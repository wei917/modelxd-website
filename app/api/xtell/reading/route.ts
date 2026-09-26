// app/api/xtell/reading/route.ts — the master reads the chart. SSE stream.
//
// The chart is RECOMPUTED here from the raw birth input — a client-supplied
// chart is never trusted, so the model can only ever see pillars the library
// produced. The user chose the model, so house rules apply: bill list price,
// never substitute (lib/provider-errors ACCOUNT branch surfaces our limits).

export const runtime = 'nodejs'
export const maxDuration = 300

import { createSupabaseServer } from '@/lib/supabase-server'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits, InsufficientCreditsError } from '@/lib/credits'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { baziChart, baziFacts, ziweiChart, ziweiFacts, yuelaoFacts, heMatch, liuNian, simianfoFacts, guandiFacts, bingGaoFacts, validBingGao, qianOf, navagrahaChart, navagrahaFacts, zhanxingChart, zhanxingFacts, asAstroMode, validBirth, validQian, validWishes, validPlace, asTemple, isQianTemple, nameChart, nameFacts, validName, charInfo, ceziFacts, validChar, MASTERS } from '@/lib/xtell'
import { classicsBlock } from '@/lib/classics'
import { yixueFacts, yixueInputError } from '@/lib/yijing'

const LOG = '[xtell/reading]'

// The visitor's site language → the language the master answers in. The
// chart facts stay Chinese (they are the checkable record); the reading
// follows the picker unless the visitor writes in another language.
const LANG_LINE: Record<string, string> = {
  'zh-Hant': '回答語言：繁體中文，全文不得夾雜簡體字。',
  'zh-Hans': '回答语言：简体中文。',
  'ja': '回答言語：日本語。命理の術語は漢字表記を残し、必要なら短い説明を添えること（例：日主（にっしゅ）、流年（りゅうねん））。',
  'ko': '답변 언어: 한국어. 명리 용어는 한자를 병기하고 필요하면 짧은 설명을 덧붙일 것 (예: 일주(日主), 유년(流年)).',
  'en': 'Answer in English. Keep the Chinese terms in parentheses the first time each appears (e.g. day master 日主, the year\'s flow 流年) and do not translate proper names of stars or palaces without also giving the Chinese.',
}
const langLine = (v: unknown) => (typeof v === 'string' && LANG_LINE[v]) ? `\n\n${LANG_LINE[v]} 若信眾以其他語言提問，改用信眾的語言。` : ''

