'use client'
// app/xgame/TableChat.tsx — a table's two chats beside the board (Oct 21;
// lib/xgame-chat.ts, /api/xgame/chat). Owner: "private and public chat room
// in the same game page".
//   公開: both players and the house commentator (GPT-6 Luna, paid by the
//   house), which explains the game after moves and answers @Luna / @AI.
//   我的 AI 助手: the player and the helper they hired, paid by them; only
//   they read it. The opponent sees only that a helper was hired.
// New messages arrive on the table's ping (`pingN` from the table), as moves
// do; a dot marks the tab that has unread ones.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../lib/i18n'
import ModelPickerDialog from '../components/ModelPickerDialog'
import { isEligible, type SpeedGame } from '../../lib/xgame-speed'
import { Face } from './DuoParts'

type Message = { id: number; kind: 'human' | 'ai'; name: string; handle: string | null; avatar: string | null; model: string | null; content: string; costUsd: number; mine: boolean; at: string }
type Talk = 'asked' | 'normal' | 'chatty'
const TALKS: Talk[] = ['asked', 'normal', 'chatty']
type Helper = { modelId: string; name: string; short: string; talk: Talk }
type Tab = 'public' | 'private'
type Chat = {
  public: Message[]; private: Message[]
  house: { name: string; short: string; quiet: boolean }
  helper: Helper | null; opponentHired: string | null
}

const newest = (list: Message[]) => list.reduce((n, m) => Math.max(n, m.id), 0)
/** The newest message someone else wrote (my own never makes a dot). */
const newestOthers = (list: Message[]) => list.reduce((n, m) => (m.kind === 'human' && m.mine ? n : Math.max(n, m.id)), 0)

