// lib/xtell-memory.ts — XTell masters' memory, the server half (Oct 3,
// docs/XTELL-MEMORY.md; tables in supabase/126_xtell_memory.sql).
//
//   messages  every message of a conversation, one row each (xtell_messages):
//             the visitor's message stored when the question arrives, each
//             master's answer when it finishes, with what it read and cost.
//   summaries each master's own summaries (xtell_memories): when a master's
//             answer read past its summary point (70% of its limit, or just
//             before its price jump), its own model summarizes the older
//             part of its thread (like compacting a chat), keeping the
//             newest messages word for word.
//
// Everything here goes through the service role, after the reading route has
// read the conversation with the visitor's own session (so it is theirs).
// Limits, budgets and the summarize step are shared by every surface:
// lib/conversation-memory.ts. What stays here is XTell's own: its tables, its
// thread rule and the wording its masters read.
// Before migration 126 runs, every call quietly does nothing: masters then
// reread their whole thread from xtell_readings.turns (lib/xtell-thread.ts).

import { threadIndices } from './xtell-thread'
import { maybeSummarize as summarize, MESSAGE_CHARS, type Message, type SummaryRun } from './conversation-memory'

export type Row = { seq: number; role: 'user' | 'assistant'; content: string; model_id: string | null; qid: string | null; to: string[] | null }
export type Memo = { text: string; through_seq: number }

/** Store one message. A question already stored (several masters answering
 *  it at once) or an answer already stored is left as it is: the new seq, or
 *  null when nothing new was stored (and before 126).
 *
 *  Through xtell_add_message (migration 127), whose ON CONFLICT DO NOTHING
 *  skips a copy quietly. The plain insert refused it with a unique-index
 *  error, which Postgres logs as an ERROR: 20 of the 27 in the dashboard on
 *  Oct 3. Until 127 runs, the plain insert is still used. */
export async function addMessage(admin: any, m: {
  reading_id: string; role: 'user' | 'assistant'; content: string; qid?: string | null
  to?: string[] | null; seats?: string[] | null; model_id?: string | null; model_name?: string | null
  provider?: string | null; input_tokens?: number | null; cost?: number | null
}): Promise<number | null> {
  const row = {
    reading_id: m.reading_id, role: m.role, content: m.content, qid: m.qid ?? null,
    to: m.to?.length ? m.to : null, seats: m.seats?.length ? m.seats : null,
    model_id: m.model_id ?? null, model_name: m.model_name ?? null, provider: m.provider ?? null,
    input_tokens: m.input_tokens ?? null, cost: m.cost ?? null,
  }
  const { data, error } = await admin.rpc('xtell_add_message', {
    p_reading_id: row.reading_id, p_role: row.role, p_content: row.content, p_qid: row.qid,
    p_to: row.to, p_seats: row.seats, p_model_id: row.model_id, p_model_name: row.model_name,
    p_provider: row.provider, p_input_tokens: row.input_tokens, p_cost: row.cost,
  })
  if (!error) return data == null ? null : Number(data) || null
  if (error.code !== 'PGRST202') return null    // PGRST202: no such function, i.e. before 127
  const { data: inserted, error: insertError } = await admin.from('xtell_messages').insert(row).select('seq').maybeSingle()
  if (insertError) return null     // 23505: already stored; missing: before 126
  return typeof inserted?.seq === 'number' ? inserted.seq : Number(inserted?.seq) || null
}

/** The master's newest memo in this conversation, or null. */
export async function latestMemo(admin: any, readingId: string, modelId: string): Promise<Memo | null> {
  const { data, error } = await admin.from('xtell_memories').select('text, through_seq')
    .eq('reading_id', readingId).eq('model_id', modelId).order('through_seq', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) return null
  return { text: String(data.text), through_seq: Number(data.through_seq) }
}

/** The conversation's messages after `seq`, in order; null before 126. */
export async function messagesAfter(admin: any, readingId: string, seq: number): Promise<Row[] | null> {
  const { data, error } = await admin.from('xtell_messages').select('seq, role, content, model_id, qid, to')
    .eq('reading_id', readingId).gt('seq', seq).order('seq', { ascending: true })
  if (error) return null          // missing before 126, or a read error: callers fall back
  return (data ?? []).map((r: any) => ({ ...r, seq: Number(r.seq) }))
}

/** A master's thread in message rows (lib/xtell-thread.ts's rule), each
 *  message with its seq. */
export function threadRows(rows: Row[], modelId: string, qid: string | null): Array<Message & { seq: number }> {
  const turns = rows.map(r => ({ role: r.role, content: r.content, modelId: r.model_id, qid: r.qid, to: r.to }))
  return threadIndices(turns, modelId, qid).map(i => ({ role: rows[i].role, content: rows[i].content.slice(0, MESSAGE_CHARS), seq: rows[i].seq }))
}

/** The memo's place in the master's instructions (part d). */
export const memoBlock = (memo: Memo) =>
  `\n\n你先前寫的對話摘要（你自己寫的，涵蓋這段對話較早的部分；之後的對話原文接在後面）：\n${memo.text}`

