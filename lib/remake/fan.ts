// lib/remake/fan.ts: our own ceiling fan, drawn over a remake (the fan
// outfit-change trend, Oct 16-17). No video model holds a fan's speed (owner,
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
  kill() { this.proc.kill() }
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
            const m = sheen[i], cap = 255 * fA
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
