// scripts/xtell-clear-icons.mjs — the temple icons without their paper square,
// for the white top bar (owner, Sep 27: the cream tiles showed as squares).
//
// Derived, not redrawn: the approved sheets (public/xtell/approved/icons.avif,
// 5 × 2 tiles of 300 px, and yixue-school-icon.avif) keep every pixel of the
// art. Only the paper that surrounds each icon is removed: a flood fill from
// the tile's edge through pixels within a small distance of that tile's
// paper colour, so paper ENCLOSED by the art (book pages, faces, the 紫微
// board's centre, halos) stays. The one- to two-pixel rim where art meets
// paper gets partial alpha with the paper colour taken back out, so there is
// no cream fringe on white or on the hover tint. The originals stay in use
// wherever the icons sit on paper (the room headers).
//
//   node scripts/xtell-clear-icons.mjs   → icons-clear.avif, yixue-school-icon-clear.avif, jiemeng-icon-clear.avif,
//                                           guanyin-icon-clear.avif, tarot-icon-clear.avif

import sharp from 'sharp'

const DIR = 'public/xtell/approved'
const FILL = 26          // RGB distance from the paper still counted as paper
const EDGE_LO = 10, EDGE_HI = 110   // rim: alpha ramps from 0 to 1 over this distance

async function clear(src, out, tile) {
  const { data, info } = await sharp(`${DIR}/${src}`).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 255 }
  for (let ty = 0; ty < H; ty += tile) for (let tx = 0; tx < W; tx += tile) {
    const x1 = Math.min(tx + tile, W), y1 = Math.min(ty + tile, H)
    // This tile's paper: the median of its border pixels, per channel.
    const border = []
    for (let x = tx; x < x1; x++) border.push([x, ty], [x, y1 - 1])
    for (let y = ty; y < y1; y++) border.push([tx, y], [x1 - 1, y])
    const med = c => { const v = border.map(([x, y]) => data[(y * W + x) * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1] }
    const bg = [med(0), med(1), med(2)]
    const dist = (x, y) => { const i = (y * W + x) * 3; return Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) }
    // Flood fill the paper that touches the tile's edge.
    const paper = new Uint8Array(W * H)
    const stack = border.filter(([x, y]) => dist(x, y) < FILL)
    for (const [x, y] of stack) paper[y * W + x] = 1
    while (stack.length) {
      const [x, y] = stack.pop()
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < tx || ny < ty || nx >= x1 || ny >= y1 || paper[ny * W + nx]) continue
        if (dist(nx, ny) < FILL) { paper[ny * W + nx] = 1; stack.push([nx, ny]) }
      }
    }
    // Paper → transparent; the art's rim next to it → partial alpha, with the
    // paper's share of each rim pixel's colour removed.
    const near = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= tx && ny >= ty && nx < x1 && ny < y1 && paper[ny * W + nx]) return true } return false }
    for (let y = ty; y < y1; y++) for (let x = tx; x < x1; x++) {
      const p = y * W + x
      if (paper[p]) { rgba[p * 4 + 3] = 0; continue }
      if (!near(x, y, 2)) continue
      const a = Math.min(1, Math.max(0, (dist(x, y) - EDGE_LO) / (EDGE_HI - EDGE_LO)))
      if (a >= 1) continue
      const alpha = Math.max(a, 0.02)
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round(Math.min(255, Math.max(0, (data[p * 3 + c] - (1 - alpha) * bg[c]) / alpha)))
      rgba[p * 4 + 3] = Math.round(a * 255)
    }
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).avif({ quality: 72, effort: 6 }).toFile(`${DIR}/${out}`)
  console.log(`${DIR}/${out}`)
}

await clear('icons.avif', 'icons-clear.avif', 300)
await clear('yixue-school-icon.avif', 'yixue-school-icon-clear.avif', 300)
await clear('jiemeng-icon.avif', 'jiemeng-icon-clear.avif', 300)
await clear('guanyin-icon.avif', 'guanyin-icon-clear.avif', 300)
await clear('tarot-icon.avif', 'tarot-icon-clear.avif', 300)
