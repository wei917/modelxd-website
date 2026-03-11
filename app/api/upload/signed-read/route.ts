// app/api/upload/signed-read/route.ts
// Generates a time-limited signed READ URL for a private user-video
// Used when you want to share a video temporarily

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = createSupabaseServer()
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { path, bucket = 'create-user-videos', expiresIn = 3600 } = await req.json() as {
      path: string
      bucket?: 'create-ai-images' | 'create-ai-videos' | 'create-user-images' | 'create-user-videos'
      expiresIn?: number
    }

    // Only private (create-*) buckets need signed read URLs
    if (!bucket.startsWith('create-')) {
      return NextResponse.json({ error: 'xduel-* buckets are public — use the direct URL' }, { status: 400 })
    }

    // Ensure the path belongs to this user
    if (!path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
    )

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn) // default 1 hour

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 })
    }

    return NextResponse.json({ signedUrl: data.signedUrl, expiresIn })

  } catch (err) {
    console.error('[signed-read] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
