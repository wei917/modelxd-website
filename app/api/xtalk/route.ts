// app/api/xtalk/route.ts
// XTalk — several models in one room, taking turns on one question.
//
// The opposite architecture to XDuel on purpose. XDuel fires every model in
// Promise.all with no model able to see another's output, and that isolation
// is what makes its votes clean. Here the models are SEQUENTIAL and every
// speaker reads the whole transcript first, so the conversation can actually
// build — at the cost of any claim to being a fair comparison. Nothing here
// feeds model_ratings.
//
// One request = ONE speaker turn. The client owns the loop: it decides who
// speaks next, appends the reply to the transcript and calls again. Holding
// a request open for four models talking would blow the serverless limit,
// and a per-turn boundary is also what lets the user interrupt mid-round.
//
// Billing: one debit per turn, same rounding as /api/xcreate/chat.

export const runtime     = 'nodejs'
export const maxDuration = 120

import { getModelById } from '@/lib/models'
import * as providers   from '@/lib/providers'
import { debitCredits, InsufficientCreditsError } from '@/lib/credits'
import { resolveVideoId } from '@/lib/youtube'

const LOG = '[xtalk]'

/** A soft length hint, not a behavioural rule. Every later speaker pays to
 *  re-read this turn, so an essay costs the whole room. */
const REPLY_WORDS = 150

export interface XTalkTurn {
  speaker: string        // display name, or 'You'
  isUser:  boolean
  text:    string
}

/**
 * The room's briefing.
 *
 * Deliberately thin (CC, July 31). An earlier version ordered every speaker
 * to either say something new, dispute a specific line, or pass — written to
 * stop the room collapsing into "I agree with Model A, and would add...".
 * It worked, but it was the wrong lever: it made every model argumentative
 * by decree, so the disagreement was the instruction talking, not the model.
 * Give each speaker a persona instead and the differences come from who they
 * are. Whether they agree is then real information.
 */
// The "never attribute a point to someone who has not spoken" line is earned:
// told who else was in the room and to "react to the others", the round's
// FIRST speaker opened with "GPT-5.5 made a solid point about data moats"
// while the transcript held nothing but the question. (Release test, Aug 2)
function roomPrompt(me: string, others: string[], opener: string, persona: string): string {
  const cast = others.length ? `The others in the room are: ${others.join(', ')}.` : 'You are the only model in the room so far.'
  // The room player rides YouTube (owner, Aug 13): full songs for every
  // visitor, no per-user OAuth, no listener subscription — the walls that
  // killed the Spotify version. Without YOUTUBE_API_KEY the card degrades
  // to a link-out, so the door is safe to offer unconditionally.
  // leads nowhere teaches agents to stop trusting doors.
  const player = `\nThe room has a music player. To put a song on, end your message with a line of exactly this form:\nPLAY_SONG: <artist> - <title>\nUse it when the human asks for music, or when one specific track genuinely serves the moment — never more than one per turn, and never as a substitute for saying something. Real songs only; if you are not confident the song exists, do not play one.\n`
  return `You are ${me}, in a room called XTalk with other AI models. ${cast} A human is in the room too, reading along and free to speak whenever they like.${player}

This is a conversation, not a Q&A. It opened with: "${opener}" — but that was only the way in. Follow the conversation to wherever it has actually gone, the way you would in a real one. Do NOT keep re-answering the opening line.
${persona ? `\nWho you are in this room: ${persona}\nStay in that character. It is the reason you were invited.\n` : ''}
Everything said so far is below, each turn labelled with who said it. Read it, then say what you think. React to the others if you have something to say about their points; if you simply agree, say so and move on. Asking someone a direct question is fine. If nobody has spoken yet, simply give your own view — never attribute a point to someone who has not actually spoken.

Keep it under ${REPLY_WORDS} words, plain prose, no headers or bullet lists. Speak in the language the human used. You are not the moderator — no summarising the discussion and no closing remarks unless the human asks.`
}

