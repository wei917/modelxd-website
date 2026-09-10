// lib/xworld-models.ts — XWorld's price table, shared by the page and the
// server. Client-safe: no imports. Prices are the providers' published list
// prices (docs/price-audit.md rules apply — list price, never promos).
//
// World Labs (docs.worldlabs.ai/api/pricing, 2026-09-10): $1 = 1,250 credits.
// `credits` = [text / single image, multi-image / video]. Plus is the CEILING
// of its 1,500 + 0–1,500 variable range — held up front, settled to the
// world's real cost when it finishes.
// Tripo (lib/tripo.ts, fetched 2026-08-30): image → textured model, 1 credit = 1¢.

export type WorldInput = 'text' | 'image' | 'multi-image' | 'video'

export const WORLD_MODELS: Record<string, { label: string; credits: [number, number]; variable?: boolean }> = {
  'marble-1.0-draft': { label: 'Marble Draft',    credits: [230, 250] },
  'marble-1.1':       { label: 'Marble 1.1',      credits: [1580, 1600] },
  'marble-1.1-plus':  { label: 'Marble 1.1 Plus', credits: [3080, 3100], variable: true },
}
export const DEFAULT_WORLD_MODEL = 'marble-1.1'

export const OBJECT_MODELS: Record<string, { label: string; cents: number }> = {
  'P1-20260311':   { label: 'Tripo P1',  cents: 50 },
  'v3.1-20260211': { label: 'Tripo 3.1', cents: 30 },
}
export const DEFAULT_OBJECT_MODEL = 'P1-20260311'

export const creditsToCents = (credits: number) => credits * 0.08

/** Up-front hold in whole cents (rounded UP; always reconciled down). */
export function worldCeilingCents(model: string, input: WorldInput): number {
  const m = WORLD_MODELS[model]
  if (!m) throw new Error(`unknown World Labs model ${model}`)
  const credits = input === 'multi-image' || input === 'video' ? m.credits[1] : m.credits[0]
  return Math.ceil(creditsToCents(credits))
}

/** Price label for the picker: the LIST price to the nearest cent ("$1.26",
 *  "$1.26–2.46" for Plus) — never the rounded-up hold, which read $1.27 and
 *  $0.19 against World Labs' published $1.26 / $0.18. */
export function worldPriceLabel(model: string, input: WorldInput): string {
  const m = WORLD_MODELS[model]
  const credits = m.credits[input === 'multi-image' || input === 'video' ? 1 : 0]
  const hi = (creditsToCents(credits) / 100).toFixed(2)
  if (!m.variable) return `$${hi}`
  const lo = (creditsToCents(credits - 1500) / 100).toFixed(2)
  return `$${lo}–${hi}`
}
