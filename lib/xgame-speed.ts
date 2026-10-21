// lib/xgame-speed.ts — which models may sit at an XGame table (Oct 20).
// Client-safe: the seat pickers and the create routes read the same file.
//
// Owner, Oct 20: "we should try it ourselves, if over 30 seconds, we should
// not let users even select them"; "we should set rule per game. and we test
// it. borderline is ok, limit 30 but 32 is ok but 36 is not".
//
// So every game has its own time rule (GAME_TIME_RULES), and every model is
// measured on that game's real prompt at each of its thinking levels by
// scripts/xgame-speed-test.ts, which writes lib/xgame-speed-results.ts. A
// (model, level) is offered for a game only if two of its three test moves
// came back readable within the limit plus the margin (30 s + 10% = 33 s;
// one slow move is luck). A model
// with no passing level is not in that game's picker at all, and a model
// added later stays out until it has been tested.

import { XGAME_SPEED } from './xgame-speed-results'
import { seatThinking } from './game-thinking'

export type SpeedGame = 'chess' | 'xiangqi' | 'gomoku' | 'poker' | 'bridge'
export const SPEED_GAMES: SpeedGame[] = ['chess', 'xiangqi', 'gomoku', 'poker', 'bridge']

/** Seconds per model move, and the margin a test move may run over it. */
export const GAME_TIME_RULES: Record<SpeedGame, { limitSec: number; grace: number }> = {
  chess: { limitSec: 30, grace: 0.1 },
  xiangqi: { limitSec: 30, grace: 0.1 },
  gomoku: { limitSec: 30, grace: 0.1 },
  poker: { limitSec: 30, grace: 0.1 },
  bridge: { limitSec: 30, grace: 0.1 },
}

/** The slowest a passing test move may be, in ms (30 s → 33,000). */
export const passMs = (game: SpeedGame) => Math.round(GAME_TIME_RULES[game].limitSec * 1000 * (1 + GAME_TIME_RULES[game].grace))

/** A thinking level as the results store it: the model's default is 'auto'. */
export const levelKey = (level: string | null) => level ?? 'auto'

type LevelResult = { pass: boolean; ms: number[]; note?: string }
type ModelResult = { name: string; levels: Record<string, LevelResult> }

function resultFor(game: SpeedGame, modelId: string): ModelResult | null {
  const g = (XGAME_SPEED.results as Record<string, Record<string, ModelResult>>)[game]
  return g?.[modelId] ?? null
}

/** The thinking levels a model may play this game at, fastest-first as the
 *  seat menu lists them (null = the model's own default). Empty = not
 *  offered for this game. */
export function passingLevels(game: SpeedGame, model: { id: string; output_config?: any }): (string | null)[] {
  const r = resultFor(game, model.id)
  if (!r) return []
  const declared: string[] = model.output_config?.text?.thinking_levels ?? []
  const out: (string | null)[] = []
  if (r.levels.auto?.pass) out.push(null)
  for (const lv of declared) if (r.levels[lv]?.pass) out.push(lv)
  return out
}

export const isEligible = (game: SpeedGame, model: { id: string; output_config?: any }) => passingLevels(game, model).length > 0

/** The level a seat plays at: the one chosen if it passed; with none chosen,
 *  the table's usual default (lib/game-thinking.ts) if it passed, else the
 *  first passing level. Null result = this model is not offered for the game. */
export function seatLevel(game: SpeedGame, model: { id: string; output_config?: any }, chosen: string | null | undefined):
  { ok: true; level: string | null } | { ok: false; reason: string } {
  const ok = passingLevels(game, model)
  if (!ok.length) return { ok: false, reason: `this model is too slow for this table (over ${GAME_TIME_RULES[game].limitSec} s a move) or not tested yet` }
  if (typeof chosen === 'string' && chosen) {
    return ok.includes(chosen) ? { ok: true, level: chosen } : { ok: false, reason: `that thinking level is too slow for this table (over ${GAME_TIME_RULES[game].limitSec} s a move)` }
  }
  const dflt = seatThinking(model, null)
  return { ok: true, level: ok.includes(dflt) ? dflt : ok[0] }
}

/** The level a seat will play at, for the cost estimate before the table
 *  starts (the create route refuses a level that did not pass). */
export function speedLevel(game: SpeedGame, model: { id: string; output_config?: any }, chosen: string | null | undefined): string | null {
  const r = seatLevel(game, model, chosen)
  return r.ok ? r.level : seatThinking(model, chosen)
}

export const speedMeasuredAt = () => XGAME_SPEED.measuredAt
