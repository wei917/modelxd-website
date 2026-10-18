// lib/fan-template/fan.ts: our own ceiling fan, drawn over the 風扇變裝 (fan
// outfit change) template's takes (Oct 16-18; it lived in 同款 until the owner
// split them on Oct 18: "don't mix them together"). No video model holds a
// fan's speed (owner,
// Oct 16: "the fan speed is not consistent"), so the blades are drawn here, at
// one steady speed, and each change of take is a wipe whose edge is the centre
// line of the blade passing over the frame: the part the blade has already
// crossed shows the next take, the rest still shows the current one. The edge
// is always under the solid blade, so the change never shows.
//
// Plain image maths, no vision library: every frame pixel has a fixed radius
// and angle from the hub, so the fan is a lookup in a polar copy of the fan
// picture, with motion blur applied along the angle (the speed is constant).
// The picture is a house asset (FAN_ASSET): a hub-centred RGBA fan whose hub
// was found by its 120-degree symmetry.

import sharp from 'sharp'
import { spawn } from 'node:child_process'

export const FAN_ASSET = { bucket: 'xcreate-user-images', path: 'house/fan-outfit/fan-hub.png', blades: [30.6, 149.8, 270.1] }

export type FanTake = { video: string; start: number }
export type FanOptions = {
  out: string
  ffmpeg: string
  /** The hub-centred RGBA fan picture. */
  fan: Buffer
  /** Blade centre angles in that picture, degrees (0 = right, clockwise, y down). */
  blades?: number[]
  W?: number; H?: number; fps?: number
  duration: number
  /** Hub position in the output frame (above it, so only its lower edge shows). */
  hub: [number, number]
  /** Output px per fan-picture px. */
  scale?: number
  /** Blades reshaped to one straight width (output px), just wider than the person. */
  bladeWidth: number
  /** Hub to blade tip (output px): the blade ends inside the frame in a
   *  rounded tip, as the reference's ceiling fan does (owner, Oct 18: the
   *  blades were too long). It must reach past the person's feet: beyond the
   *  tip the change of take has no blade over it (only floor there, which is
   *  the same in every take). Unset: as long as the picture's blades. */
  length?: number
  /** How far the round end reaches back from the tip (px); the blade's half
   *  width makes it a semicircle. Default 0.6 of the half width. */
  tip?: number
  /** The blades' material, a flat picture of it (the user's choice, owner
   *  Oct 18), painted on the blades past the hub, its height along the blade.
   *  Unset: the picture's own blades. */
  bladeTexture?: Buffer
  /** The hub's metal as a colour over the chrome's light and shade (e.g.
   *  gold), so it matches a luxury set (owner, Oct 18: "elegant, luxury").
   *  Unset: chrome. */
  hubTint?: [number, number, number]
  /** How much of the moving light the blades keep: 1 for polished metal; a
   *  third by default for a material (its colours stay true). */
  sheen?: number
  warpFrom?: number; warpFull?: number
  /** When the fan starts turning (s), seconds per full turn, spin-up time constant. */
  start: number; period: number; ramp?: number
  /** Fraction of a frame interval the shutter is open (motion blur). */
  shutter?: number
  /** The takes in order; take n shows after n blade crossings. */
  takes: FanTake[]
}

/** Seconds from the fan starting until a blade centre is straight below the
 *  hub (90 deg) for the first time, with the spin-up. */
export function firstCrossing(period: number, ramp = 0.3, restAngle = 30.6): number {
  const need = (90 - restAngle) / (360 / period)
  let u = need + ramp
  for (let i = 0; i < 30; i++) u = need + ramp * (1 - Math.exp(-u / ramp))
  return u
}

const SHEEN = { lo: 0.72, hi: 1.38, stripes: [{ angle: 63, at: 560, width: 70, gain: 1.0 }, { angle: 63, at: 760, width: 26, gain: 0.7 }, { angle: 63, at: 1150, width: 140, gain: 0.45 }] }

