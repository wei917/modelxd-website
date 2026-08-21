// lib/download.ts
//
// Force a real download instead of a navigation. Client-side only.
//
// `<a href={url} download>` looks right but silently does nothing here: the
// HTML spec ignores the `download` attribute for CROSS-ORIGIN hrefs, and
// every result URL is a Supabase signed URL on *.supabase.co, not our own
// origin. The browser falls back to plain navigation, which is why the
// button opened a new tab and left the user to save it by hand — worse on
// mobile Chrome, where there is no "Save video as…" on the opened tab at
// all (CC July 25; profile page caught doing the same, owner Aug 21).
//
// Fetching to a blob puts the bytes on our own origin, so `download` is
// honoured and the filename sticks. Falls back to opening the URL if the
// fetch fails (expired signature, offline) — that's the old behaviour, so
// a failure is no worse than before.
//
// Extracted from app/xcreate/client.tsx so the profile gallery (and any
// future surface) shares ONE working implementation.

export async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const obj  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = obj
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoke on the next tick — revoking synchronously can cancel the
    // download in Safari before it starts.
    setTimeout(() => URL.revokeObjectURL(obj), 10_000)
  } catch (err) {
    console.warn('download failed, opening instead:', err)
    window.open(url, '_blank', 'noopener')
  }
}

/** result URL -> a sensible filename, keeping the real extension. */
export function downloadName(url: string, kind: 'image' | 'video') {
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i)?.[1] ?? (kind === 'video' ? 'mp4' : 'png')).toLowerCase()
  return `modelxd-${kind}-${Date.now()}.${ext}`
}