// What the facts block is called, per temple: a 命盤 for the chart temples,
// a 籤 for 關帝廟, wishes plus a chart for 四面佛.
const FACTS_HEAD: Record<string, string> = {
  bazi:     '信眾的命盤（系統排定，勿更動）：',
  ziwei:    '信眾的命盤（系統排定，勿更動）：',
  yuelao:   '信眾的命盤（系統排定，勿更動）：',
  guandi:   '信眾求得的籤（系統從籤筒抽出、擲筊允准；籤文取自清刊本，勿更動）：',
  mazu:     '信眾求得的籤（系統從籤筒抽出、擲筊允准；籤文取自維基文庫六十甲子籤，勿更動）：',
  xingming: '使用者的姓名與五格（系統查康熙筆畫排定，勿更動）：',
  cezi:     '來訪者所書之字（部首與筆畫由系統查表，勿更動）：',
  simianfo: '信眾的願文、命盤與流年（系統排定，勿更動）：',
  navagraha: '信眾的吠陀星盤（系統排定，勿更動）：',
  zhanxing:  '來訪者的星盤（系統以回歸黃道排定，勿更動）：',
  yixue:     '易學堂的情況、系統算定的卦與讀法，以及《周易》原文（照錄，勿更動）：',
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple = asTemple(body?.temple)
  const question = typeof body?.question === 'string' ? body.question.slice(0, 2000) : ''
  // 關帝廟's input is the stick number; everything else starts from a birth.
  if (isQianTemple(temple)) {
    if (!validQian(body?.n, temple) || !qianOf(body.n, temple)) return Response.json({ error: 'bad stick number' }, { status: 400 })
    if (body?.birth !== undefined && !validBirth(body.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
  } else if (temple === 'xingming') {
    if (!validName(body?.surname) || !validName(body?.given)) return Response.json({ error: 'bad name' }, { status: 400 })
  } else if (temple === 'cezi') {
    if (!validChar(body?.ch) || !charInfo(body.ch)) return Response.json({ error: 'bad character' }, { status: 400 })
  } else if (temple === 'yixue') {
    const bad = yixueInputError(body)
    if (bad) return Response.json({ error: bad }, { status: 400 })
  } else {
    if (!validBirth(body?.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
    if (temple === 'yuelao' && !validBirth(body?.birth2)) return Response.json({ error: 'bad birth input (second person)' }, { status: 400 })
    if (temple === 'simianfo' && !validWishes(body?.wishes)) return Response.json({ error: 'write at least one wish' }, { status: 400 })
    if (temple === 'navagraha' && !validPlace(body?.place)) return Response.json({ error: 'bad place' }, { status: 400 })
    if (temple === 'zhanxing') {
      if (!validPlace(body?.place)) return Response.json({ error: 'bad place' }, { status: 400 })
      if (asAstroMode(body?.mode) === 'synastry'
        && (!validBirth(body?.birth2) || !validPlace(body?.place2))) {
        return Response.json({ error: 'bad birth input (second person)' }, { status: 400 })
      }
    }
  }
  if (typeof body?.modelId !== 'string') return Response.json({ error: 'modelId required' }, { status: 400 })

  const model = await getModelById(body.modelId)
  if (!model || (model as any).enabled === false) return Response.json({ error: 'model not available' }, { status: 400 })
  if (((model as any).blocked_features ?? []).includes('xtell')) {
    return Response.json({ error: 'model not offered for XTell' }, { status: 400 })
  }

  // Search is opt-in AND gated on the model declaring the capability — the
  // same double gate every other surface uses.
  const canSearch = ((model as any).output_config?.text?.capabilities ?? []).includes('web_search')
  const search = canSearch && body?.search === true
  // Thinking level per seat (owner, Sep 24: configure each master like an
  // XCreate slot). Accepted only if the row declares it; `null` from the
  // client means an explicit Auto (provider default); absent means the house
  // default: Qwen Flash thinking on (the default master), other Qwen rows
  // thinking off — Max's own default sat 130 s before the first token on a
  // 紫微 prompt.
  const levels: string[] = (model as any).output_config?.text?.thinking_levels ?? []
  const houseDefault = (model as any).provider !== 'alibaba' ? null
    : (model as any).model_name === 'qwen3.8-flash' ? 'thinking_true' : 'thinking_false'
  const thinking: string | null = body?.thinking === undefined
    ? houseDefault
    : (typeof body.thinking === 'string' && levels.includes(body.thinking) ? body.thinking : null)

  // Bound history before deriving facts so an 易學堂 follow-up can retain
  // the last user-named hexagram's canonical text.
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(body?.history)
    ? body.history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-20)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 8000) }))
    : []

  // Recomputed here, never taken from the client — same rule as every other
  // temple: the model may only see a chart this server produced.
  const facts = temple === 'yixue'
    // The cast is recomputed from the six line values; the text comes from
    // disk. A learner's question names the hexagrams it wants shown.
    ? yixueFacts(body, question, history)
    : temple === 'zhanxing'
    ? zhanxingFacts(
        zhanxingChart(body.birth, body.place, asAstroMode(body?.mode),
          { b2: body.birth2, place2: body.place2, year: Number(body.year) || undefined }),
        body.birth.gender, body.birth2?.gender ?? 'female')
    : temple === 'ziwei'
    ? ziweiFacts(ziweiChart(body.birth), body.birth.gender)
    : temple === 'yuelao'
      ? (() => {
        // Recomputed, not taken from the client: the score is a fact about two
        // birth moments, and a number that arrived over the wire is a number
        // someone could have chosen.
        const a = baziChart(body.birth), b = baziChart(body.birth2)
        return yuelaoFacts(a, body.birth.gender, b, body.birth2.gender, heMatch(a, b, new Date().getFullYear()))
      })()
      : temple === 'navagraha'
        ? navagrahaFacts(navagrahaChart(body.birth, body.place), body.birth.gender)
      : temple === 'xingming'
        ? nameFacts(nameChart(body.surname, body.given), typeof body?.gender === 'string' ? body.gender : '')
      : temple === 'cezi'
        ? ceziFacts(charInfo(body.ch)!, typeof body?.ask === 'string' ? body.ask.slice(0, 300) : '')
      : isQianTemple(temple)
        // The poem comes from disk by number; the client's copy is never used.
        ? (() => {
          const base = guandiFacts(qianOf(body.n, temple)!, typeof body?.ask === 'string' ? body.ask.slice(0, 300) : '', temple)
          const bz = validBirth(body?.birth) ? baziChart(body.birth) : null
          const extra = bingGaoFacts(validBingGao(body), bz, body?.birth?.gender ?? '', body?.birth?.hourUnknown === true, bz ? liuNian(bz, body.birth.y, new Date().getFullYear()) : null)
          return extra ? `${base}\n\n${extra}` : base
        })()
        : temple === 'simianfo'
          ? (() => {
            const c = baziChart(body.birth)
            return simianfoFacts(c, body.birth.gender, body.birth?.hourUnknown === true, body.wishes, liuNian(c, body.birth.y, new Date().getFullYear()))
          })()
          : baziFacts(baziChart(body.birth), body.birth.gender, body.birth?.hourUnknown === true)

  // The chart rides in the SYSTEM slot with the master persona: every turn of
  // the conversation carries it natively, and the client can never overwrite
  // it — history is user/assistant turns only, capped so a long consultation
  // cannot smuggle an unbounded prompt.
  const messages = [...history, { role: 'user' as const, content: question || '請為信眾做一次完整的解讀。' }]

  // Saved reading (supabase/105): the client passes the row id it got from
  // the chart route and a per-question id; both turns are appended through
  // xtell_append_turns under the user's own session, so two masters answering
  // at once cannot lose a write and the question is stored once.
  const readingId = typeof body?.readingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.readingId) ? body.readingId : null
  const qid = typeof body?.qid === 'string' ? body.qid.slice(0, 40) : null
  let full = ''

  const stream = new ReadableStream({
    async start(controller) {
      await providers.streamText(
        model as any,
        messages,
        {
          onDelta: (text) => { full += text; controller.enqueue(sse('delta', { text })) },
          // The save and the debit are AWAITED before the stream closes:
          // Vercel freezes the function the moment the response ends, and a
          // fire-and-forget write started here can be cut off. The first
          // live test lost exactly one appended turn that way (Sep 24).
          onDone: async (r) => {
            const cents = Math.round((r.cost ?? 0) * 100)
            if (readingId && qid) {
              const ts = new Date().toISOString()
              const { error } = await sb.rpc('xtell_append_turns', {
                p_id: readingId,
                p_user_turn: { role: 'user', content: question || '請為信眾做一次完整的解讀。', qid, ts },
                p_assistant_turn: { role: 'assistant', content: full, modelId: (model as any).id, name: (model as any).display_name ?? (model as any).model_name, provider: (model as any).provider, cost: r.cost ?? 0, qid, ts },
                p_add_cents: cents,
              })
              if (error) console.warn(`${LOG} save turns failed:`, error.message)
            }
            if (cents > 0) {
              await debitCredits({
                userId: user.id, amountCents: cents,
                referenceType: 'xtell', referenceId: (model as any).id ?? (model as any).model_name,
                description: `XTell ${temple} reading (${(model as any).model_name})`,
                metadata: { temple, modelName: (model as any).model_name, search, thinking },
              }).catch(err => {
                if (err instanceof InsufficientCreditsError) console.warn(`${LOG} insufficient credits (${cents}¢)`)
                else console.warn(`${LOG} debit failed:`, err)
              })
            }
            controller.enqueue(sse('done', { cost: r.cost ?? 0, searches: r.searchCount ?? 0 }))
            controller.close()
          },
          onError: (msg) => {
            controller.enqueue(sse('error', { message: sanitizeProviderError(msg) }))
            controller.close()
          },
        },
        [],
        { userId: user.id },
        {
          system: `${MASTERS[temple]}${langLine(body?.lang)}\n\n${FACTS_HEAD[temple]}\n${facts}${classicsBlock(temple, `${question} ${facts}`.slice(0, 2000))}`,
          search,
          thinking,
        },
      )
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
