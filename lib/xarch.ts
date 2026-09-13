// lib/xarch.ts — XArch (X建築設計): the plan model, edit ops, and the checks.
// Client-safe: no imports. The server (lib/xarch-ai.ts) and the page share it.
//
// The rule that shapes everything (tests, Sep 13): models READ and REASON,
// code owns geometry. An architect never returns a new drawing; it returns a
// short list of ops by element id, applied here, and the result is checked
// here — a door floating off every wall or a wall end touching nothing is
// flagged, never trusted. Coordinates are pixels of the plan image the
// architect read; `scale.px_per_ft` turns them into feet.

export type Wall   = { id: string; x1: number; y1: number; x2: number; y2: number; thickness_in?: number; exterior?: boolean }
export type Door   = { id: string; x: number; y: number; width_in?: number; width?: number; wall_orientation?: 'h' | 'v' | 'diag' }
export type Window = { id: string; x1: number; y1: number; x2: number; y2: number }
export type Stair  = { id: string; x: number; y: number; w: number; h: number; direction?: string }
export type Room   = { id: string; name: string; polygon: [number, number][]; label_dims?: string | null }

export type Plan = {
  image: { w: number; h: number }
  scale?: { px_per_ft: number; method?: string } | null
  overall_ft?: { width?: number; depth?: number } | null
  walls: Wall[]; doors: Door[]; windows: Window[]; stairs: Stair[]; rooms: Room[]
}
export type Kind = 'walls' | 'doors' | 'windows' | 'stairs' | 'rooms'
export const KINDS: Kind[] = ['walls', 'doors', 'windows', 'stairs', 'rooms']
export type Selection = { kind: Kind; id: string } | null

export type Op =
  | { op: 'delete'; kind: Kind; id: string }
  | { op: 'set'; kind: Kind; id: string; value: Record<string, unknown> }
  | { op: 'add'; kind: Kind; id: string; value: Record<string, unknown> }

/** The two architects (owner, Sep 13). List price per 1M tokens lives in
 *  ai_models; this is who they are and how hard they think. */
export const ARCHITECTS = {
  astra: { provider: 'openai',    model: 'gpt-6-astra',      thinking: 'high', label: 'GPT-6 Astra',      readEstimateCents: 110, editEstimateCents: 15 },
  fable: { provider: 'anthropic', model: 'claude-fable-5-1', thinking: null,   label: 'Claude Fable 5.1', readEstimateCents: 35,  editEstimateCents: 15 },
} as const
export type ArchitectId = keyof typeof ARCHITECTS
export const isArchitect = (v: unknown): v is ArchitectId => v === 'astra' || v === 'fable'

const PREFIX: Record<Kind, string> = { walls: 'w', doors: 'd', windows: 'win', stairs: 's', rooms: 'r' }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v))

/** Coerce whatever an architect returned into a Plan: numbers are numbers,
 *  every element has a unique id, malformed elements are dropped. */
