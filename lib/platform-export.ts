// lib/platform-export.ts: turn a generated picture into a platform's exact
// upload file (server-only; sharp). The rules are lib/platform-specs.ts.
//
// What it guarantees: the spec's pixel size, a baseline YCbCr JPEG without
// metadata, the byte window where one exists, and for white-background specs
// an edge of pure RGB 255 (the light background joined to the frame edge is
// snapped to white). It reports each as a check, so a miss is said, not hidden.

import type { ExportCheck, ExportSpec } from './platform-specs'

/** How a picture came to be, in IPTC's Digital Source Type vocabulary: what
 *  Meta and Google read to show an "AI info" label (Meta, Feb 2024). Our
 *  re-encode drops the models' own provenance data, so the export writes
 *  this back for every AI picture. A user's own photo gets none. */
export type AiSource = 'generated' | 'edited'
const DIGITAL_SOURCE: Record<AiSource, string> = {
  generated: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  edited:    'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
}
const aiXmp = (src: AiSource) => `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE[src]}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

/** Flood from the frame edge across the background and set it to 255, like
 *  a magic wand: a pixel joins when it is light (luma 215+), nearly grey,
 *  and within 6 luma of the neighbour it was reached from. That follows the
 *  smooth light-grey gradients and soft shadows a model paints for a "white"
 *  studio, and stops at the product's edge, so whites inside the product
 *  stay as they are. */
function snapWhiteBackground(px: Buffer, w: number, h: number) {
  const n = w * h
  const luma = new Uint8Array(n)
  const ok = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 3, r = px[o], g = px[o + 1], b = px[o + 2]
    luma[i] = (r * 299 + g * 587 + b * 114) / 1000
    ok[i] = luma[i] >= 215 && Math.max(r, g, b) - Math.min(r, g, b) <= 24 ? 1 : 0
  }
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0, tail = 0
  const seed = (i: number) => { if (ok[i] && !seen[i]) { seen[i] = 1; queue[tail++] = i } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  const reach = (from: number, j: number) => {
    if (!ok[j] || seen[j] || Math.abs(luma[j] - luma[from]) > 6) return
    seen[j] = 1
    queue[tail++] = j
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % w, y = (i / w) | 0
    if (x > 0) reach(i, i - 1)
    if (x < w - 1) reach(i, i + 1)
    if (y > 0) reach(i, i - w)
    if (y < h - 1) reach(i, i + w)
  }
  for (let i = 0; i < n; i++) if (seen[i]) { const o = i * 3; px[o] = 255; px[o + 1] = 255; px[o + 2] = 255 }
}

/** Every pixel on the frame edge is white (JPEG may round 255 to 254). */
function edgeIsWhite(px: Buffer, w: number, h: number, channels: number) {
  const white = (i: number) => {
    const o = i * channels
    return px[o] >= 254 && px[o + 1] >= 254 && px[o + 2] >= 254
  }
  for (let x = 0; x < w; x++) if (!white(x) || !white((h - 1) * w + x)) return false
  for (let y = 0; y < h; y++) if (!white(y * w) || !white(y * w + w - 1)) return false
  return true
}

export async function exportToSpec(input: Buffer, spec: ExportSpec, opts: { ai?: AiSource | null } = {}): Promise<{
  buffer: Buffer; width: number; height: number; checks: ExportCheck[]
}> {
  const sharp = (await import('sharp')).default
  const meta = await sharp(input, { failOn: 'none' }).rotate().metadata()

  let w = spec.w, h = spec.h
  if (spec.side) {
    const own = Math.min(meta.width ?? spec.w, meta.height ?? spec.h)
    w = h = Math.max(spec.side.min, Math.min(spec.side.max, own))
  }

  // Pixels at the exact size. White specs fit the whole picture and fill
  // any gap with white (more background); the rest crop a shape difference
  // from the centre rather than adding bars.
  const { data } = await sharp(input, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(w, h, spec.whiteBg
      ? { fit: 'contain', background: '#ffffff' }
      : { fit: 'cover', position: 'centre' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (spec.whiteBg) snapWhiteBackground(data, w, h)

  // JPEG inside the byte window: step quality down until it fits the cap;
  // a file under a lower bound (淘寶 白底圖, momo) is re-encoded at full
  // quality, which is all a flat white picture can give.
  const encode = (quality: number, chroma: '4:2:0' | '4:4:4') => {
    const img = sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality, chromaSubsampling: chroma })
    return (opts.ai ? img.withXmp(aiXmp(opts.ai)) : img).toBuffer()
  }
  let quality = 92
  let out = await encode(quality, '4:2:0')
  while (out.length > spec.maxBytes && quality > 50) {
    quality -= 6
    out = await encode(quality, '4:2:0')
  }
  if (spec.minBytes && out.length < spec.minBytes) out = await encode(100, '4:4:4')

  // Check what was actually written, not what was meant.
  const final = await sharp(out).raw().toBuffer({ resolveWithObject: true })
  const kb = Math.round(out.length / 1000)
  const checks: ExportCheck[] = [
    { key: 'size', ok: final.info.width === w && final.info.height === h, value: `${final.info.width}×${final.info.height}` },
    { key: 'format', ok: true, value: 'JPG' },
    { key: 'bytes', ok: out.length <= spec.maxBytes && (!spec.minBytes || out.length >= spec.minBytes), value: `${kb} KB` },
  ]
  if (spec.whiteBg) {
    checks.push({ key: 'white', ok: edgeIsWhite(final.data, w, h, final.info.channels), value: 'RGB 255' })
  }
  if (opts.ai) {
    const xmp = (await sharp(out).metadata()).xmp?.toString() ?? ''
    checks.push({ key: 'ai', ok: xmp.includes(DIGITAL_SOURCE[opts.ai]), value: 'IPTC' })
  }
  return { buffer: out, width: w, height: h, checks }
}