export default function TableChat({ tableId, game, pingN }: { tableId: string; game: SpeedGame; pingN: number }) {
  const { lang, t } = useLang()
  const [chat, setChat] = useState<Chat | null>(null)
  const [tab, setTab] = useState<Tab>('public')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  // An AI was asked: "… 思考中" in its tab until its answer arrives (told
  // apart by id, not time: this device's clock may be off), 90 s at most.
  const [waiting, setWaiting] = useState<{ tab: Tab; name: string; afterId: number } | null>(null)
  // The newest message seen in each tab, for the unread dot.
  const [seen, setSeen] = useState<Record<Tab, number> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const call = async (body: any) => {
    try {
      const res = await fetch('/api/xgame/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tableId, lang, ...body }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.code ? t(`xg.chat.err.${d.code}`) : (d?.error ?? `HTTP ${res.status}`)); return null }
      setErr(null)
      setChat(d)
      // Nothing is unread on arrival.
      setSeen(s => s ?? { public: newest(d.public ?? []), private: newest(d.private ?? []) })
      return d
    } catch { return null }
  }

  // Load, and reload on every ping of the table.
  useEffect(() => { void call({ action: 'list' }) }, [tableId, pingN]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = chat ? (tab === 'public' ? chat.public : chat.private) : []

  // The open tab is read.
  useEffect(() => {
    if (!chat) return
    const n = newest(list)
    setSeen(s => (s && s[tab] < n ? { ...s, [tab]: n } : s))
  }, [chat, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // The answer we were waiting for arrived.
  useEffect(() => {
    if (!waiting || !chat) return
    const l = waiting.tab === 'public' ? chat.public : chat.private
    if (l.some(m => m.kind === 'ai' && m.id > waiting.afterId && m.name === waiting.name)) setWaiting(null)
  }, [chat, waiting])
  useEffect(() => {
    if (!waiting) return
    const tm = setTimeout(() => setWaiting(null), 90_000)
    return () => clearTimeout(tm)
  }, [waiting])

  // Follow the newest message.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [list.length, waiting, tab])

  if (!chat) return null
  const { house, helper, opponentHired } = chat
  const unread = (k: Tab) => !!seen && k !== tab && newestOthers(k === 'public' ? chat.public : chat.private) > seen[k]

  const send = async () => {
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    const d = await call({ action: 'send', content, private: tab === 'private' })
    setBusy(false)
    if (!d) return
    setText('')
    if (d.asked) setWaiting({ tab, name: d.asked, afterId: newest(tab === 'public' ? d.public : d.private) })
    if (d.unpaid) setErr(t('xg.chat.unpaid').replace('{name}', d.unpaid))
  }
  const mention = (short: string) => setText(v => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${short} `)
  const when = (iso: string) => new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const canWrite = tab === 'public' || !!helper

  return (
    <section className="xgame-chat" aria-label={t('xg.chat.title')}>
      <div className="xgame-chat-tabs" role="tablist">
        {(['public', 'private'] as Tab[]).map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => { setTab(k); setErr(null) }}>
            {t(`xg.chat.tab.${k}`)}
            {unread(k) && <span className="xgame-chat-dot" aria-label={t('xg.chat.unread')} />}
          </button>
        ))}
      </div>

      {tab === 'public' ? (
        <div className="xgame-chat-ais">
          <span className="xgame-chat-ai">
            <button type="button" className="xgame-chat-ai-name" onClick={() => mention(house.short)} title={t('xg.chat.mention')}>{house.name}</button>
            <span className="xgame-chat-ai-by">{house.quiet ? t('xg.chat.house.quiet') : t('xg.chat.house')}</span>
          </span>
          {opponentHired && <span className="xgame-chat-hired">{t('xg.chat.opp.hired').replace('{name}', opponentHired)}</span>}
        </div>
      ) : helper && (
        <div className="xgame-chat-ais">
          <span className="xgame-chat-ai">
            <span className="xgame-chat-ai-name">{helper.name}</span>
            <select value={helper.talk} aria-label={t('xg.chat.talk')} title={t('xg.chat.talk')} onChange={e => void call({ action: 'talk', talk: e.target.value })}>
              {TALKS.map(k => <option key={k} value={k}>{t(`xg.chat.talk.${k}`)}</option>)}
            </select>
            <button type="button" aria-label={t('xg.chat.dismiss')} title={t('xg.chat.dismiss')} className="xgame-chat-ai-x" onClick={() => void call({ action: 'dismiss' })}>×</button>
          </span>
          <button type="button" className="xgame-chat-invite" onClick={() => setPicking(true)}>{t('xg.chat.swap')}</button>
        </div>
      )}

      <div className="xgame-chat-list" ref={listRef}>
        {tab === 'private' && !helper ? (
          <div className="xgame-chat-hire">
            <p>{t('xg.chat.private.empty')}</p>
            <button type="button" className="xgame-chat-invite" onClick={() => setPicking(true)}>＋ {t('xg.chat.hire')}</button>
          </div>
        ) : list.length === 0 && waiting?.tab !== tab ? (
          <p className="xgame-chat-empty">
            {tab === 'public' ? t('xg.chat.empty').replace('{name}', house.short) : t('xg.chat.private.start').replace('{name}', helper!.short)}
          </p>
        ) : list.map(m => (
          <div key={m.id} className={`xgame-chat-msg${m.kind === 'human' && m.mine ? ' is-mine' : ''}${m.kind === 'ai' ? ' is-ai' : ''}`}>
            {m.kind === 'human' && !m.mine && <Face name={m.name} avatar={m.avatar} size={24} />}
            <div className="xgame-chat-bubble">
              <div className="xgame-chat-meta">
                <span>{m.kind === 'ai' ? m.name : m.mine ? t('ch.you') : m.name}</span>
                {m.kind === 'ai' && <span className="xgame-chat-tag">{t('xg.chat.ai')}</span>}
                <span className="xgame-chat-time">{when(m.at)}</span>
                {m.kind === 'ai' && m.mine && m.costUsd > 0 && <span className="xgame-chat-cost">${m.costUsd.toFixed(4)}</span>}
                {m.kind === 'human' && m.mine && (
                  <button type="button" aria-label={t('xg.chat.delete')} title={t('xg.chat.delete')} className="xgame-chat-del" onClick={() => void call({ action: 'delete', messageId: m.id })}>×</button>
                )}
              </div>
              <div className="xgame-chat-text">{m.content}</div>
            </div>
          </div>
        ))}
        {waiting?.tab === tab && <p className="xgame-chat-wait"><span className="nav-history-spin" aria-hidden /> {t('xg.chat.thinking').replace('{name}', waiting.name)}</p>}
      </div>

      {canWrite && (
        <form className="xgame-chat-compose" onSubmit={e => { e.preventDefault(); void send() }}>
          <input
            value={text} onChange={e => setText(e.target.value)} maxLength={500} aria-label={t('xg.chat.title')}
            placeholder={tab === 'public' ? t('xg.chat.ph').replace('{name}', house.short) : t('xg.chat.ph.private').replace('{name}', helper!.short)}
          />
          <button type="submit" disabled={busy || !text.trim()}>{busy ? '…' : t('xg.chat.send')}</button>
        </form>
      )}
      {err && <div role="alert" className="xgame-chat-err">⚠ {err}</div>}
      {picking && (
        <ModelPickerDialog
          mode="text" recipeMode="text_to_text" slotIds={[]}
          allow={(m: any) => isEligible(game, m) && m.id !== helper?.modelId}
          onClose={() => setPicking(false)}
          onSelect={(m: any) => { setPicking(false); setTab('private'); void call({ action: 'hire', modelId: m.id }) }}
        />
      )}
    </section>
  )
}
