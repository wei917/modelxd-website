// lib/xgame-games.ts — XGame's games, in the top bar's order (Oct 20).
// Plain module (no 'use client'): the server page reads ?game= with
// isGameKey, the bar and the shell name the games with the same list.

export type GameKey = 'werewolf' | 'gomoku' | 'draw' | 'chess' | 'poker'
export const GAMES: GameKey[] = ['werewolf', 'gomoku', 'draw', 'chess', 'poker']

export const GAME_NAME_KEY: Record<GameKey, string> = {
  werewolf: 'xt.tpl.werewolf.name',
  gomoku: 'xg.game.gomoku',
  draw: 'xg.game.draw',
  chess: 'xg.game.chess',
  poker: 'xg.game.poker',
}

export const isGameKey = (v: unknown): v is GameKey => typeof v === 'string' && (GAMES as string[]).includes(v)
