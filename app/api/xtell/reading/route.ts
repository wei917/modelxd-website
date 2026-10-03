// app/api/xtell/reading/route.ts — the master reads the chart. SSE stream.
//
// The chart is RECOMPUTED here from the raw birth input — a client-supplied
// chart is never trusted, so the model can only ever see pillars the library
// produced. The user chose the model, so house rules apply: bill list price,
// never substitute (lib/provider-errors ACCOUNT branch surfaces our limits).

export const runtime = 'nodejs'
export const maxDuration = 300

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { getModelById } from '@/lib/models'
import * as providers from '@/lib/providers'
import { debitCredits, accrueFraction, InsufficientCreditsError } from '@/lib/credits'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { baziChart, baziFacts, liuNianFacts, chengGu, chengguFacts, ziweiChart, ziweiFacts, yuelaoFacts, heMatch, liuNian, simianfoFacts, guandiFacts, bingGaoFacts, validBingGao, qianOf, navagrahaChart, navagrahaFacts, zhanxingChart, zhanxingFacts, asAstroMode, validBirth, birthProblem, validQian, validWishes, validPlace, asTemple, isQianTemple, nameChart, nameFacts, validName, charInfo, ceziFacts, validChar, MASTERS, placeLabelOf } from '@/lib/xtell'
import { classicsBlock } from '@/lib/classics'
import { xtellAdmin } from '@/lib/xtell-admin'
import { DAILY_METHODS, DAILY_TEACHER, westernFacts, type DailyMethod } from '@/lib/xtell-daily'
import { liuRiFacts } from '@/lib/xtell'
import { asYixueMode, yixueFacts, yixueInputError } from '@/lib/yijing'
import { dreamEntries, dreamFacts, dreamProblem, ASK_MAX } from '@/lib/jiemeng'
import { situationProblem, sunziLines, sunziFacts, ASK_MAX as SUNZI_ASK_MAX } from '@/lib/sunzi'
import { asQianEdition } from '@/lib/xtell'
import { asSpread, asOptions, validPicks, tarotChart, tarotFacts, ASK_MAX as TAROT_ASK_MAX } from '@/lib/tarot'
import { cookieFacts } from '@/lib/xtell-cookie'
import { chineseLeak, leaksChinese, jaTermStream } from '@/lib/xtell-lang-check'
import { offersPersonality, personalityFacts } from '@/lib/xtell-personality'
import { threadFor } from '@/lib/xtell-thread'
import { fitBudget, approxTokens, rawBudget, tokensRead, windowOf, MESSAGE_CHARS, type Message } from '@/lib/conversation-memory'
import { addMessage, latestMemo, messagesAfter, threadRows, memoBlock, maybeSummarize, summaryRun, summaryCharge, type Memo } from '@/lib/xtell-memory'
import { kyuseiChart, kyuseiFacts, asToday } from '@/lib/kyusei'
import { sukuyoChart, sukuyoFacts, asPartnerDate } from '@/lib/sukuyo'

const LOG = '[xtell/reading]'

