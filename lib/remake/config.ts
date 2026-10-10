// lib/remake/config.ts: 同款 (Remake), XCreate's sixth type (owner, Oct 10:
// "paste a link to do the same video。做同款。 但是換掉人物或主角 主題 背景").
// Shared by the route and the page: limits, the breakdown's shape, the swaps,
// and the price estimate. Plan and phase-0 numbers: docs/REMAKE-PLAN.md.

/** Sources up to 3 minutes (owner, Oct 10: "length cap to 3 minutes, if our
 *  pipeline can handle. but do let users set cap"). */
export const REMAKE_MAX_SOURCE_SECONDS = 180
/** The lengths a user can pick for the remake; 0 = the whole part read. */
export const REMAKE_LENGTHS = [15, 30, 60, 0] as const
/** Free breakdowns per user per 24 hours (house-paid: about $0.05 a minute). */
export const BREAKDOWN_DAILY_CAP = 10
/** Phase 0 head to head: Gemini 3.8 Flash matched Pro's accuracy at half the
 *  price. Five frames a second found 10 of 10 cuts at 0.1 s; the default one
 *  frame a second put them 0.3–1 s off. */
export const BREAKDOWN_MODEL = 'gemini-3.8-flash'
export const BREAKDOWN_FPS = 5
/** The activity_logs event a breakdown writes; the daily cap counts them. */
export const BREAKDOWN_EVENT = 'remake_breakdown'

export type SourceKind = 'youtube' | 'x' | 'upload'

export type Shot = {
  t0: number
  t1: number
  framing: string
  camera: string
  action: string
  who: string[]
  where: string
  transition_in: string
  text: string
  sound: string
}
export type Character = { id: string; role: string; look: string }
export type Line = { t: number; who: string; text: string; language: string }
export type Breakdown = {
  duration: number
  aspect: string
  title: string
  summary: string
  hook: string
  look: { style: string; palette: string; light: string }
  characters: Character[]
  shots: Shot[]
  lines: Line[]
  music: { present: boolean; bpm: number | null; mood: string; cuts_on_beat: boolean }
}

export type BreakdownResult = {
  breakdown: Breakdown
  source: { kind: SourceKind; url: string | null; start: number; end: number }
  costUsd: number
  /** Breakdowns left today after this one. */
  left: number
}

/** What the user swaps. Phase 1 keeps it on the page; phase 2 sends it with
 *  the remake. */
export type CastChoice = 'keep' | 'photo' | 'describe' | 'famous'
export type RemakeLook = 'keep' | 'anime' | 'realistic' | '3d'
export const REMAKE_LOOKS: RemakeLook[] = ['keep', 'anime', 'realistic', '3d']

/** A rough price for a remake of `seconds`, in cents: pictures and clips cost
 *  about $0.20–0.30 a finished second, plus $1–2 of planning and review
 *  (plan, Oct 10). Shown as "about"; phase 2 measures it before charging. */
export function estimateRemakeCents(seconds: number): number {
  return Math.round((Math.max(5, seconds) * 0.25 + 1.5) * 100)
}
