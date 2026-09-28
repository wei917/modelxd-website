// lib/xtell-share.ts — the text half of XTell's share image (owner, Sep 28:
// "one button to generate an image to share and link to that temple").
// Client-safe, no DOM: the link a share carries and the excerpt a teacher's
// reply is cut down to. The image itself is drawn on the phone
// (app/components/xtell/ShareButton.tsx); nothing is uploaded or published.

/** The link on a share: the temple's own door (`?t=` opens that room and gives
 *  the link preview the temple's picture), the sharer's referral code, and a
 *  tag the visit log can count. No temple: the street itself. */
export function shareUrl(origin: string, temple: string | null, ref: string | null): string {
  const u = new URL('/', origin)
  if (temple) u.searchParams.set('t', temple)
  if (ref && /^[A-Za-z0-9]{6,16}$/.test(ref)) u.searchParams.set('ref', ref)
  u.searchParams.set('utm_source', 'share')
  return u.toString()
}

/** A date or clock time a teacher may repeat back (「你生於1990年5月3日」,
 *  1990-05-03, 03:15, 3點15分). The picture is meant to carry the reading,
 *  never the birth it came from, so these are masked before anything is drawn. */
const DATES = [
  /\d{4}\s*年\s*\d{1,2}\s*月(\s*\d{1,2}\s*[日號号])?/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日號号]/g,
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,
  /\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/g,
  /\d{1,2}\s*[:：]\s*\d{2}/g,
  /\d{1,2}\s*[點点時时]\s*(\d{1,2}\s*分)?/g,
  /\d{4}\s*년\s*\d{1,2}\s*월(\s*\d{1,2}\s*일)?/g,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b/gi,
  /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/gi,
]
export function maskDates(s: string): string {
  return DATES.reduce((out, re) => out.replace(re, '○○'), s)
}

const hasDate = (s: string) => DATES.some(re => new RegExp(re.source, re.flags.replace('g', '')).test(s))

/** Leave out every clause that holds a date or time (「你的日主為甲木，生於…，春末
 *  木氣仍旺。」 → 「你的日主為甲木，春末木氣仍旺。」), which reads better than a mask;
 *  a date that spans a comma is still masked after. */
export function dropDates(s: string): string {
  const parts = s.split(/(?<=[，,、；;。！？!?\n])/)
  let out = ''
  for (const part of parts) {
    if (!hasDate(part)) { out += part; continue }
    // A dropped clause that ended its sentence hands the ending back.
    const end = part.match(/[。！？!?]$/)?.[0]
    if (end) out = out.replace(/[，,、；;]$/, end)
  }
  return maskDates(out.replace(/[，,、；;]$/, '。'))
}

/** Markdown as a reader sees it: emphasis, links, lists and quotes reduced
 *  to their words, headings, tables and rules left out, one paragraph per
 *  entry. */
export function plainParagraphs(md: string): string[] {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map(block => block.split('\n')
      // Tables, rules and headings are structure, not the reading.
      .filter(l => !/^\s*\|/.test(l) && !/^\s*([-*_]\s*){3,}$/.test(l) && !/^\s{0,3}#{1,6}\s/.test(l))
      .map(l => l
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+/, '・')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1$2')
        .replace(/`([^`]*)`/g, '$1')
        .trim())
      .filter(Boolean)
      .join('\n'))
    .filter(Boolean)
}

/** Width in CJK characters: a Latin letter or digit counts half. */
const weight = (s: string) => [...s].reduce((n, c) => n + (/[\u0000-ɏ]/.test(c) ? 0.5 : 1), 0)

/** The opening of a reply, for the picture: whole paragraphs while they fit
 *  `max` (CJK characters), then the next one cut at its last sentence end, or
 *  at the limit with an ellipsis. Clauses with a date or time left out. */
export function shareExcerpt(md: string, max = 150): string[] {
  const out: string[] = []
  let used = 0
  for (const p of plainParagraphs(md).map(dropDates).filter(p => p.replace(/[。\s]/g, ''))) {
    const w = weight(p)
    if (used + w <= max) { out.push(p); used += w; continue }
    const room = max - used
    if (room < 24 && out.length) break
    let cut = '', cw = 0
    for (const ch of p) { if (cw + weight(ch) > room) break; cut += ch; cw += weight(ch) }
    const end = Math.max(...['。', '！', '？', '. ', '! ', '? ', '；'].map(e => cut.lastIndexOf(e)))
    out.push(end > cut.length * 0.5 ? cut.slice(0, end + 1).trim() : cut.trimEnd() + '…')
    break
  }
  return out
}
