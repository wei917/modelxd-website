// lib/remake/source.ts: what a pasted link is, and whether we can read it.
// YouTube: Gemini fetches the URL itself (we never download it, as XDirect's
// reference does). X: the X API hands us the post's video file. Everything
// else (TikTok, Instagram, Douyin, Bilibili…): downloading it ourselves would
// break the platform's terms, so the user uploads the file instead.

export type LinkKind =
  | { kind: 'youtube'; url: string }
  | { kind: 'x'; url: string; postId: string }
  /** A known platform we cannot read: the page asks for an upload, naming it. */
  | { kind: 'upload_only'; platform: string }
  | { kind: 'invalid' }

const UPLOAD_ONLY: Record<string, string> = {
  'tiktok.com': 'TikTok', 'vm.tiktok.com': 'TikTok', 'vt.tiktok.com': 'TikTok',
  'douyin.com': '抖音', 'v.douyin.com': '抖音',
  'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'fb.watch': 'Facebook',
  'bilibili.com': 'Bilibili', 'b23.tv': 'Bilibili',
  'xiaohongshu.com': '小紅書', 'xhslink.com': '小紅書',
  'threads.net': 'Threads', 'threads.com': 'Threads', 'vimeo.com': 'Vimeo',
}

export function classifyLink(raw: string): LinkKind {
  const text = raw.trim()
  // A share sheet often pastes words around the link: take the first URL.
  const found = text.match(/https?:\/\/[^\s<>"'，。]+/i)?.[0] ?? (/^[\w.-]+\.[a-z]{2,}\//i.test(text) ? `https://${text}` : null)
  if (!found) return { kind: 'invalid' }
  let u: URL
  try { u = new URL(found) } catch { return { kind: 'invalid' } }
  const host = u.hostname.replace(/^(www|m|mobile)\./, '').toLowerCase()
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    // Shorts and watch pages both work; Gemini needs a watch URL it can fetch.
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0]
      : u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2]
      : u.searchParams.get('v')
    if (!id || !/^[\w-]{6,20}$/.test(id)) return { kind: 'invalid' }
    return { kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}` }
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const postId = u.pathname.match(/\/status(?:es)?\/(\d{5,25})/)?.[1]
    if (!postId) return { kind: 'invalid' }
    return { kind: 'x', url: `https://x.com/i/status/${postId}`, postId }
  }
  const platform = UPLOAD_ONLY[host] ?? Object.entries(UPLOAD_ONLY).find(([h]) => host.endsWith(`.${h}`))?.[1]
  if (platform) return { kind: 'upload_only', platform }
  return { kind: 'upload_only', platform: host }
}
