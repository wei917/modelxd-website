'use client'
// app/components/xoracle/Xiang.tsx — 相學館's room (owner, Oct 6): how to read
// a face and a palm, up to three photos (face, left palm, right palm; at
// least one) with gender and the dominant hand, then the 相盤 drawn on the
// face for the visitor to check and correct, and saved as one image to
// share. lib/xiang.ts has the shapes; the chart route does the reading.
//
// 看我們兩個 (owner, Oct 6, "similar to 月老"): the same for the other
// person (who they are to the visitor, their photos, gender and hand), with
// a tick that the person in the photos agreed; both faces drawn side by side.
// Palm lines are not drawn (owner, Oct 6: "still not accurate"); the words
// describe them.
//
// The photos stay in this browser: shrunk to 1280 px here (which also drops
// their EXIF, location included), sent once to be read, never stored. A
// reopened visit has the written 相盤 only.
//
// The form's look (Oct 8): laid out after GPT Image 2's mockups, with its
// guide pictures (see "The look" below); Oct 9, small tiles, always two sets
// in one line (the visitor's, then the other person's, which may stay empty),
// and 怎麼看面相、手相 teaches with numbered pictures. Signed out, the same
// tiles with one sign-in.

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang } from '../../../lib/i18n'
import { RELATIONS, type XiangChart, type XiangPerson, type XiangPhotoKey, type XiangRelation, type FaceReading, type Pt } from '../../../lib/xiang'
import { palmLines } from '../../../lib/palm-lines'

/** `dataUrl` is what the models read; `url` the photo as taken (the tile shows
 *  it); a palm's `linePhoto` is its line picture, shown in the 相盤. */
export type XiangPhoto = { dataUrl: string; url: string; w: number; h: number; linePhoto?: string }
export type XiangPhotos = Partial<Record<XiangPhotoKey, XiangPhoto>>
export type XiangCheck = { ok: boolean; tip: string; is?: string }

const KEYS: XiangPhotoKey[] = ['face', 'left', 'right']
const ZONE_COLOR = '#f5c400'
const MAX_SIDE = 1280

/** A photo as the reader gets it: upright, at most 1280 px, JPEG, no EXIF.
 *  Its shape stays between square and 9:16 (owner, Oct 9: "limit to 1:1 or
 *  9:16, not 16:9. since human face and hands are long not landscape"): a
 *  landscape photo keeps its middle square, a very tall one its middle 9:16.
 *  A palm is also drawn as its lines (lib/palm-lines.ts; owner, Oct 9:
 *  "process the palm with filters to only show clear lines… and we use those
 *  to feed into AI models"): the models read the lines; the tile keeps the
 *  photo as taken and the 相盤 shows the lines ("taking palm photo still shows
 *  the original photo. you show the line photo after the analysis"). */
export async function shrinkPhoto(file: File, key: XiangPhotoKey): Promise<XiangPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as any)
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height
  if (sw > sh) { sx = (sw - sh) / 2; sw = sh }
  else if (sh > (sw * 16) / 9) { sy = (sh - (sw * 16) / 9) / 2; sh = (sw * 16) / 9 }
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh))
  const w = Math.round(sw * scale), h = Math.round(sh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const g = canvas.getContext('2d')!
  g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h)
  bitmap.close?.()
  const asTaken = canvas.toDataURL('image/jpeg', 0.85)
  const url = URL.createObjectURL(await (await fetch(asTaken)).blob())
  if (key === 'face') return { dataUrl: asTaken, url, w, h }
  const px = g.getImageData(0, 0, w, h)
  px.data.set(palmLines(px.data, w, h))
  g.putImageData(px, 0, 0)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { dataUrl, url, linePhoto: URL.createObjectURL(await (await fetch(dataUrl)).blob()), w, h }
}

/** Signed in or not, kept up to date (the photos need an account: the
 *  reading runs on ours). */
export function useSignedIn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.auth.getSession().then(({ data }) => setOn(!!data.session))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setOn(!!s))
    return () => sub.subscription.unsubscribe()
  }, [])
  return on
}

// ── The look (Oct 8, owner: "why you use green? and so many ugly drawings.
// if you can't draw you should call gpt image. ask it for a good layout and
// implement it"): GPT Image 2 drew the layout (scripts/xiang-ui-art.ts) and
// the pictures; the site's own paper, ink and vermilion, no green. Oct 9
// (owner: "the slots are way too big"; for two people "side by side 6 slots,
// no need to put two rows"): small tiles, six in a line. ──────────────────

/** The guides in the photo tiles: black-and-white ink drawings, a woman's or
 *  a man's face and hands by the gender chosen for that person (owner, Oct 9:
 *  "要有男性女性 根據性別"); the faces schematic, like an old 相書 woodblock
 *  print, so they look like no one (Oct 10: "more less human? 像古代那種…
 *  盡量不要太像某些人", then "女生也改掉"); illustration only, an uploaded photo
 *  is never drawn on. A palm seen from the front with the fingers up has its
 *  thumb on its own side: a left palm's on the left of the picture. GPT drew
 *  right palms; the left ones are their mirrors (owner, Oct 8: the two were
 *  first swapped). */
