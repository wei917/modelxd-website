// lib/partial-json.ts — the fields of a JSON object that is still being
// written, for showing a model's reply while it streams (XTell's free daily
// reading and the fortune-cookie note, Sep 29).
//
// Only string and string-array values are read; the first value of any other
// kind ends the read. A string cut off mid-way is returned as far as it goes.
// What this returns is for display only: the finished reply is still checked
// by its own parser, and the server's final answer replaces the draft.
//
// Client-safe.

export type PartialFields = Record<string, string | string[]>

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' }

export function partialFields(raw: string): PartialFields {
  const out: PartialFields = {}
  const s = String(raw ?? '')
  let i = s.indexOf('{')
  if (i < 0) return out
  i++
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  /** A string starting at the quote under `i`: its text so far, and whether
   *  its closing quote has arrived. */
  const str = (): [string, boolean] => {
    i++
    let v = ''
    while (i < s.length) {
      const c = s[i]
      if (c === '"') { i++; return [v, true] }
      if (c === '\\') {
        if (i + 1 >= s.length) break
        const e = s[i + 1]
        if (e === 'u') {
          const hex = s.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
          v += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
        v += ESC[e] ?? e
        i += 2
        continue
      }
      v += c
      i++
    }
    i = s.length
    return [v, false]
  }
  while (i < s.length) {
    ws()
    if (s[i] === ',') { i++; continue }
    if (s[i] !== '"') break
    const [key, keyDone] = str()
    if (!keyDone) break
    ws()
    if (s[i] !== ':') break
    i++
    ws()
    if (s[i] === '"') {
      const [v, done] = str()
      out[key] = v
      if (!done) break
    } else if (s[i] === '[') {
      i++
      const list: string[] = []
      out[key] = list
      let closed = false
      while (i < s.length) {
        ws()
        if (s[i] === ']') { i++; closed = true; break }
        if (s[i] === ',') { i++; continue }
        if (s[i] !== '"') { i = s.length; break }
        const [v, done] = str()
        list.push(v)
        if (!done) break
      }
      if (!closed) break
    } else break
  }
  return out
}

/** Reads a newline-delimited JSON response line by line, calling `onEvent`
 *  with each parsed line (a line that is not JSON is skipped). Resolves when
 *  the stream ends. */
export async function readNdjson(res: Response, onEvent: (e: any) => void): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) return
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += dec.decode(value, { stream: !done })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let e: any
      try { e = JSON.parse(line) } catch { continue }
      onEvent(e)
    }
    if (done) break
  }
  const last = buf.trim()
  if (last) { try { onEvent(JSON.parse(last)) } catch { /* partial last line */ } }
}

/** A response that streams newline-delimited JSON from `work`, which is
 *  handed an `emit`. Writing to a reader that has gone is a no-op, so the
 *  work (and whatever it saves) always runs to its end; `keepAlive` (Next's
 *  `after`) holds the function open for it. */
export function ndjsonResponse(work: (emit: (e: Record<string, unknown>) => void) => Promise<void>, keepAlive?: (p: Promise<unknown>) => void): Response {
  const enc = new TextEncoder()
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
  let open = true
  const emit = (e: Record<string, unknown>) => {
    if (!open || !ctrl) return
    try { ctrl.enqueue(enc.encode(JSON.stringify(e) + '\n')) } catch { open = false }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) { ctrl = c },
    cancel() { open = false },
  })
  const done = work(emit).catch(() => undefined).finally(() => {
    if (!open) return
    open = false
    try { ctrl?.close() } catch { /* already gone */ }
  })
  keepAlive?.(done)
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
