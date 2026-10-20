'use client'
// app/xcreate/MyVoices.tsx — 我的聲音, X創作's 語音 in your own voice (owner,
// Oct 20: "clone voice and ask the ai to speak some text with cloned
// voice"). Sits inside the prompt box when the From pick is 我的聲音: your
// voices as chips, and a recorder that opens in place (no dialog).
//
// Recording: the browser's own recorder (webm on Chrome, mp4 on Safari),
// turned into a WAV by lib/audio-normalize.ts because MiniMax takes only
// mp3 / m4a / wav. The person reads the page's passage aloud
// (lib/voice-passages.ts); /api/xcreate/voices checks the reading, clones
// the voice, and keeps nothing of the recording.

import { useEffect, useRef, useState } from 'react'
import { normalizeAudioForVideo } from '../../lib/audio-normalize'
import { MAX_SECONDS, MIN_SECONDS, PASSAGES, passageLang } from '../../lib/voice-passages'
import { InputIcon } from './recipes'

export type MyVoice = { id: string; name: string; lang: string | null; used: boolean; createdAt: string; lapsesAt: string | null }

type Props = {
  t: (k: string) => string
  lang: string
  signedIn: boolean
  onSignIn: () => void
  value: string | null
  onChange: (id: string | null) => void
  /** The list and the first-use fee, for the composer's estimate. */
  onVoices?: (voices: MyVoice[], feeUsd: number) => void
  disabled?: boolean
}

const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(String(x)), s)

