'use client'
// app/components/xtell/ShareButton.tsx — 分享 (owner, Sep 28): one button that
// makes a picture of a reading (or a stick, today's fortune, the almanac)
// and a link to that temple.
//
// The picture is drawn here, on the visitor's own device, with its own fonts:
// no server, no model, nothing uploaded or published. It carries the result
// only; the birth details and the question never go on it, and a teacher's
// reply has any date or time masked (lib/xtell-share.ts). The dialog shows
// the picture before anything leaves, and sharing is the phone's own share
// sheet (LINE, IG, Threads…); a computer downloads the PNG and copies the link.
// The link opens the temple (`?t=`), carries the sharer's referral code, and
// is tagged utm_source=share for the visit log. A QR code puts the link on
// the picture itself, where Instagram does not let a link be tapped.
// Each press in the dialog is counted (Oct 1, supabase/122): what was shared,
// how, and whether the share sheet was completed; never which app.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../../../lib/i18n'
import { SITE_COOKIE, siteOfHost } from '../../../lib/site'
import { shareUrl } from '../../../lib/xtell-share'
import { countShare, type ShareLog, type ShareMethod, type ShareOutcome } from '../../../lib/xtell-feedback'
import { TEMPLE_ART, type TempleKey } from './TempleArtwork'

export type ShareSpec = {
  /** The room whose icon heads the picture; null: none. */
  icon: TempleKey | null
  /** The room the link opens; null: the street. */
  link: TempleKey | null
  title: string
  kicker?: string
  /** Paragraphs. A '\n' inside one is a line break. */
  body: string[]
  /** 'poem': a stick's verse, large and centred. */
  style: 'prose' | 'poem'
  /** The file name, without extension. */
  name: string
  /** What the share counter records about this picture. */
  log?: ShareLog
}

// ── The referral code (signed-in visitors only) ────────────────────────────
let refCode: Promise<string | null> | null = null
function myRefCode(): Promise<string | null> {
  refCode ??= fetch('/api/referral').then(r => r.ok ? r.json() : null)
    .then(d => typeof d?.code === 'string' ? d.code as string : null).catch(() => null)
  // Not signed in yet (or a failure): ask again next time.
  return refCode.then(c => { if (!c) refCode = null; return c })
}

function shareOrigin(): string {
  const cookie = document.cookie.match(new RegExp('(?:^|; )' + SITE_COOKIE + '=([^;]*)'))?.[1] ?? null
  return siteOfHost(window.location.host, cookie) === 'xtell' ? window.location.origin : 'https://xtell.modelxd.com'
}

// ── Drawing ────────────────────────────────────────────────────────────────
const W = 1080, H = 1350, M = 88

