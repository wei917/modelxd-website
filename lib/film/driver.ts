// lib/film/driver.ts — starting, driving and settling a film. Server-only.
//
// A film is one Managed Agents session. It runs on Anthropic's side for 10 to
// 30 minutes and stops whenever it calls one of our tools, until we answer.
// No Vercel function lives that long, so the film is DRIVEN: the open page
// (every few seconds) and a per-minute cron call driveFilm(), which
//   1. takes a short lease on the film (one reader at a time),
//   2. reads the session's status and its new progress lines,
//   3. claims each tool call the session is waiting on (the UNIQUE
//      tool_use_id insert is the claim) and checks it against the budget,
//   4. drops the lease, runs the claimed calls and sends their results,
//   5. once the session has stopped for good, settles: the film file into
//      storage, the bill (never more than the reserve), the refund, the
//      Library row.
// Every step can be repeated by the next drive without harm.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { debitCredits, grantCredits, getUserCredits, InsufficientCreditsError, formatCents } from '@/lib/credits'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { endCall } from '@/lib/providers/call-log'
import { FILM_LOCK, FILM_MODEL, filmClient, filmTraceUrl } from './agent'
import { filmSplit, FILM_MAX_MINUTES, type FilmAspect, type FilmProgress, type FilmView } from './config'
import { loadFilmModels, runFilmTool, estimateToolCents, isFilmTool, assetName, FILM_TOOL_LIMITS, type FilmModels } from './tools'

const LOG = '[film]'
/** The read-and-claim step's lease. Tool calls run outside it; the final
 *  download and upload of a film (up to 50 MB) runs inside. */
const LEASE_MS = 120_000
/** A claimed call older than this lost its function (maxDuration is 800s). */
const CALL_LEASE_MS = 14 * 60_000
const PROGRESS_CAP = 40
/** xcreate-ai-videos' own file limit (supabase/storage.sql). */
const MAX_FILM_BYTES = 52_428_800
const OUTPUTS_BETA = ['managed-agents-2026-04-01']
const PIXELS: Record<FilmAspect, string> = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '720x720' }
const ACTIVE = ['starting', 'running', 'finishing']

/** Why a film failed, as codes the page words in the viewer's language
 *  (app/xcreate/film-copy.ts). Anything else is a provider's own message. */
const FILM_ERROR_TEXT: Record<string, string> = {
  not_started: 'The film could not start.',
  not_finished: 'Claude stopped before saving the film.',
  time_limit: 'It reached the time limit before saving the film.',
  stopped: 'The film took too long and was stopped.',
  too_large: 'The film came out larger than 50 MB and could not be kept.',
  no_credit: 'Not enough credit.',
}

const NUDGE = 'Nobody can answer questions here. Make the best choice yourself and finish the film: save /mnt/session/outputs/film.mp4 and notes.md.'

export class FilmError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

export function filmService(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
}

