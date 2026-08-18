// app/api/xcharacter/chat/route.ts — the character's turn (owner, Aug 7).
//
// MEMORY DESIGN OF RECORD: the model manages its own memory in two stores.
//   critical — one doc (≤ ~10K tokens) of exact facts, rewritten WHOLE by
//              the model at each consolidation, under a stated budget;
//   chapters — an append-only conceptual memoir; each consolidation writes
//              the next chapter. Unbounded at rest; only the tail travels.
// Consolidation runs on the CHARACTER'S OWN model — curating memory is part
// of the skill this platform measures — and the client triggers it as a
// separate request (the werewolf lesson: never do slow work after the
// response closed; serverless freezes it).
//
// Prompt layout is cache-shaped: [safety floor + persona + memory] ride in
// the FIRST user message (providers read no system field — the /api/xtalk
// lesson) and stay byte-stable between consolidations; the moving parts
// (history window, time gap, new text) come after.

export const runtime = 'nodejs'
export const maxDuration = 120

import { createClient } from '@supabase/supabase-js'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits, InsufficientCreditsError } from '@/lib/credits'
import { stableHead } from '@/lib/xcharacter-prompt'

const LOG = '[xcharacter]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const WINDOW_MSGS       = 30      // verbatim recent turns per prompt
const CHAPTER_TAIL      = 3       // memoir chapters carried per prompt
const CONSOLIDATE_EVERY = 80      // unconsolidated messages before memory work
const CRITICAL_MAX_CH   = 32_000  // ≈ 8-10K tokens; hard server-side cap
const CHAPTER_MAX_CH    = 6_000

// Safety floor + abilities + stable head live in lib/xcharacter-prompt.ts,
// shared with the live-call route — one source of truth for the floor.
const sse = (event: string, data: object) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

const approxTokens = (s: string) => Math.ceil((s ?? '').length / 4)