// Ideographs and kana break anywhere; Latin and Hangul break at spaces.
const SOLO = /[⺀-⿿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/
const TOKEN = /[⺀-⿿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]|[^\s⺀-⿿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]+|\s+/g
// Never at the start of a line (a comma, a closing bracket…).
const NO_START = /^[，。、；：！？」』）〉》】,.;:!?)\]…％%]/

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const tok of para.match(TOKEN) ?? []) {
      if (!line && /^\s+$/.test(tok)) continue
      const next = line + tok
      if (!line || ctx.measureText(next).width <= max || NO_START.test(tok)) line = next
      else if (/^\s+$/.test(tok)) { lines.push(line.trimEnd()); line = '' }
      else { lines.push(line.trimEnd()); line = tok }
      // One word wider than the line (a long URL): split it by characters.
      while (ctx.measureText(line).width > max * 1.04 && line.length > 1 && !SOLO.test(line)) {
        let i = line.length - 1
        while (i > 1 && ctx.measureText(line.slice(0, i)).width > max) i--
        lines.push(line.slice(0, i)); line = line.slice(i)
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

function ellipsize(ctx: CanvasRenderingContext2D, line: string, max: number): string {
  let s = line.replace(/[。．.，,、；;：:\s…]+$/, '')
  while (s && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src
})

async function drawIcon(ctx: CanvasRenderingContext2D, key: TempleKey, x: number, y: number, size: number): Promise<boolean> {
  const art = TEMPLE_ART[key]
  try {
    if (art.src) { ctx.drawImage(await loadImage(art.src.icon), x, y, size, size); return true }
    const sheet = await loadImage('/xtell/approved/icons.avif')
    const tw = sheet.naturalWidth / 5, th = sheet.naturalHeight / 2
    ctx.drawImage(sheet, (art.index % 5) * tw, art.index < 5 ? 0 : th, tw, th, x, y, size, size)
    return true
  } catch { return false }
}

async function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number, ink: string) {
  const qrcode = (await import('qrcode-generator')).default
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  const cell = Math.floor(size / (n + 4))
  const s = cell * (n + 4), ox = x + (size - s), oy = y + (size - s)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(ox, oy, s, s)
  ctx.fillStyle = ink
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(ox + (c + 2) * cell, oy + (r + 2) * cell, cell, cell)
}

export async function drawShareCard(spec: ShareSpec, url: string, brand: string, tagline: string): Promise<Blob> {
  const css = getComputedStyle(document.body)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const paper = v('--xtell-paper', '#faf9f6'), ink = v('--xtell-ink', '#292b29'), secondary = v('--xtell-secondary', '#656761')
  const rule = v('--xtell-rule', '#dedfd8'), vermilion = v('--xtell-vermilion', '#a6382e')
  const serif = v('--xtell-serif', 'serif'), sans = css.fontFamily || 'sans-serif'

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = rule
  ctx.lineWidth = 2
  ctx.strokeRect(36, 36, W - 72, H - 72)
  ctx.textBaseline = 'alphabetic'

  // Head: the temple's icon, its name, the line under it.
  const ICON = 150
  const iconDrawn = spec.icon ? await drawIcon(ctx, spec.icon, M, M, ICON) : false
  const tx = iconDrawn ? M + ICON + 36 : M
  ctx.fillStyle = ink
  ctx.font = `700 64px ${serif}`
  ctx.fillText(ellipsizeIfLong(ctx, spec.title, W - M - tx), tx, M + (spec.kicker ? 72 : 100))
  if (spec.kicker) {
    ctx.fillStyle = secondary
    ctx.font = `400 32px ${sans}`
    ctx.fillText(ellipsizeIfLong(ctx, spec.kicker, W - M - tx), tx, M + 130)
  }
  const headBottom = M + ICON
  ctx.fillStyle = vermilion
  ctx.fillRect(M, headBottom + 44, 72, 4)

  // Foot: brand, tagline and address on the left, the QR code on the right.
  const QR = 196
  const footTop = H - M - QR
  ctx.fillStyle = rule
  ctx.fillRect(M, footTop - 40, W - 2 * M, 2)
  ctx.fillStyle = ink
  ctx.font = `400 50px ${serif}`
  ctx.fillText(brand, M, footTop + 62)
  ctx.fillStyle = secondary
  ctx.font = `400 28px ${sans}`
  ctx.fillText(tagline, M, footTop + 116)
  ctx.fillStyle = vermilion
  ctx.font = `600 30px ${sans}`
  ctx.fillText(new URL(url).host, M, footTop + 172)
  try { await drawQr(ctx, url, W - M - QR, footTop, QR, ink) } catch { /* the address is printed anyway */ }

  // Body: the largest size at which it fits; at the smallest, cut with …
  const box = { x: M, y: headBottom + 100, w: W - 2 * M, h: footTop - 40 - 60 - (headBottom + 100) }
  const poem = spec.style === 'poem'
  const sizes = poem ? [76, 68, 60, 52, 46] : [50, 46, 42, 38, 35]
  for (const size of sizes) {
    ctx.font = poem ? `700 ${size}px ${serif}` : `400 ${size}px ${sans}`
    const lh = size * (poem ? 1.62 : 1.72), gap = poem ? 0 : size * 0.6
    // A paragraph that opens with a short label and a full-width space
    // (「宜　嫁娶、…」) hangs its lines under the text, the label in vermilion.
    const paras = spec.body.map(p => {
      const m = poem ? null : p.match(/^([^\s　]{1,4})　([\s\S]+)$/)
      const indent = m ? ctx.measureText(m[1] + '　').width : 0
      return { label: m?.[1] ?? null, indent, lines: wrap(ctx, m ? m[2] : p, box.w - indent) }
    })
    const height = paras.reduce((h, p) => h + p.lines.length * lh, 0) + gap * Math.max(0, paras.length - 1)
    if (height > box.h && size !== sizes[sizes.length - 1]) continue
    ctx.textAlign = poem ? 'center' : 'left'
    const x = poem ? W / 2 : box.x
    let y = box.y + Math.max(0, (box.h - height) * (poem ? 0.5 : 0.35)) + size
    const last = box.y + box.h
    outer: for (let pi = 0; pi < paras.length; pi++) {
      const { label, indent, lines } = paras[pi]
      if (label) { ctx.fillStyle = vermilion; ctx.fillText(label, x, y) }
      ctx.fillStyle = ink
      for (let li = 0; li < lines.length; li++) {
        const tooFar = y + lh > last + size * 0.3
        const more = li < lines.length - 1 || pi < paras.length - 1
        if (tooFar && more) { ctx.fillText(ellipsize(ctx, lines[li], box.w - indent), x + indent, y); break outer }
        ctx.fillText(lines[li], x + indent, y)
        y += lh
      }
      y += gap
    }
    ctx.textAlign = 'left'
    break
  }

  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/png'))
}

function ellipsizeIfLong(ctx: CanvasRenderingContext2D, s: string, max: number) {
  return ctx.measureText(s).width <= max ? s : ellipsize(ctx, s, max)
}

// ── The button and its dialog ──────────────────────────────────────────────
export function ShareButton({ spec, className = '' }: { spec: () => ShareSpec; className?: string }) {
  const { t } = useLang()
  const [open, setOpen] = useState<ShareSpec | null>(null)
  return <>
    <button type="button" className={'xtell-share-btn ' + className} aria-haspopup="dialog" onClick={() => setOpen(spec())}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </svg>
      {t('xtell.share.button')}
    </button>
    {open && createPortal(<ShareDialog spec={open} onClose={() => setOpen(null)} />, document.body)}
  </>
}

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error)
  r.readAsDataURL(b)
})