const nowIso = () => new Date().toISOString()
const line = (kind: FilmProgress['kind'], text: string): FilmProgress => ({ at: nowIso(), kind, text })
const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`

function kickoff(f: { brief: string; seconds: number; aspect: FilmAspect; gen_cap_cents: number }): string {
  return [
    "The viewer's brief:",
    '"""',
    f.brief,
    '"""',
    '',
    `The film: ${f.seconds} seconds, ${f.aspect} (${PIXELS[f.aspect]}).`,
    `Generation budget for images, clips and voice: ${usd(f.gen_cap_cents)}. Clips cost $0.14 a second, images about $0.05, voice almost nothing.`,
    'Write the on-screen text and your progress lines in the language of the brief.',
  ].join('\n')
}

/** The film's one slot on its xcreates row (the Library entry). The
 *  `options.film` id is what opens the row back into the film view; `text`
 *  is the video's signed URL, which the Library re-signs on read. */
function filmSlot(film: any, o: { text: string | null; error: string | null; cost: number }) {
  return {
    provider: 'anthropic', model_name: FILM_MODEL, name: 'Claude Opus 5.5',
    text: o.text, isImage: false, isVideo: true, isAudio: false,
    durationSeconds: film.duration_seconds ?? null, cost: o.cost,
    responseTime: Date.now() - Date.parse(film.created_at),
    error: o.error, errorRef: null,
    options: { film: film.id, aspect: film.aspect, seconds: film.seconds, budget_cents: film.budget_cents },
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

export async function startFilm(userId: string, input: { brief: string; aspect: FilmAspect; seconds: number; budgetCents: number }): Promise<string> {
  const sb = filmService()
  const { count, error: countErr } = await sb.from('xcreate_films')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ACTIVE)
  if (countErr) {
    throw new FilmError(503, /xcreate_films/.test(countErr.message)
      ? 'Films are not set up yet (run supabase/111_xcreate_films.sql).'
      : `Could not start the film: ${countErr.message}`)
  }
  if ((count ?? 0) >= 2) throw new FilmError(429, 'Two of your films are already being made. Start another when one is done.')

  const split = filmSplit(input.budgetCents)
  const { data: film, error } = await sb.from('xcreate_films').insert({
    user_id: userId, status: 'starting', brief: input.brief, aspect: input.aspect, seconds: input.seconds,
    budget_cents: input.budgetCents, claude_cap_cents: split.claudeCents, gen_cap_cents: split.genCents,
    // Written before the debit, so no crash can leave money reserved that
    // the row does not know about (the stuck-start cleanup refunds this).
    reserved_cents: input.budgetCents,
  }).select('*').single()
  if (error || !film) throw new FilmError(500, `Could not start the film: ${error?.message ?? 'no row'}`)

  // Reserve the whole budget first, like every XCreate run: the wallet is
  // the authority, and the unused part comes back when the film settles.
  try {
    await debitCredits({
      userId, amountCents: input.budgetCents,
      referenceType: 'xcreate_film_reserve', referenceId: film.id,
      description: `XCreate film reserve (${formatCents(input.budgetCents)} budget)`,
      metadata: { filmId: film.id, budgetCents: input.budgetCents, seconds: input.seconds, aspect: input.aspect },
    })
  } catch (e) {
    await sb.from('xcreate_films').update({ status: 'failed', error: 'no_credit', reserved_cents: 0, charged_cents: 0, finished_at: nowIso(), updated_at: nowIso() }).eq('id', film.id)
    if (e instanceof InsufficientCreditsError) {
      const balance = (await getUserCredits(userId))?.balance_cents ?? 0
      throw new FilmError(402, `A film reserves its budget of ${formatCents(input.budgetCents)} up front, and your balance is ${formatCents(balance)}.`, {
        code: 'insufficient_credits', requiredCents: input.budgetCents, balanceCents: balance,
      })
    }
    console.error(`${LOG} ${film.id} reserve failed:`, e)
    throw new FilmError(500, 'Could not reserve the budget. Nothing was charged.')
  }

  // The Library entry, born now like every run's, so a film in progress is
  // already on the account page and opens back into this view.
  const { data: row, error: rowErr } = await sb.from('xcreates')
    .insert({ user_id: userId, mode: 'video', prompt: input.brief, slots: [filmSlot(film, { text: null, error: null, cost: 0 })] })
    .select('id').single()
  if (rowErr) console.warn(`${LOG} ${film.id} Library row insert failed:`, rowErr.message)
  film.xcreate_id = row?.id ?? null
  if (film.xcreate_id) await sb.from('xcreate_films').update({ xcreate_id: film.xcreate_id }).eq('id', film.id)

  try {
    const session: any = await filmClient().beta.sessions.create({
      agent: { type: 'agent', id: FILM_LOCK.agentId, version: FILM_LOCK.agentVersion },
      environment_id: FILM_LOCK.environmentId,
      title: `XCreate film ${film.id}`,
      metadata: { film_id: film.id },
      budget: { type: 'limit', max_list_cost: { amount: String(split.claudeCents), currency: 'USD' } },
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: kickoff(film) }] }],
    } as any)
    await sb.from('xcreate_films').update({
      session_id: session.id, status: 'running', agent_version: FILM_LOCK.agentVersion, updated_at: nowIso(),
    }).eq('id', film.id)
    console.log(`${LOG} ${film.id} started (${formatCents(input.budgetCents)}): ${filmTraceUrl(session.id)}`)
  } catch (e) {
    const message = sanitizeProviderError(e)
    console.error(`${LOG} ${film.id} session create failed:`, e)
    await settle(sb, { ...film, status: 'running' }, { ok: false, claudeCents: 0, genCents: 0, error: message })
    throw new FilmError(502, `${message} Your budget was refunded.`)
  }
  return film.id
}

// ── Drive ──────────────────────────────────────────────────────────────────

/** One pass. Returns when the pass is done, including any tool calls it
 *  ran (a clip takes one to three minutes). */
export async function driveFilm(id: string): Promise<void> {
  const sb = filmService()
  const now = nowIso()
  const { data: film } = await sb.from('xcreate_films')
    .update({ lock_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq('id', id).in('status', ACTIVE)
    .or(`lock_until.is.null,lock_until.lt."${now}"`)
    .select('*').maybeSingle()
  if (!film) return
  let work: Promise<void>[] = []
  try {
    work = await step(sb, film)
  } catch (e) {
    console.error(`${LOG} ${id} drive failed:`, e)
  } finally {
    await sb.from('xcreate_films').update({ lock_until: null }).eq('id', id)
  }
  await Promise.all(work)
}

/** Active films the cron should drive, least recently driven first. */
export async function activeFilmIds(limit = 8): Promise<string[]> {
  const { data } = await filmService().from('xcreate_films')
    .select('id').in('status', ACTIVE).order('updated_at', { ascending: true }).limit(limit)
  return (data ?? []).map(r => r.id)
}

async function genCentsOf(sb: SupabaseClient, filmId: string): Promise<number> {
  const { data } = await sb.from('xcreate_film_calls').select('status, cost_usd').eq('film_id', filmId)
  return Math.round((data ?? []).reduce((s, c) => s + (c.status === 'done' ? Number(c.cost_usd ?? 0) : 0), 0) * 100)
}

async function step(sb: SupabaseClient, film: any): Promise<Promise<void>[]> {
  const minutes = (Date.now() - Date.parse(film.created_at)) / 60_000
  if (film.status === 'starting') {
    if (film.session_id) {
      await sb.from('xcreate_films').update({ status: 'running' }).eq('id', film.id)
      film.status = 'running'
    } else {
      // A start that died before its session existed: give the money back.
      if (minutes > 5) await settle(sb, film, { ok: false, claudeCents: 0, genCents: 0, error: 'not_started' })
      return []
    }
  }
  // Whatever state it is in, a film this old is settled with what it has,
  // so a failing API can never hold a reserve forever.
  if (minutes > FILM_MAX_MINUTES + 30) {
    await settle(sb, film, {
      ok: !!film.output_path, claudeCents: film.claude_cents ?? 0, genCents: await genCentsOf(sb, film.id),
      error: film.output_path ? null : 'stopped',
    })
    return []
  }
  const client = filmClient()
  const session: any = await client.beta.sessions.retrieve(film.session_id)
  const patch: Record<string, unknown> = { updated_at: nowIso() }
  const claudeCents = Number(session?.usage?.list_cost?.amount)
  if (Number.isFinite(claudeCents)) patch.claude_cents = claudeCents

  // New progress lines: the agent's one-sentence notes, and errors.
  const params: any = { order: 'asc', limit: 100, types: ['agent.message', 'session.error'] }
  if (film.last_event_at) params['created_at[gt]'] = film.last_event_at
  const page: any = await client.beta.sessions.events.list(film.session_id, params)
  const fresh: FilmProgress[] = []
  for (const ev of page?.data ?? []) {
    if (ev.processed_at) patch.last_event_at = ev.processed_at
    if (ev.type === 'agent.message') {
      const text = (ev.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').replace(/\s+/g, ' ').trim()
      if (text) fresh.push({ at: ev.processed_at ?? nowIso(), kind: 'note', text: text.slice(0, 280) })
    } else if (ev.type === 'session.error') {
      fresh.push({ at: ev.processed_at ?? nowIso(), kind: 'error', text: sanitizeProviderError(ev.error?.message ?? ev.error ?? 'error').slice(0, 280) })
    }
  }
  if (fresh.length) patch.progress = [...(film.progress ?? []), ...fresh].slice(-PROGRESS_CAP)
  await sb.from('xcreate_films').update(patch).eq('id', film.id)
  Object.assign(film, patch)

  if (film.status === 'finishing' || session.status === 'terminated') {
    await finish(sb, client, film, session)
    return []
  }

  // The wall clock. The interrupt ends the current turn; the session then
  // idles and the next pass settles with whatever was saved.
  if (minutes > FILM_MAX_MINUTES && !film.interrupted_at) {
    await client.beta.sessions.events.send(film.session_id, { events: [{ type: 'user.interrupt' }] } as any)
      .catch(e => console.warn(`${LOG} ${film.id} interrupt failed:`, e?.message ?? e))
    await sb.from('xcreate_films').update({
      interrupted_at: nowIso(),
      progress: [...(film.progress ?? []), line('step', 'time_limit')].slice(-PROGRESS_CAP),
    }).eq('id', film.id)
    return []
  }
  if (film.interrupted_at && minutes > FILM_MAX_MINUTES + 10) {
    await finish(sb, client, film, session)
    return []
  }

  if (session.status !== 'idle') return []
  const idlePage: any = await client.beta.sessions.events.list(film.session_id, { order: 'desc', limit: 1, types: ['session.status_idle'] } as any)
  const idle = idlePage?.data?.[0]
  const reason: string | undefined = idle?.stop_reason?.type
  if (!reason) return []
  if (reason === 'requires_action') return answerTools(sb, client, film, idle.stop_reason.event_ids ?? [])

  // Claude's share ran out first. Generation money not spent or promised is
  // moved to Claude, and raising the session's budget resumes it on its
  // own; the two shares still add up to no more than the viewer's budget.
  if (reason === 'budget_reached') {
    const { data: rows } = await sb.from('xcreate_film_calls').select('status, cost_usd, estimate_cents').eq('film_id', film.id)
    let committed = 0
    for (const r of rows ?? []) {
      if (r.status === 'done') committed += Math.round(Number(r.cost_usd ?? 0) * 100)
      if (r.status === 'running') committed += r.estimate_cents ?? 0
    }
    const spare = film.gen_cap_cents - committed
    const used = Number(session?.usage?.list_cost?.amount) || film.claude_cents || 0
    if (spare >= 50) {
      try {
        await client.beta.sessions.update(film.session_id, {
          budget: { type: 'limit', max_list_cost: { amount: String(used + spare), currency: 'USD' } },
        } as any)
        await sb.from('xcreate_films').update({
          claude_cap_cents: used + spare, gen_cap_cents: film.gen_cap_cents - spare,
          progress: [...(film.progress ?? []), line('step', 'budget_moved')].slice(-PROGRESS_CAP),
        }).eq('id', film.id)
        console.log(`${LOG} ${film.id} moved ${spare}¢ of generation budget to Claude (cap now ${used + spare}¢)`)
        return []
      } catch (e: any) {
        console.warn(`${LOG} ${film.id} budget raise failed:`, e?.status ?? '', e?.message ?? e)
      }
    }
  }

  // It stopped without a film (it asked something, usually). Once, tell it
  // nobody will answer; after that, settle with what there is.
  if (reason === 'end_turn' && !film.interrupted_at && (film.nudges ?? 0) < 1 && !(await findOutputs(client, film.session_id)).mp4) {
    await client.beta.sessions.events.send(film.session_id, {
      events: [{ type: 'user.message', content: [{ type: 'text', text: NUDGE }] }],
    } as any)
    await sb.from('xcreate_films').update({ nudges: (film.nudges ?? 0) + 1 }).eq('id', film.id)
    return []
  }
  await finish(sb, client, film, session)
  return []
}

// ── Tool calls ─────────────────────────────────────────────────────────────

async function answerTools(sb: SupabaseClient, client: any, film: any, ids: string[]): Promise<Promise<void>[]> {
  if (!ids.length) return []
  const usesPage: any = await client.beta.sessions.events.list(film.session_id, { order: 'desc', limit: 50, types: ['agent.custom_tool_use'] } as any)
  const uses = (usesPage?.data ?? []).filter((e: any) => ids.includes(e.id))
  const { data: rows } = await sb.from('xcreate_film_calls').select('*').eq('film_id', film.id)
  const known = new Map((rows ?? []).map((r: any) => [r.tool_use_id, r]))
  let committed = 0
  const counts: Record<string, number> = {}
  for (const r of rows ?? []) {
    if (r.status === 'done') committed += Math.round(Number(r.cost_usd ?? 0) * 100)
    if (r.status === 'running') committed += r.estimate_cents ?? 0
    if (r.status === 'done' || r.status === 'running') counts[r.tool] = (counts[r.tool] ?? 0) + 1
  }

  let models: FilmModels | null = null
  let modelsError: string | null = null
  try { models = await loadFilmModels(sb) } catch (e: any) { modelsError = String(e?.message ?? e) }

  const work: Promise<void>[] = []
  for (const use of uses) {
    const row: any = known.get(use.id)
    if (row) {
      if (row.status !== 'running' && !row.sent_at) {
        work.push(sendResult(sb, client, film, use.id, row.result ?? 'Done.', row.status !== 'done'))
      } else if (row.status === 'running' && models && Date.now() - Date.parse(row.claimed_at) > CALL_LEASE_MS) {
        // Its function died mid-call: take it over.
        const { data: again } = await sb.from('xcreate_film_calls').update({ claimed_at: nowIso() })
          .eq('id', row.id).eq('claimed_at', row.claimed_at).select('*').maybeSingle()
        if (again) work.push(runCall(sb, client, film, use, again, models))
      }
      continue
    }
    const tool = use.name
    const est = models && isFilmTool(tool) ? estimateToolCents(tool, use.input, models) : 0
    const left = film.gen_cap_cents - committed
    const refusal = !isFilmTool(tool) ? `There is no tool called ${tool}.`
      : !models ? `Generation is unavailable right now (${modelsError}). Finish with what you have.`
      : (counts[tool] ?? 0) >= FILM_TOOL_LIMITS[tool] ? `Refused: this film has used all ${FILM_TOOL_LIMITS[tool]} ${tool} calls it may make.`
      : est > left ? `Refused: this would cost about ${usd(est)} and the generation budget has ${usd(left)} left. Finish the film with what you have.`
      : null
    const { data: claimed, error } = await sb.from('xcreate_film_calls').insert({
      film_id: film.id, tool_use_id: use.id, tool: String(tool).slice(0, 40), name: assetName(use.input?.name),
      input: use.input ?? {}, status: refusal ? 'refused' : 'running', estimate_cents: refusal ? 0 : est,
      result: refusal, finished_at: refusal ? nowIso() : null,
    }).select('*').maybeSingle()
    if (error) {
      if (error.code !== '23505') console.warn(`${LOG} ${film.id} claim failed:`, error.message)
      continue   // 23505: another driver holds it
    }
    if (refusal) { work.push(sendResult(sb, client, film, use.id, refusal, true)); continue }
    committed += est
    counts[tool] = (counts[tool] ?? 0) + 1
    work.push(runCall(sb, client, film, use, claimed, models!))
  }
  return work
}

async function runCall(sb: SupabaseClient, client: any, film: any, use: any, row: any, models: FilmModels): Promise<void> {
  const leftAfter = async () => {
    const { data } = await sb.from('xcreate_film_calls').select('status, cost_usd, estimate_cents').eq('film_id', film.id)
    let spent = 0
    for (const r of data ?? []) {
      if (r.status === 'done') spent += Math.round(Number(r.cost_usd ?? 0) * 100)
      if (r.status === 'running') spent += r.estimate_cents ?? 0
    }
    return `Generation budget left: about ${usd(film.gen_cap_cents - spent)} of ${usd(film.gen_cap_cents)}.`
  }
  try {
    const out = await runFilmTool(sb, film, use.name, use.input, models, leftAfter)
    await sb.from('xcreate_film_calls').update({
      status: out.status, cost_usd: out.costUsd, result: out.text,
      bucket: out.bucket ?? null, path: out.path ?? null, finished_at: nowIso(),
    }).eq('id', row.id)
    await sendResult(sb, client, film, use.id, out.text, out.status !== 'done')
  } catch (e) {
    console.error(`${LOG} ${film.id} ${use.name} crashed:`, e)
  }
}

async function sendResult(sb: SupabaseClient, client: any, film: any, toolUseId: string, text: string, isError: boolean): Promise<void> {
  try {
    await client.beta.sessions.events.send(film.session_id, {
      events: [{ type: 'user.custom_tool_result', custom_tool_use_id: toolUseId, content: [{ type: 'text', text }], is_error: isError }],
    } as any)
    await sb.from('xcreate_film_calls').update({ sent_at: nowIso() }).eq('tool_use_id', toolUseId)
  } catch (e: any) {
    // 4xx: the session no longer waits for this answer (it has it, or it
    // ended). Stop resending; anything else is retried by the next pass.
    if (e?.status >= 400 && e?.status < 500) await sb.from('xcreate_film_calls').update({ sent_at: nowIso() }).eq('tool_use_id', toolUseId)
    console.warn(`${LOG} ${film.id} result for ${toolUseId} not sent:`, e?.status ?? '', e?.message ?? e)
  }
}

// ── Finish and settle ──────────────────────────────────────────────────────

async function findOutputs(client: any, sessionId: string): Promise<{ mp4: any | null; notes: any | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const list: any = await client.beta.files.list({ scope_id: sessionId, betas: OUTPUTS_BETA } as any)
    const files: any[] = list?.data ?? []
    const mp4 = files.find(f => f.filename === 'film.mp4') ?? files.find(f => /\.mp4$/i.test(f.filename ?? '')) ?? null
    const notes = files.find(f => f.filename === 'notes.md') ?? null
    if (mp4 || files.length || attempt === 1) return { mp4, notes }
    await new Promise(r => setTimeout(r, 3000))   // outputs index a moment after idle
  }
  return { mp4: null, notes: null }
}

/** Seconds, from the MP4's movie header. */
function mp4Duration(buf: Buffer): number | null {
  try {
    const i = buf.indexOf('mvhd')
    if (i < 4) return null
    const at = i + 8   // after the box type, version and flags
    const [scale, length] = buf[i + 4] === 1
      ? [buf.readUInt32BE(at + 16), Number(buf.readBigUInt64BE(at + 20))]
      : [buf.readUInt32BE(at + 8), buf.readUInt32BE(at + 12)]
    const s = scale ? length / scale : 0
    return s > 0 && s < 1200 ? Math.round(s * 10) / 10 : null
  } catch {
    return null   // a header cut short: the duration is only a label
  }
}

async function finish(sb: SupabaseClient, client: any, film: any, session: any): Promise<void> {
  // A call still generating is waited for, unless the session is gone.
  if (session.status !== 'terminated') {
    const { count } = await sb.from('xcreate_film_calls').select('id', { count: 'exact', head: true })
      .eq('film_id', film.id).eq('status', 'running').gt('claimed_at', new Date(Date.now() - CALL_LEASE_MS).toISOString())
    if (count) return
  }
  if (film.status !== 'finishing') {
    await sb.from('xcreate_films').update({ status: 'finishing', updated_at: nowIso() }).eq('id', film.id)
    film.status = 'finishing'
  }

  let error: string | null = null
  if (!film.output_path) {
    const { mp4, notes } = await findOutputs(client, film.session_id)
    const patch: Record<string, unknown> = {}
    if (notes) {
      const res = await client.beta.files.download(notes.id)
      patch.notes = (await res.text()).slice(0, 20_000)
    }
    if (mp4 && Number(mp4.size_bytes ?? 0) > MAX_FILM_BYTES) {
      error = 'too_large'
    } else if (mp4) {
      const res = await client.beta.files.download(mp4.id)
      const buf = Buffer.from(await res.arrayBuffer())
      const path = `${film.user_id}/films/${film.id}/film.mp4`
      const { error: upErr } = await sb.storage.from('xcreate-ai-videos').upload(path, buf, { contentType: 'video/mp4', upsert: true })
      if (upErr) throw new Error(`film upload failed: ${upErr.message}`)   // the next pass retries
      patch.output_path = path
      patch.duration_seconds = mp4Duration(buf)
    }
    if (Object.keys(patch).length) {
      await sb.from('xcreate_films').update(patch).eq('id', film.id)
      Object.assign(film, patch)
    }
  }

  const genCents = await genCentsOf(sb, film.id)
  const claudeCents = Number(session?.usage?.list_cost?.amount ?? film.claude_cents ?? 0) || 0
  const stop = film.interrupted_at ? 'time_limit' : 'not_finished'
  const sessionError = [...(film.progress ?? [])].reverse().find((p: FilmProgress) => p.kind === 'error')?.text
  await settle(sb, film, {
    ok: !!film.output_path, claudeCents, genCents,
    error: film.output_path ? null : (error ?? sessionError ?? stop),
    usage: session?.usage,
  })
}

async function settle(sb: SupabaseClient, film: any, o: { ok: boolean; claudeCents: number; genCents: number; error: string | null; usage?: any }) {
  const reserved = film.reserved_cents ?? 0
  const used = o.claudeCents + o.genCents
  // List price for what it used, never past the budget the viewer agreed
  // to; nothing at all when no film came out of it.
  const charged = o.ok ? Math.min(used, reserved) : 0
  const refund = reserved - charged
  // Claim the settle: only the writer that flips charged_cents moves money.
  const { data: won } = await sb.from('xcreate_films')
    .update({ charged_cents: charged, claude_cents: o.claudeCents, gen_cents: o.genCents, updated_at: nowIso() })
    .eq('id', film.id).is('charged_cents', null).select('id').maybeSingle()
  if (won) {
    if (refund > 0) {
      try {
        await grantCredits({
          userId: film.user_id, amountCents: refund, kind: 'refund',
          referenceType: 'xcreate_film_refund', referenceId: film.id,
          description: o.ok
            ? `XCreate film refund (used ${formatCents(charged)} of ${formatCents(reserved)})`
            : 'XCreate film refund (no film was made)',
          metadata: { filmId: film.id, reservedCents: reserved, chargedCents: charged, claudeCents: o.claudeCents, genCents: o.genCents },
        })
      } catch (e) {
        console.error(`${LOG} ${film.id} REFUND FAILED, owed ${refund}¢:`, e)
      }
    }
    if (used > reserved && o.ok) console.warn(`${LOG} ${film.id} used ${used}¢ against a ${reserved}¢ reserve; the house covers ${used - reserved}¢`)
    if (film.session_id) {
      endCall(globalThis.crypto.randomUUID(), { provider: 'anthropic', model_name: FILM_MODEL, mode: 'text', user_id: film.user_id }, {
        status: o.ok ? 'success' : 'failed',
        error_message: o.ok ? null : o.error,
        latency_ms: Date.now() - Date.parse(film.created_at),
        input_tokens: o.usage?.input_tokens ?? null,
        output_tokens: o.usage?.output_tokens ?? null,
        cached_input_tokens: o.usage?.cache_read_input_tokens ?? null,
        cost_usd: o.claudeCents / 100,
        usage_metadata: { film_id: film.id, session_id: film.session_id, active_seconds: o.usage?.active_seconds ?? null },
      })
    }
  }

  if (film.xcreate_id) {
    let text: string | null = null
    if (o.ok && film.output_path) {
      const { data } = await sb.storage.from('xcreate-ai-videos').createSignedUrl(film.output_path, 60 * 60 * 24)
      text = data?.signedUrl ?? null
    }
    const slot = filmSlot(film, { text, error: o.ok ? null : (FILM_ERROR_TEXT[o.error ?? ''] ?? o.error), cost: charged / 100 })
    const { error } = await sb.from('xcreates').update({ slots: [slot] }).eq('id', film.xcreate_id)
    if (error) console.warn(`${LOG} ${film.id} Library row update failed:`, error.message)
  }

  await sb.from('xcreate_films').update({
    status: o.ok ? 'done' : 'failed', error: o.ok ? null : o.error,
    finished_at: nowIso(), updated_at: nowIso(), lock_until: null,
  }).eq('id', film.id)
  console.log(`${LOG} ${film.id} ${o.ok ? 'done' : 'failed'}: charged ${charged}¢ of ${reserved}¢ (Claude ${o.claudeCents}¢, generation ${o.genCents}¢)${o.ok ? '' : ` — ${o.error}`}`)
}

// ── The view ───────────────────────────────────────────────────────────────

export async function loadFilm(sb: SupabaseClient, id: string, userId: string): Promise<any | null> {
  const { data } = await sb.from('xcreate_films').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
  return data ?? null
}

export async function filmView(sb: SupabaseClient, film: any): Promise<FilmView> {
  const { data: calls } = await sb.from('xcreate_film_calls')
    .select('tool, name, status, cost_usd, claimed_at').eq('film_id', film.id).order('claimed_at', { ascending: true })
  const genCents = Math.round((calls ?? []).reduce((s, c) => s + (c.status === 'done' ? Number(c.cost_usd ?? 0) : 0), 0) * 100)
  let videoUrl: string | null = null
  let downloadUrl: string | null = null
  if (film.output_path) {
    const bucket = sb.storage.from('xcreate-ai-videos')
    const [play, save] = await Promise.all([
      bucket.createSignedUrl(film.output_path, 60 * 60),
      bucket.createSignedUrl(film.output_path, 60 * 60, { download: `film-${String(film.id).slice(0, 8)}.mp4` }),
    ])
    videoUrl = play.data?.signedUrl ?? null
    downloadUrl = save.data?.signedUrl ?? null
  }
  return {
    id: film.id, status: film.status, brief: film.brief, aspect: film.aspect, seconds: film.seconds,
    budgetCents: film.budget_cents, createdAt: film.created_at, finishedAt: film.finished_at ?? null,
    progress: film.progress ?? [],
    calls: (calls ?? []).map(c => ({ at: c.claimed_at, tool: c.tool, name: c.name ?? null, status: c.status, costUsd: c.cost_usd == null ? null : Number(c.cost_usd) })),
    spentCents: film.charged_cents ?? Math.min(film.budget_cents, genCents + (film.claude_cents ?? 0)),
    chargedCents: film.charged_cents ?? null,
    videoUrl, downloadUrl,
    durationSeconds: film.duration_seconds == null ? null : Number(film.duration_seconds),
    notes: film.notes ?? null, error: film.error ?? null, xcreateId: film.xcreate_id ?? null,
  }
}