const guideOf = (k: XiangPhotoKey, gender: 'male' | 'female') => `/xoracle/xiang/guide-${k === 'face' ? 'face' : `palm-${k}`}-${gender}.avif`

type GlyphName = 'camera' | 'image' | 'book' | 'lock' | 'check' | 'alert'
/** The few line icons the layout uses, in the current text colour. */
function Glyph({ name }: { name: GlyphName }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg className={'xoracle-xiang-glyph is-' + name} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'camera' && <><path d="M4 8h3.2l1.6-2.4h6.4L16.8 8H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" {...s} /><circle cx="12" cy="13.2" r="3.6" {...s} /></>}
      {name === 'image' && <><rect x="3.5" y="4.5" width="17" height="15" rx="2" {...s} /><circle cx="9" cy="10" r="1.7" {...s} /><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" {...s} /></>}
      {name === 'book' && <><path d="M12 6.5C10.3 5.2 7.8 4.6 4 4.8v13.4c3.8-.2 6.3.4 8 1.7 1.7-1.3 4.2-1.9 8-1.7V4.8c-3.8-.2-6.3.4-8 1.7z" {...s} /><path d="M12 6.5v13.4" {...s} /></>}
      {name === 'lock' && <><rect x="5" y="10.5" width="14" height="10" rx="2" {...s} /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...s} /></>}
      {name === 'check' && <path d="M5 12.5l4.2 4.2L19 7" {...s} strokeWidth={2.2} />}
      {name === 'alert' && <><circle cx="12" cy="12" r="8.5" {...s} /><path d="M12 7.5v5.5M12 16.2v.1" {...s} strokeWidth={2.2} /></>}
    </svg>
  )
}

// ── How to read a face and a palm (a tips row that opens) ──────────────────
// Owner, Oct 9: "draw the image to teach users which line means what on palm.
// and for face, which area is for what". The pictures are GPT Image 2's: the
// face is the woman's guide face (its 三停 lines drawn in); the palm is
// scripts/xiang-ui-art.ts `learn`, with its heart line added and its fate line
// stopped at the wrist by hand (GPT left out the one and ran the other down
// the arm). The numbers sit on the pictures here, so the words follow the
// language. Spots are in % of the picture.

type Pin = { key: string; x: number; y: number }
const FACE_PINS: Pin[] = [
  { key: 'upper', x: 18, y: 31.2 }, { key: 'middle', x: 18, y: 44.2 }, { key: 'lower', x: 18, y: 58.2 },
  { key: 'yintang', x: 50, y: 36 }, { key: 'brows', x: 62.5, y: 35.5 }, { key: 'eyes', x: 35.5, y: 40.5 },
  { key: 'nose', x: 50, y: 45.5 }, { key: 'mouth', x: 59, y: 55.5 }, { key: 'ears', x: 68.5, y: 43.5 },
]
/** The five lines the reader knows (LINE_KEYS in lib/xiang.ts), on a right palm. */
const PALM_PINS: Pin[] = [
  { key: 'life', x: 59.6, y: 73.2 }, { key: 'head', x: 37, y: 49.9 }, { key: 'heart', x: 56, y: 36.2 },
  { key: 'fate', x: 50, y: 70.5 }, { key: 'sun', x: 41.5, y: 32.8 },
]

/** "Name: what it is", the name in bold (every language writes them so). */
function Term({ text }: { text: string }) {
  const m = text.match(/^(.+?)([：:])\s*([\s\S]*)$/)
  return m ? <><b>{m[1]}</b>{m[2] === '：' ? '：' : ': '}{m[3]}</> : <>{text}</>
}

function XiangLesson({ title, src, pins, words, note }: { title: string; src: string; pins: Pin[]; words: string; note: string }) {
  const { t } = useLang()
  return (
    <section className="xoracle-xiang-learn">
      <h4>{t(title)}</h4>
      <div className="xoracle-xiang-learn-body">
        <div className="xoracle-xiang-diagram" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" />
          {pins.map((p, i) => <span key={p.key} className="xoracle-xiang-pin" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{i + 1}</span>)}
        </div>
        <div>
          <ol className="xoracle-xiang-legend">{pins.map(p => <li key={p.key}><Term text={t(`${words}.${p.key}`)} /></li>)}</ol>
          <p className="xoracle-xiang-learn-note">{t(note)}</p>
        </div>
      </div>
    </section>
  )
}

