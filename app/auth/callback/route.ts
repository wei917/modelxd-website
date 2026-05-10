// app/auth/callback/route.ts
// Supabase redirects here after Google OAuth login
//
// Next 16: cookies() is async — must be awaited.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  const oauthErrorDesc = searchParams.get('error_description')

  const cookieStore = await cookies()

  // Resolve the post-login destination: ?next= query param > auth_redirect cookie > '/'
  const redirectCookie = cookieStore.get('auth_redirect')?.value
  const next = searchParams.get('next') ?? redirectCookie ?? '/'

  // Surface OAuth provider errors before attempting an exchange
  if (oauthError) {
    console.error('[auth/callback] OAuth provider error:', oauthError, oauthErrorDesc)
    const url = new URL(`${origin}/auth/error`)
    url.searchParams.set('reason', oauthError)
    if (oauthErrorDesc) url.searchParams.set('detail', oauthErrorDesc)
    return NextResponse.redirect(url)
  }

  if (!code) {
    console.error('[auth/callback] missing code param')
    const url = new URL(`${origin}/auth/error`)
    url.searchParams.set('reason', 'missing_code')
    return NextResponse.redirect(url)
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as any)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error('[auth/callback] exchangeCodeForSession failed:', error?.message, error?.status)
    const url = new URL(`${origin}/auth/error`)
    url.searchParams.set('reason', 'exchange_failed')
    if (error?.message) url.searchParams.set('detail', error.message)
    return NextResponse.redirect(url)
  }

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

  // Daily $1 free credit grant (idempotent within the same UTC day).
  // Runs on every login so users coming back find their wallet topped up
  // without needing to do anything. Failures here are non-fatal — we'd
  // rather let the user in than block sign-in over a credit-grant hiccup.
  try {
    const { ensureDailyGrant } = await import('@/lib/credits')
    await ensureDailyGrant(user.id, 100)
  } catch (err) {
    console.warn('[auth/callback] daily grant failed:', err instanceof Error ? err.message : err)
  }

  // Consume the auth_redirect cookie so it doesn't leak into future logins
  cookieStore.set('auth_redirect', '', { path: '/', maxAge: 0 })

  // Only allow same-origin paths to prevent open-redirect
  const safeNext = next.startsWith('/') ? next : '/'
  return NextResponse.redirect(`${origin}${safeNext}`)
}
