// scripts/guandi3d-paving.ts — the hilltop plaza's paving, drawn in code to
// match the World Labs world's own: light grey granite bricks, 50 x 25 cm in
// running bond, rows across the plaza (measured from the world's panorama
// projected straight down; its sunlit floor reads about RGB 183/177/173).
// The world's floor splats are sharp only within ~6 m of where it was
// captured; past that the scene lays this texture over them.
//
//   npx tsx scripts/guandi3d-paving.ts [out=public/xoracle/temple3d/hill-paving.jpg]
//
// One tile is 4 x 4 m (8 bricks by 16 rows) at 1024 px, so the repeat is not
// seen. A fixed seed: the same file every run.

import sharp from 'sharp'

const OUT = process.argv[2] ?? 'public/xoracle/temple3d/hill-paving.jpg'
const PX = 1024, M = 4                    // pixels, metres
const PPM = PX / M                        // 256 px a metre
const BW = 0.5 * PPM, BH = 0.25 * PPM     // a brick: 128 x 64 px
const BASE = [184, 178, 174]

let seed = 20261023
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rand(); return (s - 2) * 1.73 }

const rows = PX / BH, cols = PX / BW
// Each brick its own shade and a faint warm or cool cast.
const tone = Array.from({ length: rows * cols }, () => ({ k: 0.96 + rand() * 0.07, w: (rand() - 0.5) * 2.5 }))

const px = new Uint8Array(PX * PX * 3)
for (let y = 0; y < PX; y++) {
  const row = Math.floor(y / BH), shift = (row % 2) * BW / 2
  const ry = y - row * BH
  for (let x = 0; x < PX; x++) {
    const xs = (x + shift) % PX
    const col = Math.floor(xs / BW), rx = xs - col * BW
    const t = tone[row * cols + col]
    // Joints (8 mm, dark) and a slight darkening along each brick's edge.
    const edge = Math.min(rx, BW - 1 - rx, ry, BH - 1 - ry)
    const k = edge < 1 ? 0.62 : edge < 2 ? 0.86 : 1
    // Granite: fine grain, with dark and light flecks.
    const r = rand()
    const fleck = r < 0.025 ? -38 : r < 0.05 ? 22 : 0
    const g = gauss() * 5 + fleck
    for (let c = 0; c < 3; c++) {
      const v = (BASE[c] * t.k + g + (c === 0 ? t.w : c === 2 ? -t.w : 0)) * k
      px[(y * PX + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)))
    }
  }
}

sharp(px, { raw: { width: PX, height: PX, channels: 3 } })
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(OUT)
  .then(i => console.log(`${OUT} ${PX}x${PX} ${(i.size / 1e3).toFixed(0)} KB`))
