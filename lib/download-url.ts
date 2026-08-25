// lib/download-url.ts
//
// The `download` attribute on <a> is IGNORED for cross-origin URLs, so a
// bare `<a href={storageUrl} download>` opens the file inline instead of
// saving it — most visibly on mobile Chrome. Supabase Storage turns
// ?download=<name> into a Content-Disposition: attachment header, which
// works cross-origin because the SERVER asks for the save.
//
// Use for every link that points at a generated image/video in storage.
export function downloadUrl(url: string, filename: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('download', filename)
    return u.toString()
  } catch {
    return url
  }
}

/** Filename-safe, keeps CJK (our TW/JP users name boards in Chinese). */
export function safeFilename(name: string, fallback: string, ext: string): string {
  const base = (name || '').replace(/[^\w\u4e00-\u9fff\u3040-\u30ff .-]+/g, '_').trim().slice(0, 60)
  return `${base || fallback}.${ext}`
}
