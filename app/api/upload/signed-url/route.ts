// app/api/upload/signed-url/route.ts
// Returns a signed URL so the client can upload directly to Supabase Storage
// — the file never passes through this server

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'

const BUCKETS = {
  // XDuel — public, user-uploaded reference inputs
  'xduel-user-images': { maxBytes: 10  * 1024 * 1024, mimes: ['image/jpeg','image/png','image/gif','image/webp'] },
  'xduel-user-videos': { maxBytes: 500 * 1024 * 1024, mimes: ['video/mp4','video/webm','video/quicktime','video/mov'] },
  // Create — private, user-uploaded inputs
  'create-user-images': { maxBytes: 10  * 1024 * 1024, mimes: ['image/jpeg','image/png','image/gif','image/webp'] },
  'create-user-videos': { maxBytes: 500 * 1024 * 1024, mimes: ['video/mp4','video/webm','video/quicktime','video/mov'] },
  // Note: ai-* buckets are written server-side in /api/duel, not via signed upload URLs
} as const

type Bucket = keyof typeof BUCKETS

export async function POST(req: NextRequest) {
  try {
    // Auth check — must be signed in
    const supabaseUser = createSupabaseServer()
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { bucket, filename, contentType, size } = body as {
      bucket: Bucket
      filename: string
      contentType: string
      size: number
    }

    // Validate bucket
    if (!bucket || !(bucket in BUCKETS)) {
      return NextResponse.json({ error: `Invalid bucket. Use: ${Object.keys(BUCKETS).join(', ')}` }, { status: 400 })
    }

    const config = BUCKETS[bucket]

    // Validate mime type
    if (!(config.mimes as readonly string[]).includes(contentType)) {
      return NextResponse.json({ error: `Invalid file type "${contentType}" for bucket "${bucket}"` }, { status: 400 })
    }

    // Validate size
    if (size > config.maxBytes) {
      return NextResponse.json({
        error: `File too large. Max ${config.maxBytes / 1024 / 1024}MB for "${bucket}"`
      }, { status: 400 })
    }

    // Sanitize filename and build path: userId/timestamp-filename
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const path = `${user.id}/${Date.now()}-${safeName}`

    // Use service role to create signed upload URL
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
    )

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path)

    if (error || !data) {
      console.error('[upload] signed URL error:', error)
      return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 })
    }

    // xduel buckets are public — return direct URL; create buckets are private — use /api/upload/signed-read
    const isPublic = bucket.startsWith('xduel-')
    const publicUrl = isPublic
      ? supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl
      : null

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path,
      publicUrl,
    })

  } catch (err) {
    console.error('[upload] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
