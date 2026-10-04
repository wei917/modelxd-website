'use client'
// app/components/xtell/XTellPersonality.tsx — the visitor's own personality
// type: the section on the XTell account page that saves it, and the box in
// a room that attaches it to a reading (lib/xtell-personality.ts).
//
// Nothing reaches a teacher from here: the account page only keeps the type,
// and a room sends it only while its box is ticked, which it never is by
// default (owner, Sep 30: "optionally give temple master to use").

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n'
import { PAIRS, asPersonalityType, partsOf, typeOf, type PersonalityParts } from '../../../lib/xtell-personality'

/** The saved type, or null; undefined while loading or when the feature is
 *  unavailable (signed out, migration 119 not run). */
export function useSavedPersonality(enabled = true): string | null | undefined {
  const [type, setType] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let live = true
    fetch('/api/xtell/personality').then(r => r.ok ? r.json() : null).then(d => {
      if (live && d) setType(asPersonalityType(d.personality?.type))
    }).catch(() => {})
    return () => { live = false }
  }, [enabled])
  return type
}

const EMPTY: PersonalityParts = { letters: ['', '', '', ''], identity: '' }

/** The four two-way choices and the optional fifth letter. */
function TypePicker({ value, onChange, name }: { value: PersonalityParts; onChange: (p: PersonalityParts) => void; name: string }) {
  const t = useT()
  return (
    <div className="xtell-pt-picker">
      {PAIRS.map((pair, i) => (
        <div key={i} className="xtell-pt-pair" role="radiogroup" aria-label={pair.map(l => t(`xtell.pt.l.${l}`)).join(' / ')}>
          {pair.map(l => (
            <label key={l} className="xtell-pt-opt">
              <input type="radio" name={`${name}-${i}`} checked={value.letters[i] === l}
                onChange={() => { const letters = [...value.letters] as PersonalityParts['letters']; letters[i] = l; onChange({ ...value, letters }) }} />
              <b>{l}</b> <span>{t(`xtell.pt.l.${l}`)}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="xtell-pt-pair xtell-pt-identity" role="radiogroup" aria-label={t('xtell.pt.identity')}>
        <span className="xtell-pt-identity-label">{t('xtell.pt.identity')}</span>
        {(['', 'A', 'T'] as const).map(k => (
          <label key={k || 'none'} className="xtell-pt-opt">
            <input type="radio" name={`${name}-id`} checked={value.identity === k} onChange={() => onChange({ ...value, identity: k })} />
            <b>{k ? `-${k}` : t('xtell.pt.none')}</b>
          </label>
        ))}
      </div>
    </div>
  )
}

/** The account page's section. */
export function PersonalitySettings() {
  const t = useT()
  const [state, setState] = useState<'loading' | 'hidden' | 'ready'>('loading')
  const [saved, setSaved] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PersonalityParts>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const gen = useRef(0)

  useEffect(() => {
    const g = gen.current
    fetch('/api/xtell/personality').then(async r => {
      if (g !== gen.current) return
      if (!r.ok) { setState('hidden'); return }
      const d = await r.json().catch(() => null)
      if (g !== gen.current) return
      setSaved(asPersonalityType(d?.personality?.type)); setState('ready')
    }).catch(() => setState('hidden'))
  }, [])

  // Arrived from a room's 「在帳戶頁填寫」 link: scroll here once loaded.
  useEffect(() => {
    if (state === 'ready' && window.location.hash === '#xtell-personality') document.getElementById('xtell-personality')?.scrollIntoView({ block: 'start' })
  }, [state])

  const edit = () => { setDraft(partsOf(saved) ?? EMPTY); setErr(false); setNotice(null); setEditing(true) }
  const save = async () => {
    const type = typeOf(draft)
    if (!type) return
    const g = ++gen.current
    setBusy(true); setErr(false)
    const res = await fetch('/api/xtell/personality', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }).catch(() => null)
    const d = res?.ok ? await res.json().catch(() => null) : null
    if (g !== gen.current) return
    setBusy(false)
    if (!d?.personality) { setErr(true); return }
    setSaved(asPersonalityType(d.personality.type)); setEditing(false); setNotice(t('xtell.pt.saved'))
  }
  const remove = async () => {
    const g = ++gen.current
    setBusy(true)
    const res = await fetch('/api/xtell/personality', { method: 'DELETE' }).catch(() => null)
    if (g !== gen.current) return
    setBusy(false)
    if (!res?.ok) { setNotice(t('xtell.pt.err')); return }
    setSaved(null); setEditing(false); setNotice(t('xtell.pt.deleted'))
  }

  if (state !== 'ready') return null
  return (
    <section id="xtell-personality" className="xtell-dy xtell-dy-account" aria-label={t('xtell.pt.title')}>
      <div className="xtell-dy-head"><h2 className="xtell-dy-title">{t('xtell.pt.title')}</h2></div>
      <p className="xtell-dy-small">{t('xtell.pt.note')}</p>
      {notice && <p className="xtell-dy-notice" role="status">{notice}</p>}
      {editing ? (
        <form className="xtell-dy-form" onSubmit={e => { e.preventDefault(); void save() }}>
          <TypePicker value={draft} onChange={setDraft} name="xtell-pt" />
          {err && <p className="xtell-dy-warn" role="alert">{t('xtell.pt.err')}</p>}
          <div className="xtell-dy-row">
            <button type="submit" className="xtell-dy-primary" disabled={busy || !typeOf(draft)}>{t('xtell.pt.save')}{typeOf(draft) ? ` · ${typeOf(draft)}` : ''}</button>
            <button type="button" className="xtell-dy-secondary" onClick={() => setEditing(false)}>{t('xtell.pt.cancel')}</button>
          </div>
        </form>
      ) : saved ? (
        <div className="xtell-dy-profile">
          {/* Hidden like the saved birthday (owner, Sep 28 / Oct 1): the
              letters show only in the form, after 修改. */}
          <span>{t('xtell.dy.savedHidden')}</span>
          <span className="xtell-dy-row">
            <button type="button" className="xtell-dy-link" onClick={edit}>{t('xtell.pt.edit')}</button>
            <button type="button" className="xtell-dy-link" disabled={busy} onClick={() => void remove()}>{t('xtell.pt.delete')}</button>
          </span>
        </div>
      ) : (
        <p className="xtell-dy-small">{t('xtell.pt.empty')} <button type="button" className="xtell-dy-link" onClick={edit}>{t('xtell.pt.add')}</button></p>
      )}
      <p className="xtell-pt-tm">{t('xtell.pt.tm')}</p>
    </section>
  )
}

/** A room's box: attach the saved type to this reading. Off by default; shown
 *  only once a type is saved, else a link to the account page. `partner`
 *  (月老) adds a choice for the other person's type, typed in the room. */
export function PersonalityAttach({ saved, on, setOn, partner, setPartner }: {
  saved: string | null | undefined
  on: boolean
  setOn: (v: boolean) => void
  partner?: string
  setPartner?: (v: string) => void
}) {
  const t = useT()
  if (saved === undefined) return null
  const all: string[] = []
  for (const a of 'EI') for (const b of 'SN') for (const c of 'TF') for (const d of 'JP') all.push(a + b + c + d)
  return (
    <div className="xtell-pt-attach">
      {saved ? (
        <label className="xtell-dy-check">
          <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />
          {/* The letters show only once ticked: someone may be watching the
              screen (owner, Oct 1), as with the birthday. */}
          {on ? t('xtell.pt.attach').replace('{type}', saved) : t('xtell.pt.attachPlain')}
        </label>
      ) : (
        <a className="xtell-dy-link" href="/profile#xtell-personality">{t('xtell.pt.hint')}</a>
      )}
      {saved && on && <small className="xtell-pt-attach-note">{t('xtell.pt.attachNote')}</small>}
      {setPartner && (
        <label className="xtell-dy-field">
          <span>{t('xtell.pt.partner')}</span>
          <select className="xtell-dy-select" value={partner ?? ''} onChange={e => setPartner(e.target.value)}>
            <option value="">{t('xtell.pt.unknown')}</option>
            {all.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