// The visitor's site language → the language the master answers in. The
// chart facts stay Chinese (they are the checkable record); the reading
// follows the picker unless the visitor writes in another language.
// Japanese wording (a test round, Sep 29): the facts are Chinese, and the
// answers carried their terms into Japanese (第4宮, 合相, 入相位, 星盤, 月亮,
// 命盤, 命理, 籤詩, 師姐, 守願人, 系統) and Simplified forms (周公解梦, 宝马金鞍).
const JA_TERMS = '用語は日本で使われる言い方にすること：西洋占星術とインド占星術では「ハウス」（「宮」と書かない）、「コンジャンクション（合）」「スクエア」「トライン」「オポジション」「セクスタイル」、近づいている相は「接近中」、離れていく相は「離れつつある」、「ホロスコープ」（「星盤」と書かない）、「月」（「月亮」と書かない）、十二星座は「牡羊座・牡牛座・双子座・蟹座・獅子座・乙女座・天秤座・蠍座・射手座・山羊座・水瓶座・魚座」（「処女座」「巨蟹座」「摩羯座」「双魚座」と書かない）、「チャートルーラー」（「命主星」と書かない）；インド占星術の運期は「ダシャー」「マハーダシャー」「アンタルダシャー」（「大運」「副運」と書かない）、聖典名は『バガヴァッド・ギーター』のように日本語で書く。相性を見ることは「相性」（「合盤」と書かない）、生まれ年の動物は「干支（えと）」（「生肖」と書かない）。宿曜の宿の名は「参宿」「虚宿」のように新字体で書く。四面仏の四つの面は「平安・仕事・結婚・財」、願いがかなった後のお礼は「お礼参り」（「還願」と書かない）、願いをかけることは「願掛け」（「許願」と書かない）。古典の口語訳は「現代語訳」（「白話訳」「白話」と書かない）。四柱推命では「命式」（「命盤」と書かない。紫微斗数の「命盤」はそのままでよい）。方位は「南東・北西・北東・南西」の順で書く。おみくじは「おみくじ」「おみくじの詩」「言葉」と書き、「籤」「籤詩」「籤語」と書かない。「命理」は「占い」、「系統」は「システム」と書く。自分を「師姐」「守願人」と名乗らない（名乗るなら「案内役」）。簡体字（梦、马、车、齿 など）は一字も使わず、書名や分類名も日本の字体で書く（例：周公解夢）。引用する古典の原文だけは原文のままでよい。'
const LANG_LINE: Record<string, string> = {
  'zh-Hant': '回答語言：繁體中文，全文不得夾雜簡體字。',
  'zh-Hans': '回答语言：简体中文。',
  'ja': '回答言語：日本語のみ。文章はすべて自然な日本語で書き、中国語の文（簡体字でも繁体字でも）を一文も混ぜないこと。命理の術語は漢字のままでよいが、初出に短い説明を添える。読み仮名を括弧で付けてよいのは次の語だけ：日主（にっしゅ）、流年（りゅうねん）、大運（だいうん）、命式（めいしき）、十神（じっしん）。ほかの語には読み仮名を付けない（誤った読みを書くより、付けないほうがよい）。籤の詩やカードの原文を引くときは、原文のあとに日本語訳を付ける；資料におみくじの書き下し文と現代語訳が付いているときは、それをそのまま使う；付いていない漢文の書き下し文は確信が持てなければ書かず、現代語訳だけにする。' + JA_TERMS,
  'ko': '답변 언어: 한국어. 명리 용어는 한자를 병기하고 필요하면 짧은 설명을 덧붙일 것 (예: 일주(日主), 유년(流年)).',
  'en': 'Answer in English. Keep the Chinese terms in parentheses the first time each appears (e.g. day master 日主, the year\'s flow 流年) and do not translate proper names of stars or palaces without also giving the Chinese.',
}
// "Answer in the visitor's language if they write in another", said in the
// page's language: a Chinese clause here pulled Japanese answers toward
// Chinese (Sep 29).
const SWITCH_LINE: Record<string, string> = {
  'ja': '相談者が日本語以外の言語で書いた場合だけ、その言語で答える。',
  'ko': '상담자가 다른 언어로 물었을 때만 그 언어로 답한다.',
  'en': 'Only if the visitor writes in another language, answer in theirs.',
}
const langLine = (v: unknown) => (typeof v === 'string' && LANG_LINE[v]) ? `\n\n${LANG_LINE[v]} ${SWITCH_LINE[v] ?? '若信眾以其他語言提問，改用信眾的語言。'}` : ''
// The chart facts and classics are Chinese and come last, right before the
// answer; on a Japanese, Korean or English page the language is restated
// after them (Sep 29: Chinese prose leaked into Japanese answers).
const CLOSING_LINE: Record<string, string> = {
  'ja': '（最終確認：上の資料は中国語ですが、回答はすべて日本語で書くこと。中国語の文を混ぜないこと。）',
  'ko': '(최종 확인: 위 자료는 중국어지만, 답변은 모두 한국어로 쓸 것. 중국어 문장을 섞지 말 것.)',
  'en': '(Final check: the material above is in Chinese; write the whole answer in English.)',
}
const closingLine = (v: unknown) => (typeof v === 'string' && CLOSING_LINE[v]) ? `\n\n${CLOSING_LINE[v]}` : ''

