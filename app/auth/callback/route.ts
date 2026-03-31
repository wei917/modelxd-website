// app/auth/callback/route.ts
// Supabase redirects here after Google OAuth login

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Determine post-login destination: query param > cookie > home
  const cookieStore = cookies()
  const nextParam = searchParams.get('next')
  const nextCookie = cookieStore.get('auth_redirect')?.value
  const next = nextParam ?? nextCookie ?? '/'

  if (code) {
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

      // Clear the auth_redirect cookie now that we've consumed it
      const response = NextResponse.redirect(`${origin}${next}`)
      response.cookies.set('auth_redirect', '', { path: '/', maxAge: 0 })
      return response
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
