// lib/xiangqi-board.ts — 象棋's board without its rules (Oct 20), safe in the
// browser and on the server. The rules are ffish's (lib/xiangqi-engine.ts,
// server only, GPL). This file holds what both sides need: the FEN, squares,
// piece names, the text board the models read, the published harness, and
// the move names people read (WXF → 炮二平五).
//
// Coordinates follow ffish (Fairy-Stockfish): files a-i from Red's left,
// ranks 1-10 from Red's side, so Red's general starts on e1 and the opening
// 炮二平五 is h3e3. 'w' in a FEN is Red (who moves first), 'b' is Black.

export const XQ_FILES = 'abcdefghi'
export const XQ_START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

export type Side = 'w' | 'b'
export type XY = [number, number]

/** The harness every model plays under, published on the table. Change
 *  anything in lib/xiangqi-turn.ts and bump the version. */
export const XIANGQI_HARNESS = {
  version: 1,
  board: 'text board + piece lists',
  history: 'move record, coordinates and WXF',
  legalList: true,
  retries: 1,
  timeoutSec: 90,
  fallback: 'a legal move picked by a hash of the position, marked ⚠',
  plyCap: 200,
  search: false,
} as const

/** grid[y][x] with y = 0 the top row (rank 10, Black's back rank). */
export function parseFen(fen: string): { grid: (string | null)[][]; turn: Side } {
  const [board = '', side = 'w'] = fen.split(' ')
  const grid = board.split('/').map(row => {
    const out: (string | null)[] = []
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < parseInt(ch, 10); i++) out.push(null)
      else out.push(ch)
    }
    while (out.length < 9) out.push(null)
    return out.slice(0, 9)
  })
  while (grid.length < 10) grid.push(Array(9).fill(null))
  return { grid, turn: side === 'b' ? 'b' : 'w' }
}

export const squareName = (x: number, y: number) => `${XQ_FILES[x]}${10 - y}`

export function squareXY(s: string): XY | null {
  const m = /^([a-i])(10|[1-9])$/.exec(s)
  if (!m) return null
  return [XQ_FILES.indexOf(m[1]), 10 - parseInt(m[2], 10)]
}

/** Split a coordinate move ("h3e3", "b10c8") into its two squares. */
export function splitMove(uci: string): [string, string] | null {
  const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(uci)
  return m ? [m[1], m[2]] : null
}

export function generalSquare(fen: string, side: Side): XY | null {
  const { grid } = parseFen(fen)
  const want = side === 'w' ? 'K' : 'k'
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) if (grid[y][x] === want) return [x, y]
  return null
}

export const isRed = (code: string) => code === code.toUpperCase()

// ── names ─────────────────────────────────────────────────────────────────
// Traditional characters everywhere but zh-Hans. Red and Black have their
// own characters for five of the seven pieces, as on a real set.

const TRAD = { red: { K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵' }, black: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '砲', P: '卒' } }
const SIMP = { red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' }, black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' } }

/** The character on a piece ('K' red general → 帥, 'n' black horse → 馬). */
export function pieceChar(code: string, lang: string): string {
  const set = lang === 'zh-Hans' ? SIMP : TRAD
  const side = isRed(code) ? set.red : set.black
  return (side as Record<string, string>)[code.toUpperCase()] ?? code
}

const PIECE_EN: Record<string, string> = { K: 'general', A: 'advisor', B: 'elephant', N: 'horse', R: 'chariot', C: 'cannon', P: 'soldier' }

// ── the board as a model reads it ─────────────────────────────────────────

export function boardText(fen: string): string {
  const { grid } = parseFen(fen)
  const lines = ['    ' + XQ_FILES.split('').join(' ')]
  grid.forEach((row, y) => {
    lines.push(`${String(10 - y).padStart(2)}  ` + row.map(p => p ?? '.').join(' '))
    if (y === 4) lines.push('    ~ ~ ~ river ~ ~ ~')
  })
  return lines.join('\n')
}

/** "general e1, advisor d1, ..." for one side, in board order. */
export function pieceList(fen: string, side: Side): string {
  const { grid } = parseFen(fen)
  const out: string[] = []
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const p = grid[y][x]
    if (!p || isRed(p) !== (side === 'w')) continue
    out.push(`${PIECE_EN[p.toUpperCase()]} ${squareName(x, y)}`)
  }
  return out.join(', ') || '(none)'
}

// ── WXF → Chinese move names ──────────────────────────────────────────────
// ffish writes 象棋 moves in WXF: piece letter, file (or + / - for the front
// or rear of two on one file), action (+ forward, - back, = across), number.
// Red counts files 一 to 九 from its own right, Black １ to ９ from its own
// right; ffish already counts from each side's right, so only the script
// changes: 炮二平五 / 馬８進７.

const WXF_PIECE: Record<string, 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P'> = { K: 'K', A: 'A', E: 'B', B: 'B', H: 'N', N: 'N', R: 'R', C: 'C', P: 'P' }
const RED_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const BLACK_NUM = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９']

export function wxfToChinese(wxf: string, side: Side, lang: string): string {
  const m = /^([KAEBHNRCP])([1-9]|[+-])([+\-=.])([1-9])$/.exec(wxf.trim())
  if (!m) return wxf
  const [, letter, from, action, to] = m
  const simp = lang === 'zh-Hans'
  const code = side === 'w' ? WXF_PIECE[letter] : WXF_PIECE[letter].toLowerCase()
  const piece = pieceChar(code, lang)
  const num = (n: string) => (side === 'w' ? RED_NUM : BLACK_NUM)[parseInt(n, 10)]
  const act = action === '+' ? (simp ? '进' : '進') : action === '-' ? '退' : '平'
  const head = from === '+' ? `前${piece}` : from === '-' ? `${simp ? '后' : '後'}${piece}` : `${piece}${num(from)}`
  return `${head}${act}${num(to)}`
}

/** A Chinese, WXF or loosely written 象棋 move, reduced to plain WXF
 *  ("炮二平五" / "炮2平5" / "c2.5" → "C2=5"), or null. For reading what a
 *  model wrote; never for display. */
export function toWxf(input: string): string | null {
  let s = String(input ?? '').trim()
  if (!s) return null
  const PIECES: Record<string, string> = {
    帥: 'K', 帅: 'K', 將: 'K', 将: 'K', 仕: 'A', 士: 'A', 相: 'E', 象: 'E',
    傌: 'H', 馬: 'H', 马: 'H', 俥: 'R', 車: 'R', 车: 'R', 炮: 'C', 砲: 'C', 兵: 'P', 卒: 'P',
  }
  const NUMS: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
  s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48))
  s = s.replace(/[一二三四五六七八九]/g, ch => NUMS[ch])
  s = s.replace(/[進进]/g, '+').replace(/退/g, '-').replace(/平/g, '=')
  // 前炮 / 後炮 / 后炮: the tandem marker goes after the piece, as in WXF.
  s = s.replace(/^前(.)/, (_, p) => `${p}+`).replace(/^[後后](.)/, (_, p) => `${p}-`)
  s = s.replace(/^(.)/, ch => PIECES[ch] ?? ch)
  s = s.replace(/\s+/g, '').replace(/\./g, '=').toUpperCase()
  s = s.replace(/^N/, 'H').replace(/^B/, 'E')
  return /^[KAEHRCP]([1-9]|[+-])[+\-=][1-9]$/.test(s) ? s : null
}