class Reader {
  private chunks: Buffer[] = []; private have = 0; private done = false; private waiters: (() => void)[] = []
  last: Buffer | null = null
  pos = -1
  private proc: ReturnType<typeof spawn>
  constructor(ffmpeg: string, file: string, private size: number, W: number, H: number, fps: number) {
    this.proc = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=lanczos,fps=${fps}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const out = this.proc.stdout!
    out.on('data', (b: Buffer) => { this.chunks.push(b); this.have += b.length; if (this.have > 4 * size) out.pause(); this.wake() })
    out.on('end', () => { this.done = true; this.wake() })
    this.proc.stderr!.on('data', () => { /* decoder noise */ })
  }
  private wake() { const w = this.waiters; this.waiters = []; w.forEach(f => f()) }
  async next(): Promise<Buffer> {
    while (this.have < this.size && !this.done) await new Promise<void>(r => this.waiters.push(r))
    if (this.have >= this.size) {
      const all = Buffer.concat(this.chunks)
      this.last = all.subarray(0, this.size)
      const rest = all.subarray(this.size)
      this.chunks = rest.length ? [Buffer.from(rest)] : []; this.have = rest.length
      if (this.have < 2 * this.size && this.proc.stdout!.isPaused()) this.proc.stdout!.resume()
    }
    if (!this.last) throw new Error('a take has no frames')
    return this.last
  }
  // A take read only partway (the last one: 2.4 s of a 4 s clip) leaves its
  // decoder blocked writing to a full pipe, where SIGTERM never lands (Oct 18:
  // one ffmpeg left behind per run). Closing the pipe and SIGKILL end it.
  kill() { this.proc.stdout?.destroy(); this.proc.kill('SIGKILL') }
}

