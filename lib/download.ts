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
    // Mobile: route through the OS SHARE SHEET instead of a download. A
    // web page cannot write into the photo library — sandboxing, not a
    // bug — and a mobile download strands media in Files/Downloads where
    // users don't look for it (owner, Aug 21: "why can't I save it to my
    // Photos app?"). The share sheet is the one sanctioned bridge: "Save
    // Video"/"Save Image" (iOS) and "Photos" (Android) live there.
    // Desktop keeps the plain download — a share sheet there is noise.
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (isMobile && typeof navigator.canShare === 'function') {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          return
        } catch (err) {
          // AbortError = the user closed the sheet; that's a decision,
          // not a failure — don't dump a download on them as a consolation.
          if ((err as DOMException)?.name === 'AbortError') return
          // Anything else (share blocked, gesture expired): fall through
          // to the download path below.
        }
      }
    }
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