function ShareDialog({ spec, onClose }: { spec: ShareSpec; onClose: () => void }) {
  const { t } = useLang()
  const [state, setState] = useState<'making' | 'ready' | 'failed'>('making')
  const [file, setFile] = useState<File | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const brand = t('xtell.site.brand')

  useEffect(() => {
    let live = true
    setState('making')
    ;(async () => {
      const code = await myRefCode()
      const link = shareUrl(shareOrigin(), spec.link, code)
      const blob = await drawShareCard(spec, link, brand, t('xtell.share.tagline'))
      // A data: URL, not a blob: one, so a long press on the picture can
      // save it in more browsers (in-app browsers among them).
      const dataUrl = await blobToDataUrl(blob)
      if (!live) return
      setRef(code); setUrl(link); setImg(dataUrl)
      setFile(new File([blob], `${spec.name}.png`, { type: 'image/png' }))
      setState('ready')
    })().catch(() => { if (live) setState('failed') })
    return () => { live = false }
  }, [spec, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { if (state !== 'making') panel.current?.querySelector<HTMLButtonElement>('.xtell-share-actions button')?.focus() }, [state])

  const canShare = !!file && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  const count = (method: ShareMethod, outcome: ShareOutcome) => { if (spec.log) countShare(spec.log, method, outcome) }
  // The sheet says completed or closed (AbortError), never where it went.
  const sheet = (data: ShareData, method: ShareMethod) =>
    navigator.share(data).then(() => count(method, 'done'), (e: unknown) => count(method, (e as Error)?.name === 'AbortError' ? 'cancelled' : 'failed'))
  const share = () => { if (file) void sheet({ files: [file], text: `${spec.title}｜${brand}\n${url}` }, 'share') }
  // Saving to Photos (owner, Oct 1: "the image cannot be saved to Photo").
  // An iPhone saves a picture only from the share sheet's 「儲存影像」, and
  // that line is missing when text rides along with the file, as it does
  // in 分享…: so 存到相簿 shares the picture alone. An <a download> on an
  // iPhone goes to Files, not Photos. Elsewhere (Android, computers) the
  // download lands in the gallery or the Downloads folder.
  const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const ios = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  const save = () => {
    if (ios && file && canShare) void sheet({ files: [file] }, 'save')
    else { download(); count('download', 'done') }
  }
  const download = () => {
    if (!img) return
    const a = document.createElement('a')
    a.href = img; a.download = `${spec.name}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  const copy = () => {
    if (!navigator.clipboard) { count('copy', 'failed'); return }
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); count('copy', 'done') }).catch(() => count('copy', 'failed'))
  }

  return (
    <div className="xtell-tp-backdrop" onClick={onClose}>
      <div ref={panel} className="xtell-tp xtell-share" role="dialog" aria-modal="true" aria-labelledby="xtell-share-title" onClick={e => e.stopPropagation()}>
        <div className="xtell-tp-head">
          <h2 id="xtell-share-title">{t('xtell.share.title')}</h2>
          <p>{t('xtell.share.notePrivate')}</p>
        </div>
        <div className="xtell-share-body">
          {state === 'making' && <p role="status" className="xtell-share-status">{t('xtell.share.making')}</p>}
          {state === 'failed' && <p role="alert" className="xtell-share-status">{t('xtell.share.failed')} <button type="button" className="xtell-dy-link" onClick={() => setAttempt(n => n + 1)}>{t('xtell.site.retry')}</button></p>}
          {state === 'ready' && img && <img className="xtell-share-img" src={img} alt={spec.title} />}
          {state === 'ready' && phone && <p className="xtell-share-hint">{t('xtell.share.longpress')}</p>}
          {state === 'ready' && ref && <p className="xtell-share-ref">{t('xtell.share.noteRef')}</p>}
        </div>
        <div className="xtell-share-actions">
          {state === 'ready' && <button type="button" className="xtell-button" onClick={save}>{t(phone ? 'xtell.share.save' : 'xtell.share.download')}</button>}
          {state === 'ready' && canShare && <button type="button" className="xtell-share-plain" onClick={share}>{t('xtell.share.send')}</button>}
          {state === 'ready' && <button type="button" className="xtell-share-plain" onClick={copy}>{copied ? t('xtell.share.copied') : t('xtell.share.copy')}</button>}
          <button type="button" className="xtell-share-plain" onClick={onClose}>{t('xtell.share.close')}</button>
        </div>
      </div>
    </div>
  )
}