/** Transcript → the message array this speaker sees. Everyone else's turns
 *  arrive as user messages tagged with a name, because a model shown its
 *  rivals' words as `assistant` treats them as its own and continues them.
 *
 *  The room rules ride in the FIRST user message rather than a system field:
 *  providers.streamText takes only (model, messages) and no provider in
 *  lib/providers reads a system prompt, so passing one would have been a
 *  silent no-op and every speaker would have talked with no rules at all. */
function toMessages(transcript: XTalkTurn[], me: string, system: string) {
  const msgs: { role: 'user' | 'assistant'; content: any }[] = [
    { role: 'user', content: system },
  ]
  for (const t of transcript) {
    if (!t.isUser && t.speaker === me) msgs.push({ role: 'assistant', content: t.text })
    else msgs.push({ role: 'user', content: `${t.isUser ? 'The human' : t.speaker} said: ${t.text}` })
  }
  // A model given only assistant turns has nothing to answer.
  if (msgs[msgs.length - 1].role === 'assistant') {
    msgs.push({ role: 'user', content: 'Your turn.' })
  }
  return msgs
}

/**
 * Bid poll for the Auto speaking order (Werewolf Arena's dynamic
 * turn-taking, arXiv 2407.13943): before each turn every seat states how
 * much it wants the floor on a 0-4 scale; the client gives the turn to the
 * highest bidder, breaking ties toward whoever the last utterance named.
 * The bid is the model's own decision — that's the point of the mechanism —
 * so it costs one tiny completion per seat per turn.
 */
