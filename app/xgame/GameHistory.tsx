'use client'
// app/xgame/GameHistory.tsx — your games of THIS game, in a card under its
// setup (Oct 21; owner: "you should put the history in the tab page not on
// the left nav bar", "check how XOracle works"). XOracle's TempleHistory
// (app/xoracle/client.tsx): one line per table, the newest five, with where
// it stands for you (輪到你, 等待入座, the result), 繼續, and 改標題 / 刪除 on
// your own tables. A table a friend invited you to is listed too; it is the
// host's to rename or delete. The list comes from /api/xgame/mine
// (lib/xgame-history.ts); renaming and deleting your own row use the browser
// client, as the menu did (migration 147 leaves the browser exactly those).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { useLang } from '../../lib/i18n'
import { GAME_NAME_KEY, type GameKey } from '../../lib/xgame-games'
import { TitleEditor } from '../components/xoracle/TitleEditor'
import type { HistoryRow, TableState } from '../../lib/xgame-history'

const STATE_COLOR: Partial<Record<TableState, string>> = { yourturn: 'var(--red)', won: 'var(--green)' }

export default function GameHistory({ game }: { game: GameKey }) {
  const { lang, t } = useLang()
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loaded, setLoaded] = useState(false)
  // Deleting is permanent, so it asks once, in the row itself (as XOracle).
  const [confirming, setConfirming] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

  useEffect(() => {
    let active = true
    setLoaded(false)
    fetch(`/api/xgame/mine?game=${game}`).then(r => r.ok ? r.json() : { tables: [] }).catch(() => ({ tables: [] }))
      .then(d => { if (active) { setRows(d.tables ?? []); setLoaded(true) } })
    return () => { active = false }
  }, [game])

  const remove = async (id: string) => {
    setConfirming(null)
    const { error, count } = await client().from('xtalk_sessions').delete({ count: 'exact' }).eq('id', id)
    if (!error && count) { setFailed(null); setRows(rs => rs.filter(r => r.id !== id)) }
    else setFailed(id)
  }
  const rename = async (id: string, text: string) => {
    const title = text.trim().slice(0, 80) || null
    const { error } = await client().from('xtalk_sessions').update({ title }).eq('id', id)
    if (error) return false
    setRows(rs => rs.map(r => (r.id === id ? { ...r, title } : r)))
    setRenaming(null)
    return true
  }

  if (!loaded || rows.length === 0) return null
  const when = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(lang, { ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  const link = { flexShrink: 0, border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' } as const

  return (
    <section aria-labelledby="xgame-history-title" className="xgame-history">
      <h2 id="xgame-history-title">{t('xg.history.title')}</h2>
      <ul>
        {rows.map((r, i) => {
          const title = r.title || t(GAME_NAME_KEY[game])
          if (renaming === r.id) return (
            <li key={r.id} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <TitleEditor value={r.title ?? ''} onSave={text => rename(r.id, text)} onCancel={() => setRenaming(null)} />
            </li>
          )
          return (
            <li key={r.id} style={{ borderTop: i ? '1px solid var(--border)' : 'none', flexWrap: confirming === r.id || failed === r.id ? 'wrap' : undefined }}>
              <span className="xgame-history-name" title={title}>{title}</span>
              <span className="xgame-history-state" style={{ color: STATE_COLOR[r.state] ?? 'var(--muted)', fontWeight: r.state === 'yourturn' ? 800 : 600 }}>
                {t(`xg.state.${r.state}`)}
              </span>
              {confirming === r.id ? (
                <span role="group" aria-label={t('xoracle.saved.deleteConfirm')} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--red)' }}>{t('xoracle.saved.deleteConfirm')}</span>
                  <button type="button" onClick={() => void remove(r.id)} style={{ padding: '5px 12px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('xoracle.saved.deleteYes')}</button>
                  <button type="button" onClick={() => setConfirming(null)} style={link}>{t('xoracle.saved.deleteNo')}</button>
                </span>
              ) : (<>
                <span className="xgame-history-when">{when(r.updated_at)}</span>
                <Link href={`/xgame/${r.id}`} className="xgame-history-go">{t('xoracle.saved.continue')}</Link>
                {r.host && <button type="button" onClick={() => { setConfirming(null); setRenaming(r.id) }} style={link}>{t('xoracle.saved.rename')}</button>}
                {r.host && <button type="button" onClick={() => { setFailed(null); setConfirming(r.id) }} style={link}>{t('xoracle.saved.delete')}</button>}
              </>)}
              {failed === r.id && <span role="alert" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--red)' }}>{t('xoracle.saved.deleteFailed')}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
