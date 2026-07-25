// lib/xcreate-discount.ts
//
// Multi-model discount for XCreate (CC, July 19): running several models
// in one generation is ModelXD's core loop, so we reward it — the total
// bill is discounted by model count. Client-safe constants; the server
// applies the same table in app/api/xcreate/route.ts when debiting.
//
// UI strings live in lib/i18n.tsx as discount.2/3/4 — they're full
// per-language strings because discount phrasing isn't translatable
// word-for-word (en "10% off" = zh "9折").

export const MULTI_MODEL_DISCOUNT: Record<number, number> = {
  2: 0.10,
  3: 0.15,
  4: 0.20,
}

export function discountFor(modelCount: number): number {
  return MULTI_MODEL_DISCOUNT[modelCount] ?? 0
}
