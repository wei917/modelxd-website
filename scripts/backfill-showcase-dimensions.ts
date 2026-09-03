// scripts/backfill-showcase-dimensions.ts — read the real pixel size of every
// hung picture and record it.
//
//   npx tsx --env-file=.env.local scripts/backfill-showcase-dimensions.ts
//   npx tsx --env-file=.env.local scripts/backfill-showcase-dimensions.ts --all
//
// Free: no model is called. Dimensions live in the first few dozen bytes of an
// image file, so this asks storage for a byte RANGE rather than downloading
// pictures — 55 rows costs a few hundred kilobytes, not ~70MB.
//
// Why this has to be read from the file at all: a slot records the options it
// was ASKED for ({"aspect_ratio":"2:3"}), never the size it actually produced,
// and storage metadata carries bytes but not dimensions. What a model gives
// you for the money is only knowable from the picture.
//
// Idempotent: rows that already have a width are skipped unless --all.

import { createClient } from '@supabase/supabase-js'

const ALL = process.argv.includes('--all')
const RANGE_BYTES = 65_536   // generous: JPEG SOF can sit past a large EXIF block

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

function parseStored(url: string): { bucket: string; path: string } | null {
  const m = String(url).split('\n')[0].match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

/** PNG: IHDR is fixed at byte 16. JPEG: walk the segments to a SOF marker. */
function dimensionsOf(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      // SOF0..SOF15 carry the frame size; C4/C8/CC are tables, not frames.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

async function main() {
  const sb = service()
  let q = sb.from('showcase').select('id, xcreate_id, slot_index, width')
  if (!ALL) q = q.is('width', null)
  const { data: rows, error } = await q
  if (error) throw new Error(`showcase read failed: ${error.message}`)
  if (!rows?.length) { console.log('nothing to backfill'); return }

  const { data: runs } = await sb.from('xcreates')
    .select('id, slots').in('id', [...new Set(rows.map(r => r.xcreate_id))])
  const byId = new Map((runs ?? []).map(r => [r.id, r]))

  let done = 0, skipped = 0
  for (const r of rows) {
    const run: any = byId.get(r.xcreate_id)
    const slot = (run?.slots as any[])?.[r.slot_index]
    const loc = slot?.text ? parseStored(slot.text) : null
    if (!loc) { skipped++; continue }

    const { data: signed } = await sb.storage.from(loc.bucket).createSignedUrl(loc.path, 300)
    if (!signed?.signedUrl) { skipped++; continue }

    // Range request: the header is all we need, so never pull the whole file.
    const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${RANGE_BYTES - 1}` } })
    if (!res.ok && res.status !== 206) { skipped++; continue }
    const dim = dimensionsOf(Buffer.from(await res.arrayBuffer()))
    if (!dim) { console.log(`  ${slot.model_name}: header unreadable`); skipped++; continue }

    const { error: upErr } = await sb.from('showcase')
      .update({ width: dim.width, height: dim.height }).eq('id', r.id)
    if (upErr) { console.log(`  update failed: ${upErr.message}`); skipped++; continue }
    done++
    process.stdout.write(`\r  read ${done}/${rows.length}`)
  }
  console.log(`\ndone: ${done} filled, ${skipped} skipped`)

  const { data: sample } = await sb.from('showcase')
    .select('width, height, xcreate_id, slot_index').not('width', 'is', null).limit(60)
  const shapes = new Map<string, number>()
  for (const s of sample ?? []) {
    const k = `${s.width}x${s.height}`
    shapes.set(k, (shapes.get(k) ?? 0) + 1)
  }
  console.log('\nsizes on the wall:')
  for (const [k, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${n}`)
}

main().catch(e => { console.error(e); process.exit(1) })
