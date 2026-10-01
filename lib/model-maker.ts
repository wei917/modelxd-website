// lib/model-maker.ts — who MADE a model, when that is not who we buy it from.
//
// The logo beside a model is its maker's (owner, Oct 1: Seedance is
// ByteDance's model, not Runway's or Replicate's); the reseller is named in
// words where the price shows ("via Replicate", ai_models.via). One logo,
// not two: at 16 px two marks read as "made by both". Client-safe.

const MAKERS: Array<[RegExp, string]> = [
  // Matches the catalog name (seedance2_5) and the display name (Seedance 2.5).
  [/^seedance/i, 'bytedance'],
]

export const MAKER_LABELS: Record<string, string> = { bytedance: 'ByteDance' }

/** The maker of a model by its catalog or display name, when it differs
 *  from the provider we call; null when the provider IS the maker. */
export function makerOf(modelName?: string | null): string | null {
  if (!modelName) return null
  return MAKERS.find(([re]) => re.test(modelName))?.[1] ?? null
}

/** The key a model's logo and "made by" label use: its maker when known. */
export function makerKey(provider?: string | null, modelName?: string | null): string {
  return makerOf(modelName) ?? provider ?? ''
}
