// app/api/xcharacter/live/route.ts — Live call mode, Phase B (owner, Aug 8).
// Two actions:
//   token  mint a short-lived Gemini ephemeral token whose session is
//          LOCKED to our model + systemInstruction (the memory head +
//          safety floor), so the browser can open the WebSocket itself
//          but can never rewrite who the character is.
//   end    persist the call transcript as ordinary messages (memory
//          consolidation sees a call exactly like a chat) and debit.
//
// Honest labeling: during a live call the character's mind runs on Gemini
// Live, not their configured model — the UI says so. Billing is flat
// $0.023/min (Gemini's audio-in $0.005 + audio-out $0.018 list prices,
// billed for the full duration as the ceiling), debited at call end.

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { assertFeature } from '@/lib/features'
import { debitCredits } from '@/lib/credits'
import { stableHead } from '@/lib/xcharacter-prompt'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const LIVE_MODEL = process.env.XCHARACTER_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
const LIVE_USD_PER_MIN = 0.023
const MAX_CALL_SECONDS = 30 * 60   // billing sanity cap on client-reported time
const CHAPTER_TAIL = 3             // same tail the chat route carries

// Gemini prebuilt call voices. The character's Qwen TTS voice can't speak
// here, so we pick a Gemini voice by the rough register of their chosen one.
const SEEN_CALL_IDS = new Set<string>()

const MALE_PRESETS = ['Ethan', 'Vincent', 'Neil', 'Dylan', 'Rocky']
const callVoice = (voice: string | null) =>
  voice && MALE_PRESETS.includes(voice) ? 'Charon' : 'Aoede'

