// lib/face-picture.ts — a profile picture, made ready to keep (Oct 2; used
// by /api/profile/face). Server-only: sharp and outbound fetches.
//
// Every picture becomes the middle square at 256 px: WebP to store, JPEG for
// the moderation check. A sign-in photo is read from the URL on the
// account's own identity, only from the providers' avatar hosts, and at a
// size worth keeping (Google and X hand out 96 px and 48 px by default).

export const SIDE = 256
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
const MAX_FETCH_BYTES = 5 * 1024 * 1024

// Where sign-in photos live. The URL comes from the identity Supabase stored,
// but only these hosts are fetched all the same.
export const PHOTO_HOSTS = /(^|\.)(googleusercontent\.com|twimg\.com|line-scdn\.net)$/

type IdentityLike = { provider: string; identity_data?: Record<string, unknown> }

/** A browser upload: a JPEG, PNG or WebP data URL of at most 3 MB. */
export function decodeDataUrl(data: string): Buffer | null {
  const m = data.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!m || m[1].length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) return null
  return Buffer.from(m[1], 'base64')
}

/** The photo on the account's identity for this provider, larger when the
 *  provider can give it. */
export async function signinPhoto(user: { identities?: IdentityLike[] }, provider: string): Promise<Buffer | null> {
  const d = user.identities?.find(i => i.provider === provider)?.identity_data ?? {}
  const url = typeof d.avatar_url === 'string' ? d.avatar_url : typeof d.picture === 'string' ? d.picture : null
  if (!url) return null
  let host: string
  try { const u = new URL(url); if (u.protocol !== 'https:') return null; host = u.hostname } catch { return null }
  if (!PHOTO_HOSTS.test(host)) return null
  const larger = largerPhotoUrl(url)
  return (larger !== url ? await fetchImage(larger) : null) ?? await fetchImage(url)
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'follow' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length <= MAX_FETCH_BYTES ? buf : null
  } catch {
    return null
  }
}

/** The middle square at 256 px: WebP to keep, JPEG for the moderation check. */
export async function square(input: Buffer): Promise<{ webp: Buffer; jpeg: Buffer } | null> {
  try {
    const sharp = (await import('sharp')).default
    const base = sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(SIDE, SIDE, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
    const [webp, jpeg] = await Promise.all([
      base.clone().webp({ quality: 82 }).toBuffer(),
      base.clone().jpeg({ quality: 85 }).toBuffer(),
    ])
    return { webp, jpeg }
  } catch {
    return null
  }
}

/** Google's "=s96-c" and X's "_normal" ask for small copies; ask for big ones. */
export function largerPhotoUrl(url: string): string {
  return url.replace(/=s\d+(-c)?$/, '=s512-c').replace(/_normal(\.\w+)$/, '_400x400$1')
}
