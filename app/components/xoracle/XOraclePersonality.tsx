'use client'
// app/components/xoracle/XOraclePersonality.tsx — the visitor's own personality
// type: the section on the XOracle account page that saves it, and the box in
// a room that attaches it to a reading (lib/xoracle-personality.ts).
//
// Nothing reaches a teacher from here: the account page only keeps the type,
// and a room sends it only while its box is ticked, which it never is by
// default (owner, Sep 30: "optionally give temple master to use").

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n'
import { PAIRS, asPersonalityType, partsOf, typeOf, type PersonalityParts } from '../../../lib/xoracle-personality'

/** The saved type, or null; undefined while loading or when the feature is
 *  unavailable (signed out, migration 119 not run). */
export function useSavedPersonality(enabled = true): string | null | undefined {
  const [type, setType] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let live = true
    fetch('/api/xoracle/personality').then(r => r.ok ? r.json() : null).then(d => {
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
    <div className="xoracle-pt-picker">
      {PAIRS.map((pair, i) => (
        <div key={i} className="xoracle-pt-pair" role="radiogroup" aria-label={pair.map(l => t(`xoracle.pt.l.${l}`)).join(' / ')}>
          {pair.map(l => (
            <label key={l} className="xoracle-pt-opt">
              <input type="radio" name={`${name}-${i}`} checked={value.letters[i] === l}
                onChange={() => { const letters = [...value.letters] as PersonalityParts['letters']; letters[i] = l; onChange({ ...value, letters }) }} />
              <b>{l}</b> <span>{t(`xoracle.pt.l.${l}`)}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="xoracle-pt-pair xoracle-pt-identity" role="radiogroup" aria-label={t('xoracle.pt.identity')}>
        <span className="xoracle-pt-identity-label">{t('xoracle.pt.identity')}</span>
        {(['', 'A', 'T'] as const).map(k => (
          <label key={k || 'none'} className="xoracle-pt-opt">
            <input type="radio" name={`${name}-id`} checked={value.identity === k} onChange={() => onChange({ ...value, identity: k })} />
            <b>{k ? `-${k}` : t('xoracle.pt.none')}</b>
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
    fetch('/api/xoracle/personality').then(async r => {
      if (g !== gen.current) return
      if (!r.ok) { setState('hidden'); return }
      const d = await r.json().catch(() => null)
      if (g !== gen.current) return
      setSaved(asPersonalityType(d?.personality?.type)); setState('ready')
    }).catch(() => setState('hidden'))
  }, [])

  // Arrived from a room's 「在帳戶頁填寫」 link: scroll here once loaded.
  useEffect(() => {
    if (state === 'ready' && window.location.hash === '#xoracle-personality') document.getElementById('xoracle-personality')?.scrollIntoView({ block: 'start' })
  }, [state])

  const edit = () => { setDraft(partsOf(saved) ?? EMPTY); setErr(false); setNotice(null); setEditing(true) }
  const save = async () => {
    const type = typeOf(draft)
    if (!type) return
    const g = ++gen.current
    setBusy(true); setErr(false)
    const res = await fetch('/api/xoracle/personality', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }).catch(() => null)
    const d = res?.ok ? await res.json().catch(() => null) : null
    if (g !== gen.current) return
    setBusy(false)
    if (!d?.personality) { setErr(true); return }
    setSaved(asPersonalityType(d.personality.type)); setEditing(false); setNotice(t('xoracle.pt.saved'))
  }
  const remove = async () => {
    const g = ++gen.current
    setBusy(true)
    const res = await fetch('/api/xoracle/personality', { method: 'DELETE' }).catch(() => null)
    if (g !== gen.current) return
    setBusy(false)
    if (!res?.ok) { setNotice(t('xoracle.pt.err')); return }
    setSaved(null); setEditing(false); setNotice(t('xoracle.pt.deleted'))
  }

  if (state !== 'ready') return null
  return (
    <section id="xoracle-personality" className="xoracle-dy xoracle-dy-account" aria-label={t('xoracle.pt.title')}>
      <div className="xoracle-dy-head"><h2 className="xoracle-dy-title">{t('xoracle.pt.title')}</h2></div>
      <p className="xoracle-dy-small">{t('xoracle.pt.note')}</p>
      {notice && <p className="xoracle-dy-notice" role="status">{notice}</p>}
      {editing ? (
        <form className="xoracle-dy-form" onSubmit={e => { e.preventDefault(); void save() }}>
          <TypePicker value={draft} onChange={setDraft} name="xoracle-pt" />
          {err && <p className="xoracle-dy-warn" role="alert">{t('xoracle.pt.err')}</p>}
          <div className="xoracle-dy-row">
            <button type="submit" className="xoracle-dy-primary" disabled={busy || !typeOf(draft)}>{t('xoracle.pt.save')}{typeOf(draft) ? ` · ${typeOf(draft)}` : ''}</button>
            <button type="button" className="xoracle-dy-secondary" onClick={() => setEditing(false)}>{t('xoracle.pt.cancel')}</button>
          </div>
        </form>
      ) : saved ? (
        <div className="xoracle-dy-profile">
          {/* Hidden like the saved birthday (owner, Sep 28 / Oct 1): the
              letters show only in the form, after 修改. */}
          <span>{t('xoracle.dy.savedHidden')}</span>
          <span className="xoracle-dy-row">
            <button type="button" className="xoracle-dy-link" onClick={edit}>{t('xoracle.pt.edit')}</button>
            <button type="button" className="xoracle-dy-link" disabled={busy} onClick={() => void remove()}>{t('xoracle.pt.delete')}</button>
          </span>
        </div>
      ) : (
        <p className="xoracle-dy-small">{t('xoracle.pt.empty')} <button type="button" className="xoracle-dy-link" onClick={edit}>{t('xoracle.pt.add')}</button></p>
      )}
      <p className="xoracle-pt-tm">{t('xoracle.pt.tm')}</p>
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
    <div className="xoracle-pt-attach">
      {saved ? (
        <label className="xoracle-dy-check">
          <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />
          {/* The letters show only once ticked: someone may be watching the
              screen (owner, Oct 1), as with the birthday. */}
          {on ? t('xoracle.pt.attach').replace('{type}', saved) : t('xoracle.pt.attachPlain')}
        </label>
      ) : (
        <a className="xoracle-dy-link" href="/profile#xoracle-personality">{t('xoracle.pt.hint')}</a>
      )}
      {saved && on && <small className="xoracle-pt-attach-note">{t('xoracle.pt.attachNote')}</small>}
      {setPartner && (
        <label className="xoracle-dy-field">
          <span>{t('xoracle.pt.partner')}</span>
          <select className="xoracle-dy-select" value={partner ?? ''} onChange={e => setPartner(e.target.value)}>
            <option value="">{t('xoracle.pt.unknown')}</option>
            {all.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
