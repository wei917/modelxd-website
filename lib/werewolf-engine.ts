// lib/werewolf-engine.ts
// The rules, as pure functions, so the server can hold the game and the
// client can hold nothing. Everything here is deterministic; the only
// non-determinism in a game is the deal and what the models say.

export type Role = 'wolf' | 'seer' | 'doctor' | 'villager'
export type Phase = 'night_wolf' | 'night_seer' | 'night_doctor' | 'dawn' | 'day' | 'vote' | 'resolve' | 'over'

export interface Seat {
  seat:     number
  modelId:  string | null   // null for the human
  name:     string
  provider: string
  role:     Role
  alive:    boolean
  isHuman:  boolean
  /** Generation settings chosen before the deal. Stored ON THE SEAT so the
   *  whole game runs at the settings it was started with — a mid-game edit
   *  to a model row must not change how the rest of the table behaves. */
  thinking?: string | null
  search?:   boolean
}

export interface Turn {
  seat?:      number
  speaker:    string
  text:       string
  reasoning?: string
  /** Seat numbers allowed to read this. Absent = public. */
  privateTo?: number[]
  kind?:      'night' | 'day' | 'vote' | 'result'
  system?:    boolean
  cost?:      number
}

export const alive = (s: Seat[]) => s.filter(p => p.alive)
export const wolves = (s: Seat[]) => alive(s).filter(p => p.role === 'wolf')

/**
 * Table composition, matching the published setups so results are
 * comparable: Werewolf Arena runs 8 as 2 wolves + seer + doctor + 4
 * villagers, and both 7-player papers run 2 wolves + seer + a protective
 * role + 3 villagers.
 *
 * The doctor is not decoration. Two wolves at six players ends most games on
 * day one, because every night removes someone and a single wrong vote hits
 * parity. A night where nobody dies breaks that clock, which is why every
 * paper has one — and why six here still deals a single wolf.
 */
export function composition(n: number): Role[] {
  const wolves = n >= 7 ? 2 : 1
  const specials: Role[] = ['seer', 'doctor']
  return [
    ...Array(wolves).fill('wolf' as Role),
    ...specials,
    ...Array(Math.max(0, n - wolves - specials.length)).fill('villager' as Role),
  ]
}

/**
 * Deal, optionally reserving one role for a given seat — a player who asked
 * to be the wolf gets the wolf. It changes nothing for the models: they are
 * dealt from the same bag and still know only their own card.
 */
export function dealRoles(n: number, reserve?: { seat: number; role: Role }): Role[] {
  const bag = composition(n)
  let taken: Role | null = null
  if (reserve) {
    const i = bag.indexOf(reserve.role)
    if (i >= 0) { taken = reserve.role; bag.splice(i, 1) }
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  if (taken !== null && reserve) bag.splice(reserve.seat, 0, taken)
  return bag
}

export function winner(seats: Seat[]): 'wolves' | 'village' | null {
  const live = alive(seats)
  const w = live.filter(p => p.role === 'wolf').length
  const others = live.length - w
  if (w === 0) return 'village'
  if (w >= others) return 'wolves'
  return null
}

/**
 * What one seat is allowed to read.
 *
 * `viewer === null` is the god view — a watcher who is not playing sees
 * everything, including the wolf choosing who to kill, because that is the
 * whole appeal of watching. A seated player sees only public turns and their
 * own. This runs on the SERVER; a redacted transcript is what crosses the
 * wire, so there is nothing in the client to inspect.
 */
export function redact(turns: Turn[], viewer: number | null): Turn[] {
  if (viewer === null) return turns
  return turns
    .filter(t => !t.privateTo || t.privateTo.includes(viewer))
    .map(t => (t.seat === viewer || t.privateTo?.includes(viewer))
      ? t
      // Another player's private thinking is never yours, even on a turn you
      // are allowed to see the speech of.
      : { ...t, reasoning: undefined })
}

/** The transcript as one model sees it — public turns plus its own. */
export function forModel(turns: Turn[], seat: number): Turn[] {
  return turns.filter(t => !t.privateTo || t.privateTo.includes(seat))
}

/** Day speaking order, rotated so the same seat does not always open. */
export function dayOrder(seats: Seat[], day: number): number[] {
  const live = alive(seats).map(p => p.seat)
  if (live.length === 0) return []
  const shift = (day - 1) % live.length
  return live.map((_, i) => live[(i + shift) % live.length])
}

/** Most votes; a tie eliminates nobody. */
export function tally(votes: Record<string, number>): { out: number | null; counts: Record<number, number> } {
  const counts: Record<number, number> = {}
  for (const target of Object.values(votes)) counts[target] = (counts[target] ?? 0) + 1
  let top: number | null = null, topN = 0, tied = false
  for (const [seat, n] of Object.entries(counts)) {
    if (n > topN) { top = Number(seat); topN = n; tied = false }
    else if (n === topN) tied = true
  }
  return { out: tied ? null : top, counts }
}

/**
 * Resolve a name the model wrote into a seat.
 * Three layers, because an unparsed answer must never stall a game: the
 * declared field, then any candidate name appearing in the text, then the
 * first candidate. The caller records which layer fired so a rating built on
 * this data can throw out the guesses.
 */
export function resolveSeat(
  said: string, candidates: Seat[],
): { seat: number; exact: boolean } {
  const clean = (said ?? '').trim().replace(/[.。*"'\]]+$/, '').toLowerCase()
  const exact = candidates.find(c => c.name.toLowerCase() === clean)
  if (exact) return { seat: exact.seat, exact: true }
  const partial = candidates.find(c =>
    clean.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(clean))
  if (partial && clean) return { seat: partial.seat, exact: true }
  const lower = (said ?? '').toLowerCase()
  const mentioned = candidates.filter(c => lower.includes(c.name.toLowerCase()))
  if (mentioned.length) {
    const last = mentioned.reduce((best, c) =>
      lower.lastIndexOf(c.name.toLowerCase()) > lower.lastIndexOf(best.name.toLowerCase()) ? c : best)
    return { seat: last.seat, exact: false }
  }
  return { seat: candidates[0].seat, exact: false }
}
