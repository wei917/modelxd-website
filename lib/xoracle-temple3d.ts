// lib/xoracle-temple3d.ts — X先知's 3D 關帝廟 (prototype, Oct 22; owner:
// "build a 3D temple for 關帝廟 … user can walk around or see 關聖帝君
// talking … like a 3D game"). Client-safe: the scene's pieces and the hand-
// off that carries a stick drawn in the 3D temple into the 關帝籤 room.
//
// The pieces were made once and are served to everyone (house-paid, Oct 22):
//   * one scene, a hilltop (owner, Oct 23: "only hilltop"; a hall scene
//     went): a World Labs Marble 1.1 Plus world from a generated picture of
//     a generic hilltop plaza (scripts/guandi3d-art.ts, scripts/guandi3d-
//     make.ts). Marble's files stay on its CDN: unsigned, CORS *, still
//     served six weeks on for the first XWorld world (lib/worldlabs.ts).
//   * 關聖帝君, his pavilion and burner, the 籤筒 and a 筊杯: Tripo P2 meshes,
//     textures shrunk for phones (scripts/guandi3d-shrink.ts), in
//     public/xoracle/temple3d/.
// No real temple: every picture was drawn as a generic one, with no plaque
// or name (owner's rule).

const marble = (world: string) => `https://cdn.marble.worldlabs.ai/${world}`
export const TEMPLE3D_ASSETS = '/xoracle/temple3d'

export type Placement = { x: number; y: number; z: number; s: number; ry: number }
export interface Temple3DScene {
  /** A World Labs world: Marble's own splat files, and `best`, ours, shown
   *  unless ?q= asks for one of Marble's. `scale` is metres per Marble unit,
   *  `tilt` a turn about X (radians) that levels a sloping plaza, `lift`
   *  raises its ground to zero after both, so models are placed in metres
   *  on it. */
  world: { spz: Record<'100k' | '150k' | '500k', string> & { best?: string }; collider: string; scale?: number; tilt?: number; lift?: number }
  /** Sharp paving over a world's plaza past `fade` metres from the capture
   *  point (the floor splats blur from there): a plane at height y, drawn only
   *  where the collider says the plaza is (not under hedges or grass), fading
   *  in between the two distances. */
  pave?: { url: string; x0: number; x1: number; z0: number; z1: number; y: number; fade: [number, number] }
  /** Outdoors: where the models' shadows fall on the world's plaza (a plane
   *  that is only shadow, at height y). */
  shadows?: { x0: number; x1: number; z0: number; z1: number; y: number }
  /** The walking grid's cell, in units (400 x 400 cells; default 0.1). */
  cell?: number
  /** Walking speed against a person's walk (a big plaza wants a jog). */
  speed?: number
  /** The highest step a visitor takes, in units (default 20 cm; a model's
   *  steps come out coarse on the walking grid). */
  stepMax?: number
  /** Meshes standing in the world (where each stands, set by eye with
   *  ?debug=1): the giant statue, his pavilion and the burner. `metal` tones
   *  down Tripo's full-metal PBR. */
  models: { url: string; at: Placement; metal?: number; walk?: 'mesh' }[]
  /** Behind the statue's door, a dim lamp-lit inside (a plane): a hole
   *  through a model shows the sky. */
  doorway?: { x: number; y: number; z: number; w: number; h: number }
  /** Walk in and go up: a small door in the statue's pedestal, a lobby
   *  behind it, and from there straight up to the deck on his hat. */
  climb?: {
    door: { x: number; z: number; r: number }
    gate?: { x: number; z: number; w: number; h: number }
    /** The lobby inside the pedestal (a closed room `h` high), and the deck
     *  on top of his hat (`deck`: a floor at `y` with a railing, open all
     *  round, looking out on its own 360° panorama, `view`). */
    rooms: Partial<Record<'lobby' | 'top', { x: number; y: number; z: number; r: number; h?: number; deck?: boolean; view?: string }>>
    /** The model one climbs (its index in `models`): it stays in sight from
     *  the deck on its hat, the others are hidden up there. */
    statue: number
  }
  /** Where a visit starts (at or near the capture point, where the world is
   *  sharpest) and how far up the camera looks there. */
  start: { x: number; z: number; pitch?: number }
  /** Where the visitor kneels for the ritual, and the face the kneeling
   *  camera looks up at (it aims `lookUp` above it). */
  kneel: { x: number; z: number }
  face: { x: number; y: number; z: number }
  lookUp: number
  /** How far from the capture point a visitor may walk (the splats blur). */
  maxRadius: number
  /** Metres in one world unit (World Labs' metric_scale_factor): eye height,
   *  walking speed and the props follow it. */
  unit: number
}

