// lib/remake/x.ts: a post's video through the X API (app-only bearer token,
// X_BEARER_TOKEN; pay-per-use, about $0.005 a post read). X's terms allow its
// content through X's own interfaces and forbid scraping, so this is the
// route for x.com links. The file is read for the breakdown and deleted.

export type XVideo = {
  mp4Url: string
  durationSeconds: number | null
  width: number | null
  height: number | null
  text: string
}

export class XReadError extends Error {
  constructor(public code: 'x_not_configured' | 'x_unavailable' | 'x_no_video', message: string) { super(message) }
}

/** The variant to download: the smallest MP4 at or above ~720p wide, so a
 *  3-minute post stays tens of MB, not hundreds (Gemini watches at a low
 *  resolution anyway). */
function pickVariant(variants: any[]): any | null {
  const mp4 = variants.filter(v => v?.content_type === 'video/mp4' && typeof v.url === 'string')
  if (!mp4.length) return null
  const sorted = mp4.sort((a, b) => (a.bit_rate ?? 0) - (b.bit_rate ?? 0))
  return sorted.find(v => (v.bit_rate ?? 0) >= 2_000_000) ?? sorted[sorted.length - 1]
}

export async function readXVideo(postId: string): Promise<XVideo> {
  const token = process.env.X_BEARER_TOKEN
  if (!token) throw new XReadError('x_not_configured', 'X_BEARER_TOKEN is not set')
  const res = await fetch(
    `https://api.x.com/2/tweets/${postId}?expansions=attachments.media_keys&media.fields=type,duration_ms,width,height,variants`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  )
  const body: any = await res.json().catch(() => null)
  if (!res.ok || !body?.data) {
    throw new XReadError('x_unavailable', `X API ${res.status}: ${JSON.stringify(body?.errors ?? body ?? '').slice(0, 300)}`)
  }
  const media = (body.includes?.media ?? []).find((m: any) => m.type === 'video' || m.type === 'animated_gif')
  const variant = media ? pickVariant(media.variants ?? []) : null
  if (!variant) throw new XReadError('x_no_video', 'The post has no video')
  return {
    mp4Url: variant.url,
    durationSeconds: typeof media.duration_ms === 'number' ? media.duration_ms / 1000 : null,
    width: media.width ?? null,
    height: media.height ?? null,
    text: String(body.data.text ?? ''),
  }
}
