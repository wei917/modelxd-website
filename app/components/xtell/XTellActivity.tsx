'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang } from '../../../lib/i18n'

type Activity = { id: string; created_at: string; amount_cents: number; metadata: { temple?: string } | null }

export default function XTellActivity({ userId }: { userId: string }) {
  const { lang, t } = useLang()
  const [rows, setRows] = useState<Activity[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setStatus('loading')
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    void (async () => {
      try {
        const { data, error } = await client.from('credit_transactions')
          .select('id, created_at, amount_cents, metadata').eq('user_id', userId)
          .eq('reference_type', 'xtell').order('created_at', { ascending: false }).limit(100)
        if (error) throw error
        if (active) { setRows((data ?? []) as Activity[]); setStatus('ready') }
      } catch { if (active) setStatus('error') }
    })()
    return () => { active = false }
  }, [userId, attempt])
  return <section id="xtell-activity" className="xtell-activity" aria-labelledby="xtell-activity-title">
    <div className="xtell-section-heading"><h2 id="xtell-activity-title">{t('xtell.site.history')}</h2><span>XTell</span></div>
    <p className="xtell-account-note">{t('xtell.site.historyNote')}</p>
    {status === 'loading' ? <p role="status" className="xtell-history-empty">{t('common.loading')}</p>
      : status === 'error' ? <div className="xtell-history-empty" role="alert"><p>{t('xtell.site.historyError')}</p><button className="xtell-button" onClick={() => setAttempt(n => n + 1)}>{t('xtell.site.retry')}</button></div>
      : rows.length === 0 ? <div className="xtell-history-empty"><p>{t('xtell.site.historyEmpty')}</p><a className="xtell-text-link" href="/">{t('xtell.site.street')} <span aria-hidden="true">↗</span></a></div>
      : <ul className="xtell-history-list">{rows.map(row => <li key={row.id}>
        <span><strong>{row.metadata?.temple ? t(`xtell.${row.metadata.temple}.name`) : 'XTell'}</strong><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</time></span>
        <span className="xtell-history-amount">{new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(row.amount_cents / 100)}</span>
      </li>)}</ul>}
  </section>
}
