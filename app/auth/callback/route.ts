// app/auth/callback/route.ts
// Supabase redirects here after Google OAuth login

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      const user = data.user
      const meta = user.user_metadata

      // Safe metadata from Google/Apple — no tokens
      const safeMetadata = {
        email:          user.email,
        full_name:      meta?.full_name ?? null,
        avatar_url:     meta?.avatar_url ?? null,
        provider:       user.app_metadata?.provider ?? null,
        email_verified: user.email_confirmed_at != null,
      }

      // Update profiles — latest login info + metadata
      await supabase
        .from('profiles')
        .update({
          last_sign_in: new Date().toISOString(),
          metadata:     safeMetadata,
        })
        .eq('id', user.id)

      // Log every login event with metadata for history
      await supabase
        .from('activity_logs')
        .insert({
          user_id:  user.id,
          event:    'login',
          metadata: safeMetadata,
        })

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
