// lib/xsports-turn.ts — one turn of the XSports private chat (Oct 13): the
// models the viewer picked answer one after another, each debited and saved
// before the next one starts. Kept apart from the route so it can be tested
// with fake streams (scripts/xsports-turn-check.ts); nothing here calls a
// provider or the database itself.

/** What a model's stream reports, as much of it as a turn needs. */
export interface StreamResult { cost?: number; inputTokens?: number }

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onDone: (result: StreamResult) => void
  onError: (message: string) => void
}

/** Starts one model's stream with these callbacks (the provider router's
 *  streamText, bound to a model and its messages). */
export type StartStream = (callbacks: StreamCallbacks) => Promise<unknown>

/** One model's part of a turn: its words, its list cost (0 when it failed),
 *  and why it failed. */
export interface Spoken { text: string; cost: number; error: string | null }

/** One model's answer as a promise that settles only when everything after
 *  it is done. The provider router calls onDone without awaiting it
 *  (TextStreamCallbacks.onDone returns void), so awaiting the stream alone
 *  would move on before the debit and the saved remark (Codex review,
 *  Oct 13). It settles exactly once: after `persist` when the model
 *  finished, else on the first error, including a stream that throws or
 *  ends without saying either. */
export function speak(start: StartStream, hooks: {
  onDelta: (text: string) => void
  /** The debit and the saved remark; awaited before the turn moves on. */
  persist: (text: string, result: StreamResult) => Promise<void>
}): Promise<Spoken> {
  return new Promise(resolve => {
    let text = ''
    let ended = false
    const fail = (message: string) => {
      if (ended) return
      ended = true
      resolve({ text, cost: 0, error: message || 'no answer' })
    }
    const callbacks: StreamCallbacks = {
      onDelta: t => { if (t && !ended) { text += t; hooks.onDelta(t) } },
      onDone: result => {
        if (ended) return
        ended = true
        const cost = Number(result?.cost) || 0
        hooks.persist(text, result ?? {})
          .catch(e => console.warn('[xsports/turn] persist failed:', e?.message ?? e))
          .then(() => resolve({ text, cost, error: null }))
      },
      onError: message => fail(message),
    }
    let stream: Promise<unknown>
    try { stream = start(callbacks) } catch (e: any) { fail(String(e?.message ?? e)); return }
    // A stream that ends without onDone or onError, or throws: still one
    // answer, a failed one. After onDone these do nothing (`ended`).
    Promise.resolve(stream).then(() => fail('no answer'), (e: any) => fail(String(e?.message ?? e)))
  })
}

/** The turn: model 0, then 1, … each started only after the one before it
 *  settled (its debit and remark saved). A model that fails does not stop
 *  the rest. The models not started yet are skipped once `stopped()` (the
 *  page went away), or when `gate(i)`, asked just before model i starts,
 *  names a reason to hold it back (the wallet ran out: 'no_credits'); that
 *  reason comes back as `halted`. A gate that throws holds the rest back. */
export async function inTurn(
  count: number,
  one: (i: number) => Promise<Spoken>,
  stopped: () => boolean,
  gate?: (i: number) => Promise<string | null>,
): Promise<{ spoken: Spoken[]; skipped: number; halted: string | null }> {
  const spoken: Spoken[] = []
  for (let i = 0; i < count; i++) {
    if (stopped()) return { spoken, skipped: count - i, halted: null }
    const held = gate ? await gate(i).catch(() => 'unavailable') : null
    if (held) return { spoken, skipped: count - i, halted: held }
    if (stopped()) return { spoken, skipped: count - i, halted: null }
    try { spoken.push(await one(i)) } catch (e: any) { spoken.push({ text: '', cost: 0, error: String(e?.message ?? e) }) }
  }
  return { spoken, skipped: 0, halted: null }
}

/** The model that speaks next when nobody asked: the picked models take
 *  turns, one remark each, each billed at its own model's price. */
export function nextSpeaker<T>(models: T[], turn: number): T | null {
  return models.length ? models[((turn % models.length) + models.length) % models.length] : null
}