// The hilltop (owner, Oct 22), built step by step after a few tries (one
// World Labs world with the statue painted in had no face; a plaza world
// with the models had a burner and lions in the way; hills and trees drawn
// in code looked cheap): the giant 關聖帝君 (36 m) at the far end of a
// photographed hilltop plaza (a Marble 1.1 Plus world: granite paving
// between hedges, tall pines and broadleaf trees, mountains in the haze),
// an open one-floor pavilion (拜亭) in front of him, its back step at the
// small door in his pedestal, and the incense burner out in the plaza in
// front of it, so that one praying there sees his face over the pavilion's
// roof (owner, Oct 23: under its roof, the roof hid him). Inside: a lobby,
// and from it straight up to a deck on top of his hat, open all round
// ("on top of his hat, and 360 view, users can walk around"). One unit is
// a metre: the world is scaled by its metric_scale_factor, tilted 1.74°
// (its plaza falls 1.5 m over the 46 m to the statue) and lifted so the
// plaza is at zero, within 20 cm. The plaza is 14-18 m wide between its
// hedges, its middle 2 m to the right of the capture point. Past 6 m the
// world's floor goes soft and the scene lays bricks drawn to match it.
//
// World frame (three.js, after Marble's 180° turn about X): the capture point
// is the origin and the statue is straight ahead (-Z). Tripo exports a model
// facing +X, hence the quarter turns.
export const TEMPLE3D_SCENE: Temple3DScene = {
  world: {
    spz: {
      '100k': `${marble('d796fa14-e496-42cb-b6fc-d7a809a17e7a')}/fdeb2e36-7c29-4995-bb5f-6940b34f763d_dust_100k.spz`,
      '150k': `${marble('d796fa14-e496-42cb-b6fc-d7a809a17e7a')}/5cfd8a0f-da88-4852-a87a-6186de4c85f1_ceramic_150k.spz`,
      '500k': `${marble('d796fa14-e496-42cb-b6fc-d7a809a17e7a')}/80953c40-38db-4d00-b740-6805258115e8_ceramic_500k.spz`,
      // Sharp along the plaza: Marble's full file there, its 500k elsewhere
      // (scripts/guandi3d-splats.ts; 1.5M splats, 26 MB).
      best: `${TEMPLE3D_ASSETS}/hill-world.spz`,
    },
    collider: `${marble('d796fa14-e496-42cb-b6fc-d7a809a17e7a')}/0f1ff41e.glb`,
    scale: 1.6959796,
    tilt: 0.0304,
    lift: 1.09,
  },
  // Its own bricks, drawn in code (scripts/guandi3d-paving.ts).
  pave: { url: `${TEMPLE3D_ASSETS}/hill-paving.jpg`, x0: -9, x1: 13, z0: -64, z1: 4, y: 0.01, fade: [6, 12] },
  shadows: { x0: -5, x1: 9, z0: -56, z1: -14, y: 0.02 },
  cell: 0.25,
  speed: 2.2,
  stepMax: 0.55,
  models: [
    // The giant (an original heroic design; front and back views → Tripo).
    // His head is about 3 m wide, 29-34 m up, on his axis.
    { url: `${TEMPLE3D_ASSETS}/hill-giant.glb`, at: { x: 2, y: 0, z: -46, s: 36, ry: -Math.PI / 2 }, metal: 0.35 },
    // The pavilion (12.5 m across, to fit between the hedges), open on
    // every side so one walks through it, its back step at his door.
    // Tripo turned it 23.8° to the three-quarter picture it was made from.
    { url: `${TEMPLE3D_ASSETS}/hill-pavilion.glb`, at: { x: 2, y: 0, z: -33.77, s: 12.5, ry: -1.155 }, metal: 0.2, walk: 'mesh' },
    // The incense burner, 7 m in front of the pavilion: kneeling before it
    // (the 參拜 place, below) one sees his face 5 m clear of its roof.
    { url: `${TEMPLE3D_ASSETS}/hill-burner.glb`, at: { x: 2, y: 0, z: -22, s: 2.4, ry: -Math.PI / 2 }, metal: 0.4 },
  ],
  climb: {
    door: { x: 2, z: -37.4, r: 1.8 },
    gate: { x: 2, z: -38.6, w: 1.5, h: 2.5 },
    rooms: {
      lobby: { x: 1.75, y: 0.3, z: -46, r: 2.6, h: 3.2 },
      // His hat's top is at 33.85 m, about 2.5 m across: the deck sits on
      // it. Round it, a panorama (World Labs Marble 1.1 from a GPT Image 2
      // picture of the view from up there, scripts/guandi3d-art.ts hatview):
      // the plaza's world falls apart seen from 34 m up.
      top: { x: 1.8, y: 34, z: -46.3, r: 2.2, deck: true, view: `${TEMPLE3D_ASSETS}/hill-view-hat.jpg` },
    },
    statue: 0,
  },
  doorway: { x: 2, y: 0, z: -38.75, w: 1.5, h: 2.5 },
  start: { x: 2, z: 0, pitch: 0.2 },   // his head in the frame
  kneel: { x: 2, z: -19.6 },
  face: { x: 1.75, y: 32, z: -46 },
  lookUp: -14,
  maxRadius: 44,
  unit: 1,
}