function bidPrompt(me: string, others: string[], persona: string): string {
  const cast = others.length ? `The others in the room are: ${others.join(', ')}.` : ''
  return `You are ${me}, in a live group conversation. ${cast} A human is in the room too.${persona ? `\nYour character in this room: ${persona}.` : ''}

The transcript so far is below. Decide how much you want the NEXT speaking turn. Reply with exactly ONE digit and nothing else:
0: I would like to observe and listen for now.
1: I have some general thoughts to share with the group.
2: I have something critical and specific to contribute to this discussion.
3: It is absolutely urgent for me to speak next.
4: Someone has addressed me directly and I must respond.`
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    modelId, question, transcript = [], speakerNames = [], persona = '',
    // A format with hidden information (werewolf) writes its own briefing:
    // the room prompt assumes everyone sees everything, which is exactly the
    // assumption such a game inverts. The CALLER also filters the transcript
    // it sends, so this route never has to know what a role is.
    gamePrompt = '',
    // Per-seat generation settings. Both are re-validated against the model
    // row below rather than trusted: an old client, or a hand-made request,
    // must not be able to ask for a thinking level the model doesn't declare
    // or a search tool the provider hasn't got wired.
    thinking = null,
    search = false,
    // True → this is a bid poll, not a speaking turn: answer is one digit.
    bid: bidRequest = false,
    // Client discussion id: every turn/bid of one conversation shares this so
    // the credit ledger can collapse them into a single session row.
    convId = null,
  } = await req.json()
  if (!modelId || (!gamePrompt && (typeof question !== 'string' || !question.trim()))) {
    return Response.json({ error: 'Missing modelId or question' }, { status: 400 })
  }

  const model = await getModelById(modelId)
  if (!model) return Response.json({ error: 'Model not found' }, { status: 404 })

  // Clamp both against what this model actually declares.
  const levels   = model.output_config?.text?.thinking_levels ?? []
  const caps     = model.output_config?.text?.capabilities ?? []
  const thinkLvl = typeof thinking === 'string' && levels.includes(thinking) ? thinking : null
  const useSearch = search === true && caps.includes('web_search')

  const me     = model.display_name ?? model.model_name
  const others = (speakerNames as string[]).filter(n => n && n !== me)

  if (bidRequest === true) {
    const msgs = toMessages(transcript as XTalkTurn[], me, bidPrompt(me, others, typeof persona === 'string' ? persona.trim() : ''))
    // Cheapest thinking the model declares — a digit needs no deliberation,
    // and some models' default reasoning costs 30x their answer.
    const bidThink = levels.includes('low') ? 'low' : null
    let full = ''
    const result = await new Promise<{ cost?: number; error?: string }>(resolve => {
      providers.streamText(
        model, msgs,
        {
          onDelta: t => { full += t },
          onDone:  r => resolve({ cost: r.cost ?? 0 }),
          onError: m => resolve({ error: m }),
        },
        [],
        { userId: user.id, surface: 'xtalk' } as any,
        { thinking: bidThink, search: false },
      ).catch(e => resolve({ error: String(e?.message ?? e) }))
    })
    const digit = /[0-4]/.exec(full)
    // An unparseable or failed bid counts as a polite 1, never a dead seat.
    const bidVal = digit ? Number(digit[0]) : 1
    const cents = Math.round((result.cost ?? 0) * 100)
    if (cents > 0) {
      debitCredits({
        userId: user.id, amountCents: cents,
        referenceType: 'xtalk_bid', referenceId: (typeof convId === 'string' && convId) ? convId : (model.id ?? me),
        description: `XTalk bid (${me})`, metadata: { modelName: me },
      }).catch(err => console.warn(`${LOG} bid debit failed:`, err))
    }
    if (result.error) console.warn(`${LOG} bid from ${me} failed:`, result.error)
    return Response.json({ bid: bidVal, cost: result.cost ?? 0 })
  }
  const system = (typeof gamePrompt === 'string' && gamePrompt.trim())
    ? gamePrompt.trim()
    : roomPrompt(me, others, String(question).trim(), typeof persona === 'string' ? persona.trim() : '')
  const msgs   = toMessages(transcript as XTalkTurn[], me, system)

  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      try {
        await providers.streamText(
          model,
          msgs,
          {
            onDelta: (text) => {
              full += text
              controller.enqueue(sse('delta', { text }))
            },
            onDone: async (result) => {
              // The speaker asked for music (PLAY_SONG marker on its last
              // lines): resolve it HERE, server-side, and ship the track in
              // the done event. The client strips the marker and renders the
              // YouTube embed — full song, ads and playback rights stay
              // between YouTube and the listener's browser.
              let song: any = undefined
              const mPlay = /^PLAY_SONG:\s*(.+)$/m.exec(full)
              if (mPlay && mPlay[1].trim()) {
                const query = mPlay[1].trim().slice(0, 120)
                const videoId = await resolveVideoId(query).catch(() => null)
                song = { query, videoId }
                console.log(`${LOG} ${me} played: "${query}" → ${videoId ?? 'link-out'}`)
              }
              const cents = Math.round((result.cost ?? 0) * 100)
              if (cents > 0) {
                debitCredits({
                  userId:        user.id,
                  amountCents:   cents,
                  referenceType: 'xtalk_turn',
                  referenceId:   (typeof convId === 'string' && convId) ? convId : (model.id ?? me),
                  description:   `XTalk turn (${me})`,
                  metadata:      { modelName: me, persona: persona || null },
                })
                  .then(bal => console.log(`${LOG} debited ${cents}¢ for ${me}; balance ${bal}¢`))
                  .catch(err => {
                    if (err instanceof InsufficientCreditsError) console.warn(`${LOG} insufficient credits for ${me}`)
                    else console.warn(`${LOG} debit failed:`, err)
                  })
              }
              controller.enqueue(sse('done', {
                cost: result.cost ?? 0,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                speaker: me,
                ...(song ? { song } : {}),
              }))
              controller.close()
            },
            onError: (message) => {
              console.warn(`${LOG} ${me} failed:`, message)
              controller.enqueue(sse('error', { message, speaker: me }))
              controller.close()
            },
          },
          [],
          { userId: user.id, surface: 'xtalk' } as any,
          { thinking: thinkLvl, search: useSearch },
        )
      } catch (err: any) {
        controller.enqueue(sse('error', { message: err?.message ?? 'turn failed', speaker: me }))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection:      'keep-alive',
    },
  })
}
