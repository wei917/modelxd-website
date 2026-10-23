// app/api/xoracle/wall/wish/route.ts — a wish plaque outside 觀音廟 (Oct 22;
// docs/GUANYIN-HANGING-PLAN.md). Signed in; $0.10 for a year.
//
//   POST  { text, wishFor, sealed, lang }   hang one. Every check runs before
//         any money moves (lib/xoracle-wall.ts wishProblem, then
//         lib/xoracle-wall-check.ts); then 10¢ is debited and the row
//         written, and a failed write is refunded at once (the cookie's
//         pattern). Public by default (owner); sealed shows only the back.
//   PATCH { id, action }   on one's own plaque: 'seal', 'open' (runs the
//         checks again), 'fulfil' / 'unfulfil' (還願), 'take_down' (no
//         refund; a stick can be taken down too). Admins (ADMIN_EMAILS) may
//         'hide' / 'unhide' anyone's.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xoracleAdmin, dailyMissing } from '@/lib/xoracle-admin'
import { isAdminEmail } from '@/lib/admin'
import { debitCredits, grantCredits, InsufficientCreditsError } from '@/lib/credits'
import { checkWish, type WishCheck } from '@/lib/xoracle-wall-check'
import { WALL_TEMPLE, MINE_COLUMNS, WISH_CENTS, WISH_DAYS, WISHES_PER_DAY, asWallLang, asWishFor, cleanWish, wishProblem, myItem } from '@/lib/xoracle-wall'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const refuse = (code: string, error: string, status = 400) => Response.json({ error, code }, { status })
const DAY = 86_400_000

/** A failed check, as the page's refusal (each code is a sentence there). */
function checkRefusal(check: WishCheck): Response | null {
  if (check === 'ok') return null
  if (check === 'unavailable') return refuse('wish_check_unavailable', 'the check could not run', 503)
  if (check === 'refused') return refuse('wish_refused', 'refused by moderation', 422)
  if (check === 'harm') return refuse('wish_harm', 'wishes harm on someone', 422)
  if (check === 'ad') return refuse('wish_ad', 'advertising', 422)
  return refuse('wish_personal', 'names a person or carries personal details', 422)
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return refuse('sign_in', 'Unauthorized', 401)
  const body = await req.json().catch(() => null)
  const text = cleanWish(body?.text)
  const problem = wishProblem(text)
  if (problem) return refuse(`wish_${problem}`, `bad wish: ${problem}`)
  const sealed = body?.sealed === true

  const admin = xoracleAdmin()
  const since = new Date(Date.now() - DAY).toISOString()
  const { count, error: countErr } = await admin.from('xoracle_hangings').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('kind', 'wish').gte('created_at', since)
  if (countErr) return dailyMissing(countErr) ? refuse('wall_unavailable', 'the wall is not ready', 503) : refuse('wish_failed', 'wish failed', 500)
  if ((count ?? 0) >= WISHES_PER_DAY) return refuse('wish_daily_limit', 'too many wishes today', 429)

  const refusal = checkRefusal(await checkWish(text, user.id, !sealed))
  if (refusal) return refusal

  const id = crypto.randomUUID()
  try {
    await debitCredits({ userId: user.id, amountCents: WISH_CENTS, referenceType: 'xtell', referenceId: `wish:${id}`,
      description: 'XOracle wish plaque (Guanyin temple, one year)', metadata: { temple: WALL_TEMPLE, kind: 'wish' } })
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return refuse('no_credits', 'not enough credits', 402)
    console.error('[xoracle/wall/wish] debit', (e as Error).message)
    return refuse('wish_failed', 'wish failed', 500)
  }
  const now = Date.now()
  const { data, error } = await admin.from('xoracle_hangings').insert({
    id, kind: 'wish', temple: WALL_TEMPLE, user_id: user.id,
    wish_text: text, wish_for: asWishFor(body?.wishFor), sealed, price_cents: WISH_CENTS,
    lang: asWallLang(body?.lang), created_at: new Date(now).toISOString(), down_at: new Date(now + WISH_DAYS * DAY).toISOString(),
  }).select(MINE_COLUMNS).single()
  if (error) {
    console.error('[xoracle/wall/wish] insert', error.message)
    await grantCredits({ userId: user.id, amountCents: WISH_CENTS, kind: 'refund', referenceType: 'xtell', referenceId: `wish:${id}`,
      description: 'XOracle wish plaque refund (not hung)' }).catch(e => console.error('[xoracle/wall/wish] refund', (e as Error).message))
    return refuse('wish_failed', 'wish failed', 500)
  }
  return Response.json({ item: myItem(data) })
}

const ACTIONS = ['seal', 'open', 'fulfil', 'unfulfil', 'take_down', 'hide', 'unhide'] as const
type Action = (typeof ACTIONS)[number]

export async function PATCH(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return refuse('sign_in', 'Unauthorized', 401)
  const body = await req.json().catch(() => null)
  const id = body?.id, action = body?.action as Action
  if (typeof id !== 'string' || !UUID.test(id) || !(ACTIONS as readonly string[]).includes(action)) return refuse('wish_bad_input', 'bad change')

  const admin = xoracleAdmin()
  const moderator = action === 'hide' || action === 'unhide'
  if (moderator && !isAdminEmail(user.email)) return refuse('forbidden', 'admins only', 403)
  let q = admin.from('xoracle_hangings').select('id, kind, user_id, wish_text, sealed').eq('id', id)
  if (!moderator) q = q.eq('user_id', user.id)
  const { data: row, error: readErr } = await q.maybeSingle()
  if (readErr) return dailyMissing(readErr) ? refuse('wall_unavailable', 'the wall is not ready', 503) : refuse('wish_failed', 'change failed', 500)
  if (!row) return refuse('wish_not_found', 'no such plaque', 404)
  if ((row as any).kind !== 'wish' && action !== 'take_down') return refuse('wish_bad_input', 'not a wish')

  if (action === 'open' && (row as any).sealed) {
    const refusal = checkRefusal(await checkWish(String((row as any).wish_text ?? ''), user.id, true))
    if (refusal) return refusal
  }
  const at = new Date().toISOString()
  const change: Record<string, unknown> =
      action === 'seal' ? { sealed: true }
    : action === 'open' ? { sealed: false }
    : action === 'fulfil' ? { fulfilled_at: at }
    : action === 'unfulfil' ? { fulfilled_at: null }
    : action === 'take_down' ? { taken_down_at: at }
    : action === 'hide' ? { hidden_at: at, hidden_by: 'admin' }
    : { hidden_at: null, hidden_by: null }
  const { data, error } = await admin.from('xoracle_hangings').update(change).eq('id', id).select(MINE_COLUMNS).single()
  if (error) { console.error('[xoracle/wall/wish] patch', error.message); return refuse('wish_failed', 'change failed', 500) }
  return Response.json({ item: myItem(data) })
}