export async function renderFanOverlay(o: FanOptions): Promise<void> {
  const W = o.W ?? 720, H = o.H ?? 1280, fps = o.fps ?? 30
  const [HX, HY] = o.hub
  const blades = o.blades ?? FAN_ASSET.blades
  const scale = o.scale ?? 1.3, warpFrom = o.warpFrom ?? 290, warpFull = o.warpFull ?? 420
  const ramp = o.ramp ?? 0.3, shutter = o.shutter ?? 0.5
  const omega = 360 / o.period
  const STEP = 10, COLS = 360 * STEP

  // The fan picture as polar textures, sharp and motion-blurred.
  const img = await sharp(o.fan).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const FN = img.info.width, half = FN / 2, fan = img.data
  let rMax = 0
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) rMax = Math.max(rMax, Math.hypot(x - HX, y - HY))
  const ROWS = Math.ceil(rMax) + 2
  const alphaAt = (x: number, y: number) => { x = Math.round(x); y = Math.round(y); return x < 0 || y < 0 || x >= FN || y >= FN ? 0 : fan[(y * FN + x) * 4 + 3] }
  const RT = Math.ceil(half)
  // Each blade's angular half-width at every picture radius; past its widest
  // point the widest is held, so a reshaped blade keeps its rounded tip.
  const halfAng = blades.map(b => {
    const out = new Float32Array(RT)
    for (let r = 1; r < RT; r++) {
      let lo = 0, hi = 0
      while (lo < 600 && alphaAt(half + r * Math.cos((b - (lo + 1) / 10) * Math.PI / 180), half + r * Math.sin((b - (lo + 1) / 10) * Math.PI / 180)) > 127) lo++
      while (hi < 600 && alphaAt(half + r * Math.cos((b + (hi + 1) / 10) * Math.PI / 180), half + r * Math.sin((b + (hi + 1) / 10) * Math.PI / 180)) > 127) hi++
      out[r] = (lo + hi) / 20
    }
    let peak = 0, peakR = 0
    for (let r = 1; r < RT; r++) { const w = 2 * r * Math.sin(out[r] * Math.PI / 180); if (w > peak) { peak = w; peakR = r } }
    for (let r = peakR; r < RT; r++) out[r] = Math.asin(Math.min(1, peak / 2 / r)) * 180 / Math.PI
    return out
  })
  const sourceAngle = (aDeg: number, r: number) => {
    const rt = r / scale
    const blend = rt <= warpFrom ? 0 : rt >= warpFull ? 1 : (rt - warpFrom) / (warpFull - warpFrom)
    if (blend === 0) return aDeg
    let j = 0, best = 999, delta = 0
    blades.forEach((b, k) => { const d = ((aDeg - b) % 360 + 540) % 360 - 180; if (Math.abs(d) < best) { best = Math.abs(d); j = k; delta = d } })
    const hRef = halfAng[j][Math.min(RT - 1, Math.round(rt))]
    const hWant = Math.asin(Math.min(1, o.bladeWidth / 2 / Math.max(r, 1))) * 180 / Math.PI
    if (hRef <= 0 || hWant <= 0) return aDeg
    return blades[j] + delta * (blend * (hRef / hWant) + (1 - blend))
  }
  const tipA = o.bladeWidth / 2, tipB = o.tip ?? tipA * 0.6
  // The user's material: where the hub disc ends (every angle still opaque
  // inside it), and the picture, sampled across and along the blade.
  let hubOut = 0
  if (o.bladeTexture || o.hubTint) {
    for (let r = 1; r < half; r++) {
      let all = true
      for (let a = 0; a < 360 && all; a += 2) all = alphaAt(half + r * Math.cos(a * Math.PI / 180), half + r * Math.sin(a * Math.PI / 180)) >= 128
      if (!all) { hubOut = r * scale; break }
    }
  }
  const material = o.bladeTexture ? await sharp(o.bladeTexture).removeAlpha().resize(256, 768, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true }) : null
  const reach = (o.length ?? ROWS) - hubOut
  const bladeSheen = o.sheen ?? 1 / 3
  const sharpTex = new Float32Array(ROWS * COLS * 4)
  for (let r = 0; r < ROWS; r++) {
    const rr = r / scale
    for (let c = 0; c < COLS; c++) {
      const a = sourceAngle(c / STEP, r) * Math.PI / 180
      const fx = half + rr * Math.cos(a) - 0.5, fy = half + rr * Math.sin(a) - 0.5
      const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0
      let R = 0, G = 0, B = 0, A = 0
      for (const [ox, oy, w] of [[0, 0, (1 - dx) * (1 - dy)], [1, 0, dx * (1 - dy)], [0, 1, (1 - dx) * dy], [1, 1, dx * dy]] as const) {
        const x = x0 + ox, y = y0 + oy
        if (x < 0 || y < 0 || x >= FN || y >= FN || w === 0) continue
        const i = (y * FN + x) * 4, al = fan[i + 3] / 255
        R += w * fan[i] * al; G += w * fan[i + 1] * al; B += w * fan[i + 2] * al; A += w * al
      }
      if ((o.length || material) && A > 0) {
        let d = 180
        for (const b of blades) { const x = ((c / STEP - b) % 360 + 540) % 360 - 180; if (Math.abs(x) < Math.abs(d)) d = x }
        const across = r * Math.sin(d * Math.PI / 180), along = r * Math.cos(d * Math.PI / 180)
        // The material, past the hub (alpha stays the picture's).
        if (material && r > hubOut) {
          const mw = material.info.width, mh = material.info.height
          const tx = Math.min(mw - 1, Math.max(0, Math.round((across / o.bladeWidth + 0.5) * (mw - 1))))
          const ty = Math.min(mh - 1, Math.max(0, Math.round((along - hubOut) / reach * (mh - 1))))
          const q = (ty * mw + tx) * 3
          R = material.data[q] * A; G = material.data[q + 1] * A; B = material.data[q + 2] * A
        }
        // The tip: the blade ends `length` along the nearest blade's centre
        // line in a half-ellipse `tip` px long (a paddle's round end; owner,
        // Oct 18: "rounder, not so square"), with a one-pixel soft edge.
        const y = along - ((o.length ?? Infinity) - tipB)
        if (y > 0) {
          const u = Math.abs(across)
          const f = (u / tipA) ** 2 + (y / tipB) ** 2 - 1
          const g = Math.hypot(2 * u / (tipA * tipA), 2 * y / (tipB * tipB)) || 1
          const m = Math.min(1, Math.max(0, 0.5 - f / g))
          R *= m; G *= m; B *= m; A *= m
        }
      }
      // The hub's metal: the chrome's light and shade in the tint's colour.
      if (o.hubTint && A > 0 && r <= hubOut) {
        const L = 0.299 * R + 0.587 * G + 0.114 * B
        R = L * o.hubTint[0]; G = L * o.hubTint[1]; B = L * o.hubTint[2]
      }
      const p = (r * COLS + c) * 4
      sharpTex[p] = R; sharpTex[p + 1] = G; sharpTex[p + 2] = B; sharpTex[p + 3] = A
    }
  }
  const blurCols = Math.max(1, Math.round(omega * shutter / fps * STEP))
  const blurTex = new Float32Array(ROWS * COLS * 4)
  for (let r = 0; r < ROWS; r++) {
    const base = r * COLS * 4
    const acc = [0, 0, 0, 0]
    for (let j = 0; j < blurCols; j++) for (let k = 0; k < 4; k++) acc[k] += sharpTex[base + (j % COLS) * 4 + k]
    for (let c = 0; c < COLS; c++) {
      const p = base + c * 4
      for (let k = 0; k < 4; k++) blurTex[p + k] = acc[k] / blurCols
      const inn = base + ((c + blurCols) % COLS) * 4
      for (let k = 0; k < 4; k++) acc[k] += sharpTex[inn + k] - sharpTex[p + k]
    }
  }

  // Per pixel: radius, angle, where each blade's crossings are counted from,
  // and the reflections that stay put on screen as the blade moves through.
  const NP = W * H
  const pr = new Float32Array(NP), pc = new Float32Array(NP), sheen = new Float32Array(NP)
  const base = blades.map(() => new Int8Array(NP))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, dx = x + 0.5 - HX, dy = y + 0.5 - HY
    pr[i] = Math.hypot(dx, dy)
    let phi = Math.atan2(dy, dx) * 180 / Math.PI; if (phi < 0) phi += 360
    pc[i] = phi
    blades.forEach((b, j) => { base[j][i] = Math.floor((b - phi) / 360) })
    let band = 0
    for (const s of SHEEN.stripes) { const a = s.angle * Math.PI / 180, d = x * Math.cos(a) + y * Math.sin(a) - s.at; band += s.gain * Math.exp(-(d * d) / (2 * s.width * s.width)) }
    sheen[i] = SHEEN.lo + (SHEEN.hi - SHEEN.lo) * Math.min(1, band)
  }
  const angle = (t: number) => { const u = t - o.start; return u <= 0 ? 0 : ramp > 0 ? omega * (u - ramp * (1 - Math.exp(-u / ramp))) : omega * u }
  const speed = (t: number) => { const u = t - o.start; return u <= 0 ? 0 : ramp > 0 ? 1 - Math.exp(-u / ramp) : 1 }

  const size = W * H * 3
  const readers = o.takes.map(t => new Reader(o.ffmpeg, t.video, size, W, H, fps))
  const enc = spawn(o.ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.out], { stdio: ['pipe', 'ignore', 'pipe'] })
  let encErr = ''
  enc.stderr!.on('data', (b: Buffer) => { encErr += b.toString() })
  const closed = new Promise<number>(r => enc.on('close', code => r(code ?? 0)))
  const out = Buffer.alloc(size)
  const frames = Math.round(o.duration * fps)
  const nTakes = o.takes.length
  try {
    for (let f = 0; f < frames; f++) {
      const t = f / fps
      const th = angle(t), sp = speed(t)
      const bufs: Buffer[] = []
      for (let k = 0; k < nTakes; k++) {
        const rd = readers[k]
        const want = Math.max(0, Math.floor((t - o.takes[k].start) * fps + 1e-6))
        while (rd.pos < want) { await rd.next(); rd.pos++ }
        bufs.push(rd.last!)
      }
      const thCols = th * STEP
      for (let i = 0; i < NP; i++) {
        let n = 0
        for (let j = 0; j < blades.length; j++) n += Math.floor((th + blades[j] - pc[i]) / 360) - base[j][i]
        const bg = bufs[Math.min(n, nTakes - 1)], o3 = i * 3
        let R = bg[o3], G = bg[o3 + 1], B = bg[o3 + 2]
        const r = pr[i]
        if (r < ROWS - 1) {
          let c = pc[i] * STEP - thCols; c %= COLS; if (c < 0) c += COLS
          const r0 = r | 0, c0 = c | 0, fr = r - r0, fc = c - c0, c1 = (c0 + 1) % COLS
          const w00 = (1 - fr) * (1 - fc), w01 = (1 - fr) * fc, w10 = fr * (1 - fc), w11 = fr * fc
          const i00 = (r0 * COLS + c0) * 4, i01 = (r0 * COLS + c1) * 4, i10 = ((r0 + 1) * COLS + c0) * 4, i11 = ((r0 + 1) * COLS + c1) * 4
          let fR = 0, fG = 0, fB = 0, fA = 0
          for (const [tex, w] of [[sharpTex, 1 - sp], [blurTex, sp]] as const) {
            if (w === 0) continue
            const a = tex[i00 + 3] * w00 + tex[i01 + 3] * w01 + tex[i10 + 3] * w10 + tex[i11 + 3] * w11
            if (a === 0) continue
            fA += w * a
            fR += w * (tex[i00] * w00 + tex[i01] * w01 + tex[i10] * w10 + tex[i11] * w11)
            fG += w * (tex[i00 + 1] * w00 + tex[i01 + 1] * w01 + tex[i10 + 1] * w10 + tex[i11 + 1] * w11)
            fB += w * (tex[i00 + 2] * w00 + tex[i01 + 2] * w01 + tex[i10 + 2] * w10 + tex[i11 + 2] * w11)
          }
          if (fA > 0) {
            // A material keeps a third of the chrome's moving light unless
            // told otherwise (its own colours stay true).
            const m = material && r > hubOut ? 1 + (sheen[i] - 1) * bladeSheen : sheen[i], cap = 255 * fA
            R = Math.min(cap, fR * m) + (1 - fA) * R; G = Math.min(cap, fG * m) + (1 - fA) * G; B = Math.min(cap, fB * m) + (1 - fA) * B
          }
        }
        out[o3] = R > 255 ? 255 : R; out[o3 + 1] = G > 255 ? 255 : G; out[o3 + 2] = B > 255 ? 255 : B
      }
      if (!enc.stdin!.write(out)) await new Promise(r => enc.stdin!.once('drain', r))
    }
    enc.stdin!.end()
    const code = await closed
    if (code !== 0) throw new Error(`fan encode failed: ${encErr.slice(0, 300)}`)
  } finally {
    for (const rd of readers) rd.kill()
  }
}