export default function MyVoices({ t, lang, signedIn, onSignIn, value, onChange, onVoices, disabled }: Props) {
  const [voices, setVoices] = useState<MyVoice[] | null>(null)
  const [ready, setReady] = useState(true)
  const [max, setMax] = useState(5)
  const [fee, setFee] = useState(1.5)
  const [open, setOpen] = useState(false)
  const [askDelete, setAskDelete] = useState<string | null>(null)

  const load = async () => {
    const r = await fetch('/api/xcreate/voices', { cache: 'no-store' }).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    const list: MyVoice[] = j?.voices ?? []
    setVoices(list); setReady(j?.ready !== false)
    if (typeof j?.max === 'number') setMax(j.max)
    if (typeof j?.feeUsd === 'number') setFee(j.feeUsd)
    onVoices?.(list, typeof j?.feeUsd === 'number' ? j.feeUsd : fee)
    // Keep the pick when it still exists; otherwise the newest voice.
    if (!value || !list.some(v => v.id === value)) onChange(list[0]?.id ?? null)
    if (list.length === 0) setOpen(true)
  }
  useEffect(() => {
    if (signedIn) load()
    else { setVoices([]); onChange(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  const remove = async (id: string) => {
    setAskDelete(null)
    await fetch(`/api/xcreate/voices?id=${id}`, { method: 'DELETE' }).catch(() => null)
    await load()
  }

  const selected = voices?.find(v => v.id === value) ?? null
  const full = (voices?.length ?? 0) >= max

  if (!signedIn) {
    return (
      <div className="xcs-voices">
        <p className="xcs-voices-note">{t('myvoice.none')}</p>
        <button type="button" className="xcs-voices-chip add" onClick={onSignIn}>{t('myvoice.signin')}</button>
      </div>
    )
  }
  if (!ready) {
    return <div className="xcs-voices"><p className="xcs-voices-note">{t('myvoice.err.not_ready')}</p></div>
  }

  return (
    <div className="xcs-voices" style={{ opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : undefined }}>
      {((voices?.length ?? 0) > 0 || !open) && <div className="xcs-voices-row" role="radiogroup" aria-label={t('myvoice.label')}>
        <span className="xcs-voices-label">{t('myvoice.label')}</span>
        {(voices ?? []).map(v => (
          <span key={v.id} className={`xcs-voices-chip${v.id === value ? ' on' : ''}`}>
            <button type="button" role="radio" aria-checked={v.id === value} onClick={() => onChange(v.id)}>
              <InputIcon kind="mic" size={15} /><span>{v.name}</span>
            </button>
            <button type="button" className="x" aria-label={`${t('myvoice.delete')} ${v.name}`} onClick={() => setAskDelete(v.id)}>×</button>
          </span>
        ))}
        {!full && !open && (
          <button type="button" className="xcs-voices-chip add" onClick={() => setOpen(true)}>{t('myvoice.new')}</button>
        )}
      </div>}

      {askDelete && (() => {
        const v = voices?.find(x => x.id === askDelete)
        return v ? (
          <div className="xcs-voices-confirm">
            <span>{fill(t('myvoice.deleteq'), { name: v.name })}</span>
            <button type="button" className="danger" onClick={() => remove(v.id)}>{t('myvoice.delete')}</button>
            <button type="button" onClick={() => setAskDelete(null)}>{t('myvoice.cancel')}</button>
          </div>
        ) : null
      })()}

      {selected && !selected.used && (
        <p className="xcs-voices-note">
          {fill(t('myvoice.fee'), { fee: `$${fee.toFixed(2)}` })}
          {selected.lapsesAt ? ` · ${t('myvoice.lapses')}` : ''}
        </p>
      )}
      {full && <p className="xcs-voices-note">{fill(t('myvoice.err.too_many'), { max })}</p>}

      {open && !full && (
        <Recorder
          t={t} lang={lang} fee={fee} n={(voices?.length ?? 0) + 1}
          canClose={(voices?.length ?? 0) > 0}
          onClose={() => setOpen(false)}
          onMade={async v => { setOpen(false); await load(); onChange(v.id) }}
        />
      )}
    </div>
  )
}

function Recorder({ t, lang, fee, n, canClose, onClose, onMade }: {
  t: (k: string) => string; lang: string; fee: number; n: number; canClose: boolean
  onClose: () => void; onMade: (v: MyVoice) => void
}) {
  const pl = passageLang(lang)
  const [consent, setConsent] = useState(false)
  const [name, setName] = useState(fill(t('myvoice.rec.defaultname'), { n }))
  const [state, setState] = useState<'idle' | 'recording' | 'done' | 'sending'>('idle')
  const [secs, setSecs] = useState(0)
  const [wav, setWav] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const started = useRef(0)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopAll = () => {
    if (tick.current) clearInterval(tick.current)
    tick.current = null
    stream.current?.getTracks().forEach(tr => tr.stop())
    stream.current = null
  }
  useEffect(() => () => { stopAll(); if (url) URL.revokeObjectURL(url) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setErr(null)
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch { setErr(t('myvoice.err.mic')); return }
    stream.current = s
    const chunks: BlobPart[] = []
    const mr = new MediaRecorder(s)
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = async () => {
      stopAll()
      const type = mr.mimeType || 'audio/webm'
      const raw = new File([new Blob(chunks, { type })], `voice.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type })
      const norm = await normalizeAudioForVideo(raw, MAX_SECONDS, { mono: true })
      if (!norm || norm.file.type !== 'audio/wav') { setErr(t('myvoice.err.decode')); setState('idle'); return }
      setWav(norm.file)
      setSecs(Math.round(norm.durationSeconds))
      setUrl(old => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(norm.file) })
      setState('done')
    }
    rec.current = mr
    started.current = Date.now()
    setSecs(0); setWav(null); setState('recording')
    mr.start()
    tick.current = setInterval(() => {
      const s2 = (Date.now() - started.current) / 1000
      setSecs(Math.floor(s2))
      if (s2 >= MAX_SECONDS) mr.state === 'recording' && mr.stop()
    }, 250)
  }
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop() }

  const send = async () => {
    if (!wav) return
    setState('sending'); setErr(null)
    const fd = new FormData()
    fd.append('audio', wav)
    fd.append('name', name.trim().slice(0, 30))
    fd.append('lang', pl)
    fd.append('consent', consent ? '1' : '0')
    const r = await fetch('/api/xcreate/voices', { method: 'POST', body: fd }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (r?.ok && j?.voice) { onMade(j.voice); return }
    const code = String(j?.code ?? 'other')
    const known = ['reading_mismatch', 'too_short', 'too_many', 'daily_cap', 'not_ready', 'flagged', 'bad_audio']
    setErr(fill(t(`myvoice.err.${known.includes(code) ? code : 'other'}`), { min: MIN_SECONDS, max: j?.max ?? 5 }))
    setState('done')
  }

  const short = state === 'done' && secs < MIN_SECONDS
  return (
    <div className="xcs-rec">
      <div className="xcs-rec-head">
        <strong>{t('myvoice.rec.title')}</strong>
        {canClose && state !== 'recording' && state !== 'sending' && (
          <button type="button" className="xcs-rec-close" onClick={onClose} aria-label={t('myvoice.rec.close')}>×</button>
        )}
      </div>
      <p className="xcs-rec-rule">{fill(t('myvoice.rec.rule'), { min: MIN_SECONDS, max: MAX_SECONDS })}</p>
      <blockquote className="xcs-rec-passage" lang={pl}>{PASSAGES[pl]}</blockquote>

      <div className="xcs-rec-controls">
        {state === 'recording' ? (
          <button type="button" className="xcs-rec-btn stop" onClick={stop}>{t('myvoice.rec.stop')}</button>
        ) : (
          <button type="button" className="xcs-rec-btn" onClick={start} disabled={state === 'sending'}>
            {state === 'idle' ? t('myvoice.rec.start') : t('myvoice.rec.again')}
          </button>
        )}
        {(state === 'recording' || state === 'done' || state === 'sending') && (
          <span className={`xcs-rec-time${state === 'recording' ? ' live' : ''}`}>
            0:{String(Math.min(secs, MAX_SECONDS)).padStart(2, '0')} / 0:{MAX_SECONDS}
          </span>
        )}
      </div>
      {state === 'recording' && secs < MIN_SECONDS && (
        <p className="xcs-rec-hint">{fill(t('myvoice.rec.short'), { min: MIN_SECONDS })}</p>
      )}
      {url && state !== 'recording' && <audio className="xcs-rec-play" src={url} controls preload="metadata" />}
      {short && <p className="xcs-rec-err">{fill(t('myvoice.err.too_short'), { min: MIN_SECONDS })}</p>}

      <label className="xcs-rec-consent">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>{t('myvoice.rec.consent')}</span>
      </label>
      <label className="xcs-rec-name">
        <span>{t('myvoice.rec.name')}</span>
        <input value={name} maxLength={30} onChange={e => setName(e.target.value)} />
      </label>

      {err && <p className="xcs-rec-err" role="alert">{err}</p>}
      <div className="xcs-rec-foot">
        <button type="button" className="xcs-rec-make"
          disabled={!wav || short || !consent || !name.trim() || state !== 'done'}
          onClick={send}>
          {state === 'sending' ? t('myvoice.rec.making') : t('myvoice.rec.make')}
        </button>
        <span className="xcs-rec-fee">{t('myvoice.rec.free')} {fill(t('myvoice.fee'), { fee: `$${fee.toFixed(2)}` })}</span>
      </div>
    </div>
  )
}
