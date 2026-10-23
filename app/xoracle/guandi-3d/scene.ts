// app/xoracle/guandi-3d/scene.ts — the 3D 關帝廟's scene: a Marble world
// (Spark splats), the giant 關聖帝君 with his pavilion and burner (Tripo
// meshes), the ritual's 籤筒 and 筊杯, walking, and the camera
// moves of the ritual. Each scene's places are in lib/xoracle-temple3d.ts.
//
// Walking: the collider (a coarse mesh of the world) is rasterised once into
// a 10 cm grid of floor heights and blocked cells, so a step is a lookup,
// not a raycast against 155k triangles on a phone.

import type * as THREE from 'three'
import type { Jiao } from '../../../lib/xoracle-ritual'
import { TEMPLE3D, type Placement, type Temple3DScene } from '../../../lib/xoracle-temple3d'

// Sizes in units of 2.03 m (the first world's); a scene scales them by its own unit.
const NEAR_ALTAR = 1.0       // units from the kneeling place at which 參拜 is offered
const FLOOR_GUESS = -0.6
const EYE = 0.69             // 1.4 m
const KNEEL_EYE = 0.44       // 0.9 m
const SPEED = 0.62           // 1.25 m/s
const GNX = 400, GNZ = 400        // the walking grid's cells (each scene sets their size)

export interface SceneHandle {
  ready: Promise<void>
  setMove(x: number, y: number): void
  look(dx: number, dy: number): void
  nearAltar(): boolean
  nearDoor(): boolean
  /** Inside the statue (a climb scene): go in at the pedestal's door, come
   *  back down; `onPlace` hears where the visitor is now. */
  enterStatue(): void
  leaveStatue(): void
  goTo(p: Exclude<Place, 'out'>): void
  onPlace(cb: (p: Place) => void): void
  kneel(): Promise<void>
  stand(): Promise<void>
  shake(): Promise<void>
  throwBlocks(result: Jiao): Promise<void>
  clearProps(): void
  dispose(): void
  debug: Record<string, unknown>
}

export type Place = 'out' | 'lobby' | 'top'

const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type SplatSize = '100k' | '150k' | '500k'

