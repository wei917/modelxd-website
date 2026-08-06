// lib/model-features.ts
// Which models may be offered on which surface.
//
// The rule itself lives in the database (ai_models.blocked_features — see
// supabase/70_model_feature_blocks.sql). This module only names the keys and
// provides the one predicate both the browser and the server use, so a block
// cannot be enforced in the picker but forgotten in the API, which is exactly
// how a stale tab ends up seating a model we meant to exclude.
//
// Adding a surface needs no migration: pick a key, use it here, set it on the
// rows you want to exclude.

export const FEATURE = {
  werewolf:   'xtalk_werewolf',
  discussion: 'xtalk_discussion',
  xduel:      'xduel',
  xcreate:    'xcreate',
} as const

export type FeatureKey = typeof FEATURE[keyof typeof FEATURE]

/** Anything carrying the column — a full model row or a trimmed client copy. */
export type HasBlocked = { blocked_features?: string[] | null }

export const isBlockedFor = (m: HasBlocked | null | undefined, feature: string): boolean =>
  !!m && Array.isArray(m.blocked_features) && m.blocked_features.includes(feature)

export const allowedFor = <T extends HasBlocked>(models: T[], feature: string): T[] =>
  models.filter(m => !isBlockedFor(m, feature))