export const TEMPLE3D = {
  tube: `${TEMPLE3D_ASSETS}/tube.glb`,
  block: `${TEMPLE3D_ASSETS}/block.glb`,
  bronze: `${TEMPLE3D_ASSETS}/bronze.jpg`,
} as const

// ── The stick, carried into the room ────────────────────────────────────────
// A stick drawn and confirmed (one 聖筊) in the 3D temple opens the 關帝籤
// room at its poem, with the matter the visitor wrote. This tab's
// sessionStorage only, never the address; read once and removed. The number
// carries the same trust as one drawn in the room itself: both are drawn in
// the browser (lib/xoracle-ritual.ts), and the server checks it is a stick
// of the set (validQian).

export const STICK_KEY = 'xoracle.temple3d.stick'
export const STICK_TTL_MS = 30 * 60_000   // long enough to sign in and come back
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type CarriedStick = { n: number; ask: string }

export function writeStick(store: Store, n: number, ask: string): void {
  try { store.setItem(STICK_KEY, JSON.stringify({ n, ask: ask.slice(0, 300), at: Date.now() })) } catch {}
}

/** The carried stick, once: it is removed as it is read. */
export function takeStick(store: Store | null, now = Date.now()): CarriedStick | null {
  if (!store) return null
  let raw: string | null = null
  try { raw = store.getItem(STICK_KEY); store.removeItem(STICK_KEY) } catch { return null }
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (!Number.isInteger(v?.n) || v.n < 1 || v.n > 100) return null
    if (typeof v.at !== 'number' || now - v.at > STICK_TTL_MS || v.at > now + 60_000) return null
    const ask = typeof v.ask === 'string' ? v.ask.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : ''
    return { n: v.n, ask }
  } catch { return null }
}
