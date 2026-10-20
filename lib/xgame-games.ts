// lib/xgame-games.ts — XGame's games, in the top bar's order (Oct 20).
// Plain module (no 'use client'): the server page reads ?game= with
// isGameKey, the bar and the shell name the games with the same list.

export type GameKey = 'werewolf' | 'gomoku' | 'draw' | 'chess' | 'poker' | 'xiangqi' | 'bridge'
export const GAMES: GameKey[] = ['werewolf', 'gomoku', 'draw', 'chess', 'poker', 'bridge', 'xiangqi']

/** The bar's order for a language. 象棋 is featured in both Chinese
 *  languages (owner, Oct 19: "not just Taiwan!"; it is played across the
 *  Chinese-speaking world) and sits last, still playable, elsewhere. */
export function gamesFor(lang: string): GameKey[] {
  return lang === 'zh-Hant' || lang === 'zh-Hans'
    ? ['werewolf', 'xiangqi', 'gomoku', 'draw', 'chess', 'poker', 'bridge']
    : GAMES
}

export const GAME_NAME_KEY: Record<GameKey, string> = {
  werewolf: 'xt.tpl.werewolf.name',
  gomoku: 'xg.game.gomoku',
  draw: 'xg.game.draw',
  chess: 'xg.game.chess',
  poker: 'xg.game.poker',
  xiangqi: 'xg.game.xiangqi',
  bridge: 'xg.game.bridge',
}

export const isGameKey = (v: unknown): v is GameKey => typeof v === 'string' && (GAMES as string[]).includes(v)