export function normalizePlan(raw: any, image: { w: number; h: number }): Plan {
  const plan: Plan = {
    image,
    scale: raw?.scale && Number.isFinite(num(raw.scale.px_per_ft)) && num(raw.scale.px_per_ft) > 0
      ? { px_per_ft: num(raw.scale.px_per_ft), method: String(raw.scale.method ?? '') } : null,
    overall_ft: raw?.overall_ft ?? null,
    walls: [], doors: [], windows: [], stairs: [], rooms: [],
  }
  const seen = new Set<string>()
  const idFor = (k: Kind, given: unknown, i: number) => {
    let id = typeof given === 'string' && given ? given : `${PREFIX[k]}${i + 1}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id); return id
  }
  const finite = (...v: unknown[]) => v.every(x => Number.isFinite(num(x)))
  ;(raw?.walls ?? []).forEach((w: any, i: number) => {
    if (!finite(w?.x1, w?.y1, w?.x2, w?.y2)) return
    plan.walls.push({ id: idFor('walls', w.id, i), x1: num(w.x1), y1: num(w.y1), x2: num(w.x2), y2: num(w.y2),
      ...(Number.isFinite(num(w.thickness_in)) ? { thickness_in: num(w.thickness_in) } : {}), exterior: !!w.exterior })
  })
  ;(raw?.doors ?? []).forEach((d: any, i: number) => {
    if (!finite(d?.x, d?.y)) return
    plan.doors.push({ id: idFor('doors', d.id, i), x: num(d.x), y: num(d.y),
      ...(Number.isFinite(num(d.width_in)) ? { width_in: num(d.width_in) } : {}),
      ...(Number.isFinite(num(d.width)) ? { width: num(d.width) } : {}),
      ...(d.wall_orientation ? { wall_orientation: d.wall_orientation } : {}) })
  })
  ;(raw?.windows ?? []).forEach((w: any, i: number) => {
    if (!finite(w?.x1, w?.y1, w?.x2, w?.y2)) return
    plan.windows.push({ id: idFor('windows', w.id, i), x1: num(w.x1), y1: num(w.y1), x2: num(w.x2), y2: num(w.y2) })
  })
  ;(raw?.stairs ?? []).forEach((s: any, i: number) => {
    if (!finite(s?.x, s?.y, s?.w, s?.h)) return
    plan.stairs.push({ id: idFor('stairs', s.id, i), x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), ...(s.direction ? { direction: String(s.direction) } : {}) })
  })
  ;(raw?.rooms ?? []).forEach((r: any, i: number) => {
    const poly = Array.isArray(r?.polygon) ? r.polygon.filter((p: any) => Array.isArray(p) && finite(p[0], p[1])).map((p: any) => [num(p[0]), num(p[1])]) : []
    if (poly.length < 3) return
    plan.rooms.push({ id: idFor('rooms', r.id, i), name: String(r.name ?? 'Room'), polygon: poly, label_dims: r.label_dims ?? null })
  })
  return plan
}

/** Apply ops to a copy. Errors are collected, never thrown: one bad op must
 *  not throw away the good ones, and the caller shows what failed. */
export function applyOps(plan: Plan, ops: Op[]): { plan: Plan; errors: string[] } {
  const next: Plan = JSON.parse(JSON.stringify(plan))
  const errors: string[] = []
  for (const op of ops ?? []) {
    if (!op || !KINDS.includes(op.kind as Kind)) { errors.push(`unknown kind in ${JSON.stringify(op).slice(0, 80)}`); continue }
    const arr = next[op.kind] as any[]
    const i = arr.findIndex(x => x.id === op.id)
    if (op.op === 'delete') {
      if (i < 0) errors.push(`delete: no ${op.id}`); else arr.splice(i, 1)
    } else if (op.op === 'set') {
      if (i < 0) errors.push(`set: no ${op.id}`); else arr[i] = { ...op.value, id: op.id }
    } else if (op.op === 'add') {
      if (i >= 0) errors.push(`add: ${op.id} exists`); else arr.push({ ...op.value, id: op.id })
    } else errors.push(`unknown op ${(op as any).op}`)
  }
  return { plan: normalizePlan(next, plan.image), errors }
}

function segDist(px: number, py: number, w: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / L))
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy))
}

/** Geometry problems, as human-readable strings keyed by element id. The
 *  tolerance scales with the drawing: 5px on an 842px plan, ~9px at 1568. */
export function checkPlan(plan: Plan): { id: string; issue: string }[] {
  const tol = Math.max(5, Math.round(Math.max(plan.image.w, plan.image.h) / 170))
  const out: { id: string; issue: string }[] = []
  // A drawn door usually sits IN an opening — a gap between two wall
  // segments — not on top of a wall, so "near a wall end within its own
  // width" counts as on a wall, and a wall ending at a door is not dangling.
  const reach = (d: Door) => doorWidthPx(plan, d) / 2 + tol
  const ends = plan.walls.flatMap(w => [[w.x1, w.y1], [w.x2, w.y2]] as [number, number][])
  for (const d of plan.doors) {
    const onWall = plan.walls.some(w => segDist(d.x, d.y, w) <= tol)
      || plan.windows.some(w => segDist(d.x, d.y, w) <= tol)
      || ends.some(([x, y]) => Math.hypot(d.x - x, d.y - y) <= reach(d))
    if (!onWall) out.push({ id: d.id, issue: 'door is not on a wall' })
  }
  // A doorless opening (a cased passage between kitchen and dining room) is
  // two walls ending in line with a gap between them. Up to 8 ft of gap,
  // lined up with the wall, counts as an opening rather than a dangling end.
  const gapMax = (plan.scale?.px_per_ft ?? Math.max(plan.image.w, plan.image.h) / 60) * 8
  const inOpening = (w: Wall, x: number, y: number) => {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1
    const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len
    return plan.walls.some(q => q !== w && ([[q.x1, q.y1], [q.x2, q.y2]] as const).some(([qx, qy]) => {
      const dx = qx - x, dy = qy - y, dist = Math.hypot(dx, dy)
      if (dist < tol || dist > gapMax) return false
      return Math.abs(dx * uy - dy * ux) <= tol * 1.5   // on the wall's own line
    }))
  }
  for (const w of plan.walls) {
    for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]] as const) {
      const touches = plan.walls.some(q => q !== w && segDist(x, y, q) <= tol)
        || plan.windows.some(q => segDist(x, y, q) <= tol)
        || plan.doors.some(d => Math.hypot(d.x - x, d.y - y) <= reach(d))
        || inOpening(w, x, y)
      if (!touches) { out.push({ id: w.id, issue: `wall end (${Math.round(x)}, ${Math.round(y)}) touches nothing` }); break }
    }
  }
  return out
}

/** A door's width in plan pixels: inches through the scale, else the raw
 *  pixel width, else a standard 36" door. */
export function doorWidthPx(plan: Plan, d: Door): number {
  const ppf = plan.scale?.px_per_ft
  if (d.width_in && ppf) return (d.width_in / 12) * ppf
  if (d.width) return d.width
  return ppf ? 3 * ppf : Math.max(plan.image.w, plan.image.h) / 25
}

/** Parse 17'-0" / 15'-7" / 9'-3 1/2" into feet. */
export function parseFeet(s: string): number | null {
  const m = s.replace(/[’′]/g, "'").replace(/[”″]/g, '"').match(/(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)?(?:\s+(\d+)\/(\d+))?\s*"?/)
  if (!m) return null
  const inches = (m[2] ? Number(m[2]) : 0) + (m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0)
  return Number(m[1]) + inches / 12
}

export const polygonArea = (p: [number, number][]) =>
  Math.abs(p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + x * y2 - x2 * y }, 0)) / 2

export const centroid = (p: [number, number][]) => {
  const xs = p.map(q => q[0]), ys = p.map(q => q[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] as [number, number]
}

/** A room's size in feet: bounding box and area, when the plan has a scale. */
export function roomSize(plan: Plan, r: Room): { w: number; d: number; sqft: number } | null {
  const ppf = plan.scale?.px_per_ft
  if (!ppf) return null
  const xs = r.polygon.map(q => q[0]), ys = r.polygon.map(q => q[1])
  return { w: (Math.max(...xs) - Math.min(...xs)) / ppf, d: (Math.max(...ys) - Math.min(...ys)) / ppf, sqft: polygonArea(r.polygon) / (ppf * ppf) }
}

/** Printed room size vs what the drawn outline measures. Reported when the
 *  outline is off by more than a foot on either side — a label is the
 *  architect's own reading of the drawing, the outline is ours to check. */
export function labelMismatches(plan: Plan): { id: string; label: string; measured: string }[] {
  const out: { id: string; label: string; measured: string }[] = []
  for (const r of plan.rooms) {
    if (!r.label_dims) continue
    const parts = r.label_dims.split(/\s*[x×X]\s*/)
    const a = parts[0] ? parseFeet(parts[0]) : null, b = parts[1] ? parseFeet(parts[1]) : null
    const size = roomSize(plan, r)
    if (a == null || b == null || !size) continue
    const fit = Math.min(Math.abs(a - size.w) + Math.abs(b - size.d), Math.abs(a - size.d) + Math.abs(b - size.w))
    if (fit > 2) out.push({ id: r.id, label: r.label_dims, measured: `${fmtFt(size.w)} × ${fmtFt(size.d)}` })
  }
  return out
}

export function fmtFt(ft: number): string {
  const whole = Math.floor(ft), inches = Math.round((ft - whole) * 12)
  return inches === 12 ? `${whole + 1}'-0"` : `${whole}'-${inches}"`
}

export type Media = {
  id: string; room_id: string | null; kind: 'upload' | 'edit'
  mediaType: string; bucket?: string; path?: string; public_url?: string
  prompt?: string | null; source_id?: string | null; created_at: string
}