const MEMO_SYSTEM = (name: string, lang: string) => `你是這段對話中的「${name}」。對話已經很長，你要把下面較早的部分寫成摘要。之後回答時，你只會看到這份摘要與最近的對話，這些原文不會再給你。

摘要要讓你之後仍能接著談、前後一致，不遺漏重要內容。固定分成五段，每段用簡短的條列：
1. 來訪者的處境：說過的具體情況，日期、人名、選項、數字照原樣記下。
2. 問過的問題：每一題都要記，依先後，一行一題。
3. 用到的盤面重點：你引用過的命盤、籤、牌或經文要點。
4. 你的解讀與建議：你說過的結論與建議。
5. 尚未了結的事：答應要再談的、來訪者還在考慮的。

規則：
- 只根據提供的舊摘要與對話整理：不要新增解讀，不要編造，不要評論。
- 舊摘要的內容要保留（可以精簡），新對話併進去。
- 用這段對話的語言書寫（${lang}）。
- 格式：每段以「### 1. 來訪者的處境」這樣的小標題開頭（小標題用上面五段的名稱，譯成這段對話的語言），內容用「- 」條列。
- 只輸出摘要本身，不要開場白或結語。`

const LANG_NAME: Record<string, string> = { 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文', ja: '日本語', ko: '한국어', en: 'English' }

/**
 * After an answer: if it read past the master's summary point
 * (lib/conversation-memory.ts), the master's own model folds the older part
 * of its thread into a new summary. XTell's part: its tables, its thread
 * rule and its wording. Returns what was saved, or why not. Never throws.
 */
export async function maybeSummarize(o: {
  admin: any
  readingId: string
  model: any
  inputTokens: number | null
  /** A press of 「立即摘要」: summarize the whole conversation so far, now. */
  now?: boolean
  lang: string
  userId: string
  run: (system: string, content: string) => Promise<SummaryRun | null>
  charge: (usd: number) => Promise<void>
}): Promise<{ saved: boolean; reason: string; through_seq?: number; text?: string }> {
  const modelId = String(o.model?.id)
  const name = String(o.model?.display_name ?? o.model?.model_name ?? 'master')
  return summarize({
    model: o.model,
    inputTokens: o.inputTokens,
    now: o.now,
    load: async () => {
      const memo = await latestMemo(o.admin, o.readingId, modelId)
      const rows = await messagesAfter(o.admin, o.readingId, memo?.through_seq ?? 0)
      return rows ? { summary: memo, thread: threadRows(rows, modelId, null) } : null
    },
    prompt: ({ oldSummary, fold }) => ({
      system: MEMO_SYSTEM(name, LANG_NAME[o.lang] ?? LANG_NAME['zh-Hant']),
      content: `舊摘要：\n${oldSummary ?? '（無）'}\n\n要寫進摘要的對話（依先後）：\n${fold.map(m => `${m.role === 'user' ? '來訪者' : '你'}：${m.content}`).join('\n\n')}`,
    }),
    run: o.run,
    save: async (out) => {
      const { error } = await o.admin.from('xtell_memories').insert({
        reading_id: o.readingId, model_id: modelId, model_name: o.model?.display_name ?? o.model?.model_name ?? null,
        through_seq: out.through_seq, text: out.text, input_tokens: out.inputTokens, output_tokens: out.outputTokens, cost: out.cost,
      })
      return !error ? 'saved' : error.code === '23505' ? 'duplicate' : String(error.message)
    },
    charge: o.charge,
  })
}

/** The summary call: the master's own model and thinking setting, up to
 *  4,000 tokens, 120 s at most (a summary that never comes back must not hold
 *  the function). `streamText` is lib/providers' own, passed in. */
export function summaryRun(streamText: (...args: any[]) => Promise<unknown>, model: any, userId: string, thinking: string | null) {
  return (system: string, content: string) => new Promise<SummaryRun | null>(resolve => {
    setTimeout(() => resolve(null), 120_000)
    let text = ''
    streamText(model, [{ role: 'user', content }], {
      onDelta: (t: string) => { text += t },
      onDone: (m: any) => resolve({ text, inputTokens: m.inputTokens ?? null, outputTokens: m.outputTokens ?? null, cost: m.cost ?? null }),
      onError: () => resolve(null),
    }, [], { userId }, { system, thinking, maxTokens: 4000 }).catch(() => resolve(null))
  })
}

/** Bills a summary like an answer: whole cents now, what is under a cent
 *  carried to the next charge (supabase/114). lib/credits' own functions are
 *  passed in. */
export function summaryCharge(
  credits: { accrueFraction: (userId: string, micro: number) => Promise<number | null>; debitCredits: (d: any) => Promise<unknown> },
  o: { userId: string; readingId: string; model: any; temple: string; warn?: (msg: string) => void },
) {
  return async (usd: number) => {
    const carried = await credits.accrueFraction(o.userId, usd * 1e6)
    const cents = carried ?? Math.round(usd * 100)
    if (cents > 0) await credits.debitCredits({
      userId: o.userId, amountCents: cents, referenceType: 'xtell', referenceId: o.readingId,
      description: `XTell summary (${o.model?.model_name})`,
      metadata: { temple: o.temple, modelName: o.model?.model_name, memory: true },
    }).catch(err => o.warn?.(`summary debit failed: ${err instanceof Error ? err.message : String(err)}`))
  }
}
