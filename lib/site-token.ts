// lib/site-token.ts
//
// Signed-token helpers for the SITE_PASSWORD gate. Used by proxy.ts
// (Edge runtime) and app/api/site-auth/route.ts (Node runtime).
//
// Format:
//   cookie value = <base64url(payload)>.<base64url(signature)>
//   payload     = JSON stringified { exp: <unix-seconds> }
//   signature   = HMAC-SHA256(payload, SITE_PASSWORD)
//
// The cookie never contains the password. The HMAC secret is the
// password — if it rotates in Vercel, all existing cookies fail to
// verify and users have to re-enter, which is the correct behavior.
//
// Web Crypto API only (crypto.subtle.* + TextEncoder) so this works
// in both the Edge runtime (proxy.ts) and the Node runtime (the
// password-validation route).

const enc = new TextEncoder()

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return new Uint8Array(sig)
}

// Constant-time byte-array equality.
function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Mint a fresh signed token good for `ttlSeconds` from now.
 */
export async function mintSiteToken(secret: string, ttlSeconds: number): Promise<string> {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  const payloadB64 = b64urlEncode(enc.encode(payload))
  const sigBytes   = await hmacSha256(secret, payloadB64)
  return `${payloadB64}.${b64urlEncode(sigBytes)}`
}

/**
 * Verify a token. Returns true iff the signature matches AND the
 * payload's `exp` is in the future.
 */
export async function verifySiteToken(secret: string, token: string | undefined | null): Promise<boolean> {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot === -1) return false
  const payloadB64 = token.slice(0, dot)
  const sigB64     = token.slice(dot + 1)
  if (!payloadB64 || !sigB64) return false

  // Recompute the signature and compare in constant time.
  const expectSig = await hmacSha256(secret, payloadB64)
  let actualSig: Uint8Array
  try { actualSig = b64urlDecode(sigB64) } catch { return false }
  if (!eqBytes(expectSig, actualSig)) return false

  // Signature OK — check expiry.
  let payload: { exp?: number }
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) } catch { return false }
  if (typeof payload.exp !== 'number') return false
  return payload.exp > Math.floor(Date.now() / 1000)
}
