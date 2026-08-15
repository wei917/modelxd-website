// scripts/dehydrate-conversation-history.ts
//
// One-off backfill: strip inline base64 images out of
// xcreates.slots[].conversationHistory, replacing each with a
// { storageImage: { bucket, path, mimeType } } marker — the form
// lib/providers/history-storage.ts now writes and rehydrates. Existing fat
// rows (11-12MB per slot, 46MB on one four-row board) are why the board
// query ran 15.6s and intermittently 500'd (measured Aug 15).
//
// Matching, per row, is byte-exact:
//   • the slot's own outputs    — paths parsed from slot.text signed URLs
//     (model-turn images were uploaded verbatim, so these always match)
//   • parent rows' outputs      — parent_ids/parent_id, same URL parsing
//     (follow-up runs inline the parent output raw, so byte-exact too)
//   • uploaded references       — input_attachments originals plus their
//     resized copies from the attachments table (the RESIZED bytes are what
//     was inlined)
// With --apply, anything still unmatched is uploaded to
// xcreate-ai-images/<user>/hist/ first, so an applied row carries ZERO
// inline base64. Dry-run reports what would remain instead.
//
// DRY-RUN by default — prints per-row before/after sizes, writes nothing.
//
//   npx tsx scripts/dehydrate-conversation-history.ts               # dry-run, all image rows
//   npx tsx scripts/dehydrate-conversation-history.ts --board=<id>  # one board only
//   npx tsx scripts/dehydrate-conversation-history.ts --row=<id>    # one row only
//   npx tsx scripts/dehydrate-conversation-history.ts --apply       # write changes
//
// dev + prod share ONE Supabase project. This script only UPDATEs the slots
// column of rows it shrinks and only ADDs storage objects — nothing is
// deleted. Run by hand, once.
//
// Safe to re-run: rows already dehydrated no longer match the inline-data
// scan and are skipped, so a run that dies mid-table (fat pages do trip
// transient fetch failures) just resumes where it left off.

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dehydrateHistory, historyHasInlineData, type HistoryImageCandidate } from '../lib/providers/history-storage'

function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

const APPLY   = process.argv.includes('--apply')
const BOARD   = process.argv.find(a => a.startsWith('--board='))?.slice(8) ?? null
const ROW     = process.argv.find(a => a.startsWith('--row='))?.slice(6) ?? null
// Small pages: a single fat row is 10-12MB of jsonb, and >30MB responses
// have been seen to die mid-transfer with undici's bare "fetch failed".
const PAGE    = 3

/** Retry a Supabase call on transient failures (same failure class route.ts
 *  retries on uploads, plus Cloudflare 5xx HTML pages — sustained fat-row
 *  paging has tripped a 522 in testing). Non-transient errors return
 *  immediately. */
