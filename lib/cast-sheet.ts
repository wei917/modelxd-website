// lib/cast-sheet.ts — the three-view rule for CAST assets, as code.
//
// The Music Video and Animation skills have asked for turnaround sheets
// since Aug 14 (single-view sheets drifted in reference-mode generations),
// but the rule lived only in skill prose — and every cast asset ever stored
// was a single-view "medium shot character sheet" (checked against the DB,
// Aug 22; the last board predated the rule by 24 minutes, nothing since).
// Prompts guide; guards enforce — the same philosophy as the KEYFRAME model
// guard in app/api/xdirector/route.ts. Owner, Aug 22: "3 views is for all
// templates" — so the check runs on every set_storyboard, skill or no skill.

/** Wording that makes a shot prompt a three-view character sheet. Covers the
 *  English forms the skills teach plus the CJK terms a user would write. */
export const THREE_VIEW_RE =
  /three[\s-]?views?|3[\s-]?views?|turn[\s-]?around|three[\s-]?angles|(?:front|frontal)[^.;\n]{0,80}(?:three[\s-]?quarter|3\/4|¾)[^.;\n]{0,80}(?:profile|side view)|三視圖|三视图|三面圖|三面图|三面図|正面[^。；\n]{0,30}(?:四分之三|側面|侧面)|3면도|삼면도/i

/** An asset is a CAST sheet when its title or id says so — the skills name
 *  them `CAST · <name>` with ids like `cast_her`. LOOK and PROP assets are
 *  not characters and are never checked. */
export function isCastAsset(sc: { asset?: boolean; title?: string; id?: string }): boolean {
  if (sc.asset !== true) return false
  return /^\s*CAST\b/i.test(sc.title ?? '') || /^cast[_-]/i.test(sc.id ?? '')
}

export function isThreeView(shot: string | undefined): boolean {
  return THREE_VIEW_RE.test(shot ?? '')
}

/**
 * The cast assets whose shot text the DIRECTOR wrote (or rewrote) as a
 * single view. An asset whose shot is byte-identical to the client's copy
 * is the user's own text (they edit cards directly, and their wording
 * outranks the director's) — never second-guessed here.
 */
export function singleViewCastSheets<T extends { id: string; asset?: boolean; title?: string; shot?: string }>(
  scenes: T[],
  prior: Map<string, { shot?: string }>,
): T[] {
  return scenes.filter(sc => isCastAsset(sc) && !isThreeView(sc.shot) && prior.get(sc.id)?.shot !== sc.shot)
}

/** The rule, stated once — the tool schema and the rejection both quote it. */
export const THREE_VIEW_RULE =
  'A CAST asset is a CHARACTER SHEET, never a portrait: its shot must describe ONE frame holding THREE views of the same character side by side — front, three-quarter and profile — identical wardrobe, hair and light, plain background, neutral expression. The server rejects a cast sheet written as a single view.'
