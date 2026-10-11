// lib/palm-lines.ts — 相學館's palm filter (owner, Oct 9: "can we process the
// palm with filters to only show clear lines instead of original pictures? and
// we use those to feed into AI models"). The hand is kept and the room behind
// it goes; on the hand, the light falling across it, the skin's colour and its
// fine texture go and the creases stay, dark on white, with the hand's outline.
// The picture the visitor sees on the tile is the one the models read.
//
// Plain arithmetic on the pixels, no image library (owner, Oct 6: "no extra lib
// to use"), so the same code runs on a canvas in the browser and in the tests.
// Tuned on a real palm photo (Oct 9): the heart, head, life and fate lines come
// out clearly; faint skin texture stays pale grey.
//
//   skin      pixels whose colour (Cb, Cr) is near the middle of the picture's,
//             where the palm sits; thin strips are opened away and only the
//             biggest patch, the hand, is kept
//   smooth    the brightness, leaning on green (creases show best there),
//             lightly blurred so pores and sensor noise do not read as lines
//   light     the hand's own brightness around each spot (the room beside a
//             finger does not count, or every finger's edge would go dark)
//   crease    smooth − light: below zero where the skin is darker than around it
//   out       white; on the hand, each crease as dark as it is deep; the outline

/** Box blur by running sums, rows then columns; `r` pixels each side. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice()
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / k
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Three box blurs: close to a Gaussian. */
const soften = (src: Float32Array, w: number, h: number, r: number) => boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r)

/** The hand: skin coloured like the middle of the picture, opened, the biggest
 *  patch. Null when that is not a believable hand (too little or nearly all of
 *  the picture), and the whole picture is used instead. */
function handMask(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array | null {
  const n = w * h, side = Math.min(w, h)
  const cb = new Float32Array(n), cr = new Float32Array(n), Y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const R = rgba[i * 4], G = rgba[i * 4 + 1], B = rgba[i * 4 + 2]
    Y[i] = 0.299 * R + 0.587 * G + 0.114 * B
    cb[i] = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B
    cr[i] = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B
  }
  const cbs: number[] = [], crs: number[] = [], ys: number[] = []
  for (let y = Math.round(h * 0.45); y < Math.round(h * 0.65); y += 2) {
    for (let x = Math.round(w * 0.4); x < Math.round(w * 0.6); x += 2) { const i = y * w + x; cbs.push(cb[i]); crs.push(cr[i]); ys.push(Y[i]) }
  }
  const median = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]
  const mcb = median(cbs), mcr = median(crs), dark = 0.35 * median(ys)
  const bin = new Uint8Array(n)
  for (let i = 0; i < n; i++) bin[i] = Math.hypot(cb[i] - mcb, cr[i] - mcr) < 20 && Y[i] > dark ? 1 : 0
  // Open: shrink, then grow back; a thin strip of wall or wood that only touches the hand falls away.
  const r = Math.max(2, Math.round(side / 110))
  const f = new Float32Array(n)
  for (let i = 0; i < n; i++) f[i] = bin[i]
  const shrunk = boxBlur(f, w, h, r)
  for (let i = 0; i < n; i++) f[i] = shrunk[i] > 0.97 ? 1 : 0
  const grown = boxBlur(f, w, h, r)
  for (let i = 0; i < n; i++) bin[i] = grown[i] > 0.03 && bin[i] ? 1 : 0
  // The biggest patch is the hand.
  const label = new Int32Array(n), queue = new Int32Array(n)
  let best = 0, bestSize = 0, id = 0
  for (let s = 0; s < n; s++) {
    if (!bin[s] || label[s]) continue
    id++
    let head = 0, tail = 0
    queue[tail++] = s; label[s] = id
    while (head < tail) {
      const c = queue[head++], cx = c % w
      if (cx > 0 && bin[c - 1] && !label[c - 1]) { label[c - 1] = id; queue[tail++] = c - 1 }
      if (cx < w - 1 && bin[c + 1] && !label[c + 1]) { label[c + 1] = id; queue[tail++] = c + 1 }
      if (c >= w && bin[c - w] && !label[c - w]) { label[c - w] = id; queue[tail++] = c - w }
      if (c < n - w && bin[c + w] && !label[c + w]) { label[c + w] = id; queue[tail++] = c + w }
    }
    if (tail > bestSize) { bestSize = tail; best = id }
  }
  if (bestSize < n * 0.08 || bestSize > n * 0.85) return null
  for (let i = 0; i < n; i++) bin[i] = label[i] === best ? 1 : 0
  return bin
}

/** The palm's lines, dark on white, from an RGBA picture (any size). */
export function palmLines(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h, side = Math.min(w, h)
  const hand = handMask(rgba, w, h)
  const inHand = new Float32Array(n)
  for (let i = 0; i < n; i++) inHand[i] = hand ? hand[i] : 1
  const edge = soften(inHand, w, h, Math.max(2, Math.round(side / 200)))
  const grey = new Float32Array(n)
  for (let i = 0; i < n; i++) grey[i] = 0.25 * rgba[i * 4] + 0.6 * rgba[i * 4 + 1] + 0.15 * rgba[i * 4 + 2]
  const smooth = soften(grey, w, h, Math.max(1, Math.round(side / 900)))
  // The hand's own light: a blur of the hand alone, divided by how much hand was in it.
  const r = Math.max(3, Math.round(side / 90))
  const weighted = new Float32Array(n)
  for (let i = 0; i < n; i++) weighted[i] = smooth[i] * inHand[i]
  const num = soften(weighted, w, h, r), den = soften(inHand, w, h, r)
  const crease = new Float32Array(n)
  let sum = 0, count = 0
  for (let i = 0; i < n; i++) {
    crease[i] = den[i] > 0.05 ? smooth[i] - num[i] / den[i] : 0
    if (inHand[i]) { sum += Math.abs(crease[i]); count++ }
  }
  // How deep a crease must be to reach black: a few times the usual wobble of
  // the skin, so faint texture stays pale and real lines come out dark.
  const full = 3.2 * Math.max(0.5, sum / Math.max(1, count))
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const depth = Math.min(1, Math.max(0, -crease[i] / full))
    const on = Math.min(1, Math.max(0, (edge[i] - 0.35) / 0.3))
    let v = 255 * (1 - Math.pow(depth, 1.6) * on)
    // The hand's outline, a soft grey line where the hand ends.
    if (hand) v = Math.min(v, 255 - 120 * Math.max(0, 1 - Math.abs(edge[i] - 0.5) / 0.12))
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}
