'use client'
// app/components/FaceEditor.tsx — choose the website name and profile
// picture (Oct 2; owner: "profile image and website name").
//
// Opened from the account page on every door (www, xtell, xcreate). The
// picture is one of the account's sign-in photos (Google, LINE, X) or an
// upload, cut to its middle square and shrunk to 512 px here, so a phone
// photo of several MB travels as ~100 KB. /api/profile/face checks both with
// moderation, makes the 256 px file and saves; when either is refused,
// nothing is saved and the message says which.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@supabase/supabase-js'
import { useT } from '../../lib/i18n'
import { NAME_MAX, checkName, cleanName, nameLength } from '../../lib/face'
import { announceFace, type Face } from '../../lib/use-face'

type Choice =
  | { key: string; kind: 'signin'; provider: string; label: string; url: string }
  | { key: 'upload'; kind: 'upload'; label: string; url: string }

const providerLabel = (p: string) => (p === 'google' ? 'Google' : p === 'x' ? 'X' : p.startsWith('custom:line') ? 'LINE' : p)

/** One choice per sign-in method that has a photo. */
function signinChoices(user: User): Choice[] {
  const out: Choice[] = []
  for (const identity of user.identities ?? []) {
    const d = identity.identity_data ?? {}
    const url = typeof d.avatar_url === 'string' ? d.avatar_url : typeof d.picture === 'string' ? d.picture : null
    if (!url || !/^https:\/\//.test(url) || out.some(c => c.url === url)) continue
    out.push({ key: 'signin:' + identity.provider, kind: 'signin', provider: identity.provider, label: providerLabel(identity.provider), url })
  }
  return out
}

/** The middle square of a photo, at most 512 px, as a JPEG data URL. */
async function squareJpeg(file: File): Promise<string> {
  let source: CanvasImageSource & { width: number; height: number }
  let done = () => {}
  try {
    const bitmap = await createImageBitmap(file)
    source = bitmap
    done = () => bitmap.close()
  } catch {
    // Older browsers without createImageBitmap for this type.
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('decode')); img.src = url })
    source = img
    done = () => URL.revokeObjectURL(url)
  }
  try {
    const side = Math.min(source.width, source.height)
    if (!side) throw new Error('empty')
    const size = Math.min(512, side)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.9)
  } finally {
    done()
  }
}

const ERRORS = new Set(['name_empty', 'name_long', 'name_reserved', 'name_refused', 'picture_refused', 'picture_bad', 'check_unavailable', 'too_many'])

