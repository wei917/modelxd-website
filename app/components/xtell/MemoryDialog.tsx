'use client'
// app/components/xtell/MemoryDialog.tsx — 「{name}的記憶」 (Oct 3,
// docs/XTELL-MEMORY.md): how much of its window a master read for its last
// answer in this conversation, and its newest summary, written by its own model
// once the conversation passed 70% of the window. The summary is read with
// the visitor's own session (owner policy on xtell_memories, migration 126);
// in a visit that is not saved there is none to show.

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useT, useLang } from '../../../lib/i18n'
import type { PickerModel } from '../ModelPickerDialog'
import ProviderLogo from '../ProviderLogo'
import ContextMeter from '../ContextMeter'
import { windowOf, summaryPointOf, formatTokens } from '../../../lib/conversation-memory'

export default function MemoryDialog({ m, used, readingId, onClose }: {
  /** The master, with its catalog limit and prices. */
  m: PickerModel
  /** Tokens the master read for its last answer here. */
  used: number
  readingId: string | null
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
    panel.current?.querySelector<HTMLButtonElement>('.xtell-tp-foot button')?.focus()
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
  const size = windowOf(m), point = summaryPointOf(m)
  const pct = Math.min(100, Math.round(used / size * 100))
  const num = (n: number) => n.toLocaleString(lang === 'zh-Hant' ? 'zh-TW' : lang === 'zh-Hans' ? 'zh-CN' : lang)
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(lang === 'zh-Hant' ? 'zh-TW' : lang === 'zh-Hans' ? 'zh-CN' : lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  return (
    <div className="xtell-tp-backdrop" onClick={onClose}>
      <div ref={panel} className="xtell-tp xtell-mem" role="dialog" aria-modal="true" aria-labelledby="xtell-mem-title" onClick={e => e.stopPropagation()}>
        <header className="xtell-tp-head">
          <h2 id="xtell-mem-title"><span className="xtell-mem-logo" aria-hidden="true"><ProviderLogo provider={m.provider} size={20} /></span>{t('xtell.mem.title').replace('{name}', m.display_name)}</h2>
          <p>{t('xtell.mem.sub')}</p>
        </header>
        <div className="xtell-tp-body xtell-mem-body">
          <div className="xtell-mem-meter">
            <ContextMeter used={used} max={size} point={point} />
            <p>{t('xtell.mem.used').replace('{used}', num(used)).replace('{size}', num(size)).replace('{pct}', String(pct))}<br />{t('xtell.mem.point').replace('{point}', formatTokens(point))}</p>
          </div>
          <h3>{t('xtell.mem.summary')}</h3>
          {memo === undefined && <p className="xtell-tp-empty">{t('common.loading')}</p>}
          {memo === null && <p className="xtell-tp-empty">{t('xtell.mem.none')}</p>}
          {memo && <>
            <div className="xtell-mem-text">{memo.text}</div>
            {when(memo.at) && <p className="xtell-mem-at">{t('xtell.mem.at').replace('{time}', when(memo.at))}</p>}
          </>}
        </div>
        <footer className="xtell-tp-foot"><button type="button" onClick={onClose}>{t('common.close')}</button></footer>
      </div>
    </div>
  )
}