// How long an answer may be (owner, Sep 29: a tester's 塔羅 answer ran to
// ~3,300 characters and said the same advice in several sections). 1000 字
// in Chinese and Japanese; the same amount of reading is about 600 words in
// English and 1,500 자 in Korean.
const LENGTH_LINE: Record<string, string> = {
  'zh-Hant': '篇幅：全文 1000 字以內。先給結論，再說理由；同一個建議只說一次，籤詩或牌義只引用一次，結尾不要把整段解讀再摘要一遍。',
  'zh-Hans': '篇幅：全文 1000 字以内。先给结论，再说理由；同一个建议只说一次，签诗或牌义只引用一次，结尾不要把整段解读再摘要一遍。',
  'ja': '分量：全体で1000字以内。まず結論、次に理由。同じ助言は一度だけ、籤の詩やカードの意味の引用も一度だけにし、最後に全体をもう一度まとめ直さないこと。',
  'ko': '분량: 전체 1,500자 이내. 결론을 먼저, 이유는 그다음에. 같은 조언은 한 번만, 첨시나 카드 뜻의 인용도 한 번만 하고, 끝에서 풀이 전체를 다시 요약하지 말 것.',
  'en': 'Length: about 600 words at most. Give the conclusion first, then the reasons; say each piece of advice once, quote the verse or the card meaning once, and do not end by summarising the whole reading again.',
}
// Every teacher is told the date: without it a model takes the year from
// its training (2024 for 「今年」, a live test, Sep 29).
// The visitor's own day (docs/XTELL-MEMORY.md: the date-bound facts change
// once a day, never per reply, so the master's instructions stay the same
// all day). The zone comes from the page; Taipei when it sends none.
const tzOf = (v: unknown): string => {
  if (typeof v === 'string' && v.length < 64) { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v } catch { /* not a zone */ } }
  return 'Asia/Taipei'
}
const localDate = (tz: string, at: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
/** One moment per day for anything that moves within a day (占星's sky). */
const dayMoment = (tz: string) => new Date(`${localDate(tz)}T12:00:00Z`)
const todayLine = (tz: string) => `今天的日期（西元，來訪者當地）：${localDate(tz)}。說到「今天、今年、明年」以此為準，不要自行假設年份。`
const lengthLine = (v: unknown) => `\n${LENGTH_LINE[typeof v === 'string' && LENGTH_LINE[v] ? v : 'zh-Hant']}`

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
  kyusei:    '信眾的九星與方位（系統依九星氣學慣例算定，勿更動）：',
  sukuyo:    '信眾的本命宿與日宿（系統依宿曜經曆法算定，勿更動）：',
  zhanxing:  '來訪者的星盤（系統以回歸黃道排定，勿更動）：',
  yixue:     '易學堂的對話模式與可核對的經文材料（引用須照錄；僅起卦練習才有系統算定的卦）：',
  jiemeng:   '來訪者的夢與《周公解夢》的相關條目（條目由系統從原書挑出，照錄引用）：',
  sunzi:     '來訪者的處境與《孫子兵法》的相關原文（原文由系統從十三篇挑出，照錄引用）：',
  guanyin:   '信眾求得的觀音籤（系統從籤筒抽出；籤譜與籤文照錄，勿更動）：',
  cookie:    '來訪者的一餐與幸運餅乾的籤語（餐別、時辰、干支由系統計算，籤語照錄，勿更動）：',
  tarot:     '來訪者抽出的塔羅牌（系統依瀏覽器洗牌結果排定；牌義照錄韋特原文，勿更動）：',
}

