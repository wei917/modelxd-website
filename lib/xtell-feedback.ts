// lib/xtell-feedback.ts — what a vote on a teacher's answer and a press in a
// share dialog may say (owner, Oct 1: "add thumb up and thumb down for each
// response", "can we also log what type of share?"). supabase/122 stores
// them: xtell_answer_votes through /api/xtell/vote, xtell_shares through
// /api/visit under the visit log's rules. /admin/traffic counts both.
//
// A share sheet never tells the page which app was picked (LINE, Instagram,
// 儲存影像…): only that it was completed or closed.

/** What was shared: a teacher's answer, today's fortune, the almanac, a
 *  fortune cookie, tarot cards, or a 籤. */
export const SHARE_KINDS = ['answer', 'daily', 'almanac', 'cookie', 'tarot', 'qian'] as const
export type ShareKind = typeof SHARE_KINDS[number]

/** How: 存到相簿 (an iPhone's share sheet, picture alone), a download, 分享…
 *  (picture and text), or 複製連結. */
export const SHARE_METHODS = ['save', 'download', 'share', 'copy'] as const
export type ShareMethod = typeof SHARE_METHODS[number]

/** done: the sheet was completed, the file downloaded, the link copied.
 *  cancelled: the sheet was closed. failed: the browser refused. */
export const SHARE_OUTCOMES = ['done', 'cancelled', 'failed'] as const
export type ShareOutcome = typeof SHARE_OUTCOMES[number]

/** What a share button knows about its picture. */
export type ShareLog = { kind: ShareKind; temple?: string | null; modelId?: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEMPLE = /^[a-z]{2,20}$/

/** A share report from a page, checked; null when it is not one. */
export function asShareReport(x: unknown): { kind: ShareKind; temple: string | null; model_id: string | null; method: ShareMethod; outcome: ShareOutcome } | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (!(SHARE_KINDS as readonly unknown[]).includes(r.kind)) return null
  if (!(SHARE_METHODS as readonly unknown[]).includes(r.method)) return null
  if (!(SHARE_OUTCOMES as readonly unknown[]).includes(r.outcome)) return null
  return {
    kind: r.kind as ShareKind,
    temple: typeof r.temple === 'string' && TEMPLE.test(r.temple) ? r.temple : null,
    // Only an answer has a teacher.
    model_id: r.kind === 'answer' && typeof r.modelId === 'string' && UUID.test(r.modelId) ? r.modelId : null,
    method: r.method as ShareMethod,
    outcome: r.outcome as ShareOutcome,
  }
}

/** Count one press. Never stands in the way of the share itself. */
export function countShare(log: ShareLog, method: ShareMethod, outcome: ShareOutcome): void {
  try {
    const body = JSON.stringify({ share: { ...log, method, outcome }, path: window.location.pathname })
    if (navigator.sendBeacon?.('/api/visit', body)) return
    void fetch('/api/visit', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {})
  } catch { /* counting is never worth an error */ }
}

/** A vote: +1, -1, or 0 to take it back. */
export const asVote = (x: unknown): 1 | -1 | 0 | null => x === 1 || x === -1 || x === 0 ? x : null