export async function POST(req: Request) {
  const gate = await assertFeature('xtalk')
  if (gate) return gate
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { data: c } = await svc().from('x_characters')
    .select('*').eq('id', String(body.characterId ?? '')).eq('user_id', user.id).maybeSingle()
  if (!c) return Response.json({ error: 'Character not found' }, { status: 404 })

  // Calls land in a thread too (migration 80): validated id, else newest.
  const threadFor = async (want: unknown): Promise<string | null> => {
    if (typeof want === 'string' && want) {
      const { data } = await svc().from('x_character_threads').select('id')
        .eq('id', want).eq('character_id', c.id).is('deleted_at', null).maybeSingle()
      if (data) return data.id
    }
    const { data: newest } = await svc().from('x_character_threads').select('id')
      .eq('character_id', c.id).is('deleted_at', null)
      .order('last_at', { ascending: false }).limit(1).maybeSingle()
    if (newest) return newest.id
    const { data: made } = await svc().from('x_character_threads')
      .insert({ character_id: c.id }).select('id').single()
    return made?.id ?? null
  }

  const unconsolidatedCount = async (): Promise<number> => {
    const { data: dead } = await svc().from('x_character_threads')
      .select('id').eq('character_id', c.id).not('deleted_at', 'is', null)
    let q: any = svc().from('x_character_messages')
      .select('id', { count: 'exact', head: true })
      .eq('character_id', c.id).gt('id', c.consolidated_to)
    const ids = (dead ?? []).map((r: any) => r.id)
    if (ids.length) q = q.or(`thread_id.is.null,thread_id.not.in.(${ids.join(',')})`)
    const { count } = await q
    return count ?? 0
  }

  // ── token: mint the locked ephemeral session ────────────────────────
  if (body.action === 'token') {
    const key = process.env.GOOGLE_AI_API_KEY
    if (!key) return Response.json({ error: 'Live calls are not configured' }, { status: 503 })

    // CONSOLIDATE-ON-DIAL (owner, Aug 13: "compress right after the user
    // hits live call, then set up everything updated"). Only when the
    // unconsolidated tail exceeds what the context windows can carry —
    // consolidation is 10-30s on the character's own model, and a light
    // day must still ring instantly. The client shows the wait, runs the
    // chat route's consolidate action, and re-asks with skipConsolidate
    // so a failed consolidation can never dead-loop the dial.
    if (body.skipConsolidate !== true) {
      const tail = await unconsolidatedCount()
      if (tail > 40) return Response.json({ consolidateFirst: true, unconsolidated: tail })
    }

    const { data: memRows } = await svc().from('x_character_memory')
      .select('kind, seq, content').eq('character_id', c.id)
      .order('seq', { ascending: true })
    const critical = (memRows ?? []).find(m => m.kind === 'critical')?.content ?? ''
    const chapters = (memRows ?? []).filter(m => m.kind === 'chapter').slice(-CHAPTER_TAIL)

    // THE CALL PICKS UP WHERE THE CHAT LEFT OFF (owner, Aug 13: "Gemini
    // Live doesn't have the existing conversation context so it's not
    // useful"). The head always carried her long-term memory; what was
    // missing was the last stretch of the active thread. Minted per call,
    // so freshness is free.
    const tid = await threadFor(body.threadId)
    // A heavy chat day leaves up to 79 messages not yet consolidated; the
    // call must see that tail or it opens mid-amnesia (owner, Aug 13:
    // "what if I use other models to talk for 1 day?"). Window widened to
    // 40 + the cross-thread meanwhile block chat turns already get, all
    // under a hard char budget so the mint stays one instant request.
    const line = (m: any) => `${m.role === 'user' ? 'User' : c.name}: ${m.text}`
    const clip = (rows: any[], budget: number) => {
      const out: string[] = []
      let used = 0
      for (const m of rows) {
        const l = line(m)
        if (used + l.length > budget) break
        out.push(l); used += l.length + 1
      }
      return out.reverse().join('\n')
    }
    const { data: recent } = await svc().from('x_character_messages')
      .select('role, text').eq('character_id', c.id).eq('thread_id', tid ?? '')
      .order('id', { ascending: false }).limit(40)
    const windowTxt = clip(recent ?? [], 12_000)
    const { data: dead } = await svc().from('x_character_threads')
      .select('id').eq('character_id', c.id).not('deleted_at', 'is', null)
    let mq: any = svc().from('x_character_messages')
      .select('role, text').eq('character_id', c.id)
      .gt('id', c.consolidated_to).neq('thread_id', tid ?? '')
      .order('id', { ascending: false }).limit(12)
    const deadIds = (dead ?? []).map((r: any) => r.id)
    if (deadIds.length) mq = mq.or(`thread_id.is.null,thread_id.not.in.(${deadIds.join(',')})`)
    const { data: meanwhile } = await mq
    const meanwhileTxt = clip(meanwhile ?? [], 4_000)
    const systemInstruction = stableHead(c, critical, chapters, 'call')
      + (meanwhileTxt ? `\n\n=== Meanwhile, in your other chats with them (not yet in your memory file) ===\n${meanwhileTxt}` : '')
      + (windowTxt ? `\n\n=== The conversation so far (continue from here — the user just switched to a live call) ===\n${windowTxt}` : '')

    try {
      const ai = new GoogleGenAI({ apiKey: key })
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: new Date(Date.now() + 32 * 60 * 1000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: {
              responseModalities: ['AUDIO' as any],
              systemInstruction,
              // Live sessions can ground on Google Search; offered only
              // when the character has search switched on, like chat.
              ...(c.search === true ? { tools: [{ googleSearch: {} }] as any } : {}),
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: callVoice(c.voice) } },
              },
            },
          },
        },
      })
      return Response.json({ token: token.name, model: LIVE_MODEL, usdPerMin: LIVE_USD_PER_MIN })
    } catch (e: any) {
      console.warn('[xcharacter/live] token failed:', e?.message)
      return Response.json({ error: 'Could not start the live call' }, { status: 502 })
    }
  }


  const cleanTurns = (raw: any) => (Array.isArray(raw) ? raw : [])
    .map((t: any) => ({
      role: t?.role === 'character' ? 'character' : 'user',
      text: String(t?.text ?? '').trim().slice(0, 4000),
    }))
    .filter((t: any) => t.text)


  const unconsolidated = async () => {
    // Same forget-forward view as the chat route: deleted threads never
    // count toward the consolidation trigger.
    const { data: dead } = await svc().from('x_character_threads')
      .select('id').eq('character_id', c.id).not('deleted_at', 'is', null)
    let q: any = svc().from('x_character_messages')
      .select('id', { count: 'exact', head: true })
      .eq('character_id', c.id).gt('id', c.consolidated_to)
    const ids = (dead ?? []).map((r: any) => r.id)
    if (ids.length) q = q.or(`thread_id.is.null,thread_id.not.in.(${ids.join(',')})`)
    const { count } = await q
    return (count ?? 0) >= 80
  }

  // ── append: persist finished turns DURING the call (owner bug, Aug 12:
  // a dropped call lost its whole transcript, so the character "forgot"
  // the conversation — persistence only happened at graceful end). Called
  // per completed turn pair; no billing here, minutes are debited at end.
  if (body.action === 'append') {
    const turns = cleanTurns(body.turns).slice(0, 20)
    if (turns.length === 0) return Response.json({ ok: true, saved: 0 })
    const tid = await threadFor(body.threadId)
    for (const t of turns) {
      await svc().from('x_character_messages').insert({
        character_id: c.id, role: t.role, text: t.text, thread_id: tid,
      })
    }
    if (tid) await svc().from('x_character_threads').update({ last_at: new Date().toISOString() }).eq('id', tid)
    await svc().from('x_characters').update({
      last_chat_at: new Date().toISOString(),
      msg_count: (c.msg_count ?? 0) + turns.length,
    }).eq('id', c.id)
    // Calls must trigger memory work too — before this, a user who mostly
    // TALKED never crossed the consolidation trigger, which only the typed
    // chat path checked. That is the deeper half of "she forgets".
    return Response.json({ ok: true, saved: turns.length, consolidate: await unconsolidated() })
  }

  // ── end: persist the transcript, debit the minutes ──────────────────
  if (body.action === 'end') {
    const seconds = Math.min(Math.max(0, Number(body.seconds) || 0), MAX_CALL_SECONDS)
    // Idempotency (owner ledger, Aug 12: ONE 8-minute call debited three
    // times — concurrent end paths on the client all read the same
    // stopwatch before any of them reset it). The client now sends a
    // per-segment callId; a repeat is acknowledged and ignored. Per-
    // instance memory: the triple came from one client in one second, so
    // instance-local is exactly where the guard must live.
    const callId = typeof body.callId === 'string' ? body.callId.slice(0, 64) : null
    if (callId) {
      if (SEEN_CALL_IDS.has(callId)) return Response.json({ ok: true, duplicate: true })
      SEEN_CALL_IDS.add(callId)
      if (SEEN_CALL_IDS.size > 500) SEEN_CALL_IDS.clear()
    }
    const turns = cleanTurns(body.turns).slice(0, 200)

    const tid = await threadFor(body.threadId)
    for (const t of turns) {
      await svc().from('x_character_messages').insert({
        character_id: c.id, role: t.role, text: t.text, thread_id: tid,
      })
    }
    if (tid && turns.length) await svc().from('x_character_threads').update({ last_at: new Date().toISOString() }).eq('id', tid)
    await svc().from('x_characters').update({
      last_chat_at: new Date().toISOString(),
      msg_count: (c.msg_count ?? 0) + turns.length,
    }).eq('id', c.id)

    const cost = (seconds / 60) * LIVE_USD_PER_MIN
    const cents = Math.round(cost * 100)
    if (cents > 0) {
      debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xcharacter_chat',
        referenceId: c.id, description: `Live call (${c.name}, ${Math.round(seconds / 60)}m)`, metadata: {},
      }).catch(() => {})
    }
    return Response.json({ ok: true, cost, saved: turns.length, consolidate: await unconsolidated() })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
