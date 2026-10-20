// lib/game-thinking.ts — the thinking level a game seat sits down with when
// the person leaves it on 自動 / auto (Oct 20; owner: "fix Qwen's default
// thinking on game seats").
//
// DashScope's default for the Qwen rows is thinking ON with no budget:
// Qwen 3.8 Flash took 30-120 s a move in chess and over 90 s on a poker turn
// (Oct 20, live), past the tables' limit, so its seat got an automatic move
// or fold. Rows that declare only an on/off switch (thinking_true /
// thinking_false) therefore play with thinking OFF unless the person turns
// it on. Every other provider's default is bounded and fast (GPT-6 Luna
// ~4 s) and stays as it is. Client-safe: SeatSlot shows the same default.

export function seatThinking(model: any, chosen: string | null | undefined): string | null {
  const levels: unknown = model?.output_config?.text?.thinking_levels
  const list = Array.isArray(levels) ? levels as string[] : []
  if (typeof chosen === 'string' && list.includes(chosen)) return chosen
  return list.includes('thinking_false') ? 'thinking_false' : null
}
