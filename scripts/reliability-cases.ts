// scripts/reliability-cases.ts
//
// Regression checks for the Sep 16 reliability pass (Codex reproduced the
// first two against the original poll body with a stub fetch):
//   1. a transient 503 on the CURRENT job keeps polling (it used to stop);
//   2. a late 503 for an ABANDONED job is ignored (it used to stop the new
//      job's poller);
//   3. backoff grows and clears on recovery; 401/403 stop with a sentence;
//   4. a job that never appears stops after its grace window, not before;
//   5. an interrupted XDuel stream turns unfinished cards into failed ones
//      and leaves finished ones alone.
// Run: npx tsx scripts/reliability-cases.ts  (exit code 1 on any failure)

import {
  decidePoll, newPollHealth, classifyPollResponse,
  MISSING_JOB_GRACE_MS, TRANSIENT_WINDOW_MS, MAX_BACKOFF_MS,
  MISSING_JOB_MESSAGE, SESSION_EXPIRED_MESSAGE, FOREIGN_JOB_MESSAGE, LOST_CONTACT_MESSAGE, RETRY_NOTE,
} from '../lib/xcreate-poll'
import { isJobPayload } from '../lib/xcreate-poll'
import { finalizeInterrupted, STREAM_INTERRUPTED_MESSAGE } from '../lib/xduel-stream'

