// scripts/showcase-video-assets.ts — posters and fast-start copies for the video wall.
//
//   npx tsx --env-file=.env.local scripts/showcase-video-assets.ts            # dry run
//   npx tsx --env-file=.env.local scripts/showcase-video-assets.ts --apply    # writes storage
//   … --apply --force                                                        # rebuild all
//
// WHY. The wall painted each tile by loading the clip itself: 19 clips, 73 MB,
// all at once, and 13 of them had their MP4 index (the moov atom) at the END of
// the file, so the browser could not show a single frame until the whole file
// had arrived. Measured Sep 11.
//
// WHAT, for every published video piece:
//   poster      one JPEG frame, at most 720px wide  → SHOWCASE_POSTER
//   fast-start  ONLY when the index is at the end: the same streams remuxed
//               with the index moved to the front. `-c copy`, so no re-encode
//               and no quality change                → SHOWCASE_FASTSTART
// The original file is never touched. Paths are fixed per showcase id
// (lib/showcase.ts), so the img route finds them without a column.
//
// Idempotent: a piece that already has what it needs is skipped. The seed
// script calls buildVideoAssets() after it hangs new clips, so the wall stays
// fast without anyone remembering to run this.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'
import { SHOWCASE_POSTER, SHOWCASE_FASTSTART } from '../lib/showcase'

const FF = ffmpegStatic as unknown as string

const parseStored = (url: string) => {
  const m = String(url).split('\n')[0].match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

/** Is the MP4 index (moov) ahead of the media (mdat)? */
function indexAtFront(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1 << 20)
  const moov = head.indexOf('moov'), mdat = head.indexOf('mdat')
  return moov !== -1 && (mdat === -1 || moov < mdat)
}

async function exists(sb: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  const cut = path.lastIndexOf('/')
  const { data } = await sb.storage.from(bucket).list(path.slice(0, cut), { search: path.slice(cut + 1), limit: 5 })
  return !!data?.some(o => o.name === path.slice(cut + 1))
}

export async function buildVideoAssets(
  sb: SupabaseClient,
  opts: { apply: boolean; force?: boolean; log?: (s: string) => void },
): Promise<{ posters: number; fastStart: number; skipped: number; failed: number }> {
  const log = opts.log ?? ((s: string) => console.log(s))
  const { data: rows, error } = await sb.from('showcase')
    .select('id, xcreate_id, slot_index, duration_ms').eq('published', true)
  if (error) throw new Error(`showcase read failed: ${error.message}`)
  const { data: runs } = await sb.from('xcreates')
    .select('id, mode, slots, deleted_at').in('id', [...new Set((rows ?? []).map(r => r.xcreate_id))])
  const runById = new Map((runs ?? []).map(r => [r.id, r]))

  const tmp = mkdtempSync(join(tmpdir(), 'showcase-assets-'))
  const out = { posters: 0, fastStart: 0, skipped: 0, failed: 0 }
  const upload = async (bucket: string, path: string, bytes: Buffer, contentType: string) => {
    if (!opts.apply) return
    const { error: e } = await sb.storage.from(bucket).upload(path, bytes, {
      contentType, upsert: true,
      // Immutable per showcase id; the signed URL is what changes.
      cacheControl: '31536000',
    })
    if (e) throw new Error(`upload ${bucket}/${path}: ${e.message}`)
  }

  try {
    for (const r of rows ?? []) {
      const run: any = runById.get(r.xcreate_id)
      if (!run || run.deleted_at || run.mode !== 'video') continue
      const tag = r.id.slice(0, 8)
      const loc = parseStored(run.slots?.[r.slot_index]?.text ?? '')
      if (!loc) { log(`${tag}  no stored file, skipped`); out.failed++; continue }

      const needPoster = opts.force || !(await exists(sb, SHOWCASE_POSTER.bucket, SHOWCASE_POSTER.path(r.id)))
      const haveFast = !opts.force && (await exists(sb, SHOWCASE_FASTSTART.bucket, SHOWCASE_FASTSTART.path(r.id)))
      if (!needPoster && haveFast) { out.skipped++; continue }

      try {
        const { data: blob, error: dlErr } = await sb.storage.from(loc.bucket).download(loc.path)
        if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? 'empty'}`)
        const src = join(tmp, `${r.id}.mp4`)
        const bytes = Buffer.from(await blob.arrayBuffer())
        writeFileSync(src, bytes)
        const front = indexAtFront(bytes)
        const notes: string[] = [`${(bytes.length / 1e6).toFixed(1)} MB`]

        if (needPoster) {
          // A second in, or a third of the way into a very short clip: many
          // generations open on a fade from black, and a black tile is worse
          // than none.
          const at = Math.min(1, ((r.duration_ms ?? 3000) / 1000) / 3)
          const jpg = join(tmp, `${r.id}.jpg`)
          const grab = (seek: number) => execFileSync(FF, ['-v', 'error', '-y', '-ss', seek.toFixed(2), '-i', src,
            '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", '-q:v', '4', jpg], { stdio: 'pipe' })
          try { grab(at) } catch { grab(0) }
          const still = readFileSync(jpg)
          await upload(SHOWCASE_POSTER.bucket, SHOWCASE_POSTER.path(r.id), still, 'image/jpeg')
          out.posters++
          notes.push(`poster ${(still.length / 1024).toFixed(0)} KB @${at.toFixed(1)}s`)
        }

        if (!haveFast && !front) {
          const fast = join(tmp, `${r.id}.fast.mp4`)
          execFileSync(FF, ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a?',
            '-c', 'copy', '-movflags', '+faststart', fast], { stdio: 'pipe' })
          const remuxed = readFileSync(fast)
          // Only ship it if it actually is what it claims to be.
          if (!indexAtFront(remuxed)) throw new Error('remux did not move the index')
          await upload(SHOWCASE_FASTSTART.bucket, SHOWCASE_FASTSTART.path(r.id), remuxed, 'video/mp4')
          out.fastStart++
          notes.push(`fast-start copy ${(remuxed.length / 1e6).toFixed(1)} MB`)
        } else if (front) {
          notes.push('index already at front, original served')
        }
        log(`${tag}  ${notes.join(' | ')}`)
      } catch (e: any) {
        out.failed++
        log(`${tag}  FAILED: ${e?.message ?? e}`)
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const force = process.argv.includes('--force')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
  const res = await buildVideoAssets(sb, { apply, force })
  console.log(`\nposters ${res.posters} · fast-start copies ${res.fastStart} · already done ${res.skipped} · failed ${res.failed}`)
  if (!apply) console.log('DRY RUN: nothing uploaded. Re-run with --apply.')
}

// Run only when invoked directly, not when the seed script imports it.
if (process.argv[1]?.endsWith('showcase-video-assets.ts')) main().catch(e => { console.error(e); process.exit(1) })
