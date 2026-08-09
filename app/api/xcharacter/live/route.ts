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

  // ── token: mint the locked ephemeral session ────────────────────────
  if (body.action === 'token') {
    const key = process.env.GOOGLE_AI_API_KEY
    if (!key) return Response.json({ error: 'Live calls are not configured' }, { status: 503 })

    const { data: memRows } = await svc().from('x_character_memory')
      .select('kind, seq, content').eq('character_id', c.id)
      .order('seq', { ascending: true })
    const critical = (memRows ?? []).find(m => m.kind === 'critical')?.content ?? ''
    const chapters = (memRows ?? []).filter(m => m.kind === 'chapter').slice(-CHAPTER_TAIL)

    const systemInstruction = stableHead(c, critical, chapters, 'call')

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

  // ── end: persist the transcript, debit the minutes ──────────────────
  if (body.action === 'end') {
    const seconds = Math.min(Math.max(0, Number(body.seconds) || 0), MAX_CALL_SECONDS)
    const turns = (Array.isArray(body.turns) ? body.turns : [])
      .map((t: any) => ({
        role: t?.role === 'character' ? 'character' : 'user',
        text: String(t?.text ?? '').trim().slice(0, 4000),
      }))
      .filter((t: any) => t.text)
      .slice(0, 200)

    for (const t of turns) {
      await svc().from('x_character_messages').insert({
        character_id: c.id, role: t.role, text: t.text,
      })
    }
    await svc().from('x_characters').update({ last_chat_at: new Date().toISOString() }).eq('id', c.id)

    const cost = (seconds / 60) * LIVE_USD_PER_MIN
    const cents = Math.round(cost * 100)
    if (cents > 0) {
      debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xcharacter_chat',
        referenceId: c.id, description: `Live call (${c.name}, ${Math.round(seconds / 60)}m)`, metadata: {},
      }).catch(() => {})
    }
    return Response.json({ ok: true, cost, saved: turns.length })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
