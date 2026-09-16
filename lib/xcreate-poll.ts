// lib/xcreate-poll.ts
//
// Policy for the studio's poll loop (Sep 16). /xcreate asks
// /api/xcreate/job/<id> once a second while a run is live. Until now the
// loop stopped on the FIRST non-404 error — a deploy's 502, a 429, a dropped
// socket — and the cards kept spinning with nothing to say while the run
// carried on server-side. Worse, the "is this still my job?" check sat
// AFTER the error branch, so an abandoned job's late failure stopped the
// poller of the run that replaced it (both reproduced by Codex against the
// original body with a stub fetch).
//
// Pure functions, no React: the component owns the refs and the state
// setters, this file owns the verdicts, and scripts/reliability-cases.ts
// pins them.

export type PollStatus = number | 'network' | 'malformed'

export type PollHealth = {
  /** Consecutive transient failures (5xx, 429, network, unparseable body). */
  failures: number
  /** When the current run of transient failures began. */
  firstFailureAt: number | null
  /** When the job first answered 404 — the row is born a few seconds after
   *  the POST is accepted (attachments are processed first). */
  firstMissingAt: number | null
  /** Backoff: no request before this time. */
  nextAllowedAt: number
}

export const newPollHealth = (): PollHealth =>
  ({ failures: 0, firstFailureAt: null, firstMissingAt: null, nextAllowedAt: 0 })

/** A job that has answered 404 for this long never got created. */
export const MISSING_JOB_GRACE_MS = 180_000
/** Transient trouble that lasts this long stops the loop with instructions. */
export const TRANSIENT_WINDOW_MS = 120_000
/** Ceiling on the wait between polls while the server is unwell. */
export const MAX_BACKOFF_MS = 10_000

export const RETRY_NOTE =
  'Connection trouble reaching the server. Still trying; the run continues on the server.'
export const MISSING_JOB_MESSAGE =
  'This run never started: no job appeared within three minutes. Check your connection and try again.'
export const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Sign in again, then reopen this page to pick the run up where it is.'
export const FOREIGN_JOB_MESSAGE = 'This run belongs to another account.'
export const LOST_CONTACT_MESSAGE =
  'Lost contact with the server for two minutes. The run is still going there. Reload this page to pick it up.'

export const POST_UNANSWERED_NOTE =
  'The request to start this run got no answer. If it did start, it appears here shortly; otherwise this stops on its own within three minutes. Do not resubmit yet.'

/** Per-request timeout: a hung poll must not evade the retry window. */
export const POLL_TIMEOUT_MS = 15_000

/** The statuses /api/xcreate writes; anything else is not a job we know. */
export const JOB_STATUSES = new Set(['running', 'completed', 'failed'])

/** A 200 whose body is not a job payload is treated as transient, never applied. */
export function isJobPayload(x: unknown): x is { job: { status: string } & Record<string, any>; slots: Record<string, any>[] } {
  if (!x || typeof x !== 'object') return false
  const o = x as any
  if (!o.job || typeof o.job !== 'object' || typeof o.job.status !== 'string' || !JOB_STATUSES.has(o.job.status)) return false
  return Array.isArray(o.slots) && o.slots.every((s: unknown) => !!s && typeof s === 'object')
}

export type PollVerdict =
  | { kind: 'ok' }
  | { kind: 'pending' }
  | { kind: 'retry'; note: string }
  | { kind: 'stop'; message: string }

export type PollAction = { kind: 'ignore' } | PollVerdict

/**
 * One poll answer → one verdict. Mutates `h` (the job's health record).
 *  - 200: healthy, counters reset, apply the body.
 *  - 404: pending inside the grace window, stop (with a sentence) past it.
 *  - 401 / 403: stop at once; the sentence says what to do.
 *  - anything else (5xx, 429, network, malformed): transient — back off,
 *    keep polling, show a recoverable note; stop only past the window.
 */
export function classifyPollResponse(status: PollStatus, now: number, h: PollHealth): PollVerdict {
  if (status === 200) {
    h.failures = 0; h.firstFailureAt = null; h.firstMissingAt = null; h.nextAllowedAt = 0
    return { kind: 'ok' }
  }
  if (status === 404) {
    h.failures = 0; h.firstFailureAt = null; h.nextAllowedAt = 0
    if (h.firstMissingAt === null) h.firstMissingAt = now
    if (now - h.firstMissingAt > MISSING_JOB_GRACE_MS) return { kind: 'stop', message: MISSING_JOB_MESSAGE }
    return { kind: 'pending' }
  }
  if (status === 401) return { kind: 'stop', message: SESSION_EXPIRED_MESSAGE }
  if (status === 403) return { kind: 'stop', message: FOREIGN_JOB_MESSAGE }
  h.failures += 1
  if (h.firstFailureAt === null) h.firstFailureAt = now
  if (now - h.firstFailureAt > TRANSIENT_WINDOW_MS) return { kind: 'stop', message: LOST_CONTACT_MESSAGE }
  h.nextAllowedAt = now + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(h.failures, 4))
  return { kind: 'retry', note: RETRY_NOTE }
}

/**
 * The whole decision, stale check included. A response for a job that is
 * no longer the studio's current job — a reset, or a newer run — is
 * ignored outright: not applied, not an error, not a reason to stop.
 */
export function decidePoll(args: { status: PollStatus; now: number; health: PollHealth; stale: boolean }): PollAction {
  if (args.stale) return { kind: 'ignore' }
  return classifyPollResponse(args.status, args.now, args.health)
}
