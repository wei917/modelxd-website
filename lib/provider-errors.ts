// lib/provider-errors.ts
//
// User-facing sanitization of provider errors (CC, July 19). Raw provider
// messages leak operational details users should never see — "You
// exceeded your current quota, please check your plan and billing" is
// OUR billing problem, not theirs. Full messages still go to console/
// telemetry; only the sanitized form reaches the client or the DB slot.

const BILLING  = /quota|billing|credits|prepayment|insufficient|RESOURCE_EXHAUSTED|payment/i
const RATE     = /rate limit|too many requests|overloaded|UNAVAILABLE|\b(429|503|529)\b/i
// Runway's synchronous create-time moderation returns a 400 whose body says
// "content moderation" and never the word safety/policy — it fell through to
// the generic "failed to generate" message and looked like an outage
// (CC, July 25). Keep 'moderat' and 'flagged' in here. Deliberately NOT
// 'violat': it also appears in billing/ToS messages, and SAFETY is tested
// first, so it would hijack them.
const SAFETY   = /safety|blocked|policy|policies|refused|RECITATION|moderat|flagged/i
// A provider message wrapped by one of our own throw sites — e.g.
// `Runway request failed (400): {...}` or `Runway task FAILED: SAFETY.INPUT`.
// Never echo these to the user: they carry our endpoint/status detail and read
// like a stack trace, and the raw form often contains a provider's internal
// enum rather than a sentence.
const WRAPPED  = /request failed|failed \(\d{3}\)|HTTP \d{3}|^\s*\d{3}\b|task (FAILED|CANCELED)|download failed/i
const TIMEOUT  = /timeout|timed out|deadline/i
const TOOBIG   = /exceeds the (context window|maximum number of tokens)|input token count exceeds|context_length_exceeded|maximum context length|prompt is too long|too large|too many tokens/i
const NOTFOUND = /not found|NOT_FOUND|does not exist|deprecated/i

export function sanitizeProviderError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? '')
  // Guard errors we authored FOR users ("pick a model with audio input",
  // "H3 needs a prompt") — everything else here strips provider internals,
  // which was also squashing our own guidance into the generic fallback.
  // Prefix such messages with USERMSG: at the throw site; the marker is
  // stripped and the message shown verbatim.
  const um = msg.indexOf('USERMSG:')
  if (um !== -1) return msg.slice(um + 'USERMSG:'.length).trim().slice(0, 220)
  // Safety refusals are already written for end users — keep them, but
  // strip anything that looks like a JSON dump.
  if (SAFETY.test(msg)) {
    // Echo the provider's own wording only when it reads like prose meant for
    // a user. Our wrapped HTTP errors would otherwise surface as the useless
    // and leaky "Runway request failed (400):" — exactly the operational
    // detail this module exists to strip.
    const clean = msg.split('{')[0].trim()
    if (clean.length > 10 && !WRAPPED.test(clean)) return clean.slice(0, 200)
    // Our own task-failure wrapper ("Runway task FAILED: <reason>") often
    // wraps prose that IS meant for users — "Text prompt did not pass
    // moderation check" tells them to fix the text, not the frames. Strip
    // the wrapper and echo the reason when it reads like a sentence; bare
    // enums (SAFETY.INPUT) have no spaces or lowercase and stay squashed.
    const reason = clean.replace(/^.*?task (?:FAILED|CANCELED):\s*/i, '')
      // Trailing machine code appended for the call log ("… [SAFETY.INPUT]")
      // is diagnostics, not prose — never show it to the user.
      .replace(/\s*\[[A-Z0-9._\- ]+\]\s*$/, '')
      .trim()
    if (reason.length > 10 && reason.includes(' ') && !WRAPPED.test(reason) && !/^[A-Z0-9._\- ]+$/.test(reason)) {
      return `${reason.replace(/\.\s*$/, '')}. Try rephrasing it.`.slice(0, 220)
    }
    return 'The model declined this prompt for safety reasons. Try rephrasing it.'
  }
  if (TOOBIG.test(msg))   return 'The attached file or prompt is too large for this model. Try a smaller file or a model with a larger context window.'
  if (BILLING.test(msg))  return 'This model is temporarily unavailable. Please try again later.'
  if (RATE.test(msg))     return 'This model is busy right now. Please try again in a moment.'
  if (TIMEOUT.test(msg))  return 'The model took too long to respond. Please try again.'
  if (NOTFOUND.test(msg)) return 'This model is temporarily unavailable.'
  return 'The model failed to generate a response. Please try again.'
}