export default function FaceEditor({ user, current, onClose, onSaved }: {
  user: User
  current: Face
  onClose: () => void
  onSaved: (face: Face) => void
}) {
  const t = useT()
  const [name, setName] = useState(current.name ?? '')
  const [choices, setChoices] = useState<Choice[]>(() => signinChoices(user))
  const [picked, setPicked] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    nameRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); before?.focus() }
  }, [])

  const cleaned = cleanName(name)
  const length = nameLength(cleaned)
  const nameChanged = cleaned !== (current.name ?? '')
  const preview = picked?.url ?? current.photo
  const initial = (cleaned || current.name || '?').slice(0, 1).toUpperCase()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const url = await squareJpeg(file)
      const upload: Choice = { key: 'upload', kind: 'upload', label: t('face.uploaded'), url }
      setChoices(prev => [...prev.filter(c => c.kind !== 'upload'), upload])
      setPicked(upload)
    } catch {
      setError(t('face.err.picture_bad'))
    }
  }

  const save = async () => {
    setError(null)
    const body: Record<string, unknown> = {}
    if (nameChanged) {
      // The server decides about "ModelXD"; empty and too long are said here.
      const checked = checkName(name, { admin: true })
      if (!checked.ok) { setError(t('face.err.' + checked.error)); return }
      body.name = checked.name
    }
    if (picked) body.photo = picked.kind === 'upload' ? { from: 'upload', data: picked.url } : { from: 'signin', provider: picked.provider }
    if (!Object.keys(body).length) { onClose(); return }
    setBusy(true)
    try {
      const res = await fetch('/api/profile/face', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({})) as { name?: string | null; photo?: string | null; error?: string }
      if (!res.ok) {
        setError(t('face.err.' + (json.error && ERRORS.has(json.error) ? json.error : 'failed')))
        return
      }
      const face: Face = { name: json.name ?? null, photo: json.photo ?? null }
      announceFace(user.id, face)
      onSaved(face)
      onClose()
    } catch {
      setError(t('face.err.failed'))
    } finally {
      setBusy(false)
    }
  }

  // On the body, outside the account page: XTell's page forces 14 px on every
  // input inside it, and an input under 16 px makes iPhones zoom in.
  return createPortal(
    <>
      <style>{`
        .face-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; }
        .face-card { width: 100%; max-width: 420px; margin: auto 0; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border2); border-radius: 12px; padding: 24px 20px 20px; color: var(--white); box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
        .face-card h2 { margin: 0 0 18px; font-size: 18px; font-weight: 800; text-align: center; }
        .face-preview { width: 96px; height: 96px; margin: 0 auto 18px; border-radius: 50%; overflow: hidden; border: 1px solid var(--border2); background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 800; color: var(--red); }
        .face-preview img { width: 100%; height: 100%; object-fit: cover; }
        .face-label { display: block; margin: 0 0 8px; font-size: 13px; font-weight: 700; color: var(--white); }
        .face-choices { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 20px; }
        .face-choice { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 64px; padding: 0; border: none; background: none; color: var(--muted2); font-size: 12px; cursor: pointer; }
        .face-choice-img { width: 56px; height: 56px; border-radius: 50%; overflow: hidden; border: 1px solid var(--border2); background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 24px; color: var(--muted2); box-sizing: border-box; }
        .face-choice-img img { width: 100%; height: 100%; object-fit: cover; }
        .face-choice[aria-pressed="true"] .face-choice-img { outline: 3px solid var(--red); outline-offset: 2px; }
        .face-choice[aria-pressed="true"] { color: var(--white); font-weight: 700; }
        .face-choice.is-upload .face-choice-img { border-style: dashed; }
        .face-input { width: 100%; box-sizing: border-box; padding: 11px 12px; font-size: 16px; border: 1px solid var(--border2); border-radius: 8px; background: var(--bg); color: var(--white); outline: none; }
        .face-input:focus { border-color: var(--white); }
        .face-hint { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted2); }
        .face-hint .is-over { color: var(--red); font-weight: 700; }
        .face-error { margin: 14px 0 0; font-size: 13px; line-height: 1.5; color: var(--red); }
        .face-note { margin: 14px 0 0; font-size: 12px; color: var(--muted); }
        .face-actions { display: flex; gap: 10px; margin-top: 18px; }
        .face-actions button { flex: 1; min-height: 44px; border-radius: 8px; font-size: 15px; font-weight: 700; cursor: pointer; }
        .face-cancel { background: transparent; border: 1px solid var(--border2); color: var(--muted2); }
        .face-save { background: var(--white); border: 1px solid var(--white); color: var(--bg); }
        .face-save:disabled { opacity: 0.5; cursor: default; }
      `}</style>
      <div className="face-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <div className="face-card" role="dialog" aria-modal="true" aria-labelledby="face-title">
          <h2 id="face-title">{t('face.title')}</h2>
          <div className="face-preview" aria-hidden="true">
            {preview ? <img src={preview} alt="" referrerPolicy="no-referrer" /> : initial}
          </div>

          <span className="face-label" id="face-picture-label">{t('face.picture')}</span>
          <div className="face-choices" role="group" aria-labelledby="face-picture-label">
            {choices.map(c => (
              <button key={c.key} type="button" className={c.kind === 'upload' ? 'face-choice is-upload' : 'face-choice'}
                aria-pressed={picked?.key === c.key} onClick={() => setPicked(picked?.key === c.key ? null : c)}>
                <span className="face-choice-img"><img src={c.url} alt="" referrerPolicy="no-referrer" /></span>
                {c.label}
              </button>
            ))}
            <button type="button" className="face-choice is-upload" onClick={() => fileRef.current?.click()}>
              <span className="face-choice-img" aria-hidden="true">＋</span>
              {t('face.upload')}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={e => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>

          <label className="face-label" htmlFor="face-name">{t('face.name')}</label>
          <input id="face-name" ref={nameRef} className="face-input" value={name} autoComplete="nickname"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save() }} />
          <p className="face-hint">
            <span>{t('face.nameHint')}</span>
            <span className={length > NAME_MAX ? 'is-over' : undefined} aria-live="polite">{length}/{NAME_MAX}</span>
          </p>

          {error && <p className="face-error" role="alert">{error}</p>}
          <p className="face-note">{t('face.checked')}</p>

          <div className="face-actions">
            <button type="button" className="face-cancel" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
            <button type="button" className="face-save" onClick={() => void save()}
              disabled={busy || length > NAME_MAX || (!nameChanged && !picked) || (nameChanged && !cleaned)}>
              {busy ? t('face.saving') : t('face.save')}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
