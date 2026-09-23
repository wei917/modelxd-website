// lib/xtell-ritual.ts — the 求籤 ritual, pure and client-safe.
//
// 關帝廟 and 媽祖廟 have no chart to compute; their deterministic layer is the RITUAL:
// draw a numbered stick, then throw the crescent blocks (筊杯) until the
// deity confirms with three 聖筊 in a row. The poem text itself lives on the
// server (lib/xtell.ts, content/qian/guandi.json) and is fetched only after
// the third 聖筊 — the client never holds the corpus, so the number is the
// only thing that travels, exactly like a birth date.
//
// Both functions take the random source as an argument so the golden suite
// can drive them deterministically and the client can pass crypto randomness.

/** Sticks per tube. 關帝 uses the 一百籤 set, 媽祖 the 六十甲子籤. */
export const QIAN_COUNT = 100
export const QIAN_COUNTS = { guandi: 100, mazu: 60 } as const
export type QianTemple = keyof typeof QIAN_COUNTS

export type Jiao = '聖筊' | '笑筊' | '陰筊'

/** Two blocks, each landing flat (陽) or round (陰) side up. 一陰一陽 = 聖筊
 *  (yes, 50%); 兩陽 = 笑筊 (the deity smiles — ask again, 25%); 兩陰 = 陰筊
 *  (no, 25%). Real blocks are close to these odds. */
export function throwJiao(rand: () => number): Jiao {
  const a = rand() < 0.5, b = rand() < 0.5
  return a !== b ? '聖筊' : a ? '笑筊' : '陰筊'
}

/** A stick from the tube: 1 … count. */
export function drawQian(rand: () => number, count: number = QIAN_COUNT): number {
  return 1 + Math.floor(Math.min(0.999999, Math.max(0, rand())) * count)
}

/** Three 聖筊 in a row confirm the stick (三聖筊為允); any other block
 *  rejects it and the visitor draws again. */
export const CONFIRM_THROWS = 3

/** Uniform [0,1) from the Web Crypto API, for the browser and Node alike. */
export function cryptoRand(): number {
  const u = new Uint32Array(1)
  globalThis.crypto.getRandomValues(u)
  return u[0] / 4294967296
}