export function XiangTutorial() {
  const { t } = useLang()
  return (
    <details className="xoracle-xiang-help">
      <summary><Glyph name="book" /><span className="xoracle-xiang-help-text"><b>{t('xoracle.xiang.tutorial')}</b><small>{t('xoracle.xiang.help.sub')}</small></span></summary>
      <div className="xoracle-xiang-help-cols">
        <XiangLesson title="xoracle.xiang.tut.face.title" src="/xoracle/xiang/learn-face.avif" pins={FACE_PINS} words="xoracle.xiang.learn.face" note="xoracle.xiang.tut.face.4" />
        <XiangLesson title="xoracle.xiang.tut.palm.title" src="/xoracle/xiang/learn-palm.avif" pins={PALM_PINS} words="xoracle.xiang.learn.palm" note="xoracle.xiang.tut.palm.1" />
        <section>
          <h4>{t('xoracle.xiang.tut.photo.title')}</h4>
          <ul>{[1, 2, 3].map(n => <li key={n}>{t(`xoracle.xiang.tut.photo.${n}`)}</li>)}</ul>
        </section>
      </div>
    </details>
  )
}

/** The privacy line above the 開始觀相 button (app/xoracle/client.tsx). One line
 *  for one or two people, since both sets of tiles always show (owner, Oct 9:
 *  "只放你自己的照片…" was wrong once the other person's were on the page). */
export function XiangPrivacy() {
  const { t } = useLang()
  return <p className="xoracle-xiang-privacy"><Glyph name="lock" /><span>{t('xoracle.xiang.privacy')}</span></p>
}

// ── The camera on a computer ───────────────────────────────────────────────
// A phone opens its own camera from the file input (`capture`); a computer's
// browser ignores that and shows the file window (owner, Oct 6: "it should
// open camera"), so there the page runs the camera itself: a live picture,
// 拍下, and the frame as it is (not mirrored: a mirrored palm reads as the
// other hand). A webcam is wide, so the picture is its middle square, shown
// as such while framing (owner, Oct 9: "limit to 1:1 or 9:16, not 16:9").

/** A phone or tablet: its file input opens the camera app. */
const touchFirst = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

function XiangCamera({ k, onShot, onClose }: { k: XiangPhotoKey; onShot: (f: File) => void; onClose: () => void }) {
  const { t } = useLang()
  const video = useRef<HTMLVideoElement>(null)
  const shootRef = useRef<HTMLButtonElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'off'>('starting')
  const titleId = useId()
  useEffect(() => {
    let stream: MediaStream | null = null, gone = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: k === 'face' ? 'user' : 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(s => {
        if (gone) { s.getTracks().forEach(tr => tr.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}) }
        setState('live')
      })
      .catch(() => { if (!gone) setState('off') })
    if (!navigator.mediaDevices?.getUserMedia) setState('off')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { gone = true; stream?.getTracks().forEach(tr => tr.stop()); window.removeEventListener('keydown', onKey) }
  }, [k, onClose])
  useEffect(() => { if (state === 'live') shootRef.current?.focus() }, [state])
  const shoot = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas'), s = Math.min(v.videoWidth, v.videoHeight)
    c.width = s; c.height = s
    c.getContext('2d')!.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, s, s)
    c.toBlob(b => { if (b) onShot(new File([b], `${k}.jpg`, { type: 'image/jpeg' })) }, 'image/jpeg', 0.92)
  }
  return (
    <div className="xoracle-xiang-camera" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="xoracle-xiang-camera-box">
        <div id={titleId} className="xoracle-xiang-camera-title">{t(`xoracle.xiang.slot.${k}`)} · {t(k === 'face' ? 'xoracle.xiang.camera.face' : 'xoracle.xiang.camera.palm')}</div>
        {state === 'off'
          ? <p className="xoracle-xiang-tip is-bad" role="alert">{t('xoracle.xiang.camera.off')}</p>
          : <video ref={video} playsInline muted aria-label={t('xoracle.xiang.take')} />}
        <div className="xoracle-xiang-camera-actions">
          <button type="button" className="xoracle-xiang-btn is-plain" onClick={onClose}>{t('xoracle.xiang.camera.cancel')}</button>
          {state !== 'off' && <button ref={shootRef} type="button" className="xoracle-dy-primary" onClick={shoot} disabled={state !== 'live'}>{t('xoracle.xiang.camera.shoot')}</button>}
        </div>
      </div>
    </div>
  )
}

// ── One person's three photo tiles (the visitor's, or the other person's) ──

/** Signed out, the tiles show what to add but take nothing: the reading runs
 *  on our account, so photos wait for a sign-in (the form says so once). */
const LockCtx = createContext(false)

type SlotsProps = {
  photos: XiangPhotos; setPhoto: (k: XiangPhotoKey, p: XiangPhoto | null) => void; checks: Record<string, XiangCheck>
  disabled: boolean; photoAria?: { invalid: boolean; describedBy?: string }
}

/** The picture is the button: a phone offers its camera or its photos, a
 *  computer its files (or takes a photo dropped on the tile). 拍照 sits under
 *  it where the tile has room; what the photo check said is listed under the
 *  three, and marked on the picture. */
