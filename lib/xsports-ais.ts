// lib/xsports-ais.ts — who the AI commentators of X體育's public rooms are,
// and who a message asks. Plain data and text, no server code, so the page
// (its @ list) and the server (lib/xsports-room-ai.ts, the room route) read
// the same lists.

/** One commentator. `name` is the catalog's display name, stored on each of
 *  its messages; fans and the other commentator ask it by its @handle. Every
 *  handle is a reserved word, so no fan's @ID can be one (lib/handle.ts). */
export interface Commentator { handle: string; name: string; provider: string; model_name: string }

/** The top models a game's two commentators are drawn from (owner, Oct 15:
 *  "randomly pick some top models + mid thinking effort as AI 球評. because
 *  chat room is not real real time, we can have a little bit latency"), one
 *  per maker, so a game's two are always two makers. ModelXD pays for every
 *  word, up to a daily cap (lib/xsports-ai-spend.ts). Not here: GPT-6 Astra
 *  and Claude Fable 5.1 (about five times the price), Kimi K3 (75 s and more
 *  a turn). */
export const TOP_AIS: Commentator[] = [
  { handle: 'Opus', name: 'Claude Opus 5.5', provider: 'anthropic', model_name: 'claude-opus-5-5' },
  { handle: 'Sol', name: 'GPT-6.1 Sol', provider: 'openai', model_name: 'gpt-6.1-sol' },
  { handle: 'Gemini', name: 'Gemini 3.1 Pro Preview', provider: 'google', model_name: 'gemini-3.1-pro-preview' },
  { handle: 'Grok', name: 'Grok 4.7', provider: 'xai', model_name: 'grok-4.7' },
  { handle: 'Qwen', name: 'Qwen3.8 Max', provider: 'alibaba', model_name: 'qwen3.8-max' },
]

/** The cheap pair (GPT-6 Luna from Oct 13, Qwen 3.8 Flash from Oct 14):
 *  every room once the day's spend reaches the cap, and every room's
 *  commentators before Oct 15. */
export const CHEAP_AIS: Commentator[] = [
  { handle: 'Luna', name: 'GPT-6 Luna', provider: 'openai', model_name: 'gpt-6-luna' },
  { handle: 'Qwen', name: 'Qwen 3.8 Flash', provider: 'alibaba', model_name: 'qwen3.8-flash' },
]

/** Every commentator a room's history can hold. */
export const ALL_AIS: Commentator[] = [...TOP_AIS, ...CHEAP_AIS]

/** A commentator by the name its messages carry. */
export const aiByName = (name: string | null | undefined): Commentator | undefined => (name ? ALL_AIS.find(a => a.name === name) : undefined)

/** A game's draw of TOP_AIS: the same order for that game every time, on
 *  every server and in every language's room (a seeded shuffle of the
 *  game's id), so the game keeps its two. Rooms speak with the first two the
 *  catalog can serve. */
export function gameDraw(league: string, game: string): Commentator[] {
  let h = 2166136261
  for (const ch of `${league}:${game}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  let s = h >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...TOP_AIS]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Who a message asks among a room's commentators, in the order named: one
 *  by its @handle ("@Qwen"), or by "@AI" ('any': whoever's turn it is) when
 *  none is named, or nobody. "＠ＡＩ" and "@ai球友" count; a fan's @ID that
 *  only starts like one (@aiko, @lunatic, @qwen_fan) does not, nor a model
 *  that is not in this room. */
export function askedAis(text: string, room: readonly Commentator[]): (Commentator | 'any')[] {
  const t = text.normalize('NFKC')
  const hits: { at: number; who: Commentator | 'any' }[] = []
  for (const ai of room) {
    const m = new RegExp(`@\\s*${ai.handle}(?![a-z0-9_.])`, 'i').exec(t)
    if (m) hits.push({ at: m.index, who: ai })
  }
  if (!hits.length) {
    const m = /@\s*ai(?![a-z0-9_.])/i.exec(t)
    if (m) hits.push({ at: m.index, who: 'any' })
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.who)
}