const PING = new TextEncoder().encode(': ping\n\n')
function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  // A paid follow-up about one of today's free readings (/api/xtell/daily).
  // It has no chart of its own: its facts are that reading's stored basis,
  // loaded below by reference and bound to this user.
  const isDaily = body?.temple === 'daily'
  const temple = asTemple(body?.temple)
  const question = typeof body?.question === 'string' ? body.question.slice(0, 2000) : ''
  // 關帝廟's input is the stick number; everything else starts from a birth.
  // Same codes as the chart route, so a saved visit whose inputs are no
  // longer accepted (a 1990-02-31 saved before the date check) asks the
  // visitor to correct them in their language instead of failing raw.
  const refuse = (code: string, error: string) => Response.json({ error, code }, { status: 400 })
  const badBirth = (b: unknown, who: 'birth' | 'birth2' = 'birth') => {
    const problem = birthProblem(b)
    return problem ? refuse(`${who}_${problem}`, `bad birth input${who === 'birth2' ? ' (second person)' : ''}: ${problem}`) : null
  }
  if (isDaily) {
    if (typeof body?.readingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.readingId)) return refuse('daily_missing', 'daily follow-up needs its visit')
    if (!question.trim()) return refuse('question_required', 'write a question for the teacher')
  } else if (temple === 'cookie') {
    // The slip is read from the saved visit, never from the client.
    if (typeof body?.readingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.readingId)) return refuse('cookie_missing', 'a cookie reading needs its visit')
  } else if (temple === 'tarot') {
    if (!validPicks(asSpread(body?.spread), body?.picks)) return refuse('cards_invalid', 'bad draw')
  } else if (isQianTemple(temple)) {
    const edition = asQianEdition(body?.edition)
    if (!validQian(body?.n, temple, edition) || !qianOf(body.n, temple, edition)) return refuse('stick_invalid', 'bad stick number')
    if (body?.birth !== undefined) { const bad = badBirth(body.birth); if (bad) return bad; validBirth(body.birth) }
  } else if (temple === 'xingming') {
    if (!validName(body?.surname)) return refuse('surname_invalid', 'bad name')
    if (!validName(body?.given)) return refuse('given_invalid', 'bad name')
  } else if (temple === 'cezi') {
    if (!validChar(body?.ch)) return refuse('char_invalid', 'bad character')
    if (!charInfo(body.ch)) return refuse('char_nodata', 'bad character')
  } else if (temple === 'jiemeng') {
    const bad = dreamProblem(body?.dream)
    if (bad) return refuse(bad, 'write the dream')
  } else if (temple === 'sunzi') {
    const bad = situationProblem(body?.situation)
    if (bad) return refuse(bad, 'describe the situation')
  } else if (temple === 'yixue') {
    const bad = yixueInputError(body)
    if (bad) return Response.json({ error: bad }, { status: 400 })
    if (asYixueMode(body?.mode) === 'ask' && !question.trim()) return Response.json({ error: 'write a question for the teacher' }, { status: 400 })
  } else {
    const bad = badBirth(body?.birth)
    if (bad) return bad
    // 紫微 and 九曜 have no unknown-hour reading (see the chart route).
    if ((temple === 'ziwei' || temple === 'navagraha') && body.birth.hourUnknown === true) return refuse('birth_hour_required', 'this temple needs the birth hour')
    validBirth(body.birth)   // normalises an unknown hour
    if (temple === 'yuelao') { const bad2 = badBirth(body?.birth2, 'birth2'); if (bad2) return bad2; validBirth(body.birth2) }
    if (temple === 'simianfo' && !validWishes(body?.wishes)) return refuse('wish_required', 'write at least one wish')
    if (temple === 'navagraha' && !validPlace(body?.place)) return refuse('place_invalid', 'bad place')
    if (temple === 'zhanxing') {
      if (!validPlace(body?.place)) return refuse('place_invalid', 'bad place')
      if (asAstroMode(body?.mode) === 'synastry') {
        const bad2 = badBirth(body?.birth2, 'birth2')
        if (bad2) return bad2
        validBirth(body.birth2)
        if (!validPlace(body?.place2)) return refuse('place2_invalid', 'bad place (second person)')
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
  // default: every Qwen row thinking off. Max's own default sat 130 s before
  // the first token on a 紫微 prompt; Flash's thinking made a 塔羅 answer
  // 9,728 tokens and 145 s (owner, Sep 29: off, like the others).
  const levels: string[] = (model as any).output_config?.text?.thinking_levels ?? []
  const houseDefault = (model as any).provider !== 'alibaba' ? null : 'thinking_false'
  const thinking: string | null = body?.thinking === undefined
    ? houseDefault
    : (typeof body.thinking === 'string' && levels.includes(body.thinking) ? body.thinking : null)

  // What this master rereads (owner, Oct 2: "continue and read all"): its
  // whole thread in the saved conversation, built here from the visitor's
  // own row (lib/xtell-thread.ts), the newest part when a very long one does
  // not fit (lib/conversation-memory.ts). It used to be the last 20 messages
  // the page sent, and a master forgot how a long conversation began. Only
  // a conversation that is not saved falls back to the page's copy. The
  // chart is not part of this: it rides with the master's instructions.
  // Bounded before the facts, so an 易學堂 follow-up still finds the last
  // hexagram the visitor named.
  // Once this master has a memo (migration 126, lib/xtell-memory.ts), it
  // rereads the memo and the messages after it; until then its whole thread
  // from the saved turns. The memory tables are the service role's only,
  // used after the conversation was read with the visitor's own session.
  const savedId = typeof body?.readingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.readingId) ? body.readingId : null
  const modelKey = String((model as any).id)
  const qidIn = typeof body?.qid === 'string' && /^[0-9a-f-]{36}$/i.test(body.qid) ? body.qid : null
  const tz = tzOf(body?.tz)
  let admin: any = null
  try { admin = xtellAdmin() } catch { admin = null }
  let thread: Message[] | null = null
  let memo: Memo | null = null
  let savedTurns: any[] = []
  if (savedId) {
    const { data: saved } = await sb.from('xtell_readings').select('turns').eq('id', savedId).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
    if (saved) {
      savedTurns = Array.isArray((saved as any).turns) ? (saved as any).turns : []
      memo = admin ? await latestMemo(admin, savedId, modelKey) : null
      if (memo) {
        const rows = await messagesAfter(admin, savedId, memo.through_seq)
        if (rows) thread = threadRows(rows, modelKey, qidIn).map(({ role, content }) => ({ role, content }))
        else memo = null
      }
      if (!thread) thread = threadFor(savedTurns, modelKey, qidIn)
    }
  }
  const pageCopy: Message[] = Array.isArray(body?.history)
    ? body.history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MESSAGE_CHARS) }))
    : []
  // Untrimmed here (易學堂 looks back for the last hexagram named); trimmed
  // to the master's window where the request is assembled.
  const history: Message[] = thread ?? pageCopy
  // The conversation's opening question: what the reference texts are
  // picked for, once per conversation (c4).
  const firstUser = (savedTurns.find((t: any) => t?.role === 'user' && typeof t.content === 'string')?.content
    ?? pageCopy.find(m => m.role === 'user')?.content ?? question) as string
  // The day of the last answer, to tell the master when the date-bound facts moved on.
  const lastTs = [...savedTurns].reverse().find((t: any) => t?.role === 'assistant' && typeof t.ts === 'string')?.ts
  const prevDay = lastTs && !Number.isNaN(Date.parse(lastTs)) ? localDate(tz, new Date(lastTs)) : null

  // The day's reading the follow-up is about: the visit row (the visitor's
  // own, under their session) names it, and it is read with the service role
  // bound to this user, status ready. What the teacher sees is what was
  // computed and shown that day, never a basis sent by the client.
  let daily: { method: DailyMethod; facts: string } | null = null
  if (isDaily) {
    const { data: visit } = await sb.from('xtell_readings').select('subject').eq('id', body.readingId).eq('user_id', user.id).eq('temple', 'daily').maybeSingle()
    const dailyId = visit?.subject?.dailyId
    const { data: row } = typeof dailyId === 'string'
      ? await xtellAdmin().from('xtell_daily').select('method, basis, reading').eq('id', dailyId).eq('user_id', user.id).eq('status', 'ready').maybeSingle()
      : { data: null }
    if (!row || !(DAILY_METHODS as readonly string[]).includes(row.method) || !row.basis) return Response.json({ error: 'that day\'s reading is no longer kept', code: 'daily_expired' }, { status: 410 })
    const method = row.method as DailyMethod
    const basis = method === 'western' ? westernFacts(row.basis.western) : liuRiFacts(row.basis.bazi.natal, row.basis.bazi.day)
    const r = row.reading ?? {}
    const shown = [r.summary && `摘要：${r.summary}`, Array.isArray(r.themes) && r.themes.length && `留意：${r.themes.join('；')}`, r.reflect && `可思考：${r.reflect}`, r.why && `依據說明：${r.why}`].filter(Boolean).join('\n')
    daily = { method, facts: `${basis}\n\n當天的免費解讀（信眾已看過）：\n${shown}` }
  }

  // 解夢's lines are the ones the chart route's scan chose, read back from
  // the visitor's own saved visit. Without a saved visit (a failed save),
  // the line numbers the page shows are taken, and like a 籤 number only
  // the number travels: each is checked against the book and the line
  // itself comes from disk, so nothing but the book's own text is quoted.
  let dreamLines: unknown = temple === 'jiemeng' ? body?.entries : null
  if (temple === 'jiemeng' && typeof body?.readingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.readingId)) {
    const { data: visit } = await sb.from('xtell_readings').select('chart').eq('id', body.readingId).eq('user_id', user.id).eq('temple', 'jiemeng').maybeSingle()
    if (Array.isArray(visit?.chart?.entries)) dreamLines = visit.chart.entries.map((e: any) => e?.id)
  }

  // 孫子兵法's lines, the same way: from the visitor's own saved visit, else
  // the numbers the page shows, each checked against the book and read from
  // disk.
  let sunziPicked: unknown = temple === 'sunzi' ? body?.lines : null
  if (temple === 'sunzi' && typeof body?.readingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.readingId)) {
    const { data: visit } = await sb.from('xtell_readings').select('chart').eq('id', body.readingId).eq('user_id', user.id).eq('temple', 'sunzi').maybeSingle()
    if (Array.isArray(visit?.chart?.lines)) sunziPicked = visit.chart.lines
  }

  // 幸運餅乾: the slip, the meal and its 時辰 as saved when the cookie was
  // cracked, from the visitor's own visit.
  let cookieChart: any = null
  if (temple === 'cookie') {
    const { data: visit } = await sb.from('xtell_readings').select('chart').eq('id', body.readingId).eq('user_id', user.id).eq('temple', 'cookie').maybeSingle()
    cookieChart = visit?.chart ?? null
    if (!cookieChart?.fortune) return refuse('cookie_missing', 'that cookie is not saved')
  }

  // Recomputed here, never taken from the client — same rule as every other
  // temple: the model may only see a chart this server produced.
  const chartFacts = daily ? daily.facts : temple === 'cookie'
    ? `${cookieFacts({ food: String(cookieChart.food ?? ''), ask: String(cookieChart.ask ?? ''), meal: cookieChart.meal, dayGz: cookieChart.dayGz ?? null })}\n主味：${cookieChart.flavor}（五行屬${cookieChart.element}）\n幸運餅乾的籤語（照錄）：「${cookieChart.fortune}」${cookieChart.note ? `\n當時的小解說：${cookieChart.note}` : ''}`
    : temple === 'jiemeng'
    ? dreamFacts(String(body.dream).trim(), typeof body?.ask === 'string' ? body.ask.slice(0, ASK_MAX) : '', dreamEntries(dreamLines))
    : temple === 'sunzi'
    ? sunziFacts(String(body.situation).trim(), typeof body?.ask === 'string' ? body.ask.trim().slice(0, SUNZI_ASK_MAX) : '', sunziLines(sunziPicked))
    : temple === 'yixue'
    // The cast is recomputed from the six line values; the text comes from
    // disk. A learner's question names the hexagrams it wants shown.
    ? yixueFacts(body, question, history)
    : temple === 'zhanxing'
    ? zhanxingFacts(
        zhanxingChart(body.birth, body.place, asAstroMode(body?.mode),
          { b2: body.birth2, place2: body.place2, year: Number(body.year) || undefined, at: dayMoment(tz) }),
        body.birth.gender, body.birth2?.gender ?? 'female', dayMoment(tz))
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
      : temple === 'kyusei'
        // The same date the visit was cast on, so the teacher reads the boards shown.
        ? kyuseiFacts(kyuseiChart(body.birth, asToday(body?.today)))
      : temple === 'sukuyo'
        ? sukuyoFacts(sukuyoChart(body.birth, asToday(body?.today), asPartnerDate(body?.partner)))
      : temple === 'xingming'
        ? nameFacts(nameChart(body.surname, body.given), typeof body?.gender === 'string' ? body.gender : '')
      : temple === 'cezi'
        ? ceziFacts(charInfo(body.ch)!, typeof body?.ask === 'string' ? body.ask.slice(0, 300) : '')
      : temple === 'tarot'
        // The cards are laid again from their ids; the client's copy is never used.
        ? tarotFacts(tarotChart(asSpread(body.spread), body.picks, typeof body?.ask === 'string' ? body.ask.slice(0, TAROT_ASK_MAX) : '', asOptions(body)))
      : isQianTemple(temple)
        // The poem comes from disk by number; the client's copy is never used.
        ? (() => {
          const edition = asQianEdition(body?.edition)
          const base = guandiFacts(qianOf(body.n, temple, edition)!, typeof body?.ask === 'string' ? body.ask.slice(0, 300) : '', temple, edition, typeof body?.lang === 'string' ? body.lang : undefined)
          const bz = validBirth(body?.birth) ? baziChart(body.birth) : null
          const extra = bingGaoFacts(validBingGao(body), bz, body?.birth?.gender ?? '', body?.birth?.hourUnknown === true, bz ? liuNian(bz, body.birth.y, new Date().getFullYear()) : null)
          return extra ? `${base}\n\n${extra}` : base
        })()
        : temple === 'simianfo'
          ? (() => {
            const c = baziChart(body.birth)
            return simianfoFacts(c, body.birth.gender, body.birth?.hourUnknown === true, body.wishes, liuNian(c, body.birth.y, new Date().getFullYear()))
          })()
          // 八字廟: the pillars, this year's and next year's 流年 (a live test,
          // Sep 29: asked about 「今年の流年」 with no year in the facts, the
          // teacher answered for 2024 甲辰), then the 稱骨 weights.
          : (() => {
            const c = baziChart(body.birth)
            const y = new Date().getFullYear()
            return `${baziFacts(c, body.birth.gender, body.birth?.hourUnknown === true)}\n\n${liuNianFacts(liuNian(c, body.birth.y, y))}\n${liuNianFacts(liuNian(c, body.birth.y, y + 1), '明年流年')}\n\n${chengguFacts(chengGu(body.birth))}`
          })()

  // The visitor's own personality type (Sep 30), only in the rooms that offer
  // it and only when they ticked the box (the client then sends it with the
  // visit). It is their own description of themselves, said so to the teacher.
  const typeFacts = !daily && offersPersonality(temple) ? personalityFacts(body?.mbti, temple === 'yuelao' ? body?.mbti2 : undefined) : ''
  const facts = typeFacts ? `${chartFacts}\n\n${typeFacts}` : chartFacts

  // Reference passages (c4): picked for the conversation's opening question,
  // so they stay the same for the whole conversation. 易學堂's 問大師 keeps
  // looking for what each message names, as before.
  const classicsQuery = daily ? '' : temple === 'yixue' && asYixueMode(body?.mode) === 'ask'
    ? [...history.filter(turn => turn.role === 'user').slice(-3).map(turn => turn.content), question].join(' ').slice(-2000)
    : `${firstUser} ${facts}`.slice(0, 2000)

  // b: the visitor's own saved birth details (owner, Oct 3: account basics on
  // every reply), for reference; this conversation's chart may be someone
  // else's. Never recited back (the owner's rule on showing personal data).
  let basics = ''
  if (!daily && admin) {
    try {
      const { data: prof } = await admin.from('xtell_profiles').select('birth, birth_place').eq('user_id', user.id).maybeSingle()
      const b = (prof as any)?.birth
      if (b && typeof b.y === 'number') {
        const two = (n: unknown) => String(n ?? 0).padStart(2, '0')
        const when = `${b.y}-${two(b.m)}-${two(b.d)}${b.hourUnknown ? '（時辰不詳）' : ` ${two(b.h)}:${two(b.mi)}`}`
        basics = `\n\n來訪者本人存在帳戶的出生資料（僅供參考；本次的盤以下方資料為準，可能是別人的；不要在回答中複述生日或出生時間）：${when}，${placeLabelOf((prof as any).birth_place) ?? '出生地未填'}`
      }
    } catch { /* no profile, or before 109: nothing */ }
  }
  // c3: when this conversation was last answered on an earlier day, the
  // date-bound facts below are today's; say so once.
  const today = localDate(tz)
  const dayNote = prevDay && prevDay < today ? `\n（上次對話是 ${prevDay}，今天是 ${today}：日期相關的資料已更新，與先前的說法不同時，以今天的為準。）` : ''
  // The master's instructions, in the order of docs/XTELL-MEMORY.md:
  // a (prompt), b (basics), c (today, the facts, the passages), d (memo).
  const systemText = daily
    ? `${DAILY_TEACHER[daily.method]}${langLine(body?.lang)}${lengthLine(body?.lang)}\n\n${todayLine(tz)}${dayNote}\n\n今日運勢的依據與當天的免費解讀（系統算定，勿更動）：\n${facts}${memo ? memoBlock(memo) : ''}${closingLine(body?.lang)}`
    : `${MASTERS[temple]}${langLine(body?.lang)}${lengthLine(body?.lang)}${basics}\n\n${todayLine(tz)}${dayNote}\n\n${FACTS_HEAD[temple]}\n${facts}${classicsBlock(temple, classicsQuery)}${memo ? memoBlock(memo) : ''}${closingLine(body?.lang)}`
  // The chart rides in the SYSTEM slot with the master persona: every turn of
  // the conversation carries it natively, and the client can never overwrite
  // it. The conversation (e) is trimmed to what fits the master's window
  // beside it; a master summarizes long before that (lib/xtell-memory.ts).
  const fitted = fitBudget(history, rawBudget(model, approxTokens(systemText)))
  if (fitted.dropped > 0) console.warn(`${LOG} ${fitted.dropped} oldest messages left out for ${(model as any).model_name} (window ${windowOf(model)})`)
  const messages = [...fitted.kept, { role: 'user' as const, content: question || '請為信眾做一次完整的解讀。' }]

  // Saved reading (supabase/105): the client passes the row id it got from
  // the chart route and a per-question id; both turns are appended through
  // xtell_append_turns under the user's own session, so two masters answering
  // at once cannot lose a write and the question is stored once.
  const readingId = typeof body?.readingId === 'string' && /^[0-9a-f-]{36}$/i.test(body.readingId) ? body.readingId : null
  const qid = typeof body?.qid === 'string' ? body.qid.slice(0, 40) : null
  // Whom the question was for, and who was seated when it was asked (owner,
  // Sep 27: ask one teacher, or some): kept on the stored question so a
  // reopened visit rebuilds each teacher's own thread and labels a question
  // that went to only some. Model ids only; anything else is dropped.
  const ids = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 8) : []
  const to = ids(body?.to), seats = ids(body?.seats)
  let full = ''

  // xtell_messages (migration 126): the visitor's message is stored as the
  // question arrives, so it sorts before every answer; masters answering it
  // together store it once. Nothing happens before 126 runs.
  const memoryOn = !!(admin && readingId && qidIn)
  if (memoryOn) {
    await addMessage(admin, { reading_id: readingId!, role: 'user', content: question || '請為信眾做一次完整的解讀。', qid: qidIn, to, seats })
  }

  // The visitor may leave mid-answer (owner, Oct 1: switched apps on the
  // phone and the page said "Load failed"). The answer is still finished,
  // saved and billed: writes to a stream the browser dropped are ignored,
  // and after() keeps the function alive until the save is done, so the
  // page fetches the answer from the visit when it comes back.
  let open = true
  const stream = new ReadableStream({
    start(controller) {
      const emit = (chunk: Uint8Array) => { if (!open) return; try { controller.enqueue(chunk) } catch { open = false } }
      // A comment line every 15 s, so a connection kept quiet while a
      // teacher thinks before its first word is not dropped as idle.
      const beat = setInterval(() => emit(PING), 15_000)
      // Kept alive until the stream ends, not until streamText returns: the
      // providers do not await onDone, where the save and the debit run.
      let settle = () => {}
      const settled = new Promise<void>(r => { settle = r })
      // `end(false)` closes the stream but keeps the work alive (a summary
      // after the answer); `settle()` then lets the function finish.
      const end = (settleNow = true) => { clearInterval(beat); if (settleNow) settle(); if (!open) return; open = false; try { controller.close() } catch { /* already gone */ } }
      after((async () => {
        // A Japanese answer has its listed Chinese terms replaced as it streams
        // (lib/xtell-lang-check.ts): what is shown, saved and shared is the
        // same text. Not when the visitor wrote in another language, where the
        // teacher answers in theirs.
        const fix = body?.lang === 'ja' && (!question || /[ぁ-ゖァ-ヺ]/.test(question))
          ? jaTermStream(daily ? (daily.method === 'western' ? 'zhanxing' : 'daily') : temple) : null
        const show = (text: string) => { if (text) { full += text; emit(sse('delta', { text })) } }
        await providers.streamText(
          model as any,
          messages,
          {
            onDelta: (text) => show(fix ? fix.push(text) : text),
            // The save and the debit are AWAITED before the stream closes:
            // Vercel freezes the function the moment the response ends, and a
            // fire-and-forget write started here can be cut off. The first
            // live test lost exactly one appended turn that way (Sep 24).
            onDone: async (r) => {
              if (fix) show(fix.end())
              // Whole cents due now: this answer's cost joins what earlier
              // answers left under a cent (supabase/114). Until that migration
              // runs, the old rounding, which bills nothing below half a cent.
              const carried = await accrueFraction(user.id, (r.cost ?? 0) * 1e6)
              const cents = carried ?? Math.round((r.cost ?? 0) * 100)
              // Measured, not yet acted on (Sep 29): how often a Japanese
              // answer carries Chinese prose, per model. Characters only,
              // never the answer.
              if (body?.lang === 'ja' && leaksChinese(full)) {
                const leak = chineseLeak(full)
                console.warn(`${LOG} Chinese in a Japanese answer: ${(model as any).model_name}, ${leak.count} chars (${leak.sample})`)
              }
              if (readingId && qid) {
                const ts = new Date().toISOString()
                const { error } = await sb.rpc('xtell_append_turns', {
                  p_id: readingId,
                  p_user_turn: { role: 'user', content: question || '請為信眾做一次完整的解讀。', qid, ts, ...(to.length ? { to } : {}), ...(seats.length ? { seats } : {}) },
                  p_assistant_turn: { role: 'assistant', content: full, modelId: (model as any).id, name: (model as any).display_name ?? (model as any).model_name, provider: (model as any).provider, cost: r.cost ?? 0, qid, ts },
                  p_add_cents: cents,
                })
                if (error) console.warn(`${LOG} save turns failed:`, error.message)
              }
              if (cents > 0) {
                await debitCredits({
                  userId: user.id, amountCents: cents,
                  // The visit is the session: its answers are one row in the
                  // credit history. (It was the model's id until Sep 30, which
                  // put a charge from today in one group with charges from
                  // other rooms and other weeks.)
                  referenceType: 'xtell', referenceId: readingId ?? (model as any).id ?? (model as any).model_name,
                  description: `XTell ${daily ? 'daily' : temple} reading (${(model as any).model_name})`,
                  metadata: { temple: daily ? 'daily' : temple, modelName: (model as any).model_name, search, thinking },
                }).catch(err => {
                  if (err instanceof InsufficientCreditsError) console.warn(`${LOG} insufficient credits (${cents}¢)`)
                  else console.warn(`${LOG} debit failed:`, err)
                })
              }
              const read = tokensRead((model as any).provider, r)
              if (memoryOn) {
                await addMessage(admin, {
                  reading_id: readingId!, role: 'assistant', content: full, qid: qidIn,
                  model_id: (model as any).id, model_name: (model as any).display_name ?? (model as any).model_name ?? null,
                  provider: (model as any).provider ?? null, input_tokens: read, cost: r.cost ?? null,
                })
              }
              // inputTokens: what this master actually read, for the 記憶 bar.
              emit(sse('done', { cost: r.cost ?? 0, searches: r.searchCount ?? 0, inputTokens: read }))
              end(false)
              // After the answer is delivered, never before: a master whose
              // answer read more than 70% of its window folds the older part
              // of its thread into a summary, with its own model, billed to
              // the visitor like an answer (docs/XTELL-MEMORY.md).
              if (memoryOn) {
                const done = await maybeSummarize({
                  admin, readingId: readingId!, model, inputTokens: read, lang: typeof body?.lang === 'string' ? body.lang : 'zh-Hant', userId: user.id,
                  run: summaryRun((...a: any[]) => (providers.streamText as any)(...a), model, user.id, thinking),
                  charge: summaryCharge({ accrueFraction, debitCredits }, {
                    userId: user.id, readingId: readingId!, model, temple: daily ? 'daily' : temple,
                    warn: m => console.warn(`${LOG} ${m}`),
                  }),
                })
                if (done.saved || done.reason.startsWith('failed') || done.reason.startsWith('save failed')) console.warn(`${LOG} memory for ${(model as any).model_name}: ${done.reason}`)
              }
              settle()
            },
            onError: (msg) => {
              if (fix) show(fix.end())
              emit(sse('error', { message: sanitizeProviderError(msg) }))
              end()
            },
          },
          [],
          { userId: user.id },
          {
            system: systemText,
            search,
            thinking,
          },
        )
      })().catch(e => { emit(sse('error', { message: sanitizeProviderError(String(e?.message ?? e)) })); end() }).then(() => settled))
    },
    cancel() { open = false },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