export async function createScene(host: HTMLElement, opts: { scene: Temple3DScene; mobile: boolean; debug: boolean; splats?: SplatSize; onProgress?: (p: number) => void }): Promise<SceneHandle> {
  const sc = opts.scene
  const MODELS = sc.models.map(m => ({ ...m, at: { ...m.at } }))
  const KNEEL = sc.kneel, MAX_RADIUS = sc.maxRadius
  const k = 2.03 / sc.unit
  const eye = EYE * k, kneelEye = KNEEL_EYE * k, speed = SPEED * k * (sc.speed ?? 1), nearAltar = NEAR_ALTAR * k
  const CELL = sc.cell ?? 0.1, GX0 = -GNX * CELL / 2, GZ0 = -GNZ * CELL / 2
  const T = await import('three')
  const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js')

  const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.mobile ? 1.25 : 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  host.appendChild(renderer.domElement)
  renderer.domElement.style.display = 'block'

  // Two scenes, drawn one after the other into the same depth buffer: the
  // meshes first, then the splats, which depth-test against them. The ritual's
  // props (layer PROPS: the 籤筒, the stick, the 筊杯) are drawn last, over
  // everything: they are always the nearest thing, and the world's soft
  // floor splats would otherwise swallow a 12 cm block.
  const scene = new T.Scene()          // meshes and lights
  const splats = new T.Scene()         // the world
  const camera = new T.PerspectiveCamera(opts.mobile ? 72 : 64, host.clientWidth / host.clientHeight, 0.005 * k, 1200)
  camera.rotation.order = 'YXZ'
  camera.position.set(sc.start.x, FLOOR_GUESS + eye, sc.start.z)
  scene.add(camera)
  splats.add(new SparkRenderer({ renderer }))
  const PROPS = 1
  const asProp = (o: THREE.Object3D) => o.traverse(c => c.layers.set(PROPS))
  renderer.autoClear = false
  renderer.setClearColor(0x0b0806, 1)

  // Light for the meshes only (the splats carry their own): a neutral room
  // for the gilding's reflections (on each material: the splats have no use
  // for scene.environment), sky fill and the sun. Tripo's PBR is full metal;
  // turned down, it takes the light.
  const pmrem = new T.PMREMGenerator(renderer)
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  const lampLit = (root: THREE.Object3D, metal: number, env: number) => root.traverse((o: any) => {
    if (o.isMesh && o.material) { o.material.metalness = metal; o.material.envMap = envMap; o.material.envMapIntensity = env; o.material.needsUpdate = true }
  })
  // The sun from the front left and high, onto his face.
  const hemi = new T.HemisphereLight(0xe4efff, 0x6b5a46, 1.25)
  scene.add(hemi)
  const key = new T.DirectionalLight(0xfff0dc, 2.4)
  key.position.set(sc.face.x - 14, sc.face.y + 20, KNEEL.z + 12)
  key.target.position.set(sc.face.x, sc.face.y, sc.face.z)
  scene.add(key, key.target)
  for (const l of [hemi, key]) l.layers.enableAll()

  // ── the world ──────────────────────────────────────────────────────────
  // 500k everywhere (or the scene's own `best` file): at the altar, 2-3 m
  // from where the world was captured, the 150k file smears into streaks
  // (Oct 22). Phones draw it at a lower pixel ratio instead; ?q=150k or 100k
  // for a weak phone.
  const spz = opts.splats ? sc.world.spz[opts.splats] : sc.world.spz.best ?? sc.world.spz['500k']
  const world = new SplatMesh({ url: spz, onProgress: (e: ProgressEvent) => { if (e.total) opts.onProgress?.(e.loaded / e.total) } })
  // Marble's frame is turned 180° about X. A world may also be scaled to
  // metres, tilted level and lifted so its ground is at zero (World Labs'
  // metric_scale_factor and ground_plane_offset; the hilltop's plaza falls
  // 1.5 m toward the statue), so models placed in metres stand on it. The
  // collider gets the same transform.
  const WS = sc.world.scale ?? 1
  const WORLD_M = new T.Matrix4().compose(
    new T.Vector3(0, sc.world.lift ?? 0, 0),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI + (sc.world.tilt ?? 0)),
    new T.Vector3(WS, WS, WS))
  const placeWorld = (o: THREE.Object3D) => { o.matrixAutoUpdate = false; o.matrix.copy(WORLD_M) }
  placeWorld(world)
  splats.add(world)

  // Drawn over the splats (they write no depth) and under the models: the
  // plaza's sharp paving (laid once the collider says where the plaza is),
  // then the models' shadows on it, a plane that is only shadow. These and
  // the pedestal's door are `outdoors`, hidden with the world while the
  // visitor is up in the statue's rooms.
  const outdoors = new T.Group(); scene.add(outdoors)
  const CATCH = 2
  if (sc.shadows) {
    const c = sc.shadows
    const plane = new T.Mesh(new T.PlaneGeometry(c.x1 - c.x0, c.z1 - c.z0), new T.ShadowMaterial({ opacity: 0.38, depthWrite: false }))
    plane.rotation.x = -Math.PI / 2
    plane.position.set((c.x0 + c.x1) / 2, c.y, (c.z0 + c.z1) / 2)
    plane.receiveShadow = true
    plane.layers.set(CATCH)
    plane.renderOrder = 2
    outdoors.add(plane)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.type = T.PCFShadowMap
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const r = MAX_RADIUS * 0.9
    Object.assign(key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 6 })
    key.shadow.bias = -0.0005
  }

  // ── walking grid from the collider ─────────────────────────────────────
  const floorY = new Float32Array(GNX * GNZ).fill(NaN)
  const blocked = new Uint8Array(GNX * GNZ)
  let floorLevel = FLOOR_GUESS
  let gridReady = false
  const cellOf = (x: number, z: number) => {
    const i = Math.floor((x - GX0) / CELL), k = Math.floor((z - GZ0) / CELL)
    return i < 0 || k < 0 || i >= GNX || k >= GNZ ? -1 : k * GNX + i
  }
  function buildGrid(geom: THREE.BufferGeometry) {
    const p = geom.attributes.position.array as ArrayLike<number>
    const idx = geom.index ? (geom.index.array as ArrayLike<number>) : null
    const tri = idx ? idx.length / 3 : p.length / 9
    const e = WORLD_M.elements
    const v = (n: number, o: number[]) => {   // Marble → three (metres, level, lifted)
      const x = p[n * 3], y = p[n * 3 + 1], z = p[n * 3 + 2]
      o[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; o[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; o[2] = e[2] * x + e[6] * y + e[10] * z + e[14]
    }
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0]
    // The floor: the most common height of up-facing surfaces near the origin.
    const hist = new Map<number, number>()
    const samples: number[] = []   // x, y, z, up
    const ups: number[] = []       // heights of up-facing surfaces near the origin
    for (let t = 0; t < tri; t++) {
      v(idx ? idx[t * 3] : t * 3, a); v(idx ? idx[t * 3 + 1] : t * 3 + 1, b); v(idx ? idx[t * 3 + 2] : t * 3 + 2, c)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2]
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
      const nl = Math.hypot(nx, ny, nz) || 1
      const up = Math.abs(ny / nl) > 0.7 ? 1 : 0
      const span = Math.max(Math.hypot(ux, uz), Math.hypot(wx, wz), Math.hypot(c[0] - b[0], c[2] - b[2]))
      const n = Math.max(1, Math.ceil(span / (CELL * 0.5)))
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const s = i / n, r = j / n
        const x = a[0] + ux * s + wx * r, y = a[1] + uy * s + wy * r, z = a[2] + uz * s + wz * r
        samples.push(x, y, z, up)
        if (up && x * x + z * z < 9) { const h = Math.round(y * 20) / 20; hist.set(h, (hist.get(h) ?? 0) + 1); ups.push(y) }
      }
    }
    // The lowest common one: a table or a lion's plinth beside the start is
    // up-facing too, and was taken for the floor on the hilltop (Oct 22).
    ups.sort((a, b) => a - b)
    const low = ups.length ? ups[Math.floor(ups.length * 0.05)] : FLOOR_GUESS
    let best = 0
    for (const [h, n] of hist) if (h < 0 && h <= low + 0.25 && n > best) { best = n; floorLevel = h }
    // Each cell's floor is its lowest up-facing surface (a table top faces up
    // too, but there is floor under or beside it), within reach of the start's
    // level, so the ground may rise toward a temple (roofs and the sky shell
    // are not floor). Then anything between knee and head height over that
    // floor blocks the cell.
    for (let s = 0; s < samples.length; s += 4) {
      const x = samples[s], y = samples[s + 1], z = samples[s + 2]
      const cell = cellOf(x, z)
      if (cell < 0 || !samples[s + 3] || y < floorLevel - 0.3 || y > floorLevel + 2) continue
      if (Number.isNaN(floorY[cell]) || y < floorY[cell]) floorY[cell] = y
    }
    const knee = 0.12 * k, head = 0.95 * k
    for (let s = 0; s < samples.length; s += 4) {
      const x = samples[s], y = samples[s + 1], z = samples[s + 2]
      const cell = cellOf(x, z)
      if (cell < 0 || Number.isNaN(floorY[cell])) continue
      if (y > floorY[cell] + knee && y < floorY[cell] + head) blocked[cell] = 1
    }
    // Ground standing above its surroundings is a thing (a table, a plinth),
    // not floor: the coarse collider ramps a table's edge, so the step rule
    // alone let a visitor walk up onto the hall's low table (Oct 22). Each
    // floor is compared with the mean floor about a metre around it (summed-
    // area tables); a broad rise, stairs or a slope, stays walkable.
    {
      const W = GNX + 1, sum = new Float64Array(W * (GNZ + 1)), cnt = new Float64Array(W * (GNZ + 1))
      for (let kz = 0; kz < GNZ; kz++) for (let i = 0; i < GNX; i++) {
        const f = floorY[kz * GNX + i], has = Number.isNaN(f) ? 0 : 1
        const o = (kz + 1) * W + i + 1
        sum[o] = (has ? f : 0) + sum[o - 1] + sum[o - W] - sum[o - W - 1]
        cnt[o] = has + cnt[o - 1] + cnt[o - W] - cnt[o - W - 1]
      }
      const R = Math.max(3, Math.round(1.0 * k / CELL))
      for (let kz = 0; kz < GNZ; kz++) for (let i = 0; i < GNX; i++) {
        const f = floorY[kz * GNX + i]
        if (Number.isNaN(f)) continue
        const x0 = Math.max(0, i - R), x1 = Math.min(GNX, i + R + 1), z0 = Math.max(0, kz - R), z1 = Math.min(GNZ, kz + R + 1)
        const at = (z: number, x: number) => z * W + x
        const n = cnt[at(z1, x1)] - cnt[at(z0, x1)] - cnt[at(z1, x0)] + cnt[at(z0, x0)]
        const t = sum[at(z1, x1)] - sum[at(z0, x1)] - sum[at(z1, x0)] + sum[at(z0, x0)]
        if (n > 0 && f > t / n + 0.1 * k) blocked[kz * GNX + i] = 1
      }
    }
    // A body is wider than a cell: grow every obstacle by one cell.
    const grown = blocked.slice()
    for (let k = 1; k < GNZ - 1; k++) for (let i = 1; i < GNX - 1; i++) {
      if (!blocked[k * GNX + i]) continue
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) grown[(k + dk) * GNX + i + di] = 1
    }
    blocked.set(grown)
    gridReady = true
    if (sc.pave) layPaving(sc.pave)
  }
  // The paving shows where the floor is plaza: near zero and clear of the
  // collider's hedges and slopes (softened over half a metre), and fades in
  // from where the world's own floor goes soft.
  function layPaving(pv: NonNullable<Temple3DScene['pave']>) {
    const w = Math.round((pv.x1 - pv.x0) / CELL), d = Math.round((pv.z1 - pv.z0) / CELL)
    let m = new Float32Array(w * d)
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const cell = cellOf(pv.x0 + (i + 0.5) * CELL, pv.z0 + (j + 0.5) * CELL), f = cell < 0 ? NaN : floorY[cell]
      m[j * w + i] = cell >= 0 && !blocked[cell] && Math.abs(f - pv.y) < 0.35 ? 1 : 0
    }
    const R = Math.max(1, Math.round(0.25 / CELL))
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(w * d)
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
        let s = 0, n = 0
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          const jj = j + dj, ii = i + di
          if (jj >= 0 && jj < d && ii >= 0 && ii < w) { s += m[jj * w + ii]; n++ }
        }
        o[j * w + i] = s / n
      }
      m = o
    }
    // A data texture, never flipped: its first row is the plane's bottom
    // edge once laid flat, the near one (z1).
    const px = new Uint8Array(w * d * 4)
    const [f0, f1] = pv.fade
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const r = Math.hypot(pv.x0 + (i + 0.5) * CELL, pv.z0 + (j + 0.5) * CELL)
      const t = Math.max(0, Math.min(1, (r - f0) / (f1 - f0)))
      const a = Math.round(255 * Math.max(0, Math.min(1, (m[j * w + i] - 0.15) / 0.7)) * t * t * (3 - 2 * t))
      px.set([a, a, a, 255], ((d - 1 - j) * w + i) * 4)
    }
    const alpha = new T.DataTexture(px, w, d)
    alpha.magFilter = alpha.minFilter = T.LinearFilter
    alpha.needsUpdate = true
    const map = new T.TextureLoader().load(pv.url)
    map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping
    map.repeat.set((pv.x1 - pv.x0) / 4, (pv.z1 - pv.z0) / 4); map.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const plane = new T.Mesh(new T.PlaneGeometry(pv.x1 - pv.x0, pv.z1 - pv.z0), new T.MeshBasicMaterial({ map, alphaMap: alpha, transparent: true, depthWrite: false, toneMapped: false }))
    plane.rotation.x = -Math.PI / 2
    plane.position.set((pv.x0 + pv.x1) / 2, pv.y, (pv.z0 + pv.z1) / 2)
    plane.layers.set(CATCH)
    plane.renderOrder = 1
    outdoors.add(plane)
  }
  const walkable = (x: number, z: number) => {
    if (x * x + z * z > MAX_RADIUS * MAX_RADIUS) return false
    if (!gridReady) return x * x + z * z < 1
    const cell = cellOf(x, z)
    return cell >= 0 && !blocked[cell] && !Number.isNaN(floorY[cell])
  }
  // A step may climb a stair, not onto a table: the floor may not jump.
  const STEP = sc.stepMax ?? 0.1 * k
  const canStep = (fx: number, fz: number, x: number, z: number) =>
    walkable(x, z) && (!gridReady || Math.abs(floorAt(x, z) - floorAt(fx, fz)) <= STEP)
  const floorAt = (x: number, z: number) => {
    const cell = cellOf(x, z)
    const f = cell >= 0 ? floorY[cell] : NaN
    return Number.isNaN(f) ? floorLevel : f
  }

  const loader = new GLTFLoader()
  const load = (url: string) => new Promise<any>((res, rej) => loader.load(url, res, undefined, rej))

  const colliderP = load(sc.world.collider).then(g => {
    let geom: THREE.BufferGeometry | null = null
    g.scene.traverse((o: any) => { if (o.isMesh && !geom) geom = o.geometry })
    if (geom) buildGrid(geom)
    camera.position.y = floorAt(camera.position.x, camera.position.z) + eye
    if (opts.debug) {
      const m = g.scene
      placeWorld(m)
      m.traverse((o: any) => { if (o.isMesh) o.material = new T.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, transparent: true, opacity: 0.25 }) })
      m.visible = false
      scene.add(m)
      debug.collider = m
    }
  }).catch(e => console.warn('[temple3d] collider', e))

  // ── the models: the giant statue, his pavilion and the burner ─────────
  // Each is placed by the bottom of its bounding box (measured before it has
  // a parent), so `at.y` is where it stands.
  const groups = MODELS.map(() => { const g = new T.Group(); scene.add(g); return g })
  const boxes = MODELS.map(() => new T.Box3(new T.Vector3(-0.5, -0.5, -0.5), new T.Vector3(0.5, 0.5, 0.5)))
  const placeModel = (i: number) => {
    const m = MODELS[i], p = m.at, g = groups[i]
    g.scale.setScalar(p.s)
    g.rotation.y = p.ry
    g.position.set(p.x, p.y - boxes[i].min.y * p.s, p.z)
  }
  const modelsP = Promise.all(MODELS.map((m, i) => load(m.url).then(g => {
    g.scene.traverse((o: any) => { if (o.isMesh) { o.material.side = T.FrontSide; o.castShadow = o.receiveShadow = !!sc.shadows } })
    lampLit(g.scene, m.metal ?? 0.45, 0.35)
    boxes[i] = new T.Box3().setFromObject(g.scene)
    groups[i].add(g.scene)
    placeModel(i)
  })))
  MODELS.forEach((_, i) => placeModel(i))
  if (sc.doorway) {
    // Lamplight deep inside, falling to dark at the frame.
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 160
    const cx = cv.getContext('2d')!
    const grad = cx.createRadialGradient(64, 110, 6, 64, 100, 110)
    grad.addColorStop(0, '#ffcf7a'); grad.addColorStop(0.25, '#b0571e'); grad.addColorStop(0.7, '#3a170b'); grad.addColorStop(1, '#120805')
    cx.fillStyle = grad; cx.fillRect(0, 0, 128, 160)
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace
    const d = sc.doorway
    const plane = new T.Mesh(new T.PlaneGeometry(d.w, d.h), new T.MeshBasicMaterial({ map: tex, toneMapped: false }))
    plane.position.set(d.x, d.y + d.h / 2, d.z)
    outdoors.add(plane)
  }
  // ── inside the statue (the hilltop; owner, Oct 22-23: "walk inside and go
  // top of the state", then "2 options ... top or exit" and "on top of his
  // hat, and 360 view, users can walk around on a small platform which is
  // his hat"). A small lobby inside the pedestal, and from it straight up to
  // a deck on his hat, open all round: his own shell stays in sight below,
  // the rest of the plaza gives way to a panorama (a splat world seen from
  // 34 m up falls apart). Each is drawn only while the visitor is in it.
  let place: Place = 'out'
  let onPlace: (p: Place) => void = () => {}
  const rooms = new Map<Place, THREE.Group>()
  const views = new Map<Place, { sky: THREE.Mesh; url: string }>()
  // As image bitmaps flipped while decoding: from an <img>, the second of
  // the two panoramas reached the GPU upside down in Chrome whatever
  // UNPACK_FLIP_Y said (Oct 23), and a bitmap ignores that setting.
  let viewsLoading = false
  const loadViews = () => {
    if (viewsLoading) return
    viewsLoading = true
    const bitmaps = typeof createImageBitmap === 'function' ? new T.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY' }) : null
    views.forEach(v => {
      const m = v.sky.material as THREE.MeshBasicMaterial
      const use = (t: THREE.Texture) => { t.colorSpace = T.SRGBColorSpace; t.needsUpdate = true; m.map = t; m.needsUpdate = true }
      if (bitmaps) bitmaps.load(v.url, b => { const t = new T.Texture(b); t.flipY = false; use(t) })
      else new T.TextureLoader().load(v.url, use)
    })
  }
  const lantern = new T.PointLight(0xffc27a, 0, 9 / sc.unit, 1.2); lantern.layers.enableAll(); scene.add(lantern)
  if (sc.climb) {
    const c = sc.climb
    const bronze = new T.TextureLoader().load(TEMPLE3D.bronze)
    bronze.colorSpace = T.SRGBColorSpace
    bronze.wrapS = bronze.wrapT = T.RepeatWrapping
    const TILE = 1.6 / sc.unit
    // Dim on purpose: the sun lights these too (they take no shadow); the
    // lantern the visitor carries does the rest.
    const dim = (r: number, h: number, f: number) => {
      const t = bronze.clone(); t.repeat.set(2 * Math.PI * r / TILE, h / TILE); t.needsUpdate = true
      return new T.MeshLambertMaterial({ map: t, color: new T.Color(f, f, f), side: T.BackSide })
    }
    for (const [name, rm] of Object.entries(c.rooms) as [Exclude<Place, 'out'>, NonNullable<typeof c.rooms.lobby>][]) {
      const g = new T.Group(); g.position.set(rm.x, rm.y, rm.z); g.visible = false
      if (rm.deck) {
        // The deck: a bronze floor on his hat, a skirt flaring down into the
        // hat so it does not float, and a low bronze parapet with a gilt cap
        // at the rim (solid: the panorama right below the deck is not the
        // plaza, and over a parapet one looks out, not down).
        const u = 1 / sc.unit
        const t = bronze.clone(); t.repeat.set(2 * rm.r / TILE, 2 * rm.r / TILE); t.needsUpdate = true
        const metal = new T.MeshStandardMaterial({ map: t, color: 0x8a7a66, metalness: 0.5, roughness: 0.55, envMap, envMapIntensity: 0.5 })
        const floor = new T.Mesh(new T.CylinderGeometry(rm.r, rm.r * 0.94, 0.18 * u, 64), metal)
        floor.position.y = -0.09 * u
        const skirt = new T.Mesh(new T.CylinderGeometry(rm.r * 0.93, rm.r * 0.4, 0.8 * u, 64, 1, true), metal)
        skirt.position.y = -0.58 * u
        const gilt = new T.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.35, envMap, envMapIntensity: 0.9 })
        const WALL = 0.8 * u, rr = rm.r - 0.06 * u
        const wt = bronze.clone(); wt.repeat.set(2 * Math.PI * rr / TILE, WALL / TILE); wt.needsUpdate = true
        const wall = new T.Mesh(new T.CylinderGeometry(rr, rr, WALL, 96, 1, true), new T.MeshStandardMaterial({ map: wt, color: 0x8a7a66, metalness: 0.5, roughness: 0.55, envMap, envMapIntensity: 0.5, side: T.DoubleSide }))
        wall.position.y = WALL / 2
        g.add(wall)
        for (const [y, tube] of [[WALL, 0.06], [0.08 * u, 0.035]]) {
          const ring = new T.Mesh(new T.TorusGeometry(rr, tube * u, 10, 128), gilt)
          ring.rotation.x = Math.PI / 2; ring.position.y = y
          g.add(ring)
        }
        g.add(floor, skirt)
        g.traverse((o: any) => { if (o.isMesh) o.castShadow = o.receiveShadow = true })
      } else {
        // The lobby: a closed bronze room, lit by the lantern one carries.
        const h = rm.h ?? 3 / sc.unit
        const wall = new T.Mesh(new T.CylinderGeometry(rm.r, rm.r, h, 32, 1, true), dim(rm.r, h, 0.4))
        wall.position.y = h / 2
        const floor = new T.Mesh(new T.CircleGeometry(rm.r, 32), new T.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.9 }))
        floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01
        const ceiling = new T.Mesh(new T.CircleGeometry(rm.r, 32), dim(rm.r, 1, 0.3))
        ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = h
        g.add(wall, floor, ceiling)
      }
      rooms.set(name, g)
      scene.add(g)
      // Its panorama round the visitor's eyes, its middle (the picture it
      // was made from) where he looks, +Z. Loaded on the way in.
      if (rm.view) {
        const geo = new T.SphereGeometry(400 / sc.unit, 64, 32); geo.scale(-1, 1, 1)
        const sky = new T.Mesh(geo, new T.MeshBasicMaterial({ toneMapped: false, depthWrite: false, fog: false }))
        sky.rotation.y = Math.PI / 2
        sky.position.set(rm.x, rm.y + eye, rm.z)
        sky.renderOrder = -1; sky.visible = false
        views.set(name, { sky, url: rm.view })
        scene.add(sky)
      }
    }
    // The way in: a small door set into his stone pedestal, the stone's own
    // grey, lamplit within (owner: "make the door smaller and blend into the
    // state").
    if (c.gate) {
      const gt = c.gate, stone = new T.MeshStandardMaterial({ color: 0x7d7b77, roughness: 0.9 })
      const post = 0.28 / sc.unit
      for (const sx of [-1, 1]) {
        const pm = new T.Mesh(new T.BoxGeometry(post, gt.h, post * 1.4), stone)
        pm.position.set(gt.x + sx * (gt.w / 2 + post / 2), gt.h / 2, gt.z); pm.castShadow = true; outdoors.add(pm)
      }
      const lintel = new T.Mesh(new T.BoxGeometry(gt.w + post * 2.6, post * 1.1, post * 1.6), stone)
      lintel.position.set(gt.x, gt.h + post * 0.55, gt.z); lintel.castShadow = true; outdoors.add(lintel)
    }
  }
  const lightsOut = { hemi: hemi.intensity, key: key.intensity }
  // Arrive: in the lobby, facing its far wall; on the deck, near its front
  // edge, looking where he looks (+Z), down over the pavilion and the plaza.
  function goTo(p: Exclude<Place, 'out'>) {
    const rm = sc.climb?.rooms[p]
    if (!rm) return
    place = p
    const deck = !!rm.deck
    rooms.forEach((g, k) => { g.visible = k === p })
    groups.forEach((g, i) => { g.visible = deck && i === sc.climb!.statue })
    loadViews()
    world.visible = outdoors.visible = false
    views.forEach((v, k) => { v.sky.visible = k === p })
    lantern.intensity = deck ? 0 : 3
    hemi.intensity = lightsOut.hemi * (deck ? 1 : 0.9)
    camera.position.set(rm.x, rm.y + eye, rm.z + rm.r * (deck ? 0.6 : -0.35))
    yaw = Math.PI; pitch = deck ? -0.38 : 0.12
    camera.rotation.set(pitch, yaw, 0)
    lantern.position.set(camera.position.x, camera.position.y + 0.4 / sc.unit, camera.position.z)
    onPlace(place)
  }
  function enterStatue() { goTo('lobby') }
  function leaveStatue() {
    place = 'out'; lantern.intensity = 0
    rooms.forEach(g => { g.visible = false })
    for (const g of groups) g.visible = true
    world.visible = outdoors.visible = true
    views.forEach(v => { v.sky.visible = false })
    hemi.intensity = lightsOut.hemi
    const d = sc.climb?.door
    if (d) camera.position.set(d.x, floorAt(d.x, d.z) + eye, d.z + 1.5 / sc.unit)
    yaw = 0; pitch = 0.25
    camera.rotation.set(pitch, yaw, 0)
    onPlace(place)
  }

  // The models are solid: their footprints join the blocked cells once both
  // the grid and the models are in (the door is reached from in front).
  // A model to walk into (`walk: 'mesh'`, the open pavilion) adds its own
  // floors (its platform and steps) and blocks only what stands between knee
  // and head (its columns); the rest block their whole footprint.
  const rasterize = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true)
    const samples: number[] = []
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), u = new T.Vector3(), w = new T.Vector3()
    root.traverse((o: any) => {
      if (!o.isMesh) return
      const pa = o.geometry.attributes.position, idx = o.geometry.index
      const tri = idx ? idx.count / 3 : pa.count / 3
      for (let t = 0; t < tri; t++) {
        a.fromBufferAttribute(pa, idx ? idx.getX(t * 3) : t * 3).applyMatrix4(o.matrixWorld)
        b.fromBufferAttribute(pa, idx ? idx.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(o.matrixWorld)
        c.fromBufferAttribute(pa, idx ? idx.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(o.matrixWorld)
        u.subVectors(b, a); w.subVectors(c, a)
        const ny = u.z * w.x - u.x * w.z, nl = Math.hypot(u.y * w.z - u.z * w.y, ny, u.x * w.y - u.y * w.x) || 1
        const up = ny / nl > 0.7 ? 1 : 0
        const span = Math.max(Math.hypot(u.x, u.z), Math.hypot(w.x, w.z), Math.hypot(c.x - b.x, c.z - b.z))
        const n = Math.max(1, Math.ceil(span / (CELL * 0.5)))
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          const s1 = i / n, r1 = j / n
          samples.push(a.x + u.x * s1 + w.x * r1, a.y + u.y * s1 + w.y * r1, a.z + u.z * s1 + w.z * r1, up)
        }
      }
    })
    for (let i = 0; i < samples.length; i += 4) {
      const cell = cellOf(samples[i], samples[i + 2]), y = samples[i + 1]
      if (cell >= 0 && samples[i + 3] && y < 1.4 / sc.unit && y > floorY[cell]) floorY[cell] = y
    }
    const knee = 0.25 / sc.unit, head = 1.9 / sc.unit
    for (let i = 0; i < samples.length; i += 4) {
      const cell = cellOf(samples[i], samples[i + 2]), y = samples[i + 1]
      if (cell >= 0 && y > floorY[cell] + knee && y < floorY[cell] + head) blocked[cell] = 1
    }
  }
  Promise.all([colliderP, modelsP]).then(() => {
    MODELS.forEach((m, i) => {
      const g = groups[i]
      if (m.walk === 'mesh') { rasterize(g); return }
      g.updateMatrixWorld(true)
      const b = new T.Box3().setFromObject(g)
      for (let x = b.min.x; x <= b.max.x; x += CELL / 2) for (let z = b.min.z; z <= b.max.z; z += CELL / 2) {
        const cell = cellOf(x, z)
        if (cell >= 0) blocked[cell] = 1
      }
    })
  }).catch(() => {})

  // ── the 籤筒 and the 筊杯 ──────────────────────────────────────────────
  const tube = new T.Group(); tube.visible = false; camera.add(tube)
  const tubeP = load(TEMPLE3D.tube).then(g => {
    const box = new T.Box3().setFromObject(g.scene), size = box.getSize(new T.Vector3())
    const s = 0.12 / size.y              // a 25 cm tube
    g.scene.scale.setScalar(s)
    g.scene.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s - 0.06, -(box.min.z + size.z / 2) * s)
    lampLit(g.scene, 0.1, 0.4)
    asProp(g.scene)
    tube.add(g.scene)
  })
  // The one stick that comes out: a thin bamboo slat with a red tip.
  const stick = new T.Group()
  {
    const slat = new T.Mesh(new T.BoxGeometry(0.0065, 0.14, 0.0018), new T.MeshStandardMaterial({ color: 0xd9b77e, roughness: 0.7 }))
    const tip = new T.Mesh(new T.BoxGeometry(0.007, 0.02, 0.0022), new T.MeshStandardMaterial({ color: 0xc22a1c, roughness: 0.5 }))
    tip.position.y = 0.06
    stick.add(slat, tip)
    stick.visible = false
    tube.add(stick)
    asProp(stick)
  }
  let blockGeo: { geometry: THREE.BufferGeometry; material: THREE.Material } | null = null
  const blockP = load(TEMPLE3D.block).then(g => {
    let mesh: any = null
    g.scene.traverse((o: any) => { if (o.isMesh && !mesh) mesh = o })
    if (!mesh) return
    // Tripo rounded both faces; a 筊 has one flat face. Flatten the back
    // (local -Z), thin it, and size it to a 12 cm block.
    const geo = (mesh.geometry as THREE.BufferGeometry).clone()
    geo.applyMatrix4(mesh.matrixWorld)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!, cz = (bb.min.z + bb.max.z) / 2
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      let z = pos.getZ(i) - cz
      z = z < 0 ? z * 0.08 : z * 0.55
      pos.setZ(i, z)
    }
    geo.center()
    geo.computeBoundingBox()
    const len = geo.boundingBox!.getSize(new T.Vector3()).x
    geo.scale(0.06 * k / len, 0.06 * k / len, 0.06 * k / len)
    geo.computeBoundingBox()
    geo.computeVertexNormals()
    // Deep lacquer red rather than the pink the lamps made of Tripo's texture.
    mesh.material.metalness = 0.05; mesh.material.envMap = envMap; mesh.material.envMapIntensity = 0.3
    mesh.material.color.setRGB(0.78, 0.5, 0.46)
    blockGeo = { geometry: geo, material: mesh.material }
  })
  const blocks: THREE.Mesh[] = []
  // The prayer mat the blocks land on: crisp, where the world's floor right
  // under the camera is at its softest (on the hilltop, a smear of streaks).
  const MAT = 0.012 * k
  const mat = new T.Group()
  {
    // Gold cloth, a red hem: the red blocks read on it.
    const cloth = new T.Mesh(new T.BoxGeometry(0.42 * k, MAT, 0.48 * k), new T.MeshStandardMaterial({ color: 0xd9a63a, roughness: 0.9 }))
    const hem = new T.Mesh(new T.BoxGeometry(0.45 * k, MAT * 0.7, 0.51 * k), new T.MeshStandardMaterial({ color: 0x7a1410, roughness: 0.8 }))
    cloth.position.y = MAT / 2; hem.position.y = MAT * 0.35
    mat.add(cloth, hem)
    mat.visible = false
    asProp(mat)
    scene.add(mat)
  }

  // ── controls ───────────────────────────────────────────────────────────
  let yaw = 0, pitch = sc.start.pitch ?? -0.04
  const move = { x: 0, y: 0 }
  const keys = new Set<string>()
  let locked = false                       // the ritual holds the camera
  let gliding = false                      // a camera move is under way
  // Every animation runs on the render loop's clock (so a stepped loop in a
  // test advances it too): fn(t) for t from 0 to 1 over ms.
  const tweens = new Set<(now: number) => boolean>()
  const tween = (ms: number, fn: (t: number) => void) => new Promise<void>(resolve => {
    let t0 = -1
    tweens.add(now => {
      if (t0 < 0) t0 = now
      const t = Math.min(1, (now - t0) / ms)
      fn(t)
      if (t >= 1) { resolve(); return false }
      return true
    })
  })
  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) {
      if (e.type === 'keydown') keys.add(k); else keys.delete(k)
      if ((e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault()
    }
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)

  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    for (const f of [...tweens]) if (!f(now)) tweens.delete(f)
    let climbY = move.y
    if (keys.has('w') || keys.has('arrowup')) climbY += 1
    if (keys.has('s') || keys.has('arrowdown')) climbY -= 1
    if (place !== 'out' && !gliding) {
      // A few steps about the room, never through its wall.
      const rm = sc.climb!.rooms[place]!, mxy = Math.hypot(move.x, climbY)
      if (mxy > 0.01) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw)
        const p = camera.position, sp = 1.1 / sc.unit * dt / Math.max(1, mxy)
        const nx = p.x + (fx * climbY + rx * move.x) * sp, nz = p.z + (fz * climbY + rz * move.x) * sp
        if (Math.hypot(nx - rm.x, nz - rm.z) < rm.r - 0.35 / sc.unit) { p.x = nx; p.z = nz }
      }
      camera.rotation.set(pitch, yaw, 0)
      lantern.position.set(camera.position.x, camera.position.y + 0.4 / sc.unit, camera.position.z)
    } else if (!gliding && !locked) {
      let mx = move.x, my = move.y
      if (keys.has('w') || keys.has('arrowup')) my += 1
      if (keys.has('s') || keys.has('arrowdown')) my -= 1
      if (keys.has('d')) mx += 1
      if (keys.has('a')) mx -= 1
      if (keys.has('arrowleft')) yaw += 1.6 * dt
      if (keys.has('arrowright')) yaw -= 1.6 * dt
      const m = Math.hypot(mx, my)
      if (m > 1) { mx /= m; my /= m }
      if (m > 0.01) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw)
        const dx = (fx * my + rx * mx) * speed * dt, dz = (fz * my + rz * mx) * speed * dt
        const p = camera.position
        if (opts.debug && debug.fly) { p.x += dx; p.z += dz }
        else if (canStep(p.x, p.z, p.x + dx, p.z + dz)) { p.x += dx; p.z += dz }
        else if (canStep(p.x, p.z, p.x + dx, p.z)) p.x += dx
        else if (canStep(p.x, p.z, p.x, p.z + dz)) p.z += dz
      }
      if (opts.debug && debug.fly) {
        if (keys.has('q')) camera.position.y -= speed * dt
        if (keys.has('e')) camera.position.y += speed * dt
      } else {
        const target = floorAt(camera.position.x, camera.position.z) + eye
        camera.position.y += (target - camera.position.y) * Math.min(1, dt * 6)
      }
      camera.rotation.set(pitch, yaw, 0)
    }
    renderer.clear()
    camera.layers.set(0)
    renderer.shadowMap.needsUpdate = true
    renderer.render(scene, camera)
    renderer.render(splats, camera)
    if (sc.pave || sc.shadows) { camera.layers.set(CATCH); renderer.render(scene, camera) }
    renderer.clearDepth()
    camera.layers.set(PROPS)
    renderer.render(scene, camera)
    camera.layers.set(0)
  }
  renderer.setAnimationLoop(frame)

  const ro = new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
  })
  ro.observe(host)

  // Camera glide: position and look-at target over `ms`.
  const baseFov = camera.fov
  const glide = async (to: THREE.Vector3, lookAt: THREE.Vector3, ms: number, fov = baseFov) => {
    const from = camera.position.clone()
    const q0 = camera.quaternion.clone()
    const q1 = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(to, lookAt, new T.Vector3(0, 1, 0)))
    const f0 = camera.fov
    gliding = true
    await tween(ms, t => {
      const e = ease(t)
      camera.position.lerpVectors(from, to, e)
      camera.quaternion.slerpQuaternions(q0, q1, e)
      if (f0 !== fov) { camera.fov = f0 + (fov - f0) * e; camera.updateProjectionMatrix() }
    })
    const eul = new T.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    yaw = eul.y; pitch = eul.x
    gliding = false
  }
  const faceTarget = () => new T.Vector3(sc.face.x, sc.face.y, sc.face.z)
  const kneelLook = () => faceTarget().add(new T.Vector3(0, sc.lookUp, 0))
  const kneelPos = () => new T.Vector3(KNEEL.x, floorAt(KNEEL.x, KNEEL.z) + kneelEye, KNEEL.z)
  let lookingDown = false

  const debug: Record<string, unknown> = {
    fly: false,
    camera, groups, scene, T,
    place: (i: number, p: Partial<Placement>) => { if (MODELS[i]) { Object.assign(MODELS[i].at, p); placeModel(i) } },
    models: () => MODELS.map(m => m.at),
    face: (f: Partial<Temple3DScene['face']>) => Object.assign(sc.face, f),
    where: () => ({ x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), floorLevel, gridReady }),
    walkable, floorAt,
    // A hidden browser tab runs no animation frames: step the loop by hand.
    step: (frames: number, ms = 33) => { for (let i = 0; i < frames; i++) frame(last + ms) },
    setView: (x: number, y: number, z: number, yw: number, pt: number) => { camera.position.set(x, y, z); yaw = yw; pitch = pt },
  }

  function clearProps() {
    tube.visible = false
    stick.visible = false
    mat.visible = false
    for (const b of blocks) scene.remove(b)
    blocks.length = 0
  }

  const ready = Promise.all([world.initialized, modelsP, colliderP, tubeP, blockP]).then(() => undefined)

  return {
    ready,
    setMove: (x, y) => { move.x = x; move.y = y },
    look: (dx, dy) => {
      if (locked || gliding) return
      yaw -= dx * 0.0048
      pitch = Math.max(-1.1, Math.min(1.1, pitch - dy * 0.0042))
    },
    nearAltar: () => Math.hypot(camera.position.x - KNEEL.x, camera.position.z - KNEEL.z) < nearAltar,
    nearDoor: () => {
      if (place !== 'out') return false
      const d = sc.climb?.door
      return !!d && Math.hypot(camera.position.x - d.x, camera.position.z - d.z) < d.r
    },
    enterStatue,
    leaveStatue,
    goTo,
    onPlace: cb => { onPlace = cb },
    async kneel() {
      locked = true
      move.x = move.y = 0
      await glide(kneelPos(), kneelLook(), 1700)
      lookingDown = false
    },
    async stand() {
      clearProps()
      const p = camera.position
      await glide(new T.Vector3(p.x, floorAt(p.x, p.z) + eye, p.z + 0.35 * k), faceTarget(), 900)
      lookingDown = false
      locked = false
    },
    async shake() {
      for (const b of blocks) scene.remove(b)
      blocks.length = 0
      mat.visible = false
      if (lookingDown) { await glide(kneelPos(), kneelLook(), 600); lookingDown = false }
      stick.visible = false
      tube.visible = true
      tube.position.set(0.075, -0.15, -0.4)
      tube.rotation.set(-0.35, 0, 0)
      await tween(1500, k => {
        const t = k * 1.5
        const a = Math.min(1, t * 3) * Math.max(0, 1 - Math.max(0, t - 1.1) * 2.5)
        tube.rotation.x = -0.35 - 0.28 * a * Math.abs(Math.sin(t * 22))
        tube.rotation.z = 0.06 * a * Math.sin(t * 17)
        tube.position.y = -0.15 + 0.012 * a * Math.sin(t * 22)
      })
      tube.rotation.set(-0.35, 0, 0)
      // One stick works its way up and out.
      stick.visible = true
      await tween(700, t => {
        stick.position.set(0.01, 0.03 + 0.08 * ease(t), 0)
        stick.rotation.z = -0.12 * ease(t)
      })
    },
    async throwBlocks(result) {
      tube.visible = false
      for (const b of blocks) scene.remove(b)
      blocks.length = 0
      if (!blockGeo) return
      // The mat goes down before the cushion; the camera looks down at it,
      // narrowed so it fills the view, with the landing in the lower half of
      // the screen (the close-up card and the subtitles hold the upper half).
      const fwd = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
      const c = camera.position
      mat.position.set(c.x + fwd.x * 0.38 * k, floorAt(c.x, c.z), c.z + fwd.z * 0.38 * k)
      mat.rotation.y = yaw
      mat.visible = true
      const aim = new T.Vector3(c.x + fwd.x * 0.445 * k, mat.position.y, c.z + fwd.z * 0.445 * k)   // just past the mat's middle
      await glide(c.clone(), aim, 650, 46)
      lookingDown = true
      // 聖筊 = one flat face up and one round; 笑筊 = both flat up; 陰筊 = both round up.
      const faces: [boolean, boolean] = result === '聖筊' ? (Math.random() < 0.5 ? [true, false] : [false, true]) : result === '笑筊' ? [true, true] : [false, false]
      const yawNow = yaw
      const fx = -Math.sin(yawNow), fz = -Math.cos(yawNow), rx = Math.cos(yawNow), rz = -Math.sin(yawNow)
      const p = camera.position
      const dur = 950, delay = 70
      const plans = faces.map((flatUp, i) => {
        const side = i === 0 ? -1 : 1
        const mesh = new T.Mesh(blockGeo!.geometry, blockGeo!.material)
        mesh.layers.set(PROPS)
        scene.add(mesh); blocks.push(mesh)
        const start = new T.Vector3(p.x + (fx * 0.12 + rx * 0.03 * side) * k, p.y - 0.1 * k, p.z + (fz * 0.12 + rz * 0.03 * side) * k)
        const dist = (0.3 + Math.random() * 0.1) * k
        const endX = p.x + fx * dist + rx * (0.035 + Math.random() * 0.03) * side * k
        const endZ = p.z + fz * dist + rz * (0.035 + Math.random() * 0.03) * side * k
        // Resting on its round face (flat up) or its flat face (round up).
        const bb = blockGeo!.geometry.boundingBox!
        const restLift = flatUp ? bb.max.z : -bb.min.z
        const end = new T.Vector3(endX, mat.position.y + MAT + restLift, endZ)
        const spin = new T.Vector3((Math.random() * 2 + 3) * Math.PI * 2, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3)
        const finalRot = new T.Euler(flatUp ? Math.PI / 2 : -Math.PI / 2, yawNow + (Math.random() - 0.5) * 1.6, 0, 'YXZ')
        return { mesh, start, end, spin, finalRot, delay: i * delay }
      })
      await tween(dur + delay, k => {
        for (const pl of plans) {
          const t = Math.max(0, Math.min(1, (k * (dur + delay) - pl.delay) / dur))
          pl.mesh.position.lerpVectors(pl.start, pl.end, t)
          pl.mesh.position.y += 0.16 * k * 4 * t * (1 - t)
          // Spinning down to its landing face, with a small rock as it settles.
          const settle = t >= 1 ? 0 : Math.max(0, (t - 0.85) / 0.15)
          const rest = 1 - Math.pow(1 - t, 3)
          pl.mesh.rotation.set(
            pl.finalRot.x + pl.spin.x * (1 - rest),
            pl.finalRot.y + pl.spin.y * (1 - rest),
            pl.finalRot.z + pl.spin.z * (1 - rest) + Math.sin(settle * Math.PI) * 0.05,
            'YXZ')
        }
      })
      await sleep(250)
    },
    clearProps,
    dispose() {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      ro.disconnect()
      renderer.setAnimationLoop(null)
      world.dispose?.()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
    debug,
  }
}