let failures = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ok   ${name}`)
  else { failures++; console.log(`  FAIL ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`) }
}

// A miniature of the component's poll loop: the only thing it may do with
// a verdict is what the verdict says. `stops` counts stopPolling calls.
function simulate(sequence: Array<{ status: number | 'network' | 'malformed'; at: number; stale?: boolean }>) {
  const health = newPollHealth()
  let stops = 0, applied = 0, retries = 0, ignored = 0, pending = 0
  let lastMessage: string | null = null
  for (const step of sequence) {
    if (step.at < health.nextAllowedAt) { continue }  // backoff skips the tick
    const a = decidePoll({ status: step.status, now: step.at, health, stale: !!step.stale })
    if (a.kind === 'ignore') ignored++
    else if (a.kind === 'stop') { stops++; lastMessage = a.message }
    else if (a.kind === 'retry') { retries++; lastMessage = a.note }
    else if (a.kind === 'pending') pending++
    else applied++
  }
  return { stops, applied, retries, ignored, pending, lastMessage, health }
}

console.log('1. transient 503 on the current job keeps polling')
{
  const r = simulate([{ status: 503, at: 1000 }, { status: 503, at: 4000 }, { status: 200, at: 9000 }])
  check('no stop on 503', r.stops === 0, r)
  check('two retries then one apply', r.retries === 2 && r.applied === 1, r)
  check('retry note is the visible recoverable status', r.lastMessage === null || r.lastMessage === RETRY_NOTE)
  check('health reset after recovery', r.health.failures === 0 && r.health.firstFailureAt === null, r.health)
}

console.log('2. a late 503 for an abandoned job is ignored')
{
  const r = simulate([{ status: 503, at: 1000, stale: true }, { status: 200, at: 2000 }])
  check('stale answer neither stops nor retries', r.stops === 0 && r.retries === 0 && r.ignored === 1, r)
  check('the current job still applies', r.applied === 1, r)
}
{
  const r = simulate([{ status: 200, at: 1000, stale: true }])
  check('a stale RESULT is not applied either', r.applied === 0 && r.ignored === 1, r)
}

console.log('3. backoff grows, is capped, and clears; auth answers stop')
{
  const h = newPollHealth()
  const waits: number[] = []
  let t = 0
  for (let i = 0; i < 7; i++) {
    const v = classifyPollResponse('network', t, h)
    check(`network failure ${i + 1} is a retry`, v.kind === 'retry', v)
    waits.push(h.nextAllowedAt - t)
    t = h.nextAllowedAt
  }
  check('waits grow then cap', waits[0] === 2000 && waits[1] === 4000 && waits[2] === 8000 && waits[3] === MAX_BACKOFF_MS && waits[6] === MAX_BACKOFF_MS, waits)
  const ok = classifyPollResponse(200, t + 1, h)
  check('200 clears the backoff', ok.kind === 'ok' && h.nextAllowedAt === 0 && h.failures === 0, h)
  const h2 = newPollHealth()
  const v401 = classifyPollResponse(401, 5000, h2)
  check('401 stops with the sign-in sentence', v401.kind === 'stop' && v401.message === SESSION_EXPIRED_MESSAGE, v401)
  const v403 = classifyPollResponse(403, 5000, h2)
  check('403 stops with the ownership sentence', v403.kind === 'stop' && v403.message === FOREIGN_JOB_MESSAGE, v403)
  const h3 = newPollHealth()
  classifyPollResponse(503, 0, h3)
  const late = classifyPollResponse(503, TRANSIENT_WINDOW_MS + 1, h3)
  check('trouble past the window stops with the reload sentence', late.kind === 'stop' && late.message === LOST_CONTACT_MESSAGE, late)
  const h4 = newPollHealth()
  check('malformed body counts as transient', classifyPollResponse('malformed', 0, h4).kind === 'retry')
}

console.log('4. a job that never appears stops only after the grace window')
{
  const h = newPollHealth()
  check('404 at t=0 is pending', classifyPollResponse(404, 0, h).kind === 'pending')
  check('404 inside the window is pending', classifyPollResponse(404, MISSING_JOB_GRACE_MS - 1, h).kind === 'pending')
  const v = classifyPollResponse(404, MISSING_JOB_GRACE_MS + 1, h)
  check('404 past the window stops with the never-started sentence', v.kind === 'stop' && v.message === MISSING_JOB_MESSAGE, v)
  const h2 = newPollHealth()
  classifyPollResponse(404, 0, h2)
  classifyPollResponse(200, 3000, h2)
  check('a 200 resets the missing clock', h2.firstMissingAt === null)
  const h3 = newPollHealth()
  classifyPollResponse(503, 0, h3); classifyPollResponse(503, 3000, h3)
  classifyPollResponse(404, 5000, h3)
  check('a 404 after 5xx clears the failure run', h3.failures === 0 && h3.firstFailureAt === null && h3.nextAllowedAt === 0, h3)
}

console.log('5. an interrupted XDuel stream settles unfinished cards')
{
  const slots = [
    { text: 'https://x/a.png', isImage: true, isVideo: false, streaming: false, done: true, errorMessage: null as string | null, cost: 0.02 },
    { text: 'partial', isImage: false, isVideo: false, streaming: true, done: false, errorMessage: null as string | null, cost: 0 },
  ]
  const out = finalizeInterrupted(slots)
  check('finished slot untouched', out[0] === slots[0])
  check('unfinished slot becomes a failed, done, non-streaming card', out[1].done && !out[1].streaming && out[1].errorMessage === STREAM_INTERRUPTED_MESSAGE && out[1].text === '' && !out[1].isImage, out[1])
  check('extra fields survive', out[1].cost === 0)
  check('empty list is a no-op', finalizeInterrupted([]).length === 0)
}

console.log('6. a 200 is applied only when it is shaped like a job')
{
  check('real payload passes', isJobPayload({ job: { status: 'running', id: 'x' }, slots: [] }))
  check('HTML error page (string) is rejected', !isJobPayload('<!DOCTYPE html>'))
  check('object without job is rejected', !isJobPayload({ slots: [] }))
  check('job without status is rejected', !isJobPayload({ job: { id: 'x' }, slots: [] }))
  check('slots not an array is rejected', !isJobPayload({ job: { status: 'running' }, slots: null }))
  check('a null slot entry is rejected', !isJobPayload({ job: { status: 'running' }, slots: [null] }))
  check('an unknown job status is rejected', !isJobPayload({ job: { status: 'queued' }, slots: [] }))
  check('completed and failed are accepted', isJobPayload({ job: { status: 'completed' }, slots: [{}] }) && isJobPayload({ job: { status: 'failed' }, slots: [] }))
  check('null is rejected', !isJobPayload(null))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
