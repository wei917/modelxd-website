// lib/xduel-stream.ts
//
// What the XDuel page does when its event stream ends without the server's
// `end` event (Sep 16). The route streams for as long as the slowest model
// takes; a proxy cutting an idle response, a lost connection, or the
// function reaching its limit all close the stream early, and until now
// every card that had not finished kept its spinner for ever. Interrupted
// slots become failed slots with a sentence — the same shape a
// server-reported failure produces — so the page settles and can be
// retried. Pure, so scripts/reliability-cases.ts can pin it.

export const STREAM_INTERRUPTED_MESSAGE =
  'The connection closed before this model finished. Try the duel again.'
export const STREAM_NEVER_STARTED_MESSAGE =
  'The connection closed before the duel started. Try again.'

type InterruptibleSlot = {
  text: string; isImage: boolean; isVideo: boolean
  streaming: boolean; done: boolean; errorMessage: string | null
}

/** Finished slots are untouched; every other slot becomes a failed one. */
export function finalizeInterrupted<T extends InterruptibleSlot>(slots: T[], message: string = STREAM_INTERRUPTED_MESSAGE): T[] {
  return slots.map(m => m.done
    ? m
    : { ...m, text: '', isImage: false, isVideo: false, streaming: false, done: true, errorMessage: message })
}
