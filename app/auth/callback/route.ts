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

      // Update last_sign_in in profiles
      await supabase
        .from('profiles')
        .update({ last_sign_in: new Date().toISOString() })
        .eq('id', user.id)

      // Log the login event — safe fields only, no tokens
      await supabase
        .from('activity_logs')
        .insert({
          user_id:  user.id,
          event:    'login',
          metadata: {
            email:          user.email,
            full_name:      meta?.full_name ?? null,
            avatar_url:     meta?.avatar_url ?? null,
            provider:       user.app_metadata?.provider ?? null,
            email_verified: user.email_confirmed_at != null,
          },
        })

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