async function withRetry<T extends { error: any }>(fn: () => PromiseLike<T>, what: string, attempts = 5): Promise<T> {
  let last: T
  for (let i = 1; ; i++) {
    last = await fn()
    const msg = last.error?.message ?? (last.error ? String(last.error) : '')
    if (!last.error || i >= attempts) return last
    if (!/fetch failed|network|socket|econnreset|timeout|terminated|cloudflare|<html|<!doctype/i.test(msg)) return last
    console.warn(`   ~ ${what} attempt ${i}/${attempts} failed transiently (${msg.slice(0, 120).replace(/\s+/g, ' ')}) — retrying`)
    await new Promise(r => setTimeout(r, 2000 * i))
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

/** bucket/path pairs referenced by a slot's output URLs (signed or public). */
function parseStorageUrls(text: unknown): Array<{ bucket: string; path: string }> {
  if (typeof text !== 'string' || !text) return []
  const out: Array<{ bucket: string; path: string }> = []
  for (const line of text.split('\n')) {
    const m = line.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/)
    if (m) out.push({ bucket: m[1], path: decodeURIComponent(m[2]) })
  }
  return out
}

const downloadCache = new Map<string, Buffer | null>()
async function download(bucket: string, path: string): Promise<Buffer | null> {
  const key = `${bucket}/${path}`
  if (downloadCache.has(key)) return downloadCache.get(key)!
  try {
    const { data, error } = await sb.storage.from(bucket).download(path)
    const buf = (error || !data) ? null : Buffer.from(await data.arrayBuffer())
    if (!buf) console.warn(`   ! candidate download failed: ${key} (${error?.message ?? 'no data'})`)
    downloadCache.set(key, buf)
    return buf
  } catch (err) {
    console.warn(`   ! candidate download threw: ${key}:`, err instanceof Error ? err.message : err)
    downloadCache.set(key, null)
    return null
  }
}

function countInlineParts(history: any[] | null | undefined): number {
  let n = 0
  for (const t of history ?? []) {
    for (const p of (Array.isArray(t?.parts) ? t.parts : [])) {
      if (typeof p?.inlineData?.data === 'string' && p.inlineData.data.length > 0) n++
    }
  }
  return n
}

async function candidatesForRow(row: any): Promise<HistoryImageCandidate[]> {
  const refs: Array<{ bucket: string; path: string }> = []

  // 1. This row's own outputs.
  for (const sl of (Array.isArray(row.slots) ? row.slots : [])) refs.push(...parseStorageUrls(sl?.text))

  // 2. Parent rows' outputs (one level is enough: a history only ever inlined
  //    this run's attachments — which for follow-ups ARE the parent outputs —
  //    plus this run's own outputs).
  const parentIds: string[] = (Array.isArray(row.parent_ids) && row.parent_ids.length > 0)
    ? row.parent_ids
    : (row.parent_id ? [row.parent_id] : [])
  if (parentIds.length > 0) {
    const { data: parents } = await sb.from('xcreates').select('id, slots').in('id', parentIds)
    for (const p of parents ?? []) {
      for (const sl of (Array.isArray((p as any).slots) ? (p as any).slots : [])) refs.push(...parseStorageUrls(sl?.text))
    }
  }

  // 3. Uploaded references: originals + resized copies (the resized bytes are
  //    what got inlined; originals cover the chat route's direct fetches).
  const inputPaths: string[] = (Array.isArray(row.input_attachments) ? row.input_attachments : [])
    .map((a: any) => a?.storagePath).filter(Boolean)
  for (const a of (Array.isArray(row.input_attachments) ? row.input_attachments : [])) {
    if (a?.bucket && a?.storagePath) refs.push({ bucket: a.bucket, path: a.storagePath })
  }
  if (inputPaths.length > 0) {
    const { data: atts } = await sb.from('attachments')
      .select('bucket, original_path, resized_path')
      .in('original_path', inputPaths)
    for (const a of atts ?? []) {
      if ((a as any).resized_path) refs.push({ bucket: (a as any).bucket, path: (a as any).resized_path })
    }
  }

  const seen = new Set<string>()
  const out: HistoryImageCandidate[] = []
  for (const r of refs) {
    const key = `${r.bucket}/${r.path}`
    if (seen.has(key)) continue
    seen.add(key)
    const buffer = await download(r.bucket, r.path)
    if (buffer) out.push({ bucket: r.bucket, path: r.path, buffer })
  }
  return out
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will update rows)' : 'dry-run (no writes)'}${BOARD ? `, board=${BOARD}` : ''}${ROW ? `, row=${ROW}` : ''}\n`)

  let offset = 0
  let scanned = 0, fatRows = 0, updated = 0, failedUpdates = 0
  let bytesBefore = 0, bytesAfter = 0, unmatchedTotal = 0
  // Fallback uploads carry across rows: the same reference image reused by
  // ten rows gets ONE hist/ object, and every row's marker points at it.
  const uploadedGlobal: HistoryImageCandidate[] = []

  for (;;) {
    const page = () => {
      let q = sb.from('xcreates')
        .select('id, user_id, mode, slots, parent_id, parent_ids, board_id, input_attachments, created_at')
        .eq('mode', 'image')
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (BOARD) q = q.eq('board_id', BOARD)
      if (ROW)   q = q.eq('id', ROW)
      return q
    }
    const { data: rows, error } = await withRetry(page, `page @${offset}`)
    if (error) {
      console.error(`Query failed at offset ${offset}: ${String(error.message ?? error).slice(0, 200)}`)
      console.error('Re-run the script to resume — already-dehydrated rows are skipped.')
      process.exit(1)
    }
    if (!rows || rows.length === 0) break
    offset += rows.length
    // Be gentle: dev + prod share this database, and back-to-back fat pages
    // have tripped Cloudflare 522s.
    await new Promise(r => setTimeout(r, 300))

    for (const row of rows as any[]) {
      scanned++
      const slots: any[] = Array.isArray(row.slots) ? row.slots : []
      if (!slots.some(sl => historyHasInlineData(sl?.conversationHistory))) continue
      fatRows++

      const before = JSON.stringify(slots).length
      const candidates = [...(await candidatesForRow(row)), ...uploadedGlobal]
      const preUploadLen = candidates.length
      // Dry-run uses a stub uploader so the reported "after" size is the
      // true post-apply size (signatures and unmatched images markered)
      // while writing nothing anywhere.
      let stubUploads = 0
      const stubSb: any = { storage: { from: () => ({ upload: async () => { stubUploads++; return { error: null } } }) } }
      const fallback = {
        sb: APPLY ? sb : stubSb,
        bucket: 'xcreate-ai-images',
        pathPrefix: `${row.user_id}/hist/`,
      }

      let unmatched = 0
      const newSlots: any[] = []
      for (const sl of slots) {
        if (!historyHasInlineData(sl?.conversationHistory)) { newSlots.push(sl); continue }
        const dehydrated = await dehydrateHistory(sl.conversationHistory, candidates, fallback)
        unmatched += countInlineParts(dehydrated)
        newSlots.push({ ...sl, conversationHistory: dehydrated })
      }
      const after = JSON.stringify(newSlots).length
      bytesBefore += before; bytesAfter += after; unmatchedTotal += unmatched
      // Anything dehydrateHistory uploaded this row (it pushes into the
      // array) becomes a candidate for every following row. Signatures are
      // unique per response so only image uploads land here.
      if (APPLY) uploadedGlobal.push(...candidates.slice(preUploadLen))

      const mb = (n: number) => (n / 1024 / 1024).toFixed(2)
      console.log(`${row.id}  ${mb(before)}MB → ${mb(after)}MB`
        + `  (candidates=${candidates.length}`
        + `${stubUploads > 0 ? `, would upload ${stubUploads} object(s)` : ''}`
        + `${unmatched > 0 ? `, STILL INLINE=${unmatched}` : ''})`)

      if (APPLY && after < before) {
        const { error: upErr } = await withRetry(
          () => sb.from('xcreates').update({ slots: newSlots }).eq('id', row.id), `update ${row.id}`)
        if (upErr) { failedUpdates++; console.error(`   ! update failed: ${upErr.message}`) }
        else updated++
      }
    }
    if (ROW) break
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(2)
  console.log(`\nScanned ${scanned} image rows; ${fatRows} carried inline history.`)
  console.log(`Slots JSON: ${mb(bytesBefore)}MB → ${mb(bytesAfter)}MB (${bytesBefore > 0 ? Math.round((1 - bytesAfter / bytesBefore) * 100) : 0}% smaller)`)
  if (unmatchedTotal > 0) console.log(`${unmatchedTotal} part(s) stayed inline — fallback upload failed; see warnings above.`)
  if (APPLY) console.log(`Updated ${updated} row(s)${failedUpdates > 0 ? `, ${failedUpdates} FAILED` : ''}.`)
  else if (fatRows > 0) console.log(`Dry-run only — re-run with --apply to write.`)
}

main().catch(err => { console.error(err); process.exit(1) })
