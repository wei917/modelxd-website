// scripts/guandi3d-splats.ts — one splat file for the hilltop that is sharp
// where visitors walk and light enough for a phone. A Marble world is sharp
// only near where it was captured: Marble's 500k file smears the hedges and
// trees beside the pavilion, 25-35 m out, into shards, and its full file
// (4.3M splats, 69 MB) is too big for a phone. This keeps the 500k file's
// splats near the start and far away, and puts the full file's splats in
// their place in a ring along the plaza: 1.5M splats, 26 MB
// (public/xoracle/temple3d/hill-world.spz).
//
//   npx tsx scripts/guandi3d-splats.ts <500k.spz> <full.spz> <out.spz> [r0=8] [r1=50]
//
// The ring is measured in the scene's metres (lib/xoracle-temple3d.ts, the
// hill's scale and tilt), from the capture point, and only across the plaza,
// its hedges and the trees behind them (x -25..30, z -70..15); the file keeps
// Marble's own frame. Splats in the ring that show nothing are left out:
// about a quarter of them are all but transparent (alpha under 0.04) or have
// no size. (Not outside it: the sky is made of faint splats.)
//
// It reads and writes with Spark 2.1's SpzReader and SpzWriter. Spark 2.4
// (what a fresh install gets: the repo keeps no lockfile) no longer exports
// them, so they are looked up untyped and the build does not depend on them;
// to run this again, `npm i --no-save @sparkjsdev/spark@2.1.0` first.

import fs from 'node:fs'

const spark = async () => (await import('@sparkjsdev/spark')) as any

const [smallFile, fullFile, outFile, r0Arg, r1Arg] = process.argv.slice(2)
const R0 = Number(r0Arg ?? 8), R1 = Number(r1Arg ?? 50)
const S = 1.6959796, TILT = 0.0304
const ca = Math.cos(Math.PI + TILT), sa = Math.sin(Math.PI + TILT)
const inRing = (x: number, y: number, z: number) => {
  const X = x * S, Z = (y * sa + z * ca) * S
  const r = Math.hypot(X, Z)
  return r >= R0 && r < R1 && X > -25 && X < 30 && Z > -70 && Z < 15
}

type Splat = { c: number[]; a: number; rgb: number[]; s: number[]; q: number[] }

async function read(file: string, keep: (x: number, y: number, z: number) => boolean, prune: boolean) {
  const { SpzReader } = await spark()
  if (!SpzReader) throw new Error('this Spark has no SpzReader: npm i --no-save @sparkjsdev/spark@2.1.0')
  const r = new SpzReader({ fileBytes: fs.readFileSync(file) })
  await r.parseHeader()
  const all: Splat[] = []
  await r.parseSplats(
    (i: number, x: number, y: number, z: number) => { all[i] = { c: [x, y, z], a: 0, rgb: [0, 0, 0], s: [0, 0, 0], q: [0, 0, 0, 1] } },
    (i: number, a: number) => { all[i].a = a },
    (i: number, cr: number, cg: number, cb: number) => { all[i].rgb = [cr, cg, cb] },
    (i: number, sx: number, sy: number, sz: number) => { all[i].s = [sx, sy, sz] },
    (i: number, qx: number, qy: number, qz: number, qw: number) => { all[i].q = [qx, qy, qz, qw] },
  )
  const kept = all.filter(p => keep(p.c[0], p.c[1], p.c[2]) && (!prune || (p.a >= 0.04 && Math.max(...p.s) * S >= 0.002)))
  console.log(`${file}: ${r.numSplats} splats (sh ${r.shDegree}, ${r.fractionalBits} fractional bits), ${kept.length} kept`)
  return { kept, fractionalBits: r.fractionalBits }
}

async function main() {
  const small = await read(smallFile, (x, y, z) => !inRing(x, y, z), false)
  const full = await read(fullFile, inRing, true)
  const splats = [...small.kept, ...full.kept]
  const { SpzWriter } = await spark()
  const w = new SpzWriter({ numSplats: splats.length, shDegree: 0, fractionalBits: Math.max(small.fractionalBits, full.fractionalBits) })
  splats.forEach((p, i) => {
    w.setCenter(i, p.c[0], p.c[1], p.c[2])
    w.setAlpha(i, p.a)
    w.setRgb(i, p.rgb[0], p.rgb[1], p.rgb[2])
    w.setScale(i, p.s[0], p.s[1], p.s[2])
    w.setQuat(i, p.q[0], p.q[1], p.q[2], p.q[3])
  })
  const bytes = await w.finalize()
  fs.writeFileSync(outFile, bytes)
  console.log(`${outFile}: ${splats.length} splats, ${(bytes.length / 1e6).toFixed(1)} MB${w.clippedCount ? `, ${w.clippedCount} clipped` : ''}`)
}

main().catch(e => { console.error(e); process.exit(1) })
