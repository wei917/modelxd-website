// lib/xsports-ais.ts — who the AI commentators of X體育's public rooms are,
// and who a message asks. Plain data and text, no server code, so the page
// (its @ list) and the server (lib/xsports-room-ai.ts, the room route) read
// the same list.

/** The room's AI commentators: ModelXD pays and picks, two cheap models from
 *  different makers that take turns (owner, Oct 14: "add one more AI, how
 *  about another cheap model? so two AI can talk each other too"). `name`
 *  is the catalog's display name, stored on each of its messages; fans and
 *  the other AI ask one by its @handle. Both handles are reserved words, so
 *  no fan's @ID can be one (lib/handle.ts). */
export const HOUSE_AIS = [
  { handle: 'Luna', name: 'GPT-6 Luna', provider: 'openai', model_name: 'gpt-6-luna' },
  { handle: 'Qwen', name: 'Qwen 3.8 Flash', provider: 'alibaba', model_name: 'qwen3.8-flash' },
] as const
export type HouseAi = (typeof HOUSE_AIS)[number]

/** Who a message asks, in the order named: a commentator by its @handle
 *  ("@Qwen"), or by "@AI" ('any': whoever's turn it is) when none is named,
 *  or nobody. "＠ＡＩ" and "@ai球友" count; a fan's @ID that only starts
 *  like one (@aiko, @lunatic, @qwen_fan) does not. */
export function askedAis(text: string): (HouseAi | 'any')[] {
  const t = text.normalize('NFKC')
  const hits: { at: number; who: HouseAi | 'any' }[] = []
  for (const ai of HOUSE_AIS) {
    const m = new RegExp(`@\\s*${ai.handle}(?![a-z0-9_.])`, 'i').exec(t)
    if (m) hits.push({ at: m.index, who: ai })
  }
  if (!hits.length) {
    const m = /@\s*ai(?![a-z0-9_.])/i.exec(t)
    if (m) hits.push({ at: m.index, who: 'any' })
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.who)
}
