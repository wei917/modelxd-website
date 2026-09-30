// app/auth/callback/route.ts
// Supabase redirects here after a Google or LINE sign-in
//
// Next 16: cookies() is async — must be awaited.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { LINE_CHANNELS, LINE_COOKIE_MAX_AGE, LINE_KEY, LINE_TRY, LINE_TWIN, asLineChannel, isNewUserRefusal, lineChannelOfProvider, lineCookieDomain, otherLineChannel } from '../../../lib/line-login'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  const oauthErrorDesc = searchParams.get('error_description')

  const cookieStore = await cookies()

  // Resolve the post-login destination: ?next= query param > auth_redirect cookie > '/'
  // The cookie is URL-encoded by AuthModal so a destination can carry its own
  // query string (?template=, ?agent=1&q=...). A plain path decodes to
  // itself, so cookies written before that change still resolve correctly.
  const rawRedirectCookie = cookieStore.get('auth_redirect')?.value
  let redirectCookie = rawRedirectCookie
  try { if (rawRedirectCookie) redirectCookie = decodeURIComponent(rawRedirectCookie) }
  catch { /* malformed escape — fall through to the raw value */ }
  const next = searchParams.get('next') ?? redirectCookie ?? '/'

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

  // The remembered LINE channel, written for every modelxd.com door.
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host).split(':')[0]
  const rememberLine = (res: NextResponse, c: string) =>
    res.cookies.set(LINE_KEY, c, { path: '/', maxAge: LINE_COOKIE_MAX_AGE, sameSite: 'lax', domain: lineCookieDomain(host) })

  // One LINE person, one account (migration 113): the database refused a
  // second account for a LINE id that already has one through the other
  // channel. Sign in again through that channel, once, and the person lands
  // in their account. LINE_TRY says which channel was just tried; LINE_TWIN
  // stops a second round.
  const triedLine = asLineChannel(cookieStore.get(LINE_TRY)?.value)
  if (oauthError && triedLine && isNewUserRefusal(oauthErrorDesc) && !cookieStore.get(LINE_TWIN)?.value) {
    const other = otherLineChannel(triedLine)
    if (LINE_CHANNELS[other].live) {
      const { data: start } = await supabase.auth.signInWithOAuth({
        provider: LINE_CHANNELS[other].provider as any,
        options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
      })
      if (start?.url) {
        console.log('[auth/callback] LINE id already has an account on', other, '- signing in there')
        cookieStore.set(LINE_TRY, other, { path: '/', maxAge: 600, sameSite: 'lax' })
        cookieStore.set(LINE_TWIN, '1', { path: '/', maxAge: 300, sameSite: 'lax' })
        const res = NextResponse.redirect(start.url)
        rememberLine(res, other)
        return res
      }
    }
  }
  cookieStore.set(LINE_TWIN, '', { path: '/', maxAge: 0 })

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
    full_name:      meta?.full_name ?? meta?.name ?? null,
    avatar_url:     meta?.avatar_url ?? meta?.picture ?? null,
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

  // Consume the auth_redirect cookie so it doesn't leak into future logins
  cookieStore.set('auth_redirect', '', { path: '/', maxAge: 0 })
  cookieStore.set(LINE_TRY, '', { path: '/', maxAge: 0 })

  // Only allow same-origin paths to prevent open-redirect
  const safeNext = next.startsWith('/') ? next : '/'
  const res = NextResponse.redirect(`${origin}${safeNext}`)
  // A LINE account: remember the channel it lives on, so the next sign-in
  // in this browser goes straight there whatever the page language.
  const lineHome = (user.identities ?? []).map(i => lineChannelOfProvider(i.provider)).find(Boolean)
  if (lineHome) rememberLine(res, lineHome)
  return res
}
