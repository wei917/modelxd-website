#!/usr/bin/env npx tsx
// scripts/migrate-storage-paths.ts
// Moves xcreate-ai-images and xcreate-ai-videos files from the root of the
// bucket into a {userId}/ subfolder so the RLS policy
//   (storage.foldername(name))[1] = auth.uid()::text
// allows the browser client to re-sign expired URLs.
//
// Safe to re-run — skips files that are already under a userId/ prefix.
//
// Usage:
//   npx tsx scripts/migrate-storage-paths.ts
//
// Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local so the script works without a wrapper
try {
  const envPath = resolve(process.cwd(), '.env.local')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const BUCKETS = ['xcreate-ai-images', 'xcreate-ai-videos'] as const

// UUID regex — files at the root look like {jobId}_slot{N}.ext
// Files already migrated look like {userId}/{jobId}_slot{N}.ext
const ROOT_FILE_RE = /^[0-9a-f-]+_slot\d+\.\w+$/i

async function migrate() {
  // Step 1: Build a map of jobId → userId from xcreate_jobs
  console.log('Loading job → user mapping from xcreate_jobs...')
  const { data: jobs, error: jobErr } = await sb
    .from('xcreate_jobs')
    .select('id, user_id')
  if (jobErr) { console.error('Failed to load jobs:', jobErr.message); process.exit(1) }

  const jobToUser: Record<string, string> = {}
  for (const j of jobs ?? []) {
    jobToUser[j.id] = j.user_id
  }
  console.log(`  Found ${Object.keys(jobToUser).length} jobs`)

  for (const bucket of BUCKETS) {
    console.log(`\nProcessing bucket: ${bucket}`)

    // Step 2: List all files at the root of the bucket
    const { data: files, error: listErr } = await sb.storage.from(bucket).list('', { limit: 1000 })
    if (listErr) { console.error(`  Failed to list ${bucket}:`, listErr.message); continue }
    if (!files || files.length === 0) { console.log('  No files found'); continue }

    // Filter to root-level files that match the old naming pattern
    const rootFiles = files.filter(f => f.name && ROOT_FILE_RE.test(f.name))
    console.log(`  Found ${rootFiles.length} root-level files to migrate (${files.length} total)`)

    let moved = 0, skipped = 0, failed = 0

    for (const file of rootFiles) {
      const name = file.name
      // Extract jobId from filename: {jobId}_slot{N}.ext
      const jobId = name.split('_slot')[0]
      const userId = jobToUser[jobId]

      if (!userId) {
        console.warn(`  SKIP ${name} — no matching job found for jobId=${jobId}`)
        skipped++
        continue
      }

      const newPath = `${userId}/${name}`

      // Download the file
      const { data: blob, error: dlErr } = await sb.storage.from(bucket).download(name)
      if (dlErr || !blob) {
        console.error(`  FAIL download ${name}: ${dlErr?.message}`)
        failed++
        continue
      }

      const buffer = Buffer.from(await blob.arrayBuffer())
      const contentType = file.metadata?.mimetype ?? (bucket.includes('video') ? 'video/mp4' : 'image/png')

      // Upload to new path
      const { error: upErr } = await sb.storage.from(bucket).upload(newPath, buffer, {
        contentType,
        upsert: false,  // don't overwrite if already exists
      })
      if (upErr) {
        if (upErr.message?.includes('already exists') || upErr.message?.includes('Duplicate')) {
          console.log(`  SKIP ${name} → ${newPath} (already exists)`)
          skipped++
        } else {
          console.error(`  FAIL upload ${name} → ${newPath}: ${upErr.message}`)
          failed++
        }
        continue
      }

      // Delete old file
      const { error: rmErr } = await sb.storage.from(bucket).remove([name])
      if (rmErr) {
        console.warn(`  WARN moved ${name} → ${newPath} but failed to delete old: ${rmErr.message}`)
      }

      console.log(`  MOVED ${name} → ${newPath}`)
      moved++
    }

    console.log(`  Done: ${moved} moved, ${skipped} skipped, ${failed} failed`)

    // Step 3: Update signed URLs in xcreates.slots
    // The xcreates table stores signed URLs in slots[].text. We need to update
    // the storage path embedded in those URLs so refreshSlotUrls can re-sign them.
    // The URL format is: /storage/v1/object/sign/{bucket}/{path}?token=...
    // Old path: {jobId}_slot{N}.ext
    // New path: {userId}/{jobId}_slot{N}.ext
    // We can't easily update jsonb array elements in SQL, so we do it in code.
  }

  // Step 4: Re-sign all URLs in xcreates.slots so they point to the new paths
  console.log('\nUpdating signed URLs in xcreates table...')
  const { data: xcreates, error: xcErr } = await sb
    .from('xcreates')
    .select('id, user_id, slots')

  if (xcErr) { console.error('Failed to load xcreates:', xcErr.message); process.exit(1) }

  let updated = 0
  for (const row of xcreates ?? []) {
    if (!Array.isArray(row.slots) || row.slots.length === 0) continue

    let changed = false
    const newSlots = row.slots.map((slot: any) => {
      if (!slot?.text || typeof slot.text !== 'string') return slot

      // Check if it's a signed URL pointing to one of our buckets
      for (const bucket of BUCKETS) {
        // Match: /storage/v1/object/sign/{bucket}/{jobId}_slot{N}.ext
        // (root-level file, no userId prefix)
        const pattern = `/storage/v1/object/sign/${bucket}/`
        const idx = slot.text.indexOf(pattern)
        if (idx === -1) continue

        const afterBucket = slot.text.substring(idx + pattern.length)
        // Check if it's a root-level file (no slash before the query string)
        const queryIdx = afterBucket.indexOf('?')
        const filePart = queryIdx !== -1 ? afterBucket.substring(0, queryIdx) : afterBucket

        if (ROOT_FILE_RE.test(decodeURIComponent(filePart))) {
          // This is an old-style path — update it
          const newPath = `${row.user_id}/${filePart}`
          // We can't just replace the path in the signed URL because the token
          // is bound to the old path. Instead, generate a fresh signed URL.
          changed = true
          // Mark for re-signing (we'll batch this below)
          return { ...slot, _needsResign: true, _bucket: bucket, _newPath: newPath }
        }
      }
      return slot
    })

    if (!changed) continue

    // Re-sign any slots that need it
    const resignedSlots = await Promise.all(newSlots.map(async (slot: any) => {
      if (!slot._needsResign) return slot
      const { _bucket, _newPath, _needsResign, ...rest } = slot
      const { data: signed } = await sb.storage.from(_bucket).createSignedUrl(_newPath, 60 * 60 * 24)
      if (signed?.signedUrl) {
        return { ...rest, text: signed.signedUrl }
      }
      console.warn(`  WARN could not re-sign ${_bucket}/${_newPath}`)
      return rest
    }))

    const { error: updateErr } = await sb
      .from('xcreates')
      .update({ slots: resignedSlots })
      .eq('id', row.id)

    if (updateErr) {
      console.error(`  FAIL updating xcreate ${row.id}: ${updateErr.message}`)
    } else {
      updated++
    }
  }

  console.log(`Updated ${updated} xcreate rows with fresh signed URLs`)
  console.log('\nMigration complete!')
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
