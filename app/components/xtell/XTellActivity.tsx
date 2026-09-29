'use client'
// The visitor's saved readings (supabase/105): every chart cast and every
// conversation, newest first. Open continues the same thread; delete is a
// soft delete under the owner policy. Reads the table directly with the
// browser client, like the wallet does — RLS scopes it to the signed-in user.

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang } from '../../../lib/i18n'
import { describeVisit, eraseReading, notAskedKey, renameReading, cleanTitle, firstAsk } from '../../../lib/xtell-history'
import { TitleEditor } from './TitleEditor'

type Saved = { id: string; temple: string; title: string | null; subject: any; cost_cents: number; created_at: string; updated_at: string; turns: Array<{ role: string }> }

export default function XTellActivity({ userId, basePath = '/' }: { userId: string; basePath?: string }) {
  const { lang, t } = useLang()
  const [rows, setRows] = useState<Saved[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  // Deleting is permanent, so it asks once, in the row itself.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // 改標題 (owner, Sep 28): the row being renamed, edited in place.
  const [renaming, setRenaming] = useState<string | null>(null)
  const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
  useEffect(() => {
    let active = true
    setStatus('loading')
    void (async () => {
      try {
        const { data, error } = await client().from('xtell_readings')
          .select('id, temple, title, subject, cost_cents, created_at, updated_at, turns').eq('user_id', userId)
          .is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
        if (error) throw error
        if (active) { setRows((data ?? []) as Saved[]); setStatus('ready') }
      } catch { if (active) setStatus('error') }
    })()
    return () => { active = false }
  }, [userId, attempt])
  const remove = async (id: string) => {
    setConfirming(null)
    if (await eraseReading(client(), id)) { setFailed(null); setRows(rs => rs.filter(r => r.id !== id)) }
    else setFailed(id)
  }
  const rename = async (id: string, text: string) => {
    if (!(await renameReading(client(), id, text))) return false
    setRows(rs => rs.map(r => (r.id === id ? { ...r, title: cleanTitle(text) } : r)))
    setRenaming(null)
    return true
  }
  return <section id="xtell-activity" className="xtell-activity" aria-labelledby="xtell-activity-title">
    <div className="xtell-section-heading"><h2 id="xtell-activity-title">{t('xtell.site.history')}</h2><span>XTell</span></div>
    <p className="xtell-account-note">{t('xtell.site.historyNote')}</p>
    {status === 'loading' ? <p role="status" className="xtell-history-empty">{t('common.loading')}</p>
      : status === 'error' ? <div className="xtell-history-empty" role="alert"><p>{t('xtell.site.historyError')}</p><button className="xtell-button" onClick={() => setAttempt(n => n + 1)}>{t('xtell.site.retry')}</button></div>
      : rows.length === 0 ? <div className="xtell-history-empty"><p>{t('xtell.site.historyEmpty')}</p><a className="xtell-text-link" href={basePath}>{t('xtell.site.street')} <span aria-hidden="true">↗</span></a></div>
      : <ul className="xtell-history-list">{rows.map(row => {
        const asked = (row.turns ?? []).filter(x => x.role === 'user').length
        const named = row.title || firstAsk(row.turns)
        if (renaming === row.id) return <li key={row.id} style={{ display: 'block' }}>
          <strong>{t(`xtell.site.focus.${row.temple}.name`)}</strong>
          <TitleEditor value={row.title ?? ''} onSave={text => rename(row.id, text)} onCancel={() => setRenaming(null)} />
        </li>
        return <li key={row.id}>
          <span>
            {/* Named as the explorer and the room name it (tester, Sep 26:
                the list said 姓名亭／測字亭, the explorer 姓名學／測字). */}
            <strong>{t(`xtell.site.focus.${row.temple}.name`)}</strong>
            {/* Named by what it was about, not "chart only" for every row
                (audit, product); the first question stays the title. */}
            <span style={{ display: 'block', fontSize: 13 }}>{named || describeVisit(t, row.temple, row.subject) || t(notAskedKey(row.temple))}</span>
            {named && describeVisit(t, row.temple, row.subject) && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted2)' }}>{describeVisit(t, row.temple, row.subject)}</span>}
            {!asked && (named || describeVisit(t, row.temple, row.subject)) && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted2)' }}>{t(notAskedKey(row.temple))}</span>}
            <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</time>
            {asked > 0 && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted2)' }}>{asked} {t('xtell.saved.turns')}</span>}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {row.cost_cents > 0 && <span className="xtell-history-amount">{new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.cost_cents / 100)}</span>}
            {confirming === row.id ? (
              <span role="group" aria-label={t('xtell.saved.deleteConfirm')} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, color: 'var(--xtell-vermilion, var(--red))' }}>{t('xtell.saved.deleteConfirm')}</span>
                <button type="button" className="xtell-button" onClick={() => void remove(row.id)}>{t('xtell.saved.deleteYes')}</button>
                <button type="button" className="xtell-text-link" onClick={() => setConfirming(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>{t('xtell.saved.deleteNo')}</button>
              </span>
            ) : (<>
              <a className="xtell-button" href={`${basePath}?reading=${row.id}`}>{t('xtell.saved.continue')}</a>
              {row.temple !== 'daily' && <button type="button" className="xtell-text-link" onClick={() => { setConfirming(null); setRenaming(row.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>{t('xtell.saved.rename')}</button>}
              <button type="button" className="xtell-text-link" onClick={() => { setFailed(null); setConfirming(row.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>{t('xtell.saved.delete')}</button>
            </>)}
            {failed === row.id && <span role="alert" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--xtell-vermilion, var(--red))', textAlign: 'right' }}>{t('xtell.saved.deleteFailed')}</span>}
          </span>
        </li>
      })}</ul>}
  </section>
}
