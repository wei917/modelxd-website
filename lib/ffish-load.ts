// lib/ffish-load.ts — loading ffish once per server process (Oct 20; moved
// out of lib/chess-engine.ts when 象棋 became its second user). ffish is
// Fairy-Stockfish's move generator compiled to WebAssembly (npm `ffish`,
// GPL-3.0): SERVER ONLY, never in the browser bundle. next.config.js keeps
// the package external and traces ffish.wasm into each route that uses it.

/** The slice of ffish's Board we use (its own d.ts types the ES6 build). */
export type FfBoard = {
  delete(): void
  legalMoves(): string
  legalMovesSan(): string
  numberLegalMoves(): number
  push(uci: string): boolean
  fen(): string
  /** SAN by default; 象棋 asks for Notation.XIANGQI_WXF. */
  sanMove(uci: string, notation?: unknown): string
  isCheck(): boolean
  isInsufficientMaterial(): boolean
  halfmoveClock(): number
  result(claimDraw?: boolean): string
}
export type Ffish = { Board: new (variant: string, fen?: string, is960?: boolean) => FfBoard; info(): string; Notation: Record<string, unknown> }

// ── loading ffish ───────────────────────────────────────────────────────────
// Two quirks of this (older Emscripten) build, both handled here:
//  1. On Node 18+ it sees a global fetch() and tries to fetch() its .wasm by
//     FILE PATH, which fails ("Failed to parse URL") and then aborts. Hiding
//     fetch for the synchronous require makes it read the file from disk.
//  2. It installs process-wide 'uncaughtException' (rethrow) and
//     'unhandledRejection' (abort) handlers, which would let ANY stray
//     rejection in the server crash the process. They are removed right away.
let loading: Promise<Ffish> | null = null

export function loadFfish(): Promise<Ffish> {
  if (typeof window !== 'undefined') throw new Error('lib/ffish-load is server-only (GPL)')
  if (loading) return loading
  loading = new Promise<Ffish>((resolve, reject) => {
    const before = {
      uncaughtException: process.listeners('uncaughtException'),
      unhandledRejection: process.listeners('unhandledRejection'),
    }
    const fetchDesc = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
    let mod: any
    try {
      Object.defineProperty(globalThis, 'fetch', { value: undefined, configurable: true, writable: true })
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('ffish')
    } catch (e) {
      reject(e)
      return
    } finally {
      if (fetchDesc) Object.defineProperty(globalThis, 'fetch', fetchDesc)
      for (const ev of ['uncaughtException', 'unhandledRejection'] as const) {
        for (const l of process.listeners(ev as any)) {
          if (!(before[ev] as Function[]).includes(l)) process.removeListener(ev as any, l as any)
        }
      }
    }
    const timer = setTimeout(() => reject(new Error('ffish did not initialize in 15 s')), 15_000)
    const done = () => { clearTimeout(timer); resolve(mod as Ffish) }
    if (typeof mod.Board === 'function') done()
    else {
      mod.onRuntimeInitialized = done
      mod.onAbort = (what: unknown) => { clearTimeout(timer); reject(new Error(`ffish aborted: ${String(what)}`)) }
    }
  })
  loading.catch(() => { loading = null })
  return loading
}

/** After a WebAssembly abort the module is dead for the life of the
 *  process: forget it so the next request loads a fresh one. */
export function resetFfish() {
  loading = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    delete require.cache[require.resolve('ffish')]
  } catch { /* not a plain Node require; a cold start reloads it anyway */ }
}