function timeGapNote(lastChatAt: string | null): string {
  if (!lastChatAt) return ''
  const ms = Date.now() - new Date(lastChatAt).getTime()
  const h = ms / 3_600_000
  if (h < 6) return ''
  const human = h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`
  return `[Context: it has been ${human} since you last spoke.]`
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { data: c } = await svc().from('x_characters')
    .select('*').eq('id', String(body.characterId ?? '')).maybeSingle()
  if (!c || c.user_id !== user.id) return Response.json({ error: 'Not found' }, { status: 404 })

  // ── threads (migration 80): a thread is an EPISODE; memory stays with
  // the character. Resolution order: the id the client asked for (validated
  // against this character), else the most recent live thread, else a fresh
  // one — so pre-thread clients and empty characters both keep working.
  const threadFor = async (want: unknown): Promise<{ id: string; title: string } | null> => {
    if (typeof want === 'string' && want) {
      const { data } = await svc().from('x_character_threads').select('id, title')
        .eq('id', want).eq('character_id', c.id).is('deleted_at', null).maybeSingle()
      if (data) return data
    }
    const { data: newest } = await svc().from('x_character_threads').select('id, title')
      .eq('character_id', c.id).is('deleted_at', null)
      .order('last_at', { ascending: false }).limit(1).maybeSingle()
    if (newest) return newest
    const { data: made } = await svc().from('x_character_threads')
      .insert({ character_id: c.id }).select('id, title').single()
    return made ?? null
  }

  // FORGET-FORWARD (owner, Aug 13, policy B): a deleted thread stops
  // feeding memory from the moment of deletion — out of the meanwhile
  // window, out of every future consolidation slice and trigger count.
  // What an earlier consolidation already wrote stays written, like a
  // person who can't unhear something. NULL thread_ids (rows written by
  // pre-thread code) belong to no deleted thread and stay included.
  const deadThreadIds = async (): Promise<string[]> => {
    const { data } = await svc().from('x_character_threads')
      .select('id').eq('character_id', c.id).not('deleted_at', 'is', null)
    return (data ?? []).map((r: any) => r.id)
  }
  const excludeDead = (q: any, dead: string[]) =>
    dead.length ? q.or(`thread_id.is.null,thread_id.not.in.(${dead.join(',')})`) : q

  const loadMemory = async () => {
    const { data } = await svc().from('x_character_memory')
      .select('kind, seq, content').eq('character_id', c.id)
      .order('seq', { ascending: true })
    const rows = data ?? []
    return {
      critical: rows.find(r => r.kind === 'critical')?.content ?? '',
      chapters: rows.filter(r => r.kind === 'chapter'),
    }
  }

  // ── new_thread: a fresh episode (owner, Aug 12) ───────────────────────
  if (body.action === 'new_thread') {
    const { data: made, error } = await svc().from('x_character_threads')
      .insert({ character_id: c.id }).select('id, title').single()
    if (error || !made) return Response.json({ error: 'Could not create the chat' }, { status: 500 })
    return Response.json({ thread: made })
  }

  // ── rename_thread: first words name it, the user can rename it ───────
  if (body.action === 'rename_thread') {
    const title = String(body.title ?? '').trim().slice(0, 60)
    if (!title) return Response.json({ error: 'Give it a name' }, { status: 400 })
    await svc().from('x_character_threads').update({ title })
      .eq('id', String(body.threadId ?? '')).eq('character_id', c.id)
    return Response.json({ ok: true, title })
  }

  // ── delete_thread: soft, like every other history surface here ───────
  if (body.action === 'delete_thread') {
    await svc().from('x_character_threads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', String(body.threadId ?? '')).eq('character_id', c.id)
    return Response.json({ ok: true })
  }

  // ── history: open the room ────────────────────────────────────────────
  if (body.action === 'history') {
    const th = await threadFor(body.threadId)
    const { data: threads } = await svc().from('x_character_threads')
      .select('id, title, last_at').eq('character_id', c.id)
      .is('deleted_at', null).order('last_at', { ascending: false }).limit(50)
    const { data: msgs } = await svc().from('x_character_messages')
      .select('id, role, text, cost_usd, created_at')
      .eq('character_id', c.id).eq('thread_id', th?.id ?? '')
      .order('id', { ascending: false }).limit(100)
    const mem = await loadMemory()
    // Total spend with this character (owner, Aug 12: "I don't know how
    // much money I spent here"). Chat turns, TTS, live minutes and memory
    // work all debit with reference_id = the character — one sum tells the
    // whole truth, including the costs that never attach to a message row.
    const { data: tx } = await svc().from('credit_transactions')
      .select('amount_cents').eq('reference_id', c.id).limit(5000)
    const spentUsd = (tx ?? []).reduce((sum, r: any) => sum + Math.abs(r.amount_cents ?? 0), 0) / 100
    return Response.json({
      character: { id: c.id, name: c.name, avatarPath: c.avatar_path, modelId: c.model_id, thinking: c.thinking, msgCount: c.msg_count },
      messages: (msgs ?? []).reverse(),
      threads: threads ?? [],
      threadId: th?.id ?? null,
      spentUsd,
      memory: {
        criticalTokens: approxTokens(mem.critical),
        chapterCount: mem.chapters.length,
      },
    })
  }

  // ── consolidate: the model curates its own memory (client-triggered) ──
  if (body.action === 'consolidate') {
    const model = await getModelById(c.model_id)
    if (!model) return Response.json({ error: 'Model unavailable' }, { status: 503 })
    const dead = await deadThreadIds()
    const { data: slice } = await excludeDead(
      svc().from('x_character_messages')
        .select('id, role, text').eq('character_id', c.id)
        .gt('id', c.consolidated_to), dead)
      .order('id', { ascending: true }).limit(400)
    if (!slice || slice.length < 4) return Response.json({ ok: true, skipped: 'nothing new' })

    const mem = await loadMemory()
    const transcript = slice.map((m: any) => `${m.role === 'user' ? 'User' : c.name}: ${m.text}`).join('\n')
    const lastChapter = mem.chapters[mem.chapters.length - 1]

    const ask = async (prompt: string, maxCh: number): Promise<{ text: string; cost: number }> => {
      let full = '', cost = 0
      await new Promise<void>(resolve => {
        providers.streamText(model, [{ role: 'user', content: prompt }], {
          onDelta: (t: string) => { full += t },
          onDone: (r: any) => { cost = r.cost ?? 0; resolve() },
          onError: (m: string) => { console.warn(`${LOG} consolidation:`, m); resolve() },
        }, [], { userId: user.id, surface: 'xcharacter' } as any, { thinking: c.thinking ?? null, search: false })
          .catch(() => resolve())
      })
      return { text: full.trim().slice(0, maxCh), cost }
    }

    // Prompt A — the critical store, rewritten whole under budget.
    const [crit, chap] = await Promise.all([
      ask([
        `You are ${c.name}, maintaining your own private CRITICAL MEMORY about your user.`,
        'It holds EXACT durable facts only: names, dates, numbers, places, promises made, hard preferences, important events. No prose, no feelings — those belong in your memoir.',
        'Below is your current memory file, then the conversation since you last updated it. Rewrite the COMPLETE file: merge new facts, correct anything that changed, drop what stopped mattering. Terse lines, grouped by topic.',
        `HARD BUDGET: keep it under roughly ${Math.round(CRITICAL_MAX_CH / 4)} tokens — you decide what deserves the space.`,
        '', '=== CURRENT FILE ===', mem.critical || '(empty)', '=== END FILE ===',
        '', '=== NEW CONVERSATION ===', transcript, '=== END ===',
        '', 'Reply with ONLY the new file content.',
      ].join('\n'), CRITICAL_MAX_CH),
      // Prompt B — the next memoir chapter.
      ask([
        `You are ${c.name}, writing the next chapter of your private memoir about life with your user.`,
        'Capture the PERIOD below as you experienced it: themes, moods, jokes that stuck, disagreements and how they resolved, unresolved threads. Concepts and feelings — exact facts live in your critical memory instead.',
        lastChapter ? `Your previous chapter, for continuity:\n${lastChapter.content}\n` : '',
        '=== THE PERIOD ===', transcript, '=== END ===',
        '', 'Reply with ONLY the chapter text (roughly 300-600 words).',
      ].join('\n'), CHAPTER_MAX_CH),
    ])

    const lastId = slice[slice.length - 1].id
    if (crit.text) {
      await svc().from('x_character_memory').upsert({
        character_id: c.id, kind: 'critical', seq: 0,
        content: crit.text, tokens: approxTokens(crit.text), updated_at: new Date().toISOString(),
      })
    }
    if (chap.text) {
      await svc().from('x_character_memory').insert({
        character_id: c.id, kind: 'chapter', seq: (lastChapter?.seq ?? 0) + 1,
        content: chap.text, tokens: approxTokens(chap.text),
      })
    }
    await svc().from('x_characters').update({ consolidated_to: lastId }).eq('id', c.id)

    const totalCost = crit.cost + chap.cost
    const cents = Math.round(totalCost * 100)
    if (cents > 0) {
      debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xcharacter_chat',
        referenceId: c.id, description: `Memory consolidation (${c.name})`, metadata: {},
      }).catch(() => {})
    }
    return Response.json({ ok: true, cost: totalCost, chapters: (lastChapter?.seq ?? 0) + (chap.text ? 1 : 0) })
  }

  // ── default: one chat turn (SSE) ──────────────────────────────────────
  const text = String(body.text ?? '').trim().slice(0, 4000)
  if (!text) return Response.json({ error: 'Say something' }, { status: 400 })
  const model = await getModelById(c.model_id)
  if (!model) return Response.json({ error: 'This character\'s model is unavailable' }, { status: 503 })

  const th = await threadFor(body.threadId)
  const mem = await loadMemory()
  // The verbatim window is the THREAD's — that is the whole point of
  // threads. Memory (critical + chapters) still crosses them.
  const { data: recent } = await svc().from('x_character_messages')
    .select('role, text').eq('character_id', c.id).eq('thread_id', th?.id ?? '')
    .order('id', { ascending: false }).limit(WINDOW_MSGS)
  const window = (recent ?? []).reverse()

  // Durable before generative: the user's line lands in the log even if the
  // stream dies mid-reply.
  await svc().from('x_character_messages').insert({ character_id: c.id, role: 'user', text, thread_id: th?.id ?? null })
  if (th) {
    await svc().from('x_character_threads').update({
      last_at: new Date().toISOString(),
      // First words name the episode, like every other surface here.
      ...(th.title === 'New chat' ? { title: text.slice(0, 60) } : {}),
    }).eq('id', th.id)
  }

  const head = stableHead(c, mem.critical, mem.chapters.slice(-CHAPTER_TAIL))
  const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: head },
  ]
  for (const m of window) {
    msgs.push(m.role === 'character'
      ? { role: 'assistant', content: m.text }
      : { role: 'user', content: m.text })
  }
  // THE MEANWHILE WINDOW (owner, Aug 12: "for the same character, it
  // should know every thread... the memory should be shared"). Threads are
  // EPISODES of one relationship, not memory boundaries — so everything
  // said in other threads since her last consolidation rides along,
  // labeled as her own recollection. Consolidation then folds it into the
  // critical file and memoir; this block only bridges the gap in between.
  const deadForWindow = await deadThreadIds()
  const { data: elsewhere } = await excludeDead(
    svc().from('x_character_messages')
      .select('role, text').eq('character_id', c.id)
      .gt('id', c.consolidated_to).neq('thread_id', th?.id ?? ''), deadForWindow)
    .order('id', { ascending: false }).limit(12)
  if (elsewhere && elsewhere.length > 0) {
    const lines = elsewhere.reverse()
      .map((m: any) => `${m.role === 'user' ? 'User' : c.name}: ${m.text}`)
      .join('\n').slice(0, 6000)
    msgs.push({ role: 'user', content: `[You also remember these recent exchanges from your OTHER conversations with this user — they are part of the same one relationship:]\n${lines}` })
    msgs.push({ role: 'assistant', content: '(I remember.)' })
  }
  const gap = timeGapNote(c.last_chat_at)
  msgs.push({ role: 'user', content: gap ? `${gap}\n${text}` : text })

  const levels = model.output_config?.text?.thinking_levels ?? []
  const thinkLvl = typeof c.thinking === 'string' && levels.includes(c.thinking) ? c.thinking : null
  const caps = model.output_config?.text?.capabilities ?? []
  const useSearch = c.search === true && caps.includes('web_search')

  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      try {
        await providers.streamText(model, msgs, {
          onDelta: (t) => { full += t; controller.enqueue(sse('delta', { text: t })) },
          onDone: async (result) => {
            const cost = result.cost ?? 0
            await svc().from('x_character_messages').insert({
              character_id: c.id, role: 'character', text: full, cost_usd: cost, thread_id: th?.id ?? null,
            })
            const newCount = (c.msg_count ?? 0) + 2
            await svc().from('x_characters').update({
              msg_count: newCount, last_chat_at: new Date().toISOString(),
            }).eq('id', c.id)
            const cents = Math.round(cost * 100)
            if (cents > 0) {
              debitCredits({
                userId: user.id, amountCents: cents, referenceType: 'xcharacter_chat',
                referenceId: c.id, description: `Chat with ${c.name}`, metadata: { modelName: model.display_name },
              }).catch(err => {
                if (err instanceof InsufficientCreditsError) console.warn(`${LOG} insufficient credits`)
                else console.warn(`${LOG} debit failed:`, err)
              })
            }
            // The client fires the consolidate action when told — never
            // after-close work on serverless.
            const { count } = await excludeDead(
              svc().from('x_character_messages')
                .select('id', { count: 'exact', head: true })
                .eq('character_id', c.id).gt('id', c.consolidated_to), deadForWindow)
            controller.enqueue(sse('done', {
              cost, consolidate: (count ?? 0) >= CONSOLIDATE_EVERY,
            }))
            controller.close()
          },
          onError: (message) => {
            console.warn(`${LOG} ${model.display_name} failed:`, message)
            controller.enqueue(sse('error', { message }))
            controller.close()
          },
        }, [], { userId: user.id, surface: 'xcharacter' } as any, { thinking: thinkLvl, search: useSearch })
      } catch (err: any) {
        controller.enqueue(sse('error', { message: err?.message ?? 'turn failed' }))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
