'use client'
// app/components/xoracle/MemoryDialog.tsx — 「{name}的記憶」 (Oct 3,
// docs/XORACLE-MEMORY.md): how much of its window a master read for its last
// answer in this conversation, and its newest summary, written by its own model
// once the conversation passed 70% of the window. The summary is read with
// the visitor's own session (owner policy on xtell_memories, migration 126);
// in a visit that is not saved there is none to show.

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useT, useLang } from '../../../lib/i18n'
import type { PickerModel } from '../ModelPickerDialog'
import ProviderLogo from '../ProviderLogo'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../../../lib/markdown'
import ContextMeter from '../ContextMeter'
import { maxInputOf, summaryPointOf, formatTokens } from '../../../lib/conversation-memory'

export default function MemoryDialog({ m, used, readingId, price, canNow, busy, working, note, fresh, onSummarize, onClose }: {
  /** The master, with its catalog limit and prices. */
  m: PickerModel
  /** Tokens the master read for its last answer here. */
  used: number
  readingId: string | null
  /** About what 「立即摘要」 costs, as the page shows prices. */
  price: string | null
  /** The master has answered at least two questions here. */
  canNow: boolean
  /** An answer is coming in: no summary meanwhile. */
  busy: boolean
  /** A press of 「立即摘要」 is running (held by the page, so it outlives the
   *  dialog: closing and reopening keeps 摘要中… and the button off). */
  working: boolean
  /** Why the last press did not save a summary, if it did not. */
  note: string | null
  /** The summary a press just saved in this page, shown before the stored one. */
  fresh: { text: string; at: string } | null
  onSummarize: () => void
  onClose: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const panel = useRef<HTMLDivElement>(null)
  // undefined while loading, null when there are none.
  const [memo, setMemo] = useState<{ text: string; at: string } | null | undefined>(undefined)
  // Focus once on opening: the room re-renders with every streamed word, and
  // a fresh onClose each time must not pull the focus back.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('.xoracle-tp-foot button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!readingId) { setMemo(null); return }
    let live = true
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('xtell_memories').select('text, created_at').eq('reading_id', readingId).eq('model_id', m.id)
      .order('through_seq', { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => { if (live) setMemo(error || !data ? null : { text: String(data.text), at: String(data.created_at) }) })
    return () => { live = false }
  }, [readingId, m.id])
  // The newest summary: one a press just saved here, or the stored one.
  const shown = fresh && (!memo || fresh.at >= memo.at) ? fresh : memo
  // Full = the most XOracle lets this master read: its limit, or its price jump.
  const size = maxInputOf(m), point = summaryPointOf(m)
  const pct = Math.min(100, Math.round(used / size * 100))
  const num = (n: number) => n.toLocaleString(lang === 'zh-Hant' ? 'zh-TW' : lang === 'zh-Hans' ? 'zh-CN' : lang)
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(lang === 'zh-Hant' ? 'zh-TW' : lang === 'zh-Hans' ? 'zh-CN' : lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  return (
    <div className="xoracle-tp-backdrop" onClick={onClose}>
      <div ref={panel} className="xoracle-tp xoracle-mem" role="dialog" aria-modal="true" aria-labelledby="xoracle-mem-title" onClick={e => e.stopPropagation()}>
        <header className="xoracle-tp-head">
          <h2 id="xoracle-mem-title"><span className="xoracle-mem-logo" aria-hidden="true"><ProviderLogo provider={m.provider} size={20} /></span>{t('xoracle.mem.title').replace('{name}', m.display_name)}</h2>
        </header>
        <div className="xoracle-tp-body xoracle-mem-body">
          <div className="xoracle-mem-meter">
            <ContextMeter used={used} max={size} point={point} size={56} stroke={5} ariaLabel={`${pct}%`}>{pct}%</ContextMeter>
            <div>
              <p>{t('xoracle.mem.used')}</p>
              <p className="xoracle-mem-nums" title={`${num(used)} / ${num(size)} tokens`}>{formatTokens(used)} / {formatTokens(size)} tokens</p>
            </div>
          </div>
          <div className="xoracle-mem-head">
            <h3>{t('xoracle.mem.summary')}</h3>
            {readingId && (
              <button type="button" className="xoracle-join-btn is-add" disabled={!canNow || busy || working} onClick={onSummarize}
                title={!canNow ? t('xoracle.mem.needTwo') : undefined}>
                {working ? t('xoracle.mem.working') : t('xoracle.mem.now')}{!working && price && <small>~{price}</small>}
              </button>
            )}
          </div>
          {note && <p className="xoracle-mem-note" role="status">{note}</p>}
          {shown === undefined && <p className="xoracle-tp-empty">{t('common.loading')}</p>}
          {shown === null && <p className="xoracle-tp-empty">{t(working ? 'xoracle.mem.working' : 'xoracle.mem.none')}</p>}
          {shown && <>
            {/* Markdown, as the answers are: models write the five parts with
                ### headings and - lists (owner, Oct 3: the raw text "is wrong"). */}
            <div className="xoracle-mem-text markdown-body"><ReactMarkdown skipHtml remarkPlugins={REMARK_PLUGINS}>{shown.text}</ReactMarkdown></div>
            {when(shown.at) && <p className="xoracle-mem-at">{t('xoracle.mem.at').replace('{time}', when(shown.at))}</p>}
          </>}
        </div>
        <footer className="xoracle-tp-foot"><button type="button" onClick={onClose}>{t('common.close')}</button></footer>
      </div>
    </div>
  )
}