function XiangSlots({ who, gender, labelledBy, photos, setPhoto, checks, disabled, photoAria }: SlotsProps & {
  who: 'me' | 'partner'; gender: 'male' | 'female'; labelledBy: string
}) {
  const { t } = useLang()
  const locked = useContext(LockCtx)
  const [busy, setBusy] = useState<XiangPhotoKey | null>(null)
  const [bad, setBad] = useState<XiangPhotoKey | null>(null)
  const take = async (k: XiangPhotoKey, f: File | undefined) => {
    if (!f) return
    setBusy(k); setBad(null)
    try { setPhoto(k, await shrinkPhoto(f, k)) } catch { setBad(k) } finally { setBusy(null) }
  }
  // 拍照: a phone's own camera through the file input, else the page's camera.
  const [camera, setCamera] = useState<XiangPhotoKey | null>(null)
  const [touch, setTouch] = useState(false)
  useEffect(() => setTouch(touchFirst()), [])
  const closeCamera = useRef(() => setCamera(null)).current
  // A photo dragged onto a tile (owner, Oct 6: "it should support drag and
  // drop"). While the form is open, a file dropped anywhere else is ignored
  // rather than opened by the browser, which would leave the page.
  const [over, setOver] = useState<XiangPhotoKey | null>(null)
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop) }
  }, [])
  const off = disabled || locked
  const dropOn = (k: XiangPhotoKey) => ({
    onDragOver: (e: React.DragEvent) => { if (off || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(k) },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(o => (o === k ? null : o)) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setOver(null)
      if (off) return
      const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'))
      if (f) void take(k, f); else setBad(k)
    },
  })
  const said = KEYS.flatMap(k => {
    const c = checks[k]
    if (bad === k) return [{ k, ok: false, text: t('xoracle.err.photo_invalid') }]
    if (c && !c.ok) return [{ k, ok: false, text: c.tip || t('xoracle.err.photo_unclear') }]
    return c?.ok && c.tip ? [{ k, ok: true, text: c.tip }] : []
  })
  return (
    <div className={'xoracle-xiang-group is-' + who}>
      <div className={'xoracle-xiang-slots' + (locked ? ' is-locked' : '')} role="group" aria-labelledby={labelledBy}
        aria-invalid={photoAria?.invalid || undefined} aria-describedby={photoAria?.invalid ? photoAria.describedBy : undefined}>
        {KEYS.map(k => {
          const p = photos[k], c = checks[k], name = t(`xoracle.xiang.slot.${k}`), pick = t(p ? 'xoracle.xiang.replace' : 'xoracle.xiang.upload')
          return (
            <div key={k} className={'xoracle-xiang-slot' + (p ? ' has-photo' : '') + ((c && !c.ok) || bad === k ? ' is-bad' : '') + (c?.ok ? ' is-ok' : '') + (over === k ? ' is-over' : '')} {...dropOn(k)}>
              <div className="xoracle-xiang-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p ? <img className="is-photo" src={p.url} alt={name} /> : <img className="is-guide" src={guideOf(k, gender)} alt="" aria-hidden="true" />}
                {!locked && (
                  <label className="xoracle-xiang-pick" title={touch ? undefined : `${pick} · ${t('xoracle.xiang.drop')}`}>
                    <input type="file" accept="image/*" disabled={disabled} aria-label={`${pick} · ${name}`} onChange={e => { void take(k, e.target.files?.[0]); e.target.value = '' }} />
                    {!p && <span className="xoracle-xiang-pick-chip" aria-hidden="true"><Glyph name="image" /><span>{t(over === k ? 'xoracle.xiang.dropHere' : 'xoracle.xiang.upload')}</span></span>}
                    {!p && <span className="xoracle-xiang-plus" aria-hidden="true">+</span>}
                  </label>
                )}
                {c && <span className={'xoracle-xiang-badge' + (c.ok ? ' is-ok' : ' is-bad')}><Glyph name={c.ok ? 'check' : 'alert'} /><span className="xoracle-sr-only">{c.ok ? t('xoracle.xiang.checkOk') : c.tip || t('xoracle.err.photo_unclear')}</span></span>}
                {p && !locked && <button type="button" className="xoracle-xiang-remove" disabled={disabled} aria-label={`${t('xoracle.xiang.remove')} · ${name}`} onClick={() => setPhoto(k, null)}>×</button>}
                {busy === k && <span className="xoracle-xiang-busy" aria-hidden="true" />}
              </div>
              <div className="xoracle-xiang-slot-name">{name}</div>
              {!locked && (
                <div className="xoracle-xiang-actions">
                  {touch ? (
                    <label className="xoracle-xiang-btn">
                      <Glyph name="camera" /><span>{t('xoracle.xiang.take')}</span>
                      <input type="file" accept="image/*" capture={k === 'face' ? 'user' : 'environment'} disabled={disabled} aria-label={`${t('xoracle.xiang.take')} · ${name}`} onChange={e => { void take(k, e.target.files?.[0]); e.target.value = '' }} />
                    </label>
                  ) : <button type="button" className="xoracle-xiang-btn" disabled={disabled} aria-label={`${t('xoracle.xiang.take')} · ${name}`} onClick={() => setCamera(k)}><Glyph name="camera" /><span>{t('xoracle.xiang.take')}</span></button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {said.length > 0 && (
        <ul className="xoracle-xiang-said">
          {said.map(s => (
            <li key={s.k} className={s.ok ? 'is-ok' : 'is-bad'} role={s.ok ? undefined : 'alert'}><Glyph name={s.ok ? 'check' : 'alert'} /><span><b>{t(`xoracle.xiang.slot.${s.k}`)}</b> {s.text}</span></li>
          ))}
        </ul>
      )}
      {camera && <XiangCamera k={camera} onClose={closeCamera} onShot={f => { const k = camera; setCamera(null); void take(k, f) }} />}
    </div>
  )
}

/** A person's row above their tiles: the name, then gender and dominant hand
 *  as two small choices (native radios) in one line (owner, Oct 9: "moving
 *  gender selection and dominate hand next to 你 and 對方 選填? so one row and
 *  make the buttons smaller"); `name` keeps the two people's groups apart. */
function XiangPersonHead({ who, label, tag, labelId, name, gender, setGender, dominant, setDominant, disabled }: {
  who: 'me' | 'partner'; label: string; tag?: string; labelId: string; name: string
  gender: 'male' | 'female'; setGender: (g: 'male' | 'female') => void; dominant: 'right' | 'left'; setDominant: (h: 'right' | 'left') => void; disabled: boolean
}) {
  const { t } = useLang()
  const option = (group: string, value: string, on: boolean, set: () => void, text: string) => (
    <label key={value}><input type="radio" name={group} value={value} checked={on} onChange={set} disabled={disabled} /><span>{text}</span></label>
  )
  return (
    <div className={'xoracle-xiang-head is-' + who}>
      <div className="xoracle-xiang-head-name" id={labelId}>{label}{tag && <small>{tag}</small>}</div>
      <fieldset className="xoracle-xiang-seg is-inline">
        <legend className="xoracle-sr-only">{label} · {t('xoracle.xiang.gender')}</legend>
        <span className="xoracle-xiang-seg-cap" aria-hidden="true">{t('xoracle.xiang.gender')}</span>
        <div className="xoracle-xiang-seg-opts">
          {option(`${name}-gender`, 'male', gender === 'male', () => setGender('male'), t('xoracle.male'))}
          {option(`${name}-gender`, 'female', gender === 'female', () => setGender('female'), t('xoracle.female'))}
        </div>
      </fieldset>
      <fieldset className="xoracle-xiang-seg is-inline">
        <legend className="xoracle-sr-only">{label} · {t('xoracle.xiang.dominant')}</legend>
        <span className="xoracle-xiang-seg-cap" aria-hidden="true">{t('xoracle.xiang.dominant')}</span>
        {/* Left, then right, like the tiles (owner, Oct 6). */}
        <div className="xoracle-xiang-seg-opts">
          {option(`${name}-hand`, 'left', dominant === 'left', () => setDominant('left'), t('xoracle.xiang.hand.left'))}
          {option(`${name}-hand`, 'right', dominant === 'right', () => setDominant('right'), t('xoracle.xiang.hand.right'))}
        </div>
      </fieldset>
    </div>
  )
}

// ── The form ───────────────────────────────────────────────────────────────

/** The other person in a two-person reading: their photos, gender and hand,
 *  who they are to the visitor, and the visitor's word that they agreed (the
 *  chart route refuses without it). */
export type XiangPartnerFields = SlotsProps & {
  gender: 'male' | 'female'; setGender: (g: 'male' | 'female') => void; dominant: 'right' | 'left'; setDominant: (h: 'right' | 'left') => void
  relation: XiangRelation; setRelation: (r: XiangRelation) => void; consent: boolean; setConsent: (on: boolean) => void
  consentAria?: { invalid: boolean; describedBy?: string }
}

export function XiangForm({ photos, setPhoto, checks, gender, setGender, dominant, setDominant, onSignIn, disabled, photoAria, signedIn: given, partner, pair }: SlotsProps & {
  gender: 'male' | 'female'; setGender: (g: 'male' | 'female') => void; dominant: 'right' | 'left'; setDominant: (h: 'right' | 'left') => void
  onSignIn: () => void
  /** Known by the caller (a preview); otherwise asked of the session here. */
  signedIn?: boolean
  /** The other person, whose tiles always show on the right. */
  partner: XiangPartnerFields
  /** The reading is for two (the other person has a photo, or a reopened
   *  visit was for two): who they are and the consent tick show. */
  pair?: boolean
}) {
  const { t } = useLang()
  const live = useSignedIn()
  const locked = (given ?? live) === false
  const headId = useId(), meId = useId(), themId = useId()
  const me = t('xoracle.xiang.me'), them = t('xoracle.xiang.partner')
  return (
    <LockCtx.Provider value={locked}>
      <div className={'xoracle-xiang-form' + (locked ? ' is-locked' : '')}>
        <section className="xoracle-xiang-photos" aria-labelledby={headId}>
          <div className="xoracle-xiang-sechead">
            <h4 id={headId}>{t('xoracle.xiang.photos')}</h4>
            <p>{t('xoracle.xiang.photosHint')}</p>
          </div>
          <p className="xoracle-xiang-phototips">{t('xoracle.xiang.tut.photo.2')} {t('xoracle.xiang.tut.photo.3')}</p>
          {/* Both people always, no choice of mode (owner, Oct 9: "remove 看自己 看我們兩個 row";
              "you always show two sets. the left one is me and the right one is another person"),
              each person's name, gender and hand in one row above their tiles. The other
              person's photos are optional; with one, the reading is for two. */}
          <div className="xoracle-xiang-people">
            <XiangPersonHead who="me" label={me} labelId={meId} name="xiang" gender={gender} setGender={setGender} dominant={dominant} setDominant={setDominant} disabled={disabled} />
            <XiangSlots who="me" gender={gender} labelledBy={`${headId} ${meId}`} photos={photos} setPhoto={setPhoto} checks={checks} disabled={disabled} photoAria={photoAria} />
            <XiangPersonHead who="partner" label={them} tag={t('xoracle.xiang.optional')} labelId={themId} name="xiang-partner" gender={partner.gender} setGender={partner.setGender} dominant={partner.dominant} setDominant={partner.setDominant} disabled={partner.disabled} />
            <XiangSlots who="partner" gender={partner.gender} labelledBy={`${headId} ${themId}`} photos={partner.photos} setPhoto={partner.setPhoto} checks={partner.checks} disabled={partner.disabled} photoAria={partner.photoAria} />
            <span className="xoracle-xiang-rule" aria-hidden="true" />
            {pair && <XiangPartnerTerms {...partner} />}
          </div>
        </section>
        {locked && (
          <div className="xoracle-xiang-signin">
            <Glyph name="lock" /><span>{t('xoracle.xiang.signin')}</span>
            <button type="button" className="xoracle-dy-primary" onClick={onSignIn}>{t('auth.signin')}</button>
          </div>
        )}
        <XiangTutorial />
      </div>
    </LockCtx.Provider>
  )
}

/** Who the other person is to the visitor, and the tick that they agreed. */
function XiangPartnerTerms({ relation, setRelation, consent, setConsent, consentAria, disabled }: XiangPartnerFields) {
  const { t } = useLang()
  return (
    <section className="xoracle-xiang-partner" aria-label={t('xoracle.xiang.partner')}>
      <fieldset className="xoracle-xiang-seg is-chips">
        <legend>{t('xoracle.xiang.relation')}</legend>
        <div className="xoracle-xiang-seg-opts">
          {RELATIONS.map(r => (
            <label key={r}><input type="radio" name="xiang-relation" value={r} checked={relation === r} disabled={disabled} onChange={() => setRelation(r)} /><span>{t(`xoracle.xiang.rel.${r}`)}</span></label>
          ))}
        </div>
      </fieldset>
      <label className={'xoracle-xiang-consent' + (consentAria?.invalid ? ' is-bad' : '')}>
        <input type="checkbox" checked={consent} disabled={disabled} onChange={e => setConsent(e.target.checked)}
          aria-invalid={consentAria?.invalid || undefined} aria-describedby={consentAria?.invalid ? consentAria.describedBy : undefined} />
        <span>{t('xoracle.xiang.consent')}</span>
      </label>
    </section>
  )
}

// ── Drawing (the face only: palm lines are described, not drawn) ───────────

const svgPath = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')

type Label = { x: number; y: number; text: string; color: string }
type Shape = { kind: 'line'; pts: Pt[]; color: string; dashed?: boolean } | { kind: 'dot'; at: Pt; color: string }

/** What to draw on a face photo, in the photo's 0-1000 space. */
function marksOf(f: FaceReading, t: (k: string) => string): { shapes: Shape[]; labels: Label[] } {
  const shapes: Shape[] = [], labels: Label[] = []
  const m = f.marks
  const [x1, , x2] = f.box ?? [150, 0, 850, 0]
  const levels = (['hairline', 'brow', 'noseBase', 'chin'] as const).map(k => m[k]?.[1] ?? null)
  levels.forEach(y => { if (y !== null) shapes.push({ kind: 'line', pts: [[x1, y], [x2, y]], color: ZONE_COLOR, dashed: true }) })
  const zones = ['upper', 'middle', 'lower'] as const
  zones.forEach((z, i) => {
    const a = levels[i], b = levels[i + 1]
    if (a !== null && b !== null) labels.push({ x: Math.min(x2 + 40, 955), y: (a + b) / 2, text: t(`xoracle.xiang.zone.${z}`), color: '#8a6d00' })
  })
  const spot = (k: keyof typeof m, label: string, dx = 0, dy = -45) => { const p = m[k]; if (p) { shapes.push({ kind: 'dot', at: p, color: '#e53935' }); if (label) labels.push({ x: p[0] + dx, y: p[1] + dy, text: label, color: '#b71c1c' }) } }
  spot('yintang', t('xoracle.xiang.mark.yintang'), 0, -40)
  spot('leftEye', '', 0, 0); spot('rightEye', t('xoracle.xiang.mark.eyes'), 70, -10)
  spot('nose', t('xoracle.xiang.mark.nose'), 70, 0)
  spot('mouth', t('xoracle.xiang.mark.mouth'), 80, 0)
  return { shapes, labels }
}

function XiangDrawing({ photo, part, alt }: { photo: XiangPhoto; part: FaceReading; alt: string }) {
  const { t } = useLang()
  const { shapes, labels } = marksOf(part, t)
  return (
    <div className="xoracle-xiang-drawing" style={{ aspectRatio: `${photo.w} / ${photo.h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={alt} />
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {shapes.map((s, i) => s.kind === 'line' ? (
          <g key={i}>
            <path d={svgPath(s.pts)} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={svgPath(s.pts)} fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round" strokeDasharray={s.dashed ? '8 6' : undefined} vectorEffect="non-scaling-stroke" />
          </g>
        ) : null)}
      </svg>
      {/* Dots as page elements: in the stretched drawing a circle would be an oval. */}
      {shapes.map((s, i) => s.kind === 'dot' ? <span key={i} className="xoracle-xiang-dot" style={{ left: `${s.at[0] / 10}%`, top: `${s.at[1] / 10}%`, background: s.color }} /> : null)}
      {labels.map((l, i) => <span key={i} className="xoracle-xiang-tag" style={{ left: `${l.x / 10}%`, top: `${l.y / 10}%`, color: l.color }}>{l.text}</span>)}
    </div>
  )
}

/** One of the 相盤's pictures: a face (with its marks once read) or a palm (its lines). */
type Shown = { id: string; key: XiangPhotoKey; photo: XiangPhoto; face?: FaceReading; caption: string }

/** The 相盤's pictures side by side, as one image to keep or share; made here,
 *  from the photos this browser holds. */
async function xiangImage(items: Shown[], t: (k: string) => string, title: string): Promise<Blob | null> {
  if (!items.length) return null
  const H = items.length > 3 ? 700 : 1000, pad = 24, foot = 84
  const imgs = await Promise.all(items.map(p => new Promise<HTMLImageElement>((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = p.photo.url })))
  const widths = items.map(p => Math.round(H * p.photo.w / p.photo.h))
  const W = widths.reduce((a, b) => a + b, 0) + pad * (items.length + 1)
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H + pad * 2 + foot
  const g = canvas.getContext('2d')!
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height)
  const chip = (text: string, x: number, y: number, color: string, align: 'center' | 'left') => {
    const tw = g.measureText(text).width, left = align === 'center' ? x - tw / 2 - 10 : x
    g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); (g as any).roundRect?.(left, y - 18, tw + 20, 36, 18) ?? g.rect(left, y - 18, tw + 20, 36); g.fill()
    g.fillStyle = color; g.fillText(text, left + 10 + tw / 2, y + 1)
  }
  let x0 = pad
  items.forEach((p, i) => {
    const w = widths[i], sx = w / 1000, sy = H / 1000
    g.save(); g.translate(x0, pad)
    g.drawImage(imgs[i], 0, 0, w, H)
    if (p.face) {
      const { shapes, labels } = marksOf(p.face, t)
      for (const s of shapes) {
        if (s.kind === 'dot') { g.beginPath(); g.arc(s.at[0] * sx, s.at[1] * sy, 7, 0, Math.PI * 2); g.fillStyle = s.color; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); continue }
        const path = () => { g.beginPath(); s.pts.forEach(([x, y], j) => (j ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy))) }
        g.setLineDash([]); g.lineCap = 'round'
        path(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 9; g.stroke()
        path(); g.strokeStyle = s.color; g.lineWidth = 4.5; if (s.dashed) g.setLineDash([14, 10]); g.stroke(); g.setLineDash([])
      }
      g.font = '600 26px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
      for (const l of labels) chip(l.text, l.x * sx, l.y * sy, l.color, 'center')
    }
    g.font = '700 28px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    chip(p.caption, 16, 34, '#141414', 'left')
    g.restore()
    x0 += w + pad
  })
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'
  g.fillStyle = '#141414'; g.font = '700 30px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  g.fillText(title, pad, H + pad * 2 + 40)
  g.fillStyle = '#6b6b6b'; g.font = '400 22px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif'
  g.fillText(t('xoracle.xiang.drawnBy'), pad, H + pad * 2 + 72)
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9))
}

/** One 相盤 picture, large: the tiles are the placeholders' size (owner, Oct 9:
 *  "the analysis results images are too big. we should use the same size as
 *  the placeholder"), too small for the face's labels. */
function XiangZoom({ item, onClose }: { item: Shown; onClose: () => void }) {
  const { t } = useLang()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal() }, [])
  const width = Math.round(Math.min(window.innerWidth * 0.86, 640, (window.innerHeight * 0.72 * item.photo.w) / item.photo.h))
  return (
    <dialog ref={ref} className="xoracle-xiang-zoom" aria-label={item.caption} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) ref.current?.close() }}>
      <div className="xoracle-xiang-zoom-body">
        <div style={{ width }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.face ? <XiangDrawing photo={item.photo} part={item.face} alt={item.caption} /> : <img className="xoracle-xiang-zoom-img" src={item.photo.url} alt={item.caption} style={{ aspectRatio: `${item.photo.w} / ${item.photo.h}` }} />}
        </div>
        <div className="xoracle-xiang-zoom-bar">
          <b>{item.caption}</b>
          <button type="button" className="xoracle-xiang-btn is-plain" onClick={() => ref.current?.close()}>{t('xoracle.xiang.close')}</button>
        </div>
      </div>
    </dialog>
  )
}

// ── The 相盤: the drawn faces, the words, the visitor's corrections ────────

export function XiangBoard({ chart, photos, partnerPhotos = {}, note, setNote, disabled }: { chart: XiangChart; photos: XiangPhotos; partnerPhotos?: XiangPhotos; note: string; setNote: (s: string) => void; disabled?: boolean }) {
  const { t } = useLang()
  const [saving, setSaving] = useState(false)
  const noteId = useId()
  const pair = !!chart.partner
  const people: Array<{ id: string; person: XiangPerson; photos: XiangPhotos; label: string }> = [
    { id: 'me', person: chart, photos, label: t('xoracle.xiang.me') },
    ...(chart.partner ? [{ id: 'partner', person: chart.partner, photos: partnerPhotos, label: t('xoracle.xiang.partner') }] : []),
  ]
  const title = (label: string, k: XiangPhotoKey) => (pair ? `${label} · ${t(`xoracle.xiang.board.${k}`)}` : t(`xoracle.xiang.board.${k}`))
  const hasReading = people.some(p => KEYS.some(k => p.person[k]))
  // Every photo there is, face and palms (owner, Oct 9: "face + palms"): the face
  // with its marks once read, a palm as its lines.
  const shown: Shown[] = people.flatMap(p => KEYS.filter(k => p.photos[k]).map(k => {
    const photo = p.photos[k]!
    return { id: `${p.id}-${k}`, key: k, photo: photo.linePhoto ? { ...photo, url: photo.linePhoto } : photo, face: k === 'face' ? p.person.face ?? undefined : undefined, caption: title(p.label, k) }
  }))
  const [zoom, setZoom] = useState<Shown | null>(null)
  const save = async () => {
    setSaving(true)
    try {
      const name = `${t('xoracle.site.brand')} · ${t('xoracle.site.focus.guanxiang.name')}`
      const blob = await xiangImage(shown, t, name)
      if (!blob) return
      const file = new File([blob], 'xoracle-guanxiang.jpg', { type: 'image/jpeg' })
      // A phone shares (Save Image is in that sheet); elsewhere, a download.
      if ((navigator as any).canShare?.({ files: [file] })) { await (navigator as any).share({ files: [file] }).catch(() => {}); return }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = file.name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } finally { setSaving(false) }
  }
  return (
    <div className="xoracle-xiang-board">
      {shown.length > 0 && (
        <div className={'xoracle-xiang-results' + (pair ? ' is-pair' : '')}>
          {people.map(p => {
            const mine = shown.filter(s => s.id.startsWith(`${p.id}-`))
            return (
              <div key={p.id} className="xoracle-xiang-results-person">
                {pair && <div className="xoracle-xiang-head-name">{p.label}</div>}
                <div className="xoracle-xiang-slots">
                  {mine.map(s => (
                    <button key={s.id} type="button" className="xoracle-xiang-result" onClick={() => setZoom(s)} aria-label={`${s.caption} · ${t('xoracle.xiang.zoom')}`}>
                      <span className="xoracle-xiang-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {s.face ? <XiangDrawing photo={s.photo} part={s.face} alt="" /> : <img className="is-photo" src={s.photo.url} alt="" />}
                      </span>
                      <span className="xoracle-xiang-slot-name">{t(`xoracle.xiang.slot.${s.key}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {zoom && <XiangZoom item={zoom} onClose={() => setZoom(null)} />}
      {shown.length > 0
        ? <div className="xoracle-xiang-savebar"><span>{t('xoracle.xiang.drawnBy')}</span><button type="button" className="xoracle-dy-primary" onClick={() => void save()} disabled={saving}>{t('xoracle.xiang.save')}</button></div>
        : hasReading ? <p className="xoracle-xiang-privacy">{t('xoracle.xiang.nophoto')}</p> : null}
      <div className="xoracle-xiang-words">
        {people.flatMap(p => KEYS.filter(k => p.person[k]).map(k => {
          const part = p.person[k]!
          return (
            <section key={p.id + k}>
              <h3>{title(p.label, k)}</h3>
              {part.summary && <p className="xoracle-xiang-summary">{part.summary}</p>}
              <dl>{part.features.map((f, i) => <div key={i}><dt>{f.part}</dt><dd>{f.text}</dd></div>)}</dl>
            </section>
          )
        }))}
      </div>
      <label className="xoracle-xiang-note" htmlFor={noteId}>{t('xoracle.xiang.note')}</label>
      <textarea id={noteId} className="xoracle-xiang-notebox" value={note} rows={2} maxLength={400} disabled={disabled}
        placeholder={t('xoracle.xiang.notePh')} onChange={e => setNote(e.target.value.slice(0, 400))} />
    </div>
  )
}
