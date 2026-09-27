// lib/xcreate-limits.ts: XCreate's own input limits, shared by the studio's
// prompt box, /api/xcreate and the trending job (client-safe, no imports).

/** The longest prompt XCreate takes, in characters. Ours, not the database's
 *  (prompt columns are unlimited `text`) and not a model's: owner, Sep 27,
 *  "model can improve and if they use the model to generate, it should work".
 *  It was 8,000 (Jul 25), which turned away creators' prompts on X that the
 *  model they credit had taken (@Mayz1169's Seedance 2.5 prompt is 8,171).
 *  XDuel keeps its own 8,000: it is free, so the house pays for every prompt. */
export const XCREATE_PROMPT_MAX = 20_000
