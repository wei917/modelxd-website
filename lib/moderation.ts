// lib/moderation.ts — OpenAI's moderation check (omni-moderation, free) for
// what other people will see (Oct 2: the website name and profile picture,
// /api/profile/face).
//
// 'unavailable' means the check could not run (no key, timeout, an error):
// callers refuse the save rather than skip the check. Server-only.

export type ModerationVerdict = 'ok' | 'refused' | 'unavailable'

export type ModerationInput =
  | { text: string }
  | { image: Buffer; mime: 'image/jpeg' | 'image/png' }

// A profile picture is seen by everyone, so sexual content is refused below
// the model's own "flagged" line, and anything near minors at once.
const PICTURE_LIMITS: Record<string, number> = { sexual: 0.3, 'sexual/minors': 0.05 }

export async function moderate(input: ModerationInput): Promise<ModerationVerdict> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return 'unavailable'
  const item = 'text' in input
    ? { type: 'text', text: input.text }
    : { type: 'image_url', image_url: { url: `data:${input.mime};base64,${input.image.toString('base64')}` } }
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: [item] }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.warn('[moderation] HTTP', res.status, (await res.text()).slice(0, 200))
      return 'unavailable'
    }
    const result = (await res.json())?.results?.[0]
    if (!result || typeof result.flagged !== 'boolean') return 'unavailable'
    if (result.flagged) return 'refused'
    if ('image' in input) {
      for (const [category, limit] of Object.entries(PICTURE_LIMITS)) {
        if (Number(result.category_scores?.[category] ?? 0) > limit) return 'refused'
      }
    }
    return 'ok'
  } catch (e) {
    console.warn('[moderation] failed:', (e as Error).message)
    return 'unavailable'
  }
}
