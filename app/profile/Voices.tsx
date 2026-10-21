'use client'
// app/profile/Voices.tsx — 我的聲音 on the Profile tab (owner, Oct 20: "store
// it and user can manage it in the users profile"). Your cloned voices from
// X創作's 語音 (app/xcreate/MyVoices.tsx): whether each has spoken yet (an
// unused one is deleted by MiniMax after 7 days), rename, delete, and a link
// into X創作 to record or use one. The recording itself is never kept, so
// there is nothing to play here.

import { useEffect, useState } from 'react'
import { useLang } from '../../lib/i18n'

type Voice = { id: string; name: string; lang: string | null; used: boolean; createdAt: string; lapsesAt: string | null }

export default function VoicesSection() {
  const { t, lang } = useLang()
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [ready, setReady] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [askDelete, setAskDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const r = await fetch('/api/xcreate/voices', { cache: 'no-store' }).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    setReady(!!j && j.ready !== false)
    setVoices(j?.voices ?? [])
  }
  useEffect(() => { load() }, [])

  if (!ready || voices === null) return null

  const day = (iso: string) => new Date(iso).toLocaleDateString(lang, { month: 'short', day: 'numeric' })

  const rename = async (id: string) => {
    const name = draft.trim()
    if (!name) return
    setBusy(true)
    const r = await fetch('/api/xcreate/voices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) }).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    if (j?.voice) setVoices(vs => (vs ?? []).map(v => v.id === id ? j.voice : v))
    setBusy(false); setEditing(null)
  }
  const remove = async (id: string) => {
    setBusy(true)
    await fetch(`/api/xcreate/voices?id=${id}`, { method: 'DELETE' }).catch(() => null)
    setAskDelete(null); setBusy(false)
    await load()
  }

  return (
    <section className="acct-section" id="voices">
      <h2 className="acct-h">{t('myvoice.title')}</h2>
      <p className="acct-note">{t('myvoice.blurb').replace('{app}', t('nav.xcreate'))}</p>

      {voices.length === 0 && <p className="acct-note">{t('myvoice.empty')}</p>}
      {voices.map(v => (
        <div key={v.id} className="acct-voice">
          {editing === v.id ? (
            <form className="acct-voice-edit" onSubmit={e => { e.preventDefault(); rename(v.id) }}>
              <input value={draft} maxLength={30} autoFocus onChange={e => setDraft(e.target.value)} aria-label={t('myvoice.rec.name')} />
              <button type="submit" className="acct-btn is-primary" disabled={busy || !draft.trim()}>{t('myvoice.save')}</button>
              <button type="button" className="acct-btn" onClick={() => setEditing(null)}>{t('myvoice.cancel')}</button>
            </form>
          ) : askDelete === v.id ? (
            <div className="acct-voice-edit">
              <span className="acct-voice-q">{t('myvoice.deleteq').replace('{name}', v.name)}</span>
              <button type="button" className="acct-btn acct-danger" disabled={busy} onClick={() => remove(v.id)}>{t('myvoice.delete')}</button>
              <button type="button" className="acct-btn" onClick={() => setAskDelete(null)}>{t('myvoice.cancel')}</button>
            </div>
          ) : (
            <>
              <div className="acct-voice-main">
                <span className="acct-voice-name">{v.name}</span>
                <span className="acct-voice-meta">
                  {t('myvoice.made').replace('{date}', day(v.createdAt))}
                  {' · '}
                  {v.used ? t('myvoice.used') : t('myvoice.unused').replace('{date}', v.lapsesAt ? day(v.lapsesAt) : '')}
                </span>
              </div>
              <div className="acct-voice-acts">
                <button type="button" className="acct-btn" onClick={() => { setEditing(v.id); setDraft(v.name); setAskDelete(null) }}>{t('myvoice.rename')}</button>
                <button type="button" className="acct-btn" onClick={() => { setAskDelete(v.id); setEditing(null) }}>{t('myvoice.delete')}</button>
              </div>
            </>
          )}
        </div>
      ))}

      <p className="acct-row acct-voice-open">
        <a className="acct-btn" href="/xcreate?type=audio&from=voice_clone">{t('myvoice.open').replace('{app}', t('nav.xcreate'))}</a>
      </p>
    </section>
  )
}
