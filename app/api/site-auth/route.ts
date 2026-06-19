// app/api/site-auth/route.ts
//
// Validates the shared site password from the /coming-soon form. On
// match, sets an HttpOnly cookie containing a SIGNED TOKEN (NOT the
// password itself).
//
// The cookie is session-only — no Max-Age, so the browser drops it
// when closed. That means every fresh browser session has to re-enter
// the password, which makes "compromised cookie" a much smaller
// concern.
//
// Token format + signing: see lib/site-token.ts. Same secret (the
// password itself) is used for HMAC, so if SITE_PASSWORD rotates,
// every issued token becomes invalid.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { mintSiteToken } from '@/lib/site-token'

const COOKIE_NAME = 'modelxd_site_unlocked'
// Even within a single browser session, expire the token after a few
// hours. Re-entering once a half-day is a small price for safety.
const TTL_SECONDS = 6 * 60 * 60   // 6 hours

export async function POST(req: Request) {
  const sitePw = process.env.SITE_PASSWORD
  if (!sitePw) {
    return Response.json({ ok: true, gateDisabled: true })
  }

  let password: string | undefined
  try {
    const body = await req.json() as { password?: string }
    password = body.password
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  if (!password || password !== sitePw) {
    return Response.json({ error: 'wrong_password' }, { status: 401 })
  }

  // Mint a signed, short-lived, session-scoped token. The cookie value
  // is the token — NOT the password.
  const token = await mintSiteToken(sitePw, TTL_SECONDS)

  // Session cookie (no Max-Age, no Expires) → browser deletes on close.
  const cookieParts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ]
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Set-Cookie': cookieParts.join('; '),
      'Content-Type': 'application/json',
    },
  })
}
