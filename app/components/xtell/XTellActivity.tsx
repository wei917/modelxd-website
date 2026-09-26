'use client'
// The visitor's saved readings (supabase/105): every chart cast and every
// conversation, newest first. Open continues the same thread; delete is a
// soft delete under the owner policy. Reads the table directly with the
// browser client, like the wallet does — RLS scopes it to the signed-in user.

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang } from '../../../lib/i18n'

type Saved = { id: string; temple: string; title: string | null; cost_cents: number; created_at: string; updated_at: string; turns: Array<{ role: string }> }

export default function XTellActivity({ userId, basePath = '/' }: { userId: string; basePath?: string }) {
  const { lang, t } = useLang()
  const [rows, setRows] = useState<Saved[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
  useEffect(() => {
    let active = true
    setStatus('loading')
    void (async () => {
      try {
        const { data, error } = await client().from('xtell_readings')
          .select('id, temple, title, cost_cents, created_at, updated_at, turns').eq('user_id', userId)
          .is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
        if (error) throw error
        if (active) { setRows((data ?? []) as Saved[]); setStatus('ready') }
      } catch { if (active) setStatus('error') }
    })()
    return () => { active = false }
  }, [userId, attempt])
  const remove = async (id: string) => {
    const { error } = await client().from('xtell_readings').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (!error) setRows(rs => rs.filter(r => r.id !== id))
  }
  return <section id="xtell-activity" className="xtell-activity" aria-labelledby="xtell-activity-title">
    <div className="xtell-section-heading"><h2 id="xtell-activity-title">{t('xtell.site.history')}</h2><span>XTell</span></div>
    <p className="xtell-account-note">{t('xtell.site.historyNote')}</p>
    {status === 'loading' ? <p role="status" className="xtell-history-empty">{t('common.loading')}</p>
      : status === 'error' ? <div className="xtell-history-empty" role="alert"><p>{t('xtell.site.historyError')}</p><button className="xtell-button" onClick={() => setAttempt(n => n + 1)}>{t('xtell.site.retry')}</button></div>
      : rows.length === 0 ? <div className="xtell-history-empty"><p>{t('xtell.site.historyEmpty')}</p><a className="xtell-text-link" href={basePath}>{t('xtell.site.street')} <span aria-hidden="true">↗</span></a></div>
      : <ul className="xtell-history-list">{rows.map(row => {
        const asked = (row.turns ?? []).filter(x => x.role === 'user').length
        return <li key={row.id}>
          <span>
            <strong>{t(`xtell.${row.temple}.name`)}</strong>
            <span style={{ display: 'block', fontSize: 13 }}>{row.title || t(row.temple === 'yixue' ? 'xtell.saved.chartonly.yixue' : 'xtell.saved.chartonly')}</span>
            <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</time>
            {asked > 0 && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted2)' }}>{asked} {t('xtell.saved.turns')}</span>}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {row.cost_cents > 0 && <span className="xtell-history-amount">{new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.cost_cents / 100)}</span>}
            <a className="xtell-button" href={`${basePath}?reading=${row.id}`}>{t('xtell.saved.continue')}</a>
            <button type="button" className="xtell-text-link" onClick={() => void remove(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>{t('xtell.saved.delete')}</button>
          </span>
        </li>
      })}</ul>}
  </section>
}
