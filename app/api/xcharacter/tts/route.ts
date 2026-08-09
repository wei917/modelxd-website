// app/api/xcharacter/tts/route.ts — the character's voice (stage 2, Aug 8).
// Three actions:
//   preview  hear a preset voice before choosing it (builder)
//   design   mint a NOVEL voice from a text description ($0.20, builder)
//   speak    say one message aloud in the character's voice (chat)
//
// Owner decision, Aug 8: presets + text-designed voices only. The cloning
// API (human samples in) is deliberately never called — consent for a
// recorded human voice is unverifiable, and an AI friend doesn't need one.
//
// Billing follows the chat route's rule: real cost shown always, debited
// when it rounds to a whole cent. Voice spend shares referenceType
// 'xcharacter_chat' + the character id, so a session's chat and voice land
// in the same ledger row on Profile.

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'
import { assertFeature } from '@/lib/features'
import { debitCredits, InsufficientCreditsError } from '@/lib/credits'
import { synthesizeSpeech, designVoice, VOICE_DESIGN_USD } from '@/lib/providers/alibaba'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const SPEAK_MAX_CH = 2000

// What a voice says when auditioned, per site language.
const SAMPLE: Record<string, string> = {
  'en':      "Hey, it's me. This is what my voice sounds like — do you like it?",
  'zh-Hant': '嘿，是我。這就是我的聲音——你喜歡嗎?',
  'zh-Hans': '嘿,是我。这就是我的声音——你喜欢吗?',
  'ja':      'ねえ、私だよ。これが私の声。気に入ってくれた?',
  'ko':      '안녕, 나야. 이게 내 목소리야. 마음에 들어?',
}
// qwen3-tts language_type values for our site languages (verified live:
// "English" accepted, Aug 8). Unknown lang → omit and let it auto-detect.
const LANG_TYPE: Record<string, string> = {
  'en': 'English', 'zh-Hant': 'Chinese', 'zh-Hans': 'Chinese',
  'ja': 'Japanese', 'ko': 'Korean',
}

export async function POST(req: Request) {
  const gate = await assertFeature('xtalk')
  if (gate) return gate
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }
  const lang = typeof body.lang === 'string' ? body.lang : 'en'
  const languageType = LANG_TYPE[lang] ?? null

  const debit = (cost: number, description: string, referenceId: string | null) => {
    const cents = Math.round(cost * 100)
    if (cents <= 0) return
    debitCredits({
      userId: user.id, amountCents: cents, referenceType: 'xcharacter_chat',
      referenceId: referenceId ?? undefined, description, metadata: {},
    }).catch(() => {})
  }

  try {
    // ── preview: audition a preset voice ────────────────────────────────
    if (body.action === 'preview') {
      const voice = String(body.voice ?? '').trim().slice(0, 120)
      if (!voice) return Response.json({ error: 'No voice' }, { status: 400 })
      const r = await synthesizeSpeech(SAMPLE[lang] ?? SAMPLE.en, voice, {
        designed: body.designed === true, languageType,
      })
      debit(r.cost, 'Voice preview', null)
      return Response.json({ url: r.url, cost: r.cost })
    }

    // ── design: mint a novel voice from a description ───────────────────
    if (body.action === 'design') {
      const description = String(body.description ?? '').trim().slice(0, 500)
      if (description.length < 8) {
        return Response.json({ error: 'Describe the voice in a sentence or two' }, { status: 400 })
      }
      const name = String(body.name ?? '').trim().slice(0, 60)
      // The mint costs real money the moment it succeeds — debit up front
      // and fail fast on an empty wallet, unlike the sub-cent paths.
      await debitCredits({
        userId: user.id, amountCents: Math.round(VOICE_DESIGN_USD * 100),
        referenceType: 'xcharacter_chat', referenceId: undefined,
        description: `Voice design${name ? ` (${name})` : ''}`, metadata: {},
      })
      const d = await designVoice(description, { name })
      // The design response's preview shape is undocumented — synthesize our
      // own sample line with the minted voice so the player always has audio.
      let previewUrl = d.previewUrl
      let previewCost = 0
      if (!previewUrl) {
        const r = await synthesizeSpeech(SAMPLE[lang] ?? SAMPLE.en, d.voice, { designed: true, languageType })
        previewUrl = r.url; previewCost = r.cost
      }
      debit(previewCost, 'Voice preview', null)
      return Response.json({ voice: d.voice, url: previewUrl, cost: VOICE_DESIGN_USD + previewCost })
    }

    // ── speak: one message aloud in the character's voice ───────────────
    const text = String(body.text ?? '').trim().slice(0, SPEAK_MAX_CH)
    const id = String(body.id ?? '')
    if (!text || !id) return Response.json({ error: 'Nothing to say' }, { status: 400 })
    // '*' so a pre-migration-77 database yields "no voice yet", not a 500.
    const { data: c } = await svc().from('x_characters')
      .select('*')
      .eq('id', id).eq('user_id', user.id).maybeSingle()
    if (!c) return Response.json({ error: 'Character not found' }, { status: 404 })
    if (!c.voice) return Response.json({ error: 'This character has no voice yet' }, { status: 400 })

    const r = await synthesizeSpeech(text, c.voice, { designed: !!c.voice_desc, languageType })
    debit(r.cost, `Voice (${c.name})`, c.id)
    return Response.json({ url: r.url, cost: r.cost })
  } catch (e: any) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json({ error: 'Not enough credits' }, { status: 402 })
    }
    console.warn('[xcharacter/tts]', e?.message)
    return Response.json({ error: e?.message ?? 'Voice failed' }, { status: 502 })
  }
}
