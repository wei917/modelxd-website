'use client'
// app/xtalk/CharactersRoom.tsx — AI Characters, conversation-first (owner,
// Aug 7). Three views in one template: your roster, the builder, the chat.
// The character is a platform primitive (later seatable in games, later a
// creator on XSocial) — but it is born here, and this room is where the
// relationship lives. Memory is model-managed (see /api/xcharacter/chat);
// this client only renders what the server holds and fires the
// consolidation request when the server says it's due.

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang, useT } from '../../lib/i18n'
import ModelPickerDialog from '../components/ModelPickerDialog'
import ProviderLogo from '../components/ProviderLogo'
import YTCard from './YTCard'
import type { TemplateProps, Speaker } from './templates'

type CharRow = {
  id: string; name: string; avatar_path: string | null; persona: string
  appearance: string; model_id: string; thinking: string | null
  msg_count: number; last_chat_at: string | null
  photos: string[]; search: boolean
  voice: string | null; voice_desc: string | null; voice_rate: number | null
}

// Per-character speaking speed (owner, Aug 8): part of the character's
// identity, chosen in the builder, applied at playback (playbackRate,
// pitch-preserved) so it works for presets and designed voices alike.
const VOICE_RATES = [0.75, 1, 1.25, 1.5]
type Msg = { role: 'user' | 'character'; text: string; cost_usd?: number }

const supa = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)
// Web Speech recognition locale per site language. Stage 1 of voice
// (owner, Aug 8): browser STT — free, no server, works in Chrome/Safari;
// the button simply doesn't render where the API is missing (Firefox).
const SPEECH_LOCALE: Record<string, string> = {
  en: 'en-US', 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
}

// Stage 2 (owner, Aug 8): the character speaks. Qwen-TTS preset voices —
// ids are API values, descriptors from Alibaba's own catalog. All of them
// speak our five site languages. The ✨ option mints a NOVEL voice from a
// text description instead; cloning human samples is deliberately absent.
const VOICES: Array<{ id: string; desc: string }> = [
  { id: 'Cherry',  desc: 'sunny, friendly young woman' },
  { id: 'Serena',  desc: 'gentle young woman' },
  { id: 'Chelsie', desc: 'anime girlfriend' },
  { id: 'Momo',    desc: 'playful and mischievous' },
  { id: 'Vivian',  desc: 'confident, slightly feisty' },
  { id: 'Bunny',   desc: 'overflowing cuteness' },
  { id: 'Bellona', desc: 'powerful and dramatic' },
  { id: 'Elias',   desc: 'scholarly storyteller' },
  { id: 'Ethan',   desc: 'warm, energetic man' },
  { id: 'Vincent', desc: 'raspy, smoky man' },
  { id: 'Neil',    desc: 'news-anchor calm' },
]

const avatarUrl = (path: string | null) => path
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/x-characters/${path}`
  : null

// [[play: …]] — the character's one media ability (Aug 8). Complete
// directives become a player card; a partial one at the stream's tail is
// hidden so the syntax never flashes at the user mid-typing. Models also
// sometimes freelance a literal YouTube URL instead of the directive —
// catch those too and give them the same player (no search API needed,
// the id is right there).
const PLAY_RE = /\[\[play:\s*([^\]]{1,120})\]\]/
const YT_URL_RE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s)\]]*v=([\w-]{6,20})[^\s)\]]*|youtu\.be\/([\w-]{6,20})[^\s)\]]*)/
const splitPlay = (text: string): { clean: string; play: string | null; vid: string | null } => {
  const m = PLAY_RE.exec(text)
  const u = m ? null : YT_URL_RE.exec(text)
  const clean = text
    .replace(PLAY_RE, '')
    .replace(/\[\[play:[^\]]*$/, '')   // partial tail while streaming
    .replace(YT_URL_RE, '')
    .replace(/\n{3,}/g, '\n\n').trim()
  return { clean, play: m ? m[1].trim() : null, vid: u ? (u[1] ?? u[2] ?? null) : null }
}


/** Zoom-and-crop for the avatar (owner ask, Aug 8) — hand-rolled, no
 *  dependency: drag to position, slider to zoom, render to a 512px square
 *  canvas. The uploaded avatar is always the crop, never the raw file. */
function CropModal({ file, onDone, onCancel }: {
  file: File; onDone: (blob: Blob) => void; onCancel: () => void
}) {
  const t = useT()
  const VIEW = 280
  // Object URL lives in an effect, not useState: StrictMode's dev
  // mount-cleanup-remount would revoke a state-held URL and leave the
  // preview black (exactly what happened on first test, Aug 8).
  const [url, setUrl] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  // A memory-fast image can complete before React attaches onLoad.
  useEffect(() => {
    const im = imgRef.current
    if (url && im && im.complete && im.naturalWidth) setDims({ w: im.naturalWidth, h: im.naturalHeight })
  }, [url])

  // Cover-fit base scale; pan clamped so the square is always covered.
  const s0 = dims ? VIEW / Math.min(dims.w, dims.h) : 1
  const s = s0 * zoom
  const clampPan = (p: { x: number; y: number }) => {
    if (!dims) return p
    const maxX = Math.max(0, (dims.w * s - VIEW) / 2)
    const maxY = Math.max(0, (dims.h * s - VIEW) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) }
  }

  const confirm = () => {
    const img = imgRef.current
    if (!img || !dims) return
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const k = 512 / VIEW
    const drawW = dims.w * s * k, drawH = dims.h * s * k
    const offX = (512 - drawW) / 2 + pan.x * k
    const offY = (512 - drawH) / 2 + pan.y * k
    ctx.drawImage(img, offX, offY, drawW, drawH)
    canvas.toBlob(b => { if (b) onDone(b) }, 'image/png')
  }

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 99600, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 14, border: '1px solid var(--border2)', padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>{t('xc.crop')}</div>
        <div
          style={{ width: VIEW, height: VIEW, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--border2)', position: 'relative', touchAction: 'none', background: '#000' }}
          onPointerDown={e => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
          }}
          onPointerMove={e => {
            if (!drag.current) return
            setPan(clampPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }))
          }}
          onPointerUp={() => { drag.current = null }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url && <img
            ref={imgRef} src={url} alt="" draggable={false}
            onLoad={e => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{
              position: 'absolute', left: '50%', top: '50%',
              width: dims ? dims.w * s : undefined, height: dims ? dims.h * s : undefined,
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
              maxWidth: 'none', userSelect: 'none', pointerEvents: 'none',
            }}
          />}
        </div>
        <input
          type="range" min={1} max={3} step={0.01} value={zoom}
          onChange={e => { setZoom(Number(e.target.value)); setPan(p => clampPan(p)) }}
          style={{ width: '100%', marginTop: 14 }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button onClick={confirm} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t('xc.cropsave')}
          </button>
          <button onClick={onCancel} style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t('fb.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Call mode Phase A: the hands-free voice loop (owner, Aug 8) ──────────
// listen (continuous STT) → pause detected → chat turn (same API, same
// billing, same memory) → speak reply (character's own TTS voice) → listen
// again. The mic is HARD-stopped while she speaks: without headphones her
// voice would re-enter through the speakers and she'd transcribe herself.
// Phase B (Gemini Live realtime) becomes the second mode chip.
const CALL_PAUSE_MS = 1500   // silence that ends your utterance

// ── Live call (Phase B) plumbing: raw PCM in and out of Gemini Live ─────
// Input wants 16kHz PCM16 base64; output arrives as 24kHz PCM16 base64.
const LIVE_USD_PER_MIN = 0.023
const LIVE_MAX_MS = 9.5 * 60 * 1000   // hard stop before the 10-min session boundary

const pcm16ToB64 = (i16: Int16Array): string => {
  const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as any)
  }
  return btoa(bin)
}
const downTo16k = (f32: Float32Array, fromRate: number): Int16Array => {
  const ratio = fromRate / 16000
  const n = Math.floor(f32.length / ratio)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, f32[Math.floor(i * ratio)] ?? 0))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
const b64ToF32 = (b64: string): Float32Array => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const i16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2))
  const f = new Float32Array(i16.length)
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 0x8000
  return f
}

function CallOverlay({ char, lang, threadId, onEnd }: {
  char: CharRow; lang: string; threadId: string | null; onEnd: () => void
}) {
  const t = useT()
  type Phase = 'connecting' | 'listening' | 'thinking' | 'speaking'
  const [phase, setPhase] = useState<Phase>('listening')
  const [mode, setMode] = useState<'voice' | 'live'>('voice')
  const [caption, setCaption] = useState('')
  const [captionRole, setCaptionRole] = useState<'you' | 'her'>('you')
  const [cost, setCost] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const endedRef = useRef(false)
  const phaseRef = useRef<Phase>('listening')
  const modeRef = useRef<'voice' | 'live'>('voice')
  const mutedRef = useRef(false)
  const recRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pauseRef = useRef<any>(null)
  const wakeRef = useRef<any>(null)
  const finalsRef = useRef('')
  const startedAt = useRef(Date.now())
  // live-engine state
  const liveRef = useRef<any>(null)                 // Gemini Live session
  const micStreamRef = useRef<MediaStream | null>(null)
  const micCtxRef = useRef<AudioContext | null>(null)
  const outCtxRef = useRef<AudioContext | null>(null)
  const nextPlayRef = useRef(0)
  const srcListRef = useRef<AudioBufferSourceNode[]>([])
  const turnsRef = useRef<Array<{ role: 'user' | 'character'; text: string }>>([])
  const inTxtRef = useRef('')
  const outTxtRef = useRef('')
  const liveEnterRef = useRef(0)                    // live-mode stopwatch
  const liveAccumRef = useRef(0)
  const liveCapRef = useRef<any>(null)
  // One id per live SEGMENT, refreshed on every (re)connect: the server
  // dedupes 'end' by it (a single 8-min call was debited 3x when
  // concurrent end paths raced — owner ledger, Aug 12).
  const callIdRef = useRef('')
  const savingRef = useRef(false)
  const redialsRef = useRef(0)

  const setPh = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  useEffect(() => {
    // StrictMode's dev mount→cleanup→remount left endedRef poisoned true on
    // the second run, silencing every engine while the UI said "Listening…"
    // (found live, Aug 8). Reset on every effect run — refs survive remounts.
    endedRef.current = false
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    // Screen Wake Lock: a call in a car mount must not let the phone sleep.
    const lock = () => (navigator as any).wakeLock?.request('screen')
      .then((w: any) => { wakeRef.current = w }).catch(() => {})
    void lock()
    const onVis = () => { if (!document.hidden && !endedRef.current) void lock() }
    document.addEventListener('visibilitychange', onVis)
    // iPhone kills the page without ceremony (app switch, swipe-away): a
    // beacon survives page dismissal where fetch may not. The server's
    // callId dedupe makes this safe to race with a normal end.
    const onHide = () => {
      if (modeRef.current !== 'live' || endedRef.current) return
      const seconds = Math.round((liveAccumRef.current + (liveEnterRef.current ? Date.now() - liveEnterRef.current : 0)) / 1000)
      const turns = [...turnsRef.current]
      if (inTxtRef.current.trim()) turns.push({ role: 'user', text: inTxtRef.current.trim() })
      if (outTxtRef.current.trim()) turns.push({ role: 'character', text: outTxtRef.current.trim() })
      if (!turns.length && seconds < 5) return
      try {
        navigator.sendBeacon?.('/api/xcharacter/live', new Blob(
          [JSON.stringify({ action: 'end', characterId: char.id, turns, seconds, callId: callIdRef.current, ...(threadId ? { threadId } : {}) })],
          { type: 'application/json' },
        ))
      } catch {}
    }
    window.addEventListener('pagehide', onHide)
    // resume the caller's last-used mode
    let m: 'voice' | 'live' = 'voice'
    try { if (localStorage.getItem('xc_call_mode') === 'live') m = 'live' } catch {}
    modeRef.current = m; setMode(m)
    if (m === 'live') void startLive()
    else startListening()
    return () => {
      endedRef.current = true
      clearInterval(iv); clearTimeout(pauseRef.current); clearTimeout(liveCapRef.current)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      try { recRef.current?.abort ? recRef.current.abort() : recRef.current?.stop() } catch {}
      try { audioRef.current?.pause() } catch {}
      stopLive()
      try { wakeRef.current?.release() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startListening = () => {
    if (endedRef.current || mutedRef.current || modeRef.current !== 'voice') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setErr('Speech recognition is unavailable in this browser.'); return }
    try { recRef.current?.abort?.() } catch {}
    const rec = new SR()
    rec.lang = SPEECH_LOCALE[lang] ?? 'en-US'
    rec.interimResults = true
    rec.continuous = true
    finalsRef.current = ''
    rec.onresult = (e: any) => {
      let interim = '', finals = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finals += r[0].transcript
        else interim += r[0].transcript
      }
      finalsRef.current = finals
      setCaptionRole('you'); setCaption((finals + ' ' + interim).trim())
      clearTimeout(pauseRef.current)
      pauseRef.current = setTimeout(() => {
        const text = (finalsRef.current || interim).trim()
        if (text) void commit(text)
      }, CALL_PAUSE_MS)
    }
    // Recognizers self-stop after silences (iOS especially) — restart while
    // we're supposed to be listening; that's the always-on illusion.
    rec.onend = () => {
      if (!endedRef.current && phaseRef.current === 'listening' && !mutedRef.current && modeRef.current === 'voice') {
        try { rec.start() } catch { setTimeout(startListening, 300) }
      }
    }
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed') setErr('Microphone permission denied — allow it in the address bar.')
    }
    recRef.current = rec
    setPh('listening')
    try { rec.start() } catch {}
  }

  const commit = async (text: string) => {
    if (endedRef.current || phaseRef.current !== 'listening') return
    setPh('thinking')
    clearTimeout(pauseRef.current)
    try { recRef.current?.stop() } catch {}
    setCaptionRole('you'); setCaption(text)
    try {
      const res = await fetch('/api/xcharacter/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: char.id, text, ...(threadId ? { threadId } : {}) }),
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => null)
        setErr(d?.error ?? `HTTP ${res.status}`)
        if (!endedRef.current) startListening()
        return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = '', reply = '', turnCost = 0, consolidate = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
        for (const p of parts) {
          const ev = /event: (\w+)/.exec(p)?.[1]
          const raw = /data: (.*)/.exec(p)?.[1]
          if (!ev || !raw) continue
          const d = JSON.parse(raw)
          if (ev === 'delta') { reply += d.text; setCaptionRole('her'); setCaption(splitPlay(reply).clean) }
          else if (ev === 'done') { turnCost = d.cost ?? 0; consolidate = !!d.consolidate }
          else if (ev === 'error') setErr(d.message)
        }
      }
      setCost(c => c + turnCost)
      if (consolidate) {
        void fetch('/api/xcharacter/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'consolidate', characterId: char.id }),
        }).catch(() => {})
      }
      const say = splitPlay(reply).clean
      if (!endedRef.current && say && char.voice) await speakAloud(say)
      if (!endedRef.current) startListening()
    } catch {
      if (!endedRef.current) { setErr('Network hiccup — still listening.'); startListening() }
    }
  }

  const speakAloud = async (say: string) => {
    setPh('speaking')
    try {
      const res = await fetch('/api/xcharacter/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: char.id, text: say.slice(0, 2000), lang }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.url) return
      setCost(c => c + (d.cost ?? 0))
      await new Promise<void>(resolve => {
        const a = new Audio(d.url)
        const r = Number(char.voice_rate)
        a.playbackRate = VOICE_RATES.includes(r) ? r : 1
        audioRef.current = a
        a.onended = () => setTimeout(resolve, 250)   // echo tail before mic reopens
        a.onerror = () => resolve()
        a.play().catch(() => resolve())
      })
    } catch {}
  }

  // ── Live engine (Phase B): Gemini Live over an ephemeral token ───────
  const playPcm = (b64: string) => {
    try {
      if (!outCtxRef.current) {
        outCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 })
        nextPlayRef.current = 0
      }
      const ctx = outCtxRef.current
      const f = b64ToF32(b64)
      if (!f.length) return
      const buf = ctx.createBuffer(1, f.length, 24000)
      buf.copyToChannel(f as any, 0)
      const s = ctx.createBufferSource()
      s.buffer = buf; s.connect(ctx.destination)
      const at = Math.max(ctx.currentTime + 0.03, nextPlayRef.current)
      s.start(at)
      nextPlayRef.current = at + buf.duration
      srcListRef.current.push(s)
      s.onended = () => { srcListRef.current = srcListRef.current.filter(x => x !== s) }
    } catch {}
  }

  const handleLiveMsg = (m: any) => {
    if (endedRef.current) return
    const audio = m?.data   // SDK convenience: base64 audio of this message
    if (audio) playPcm(audio)
    const sc = m?.serverContent
    if (!audio && sc?.modelTurn?.parts) {
      for (const p of sc.modelTurn.parts) if (p?.inlineData?.data) playPcm(p.inlineData.data)
    }
    if (sc?.inputTranscription?.text) {
      inTxtRef.current += sc.inputTranscription.text
      setCaptionRole('you'); setCaption(inTxtRef.current.slice(-220))
    }
    if (sc?.outputTranscription?.text) {
      outTxtRef.current += sc.outputTranscription.text
      setCaptionRole('her'); setCaption(outTxtRef.current.slice(-220))
      if (phaseRef.current !== 'speaking') setPh('speaking')
    }
    if (sc?.interrupted) {   // barge-in: silence her mid-word, keep listening
      for (const s of srcListRef.current) { try { s.stop() } catch {} }
      srcListRef.current = []; nextPlayRef.current = 0
      setPh('listening')
    }
    if (sc?.turnComplete) {
      const pair: Array<{ role: 'user' | 'character'; text: string }> = []
      if (inTxtRef.current.trim()) pair.push({ role: 'user', text: inTxtRef.current.trim() })
      if (outTxtRef.current.trim()) pair.push({ role: 'character', text: outTxtRef.current.trim() })
      inTxtRef.current = ''; outTxtRef.current = ''
      // Persist each finished turn DURING the call — a drop now loses at
      // most the sentence in flight, not the conversation (owner, Aug 12:
      // "why doesn't she remember what we chat about after a call?").
      if (pair.length) {
        void fetch('/api/xcharacter/live', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'append', characterId: char.id, turns: pair, ...(threadId ? { threadId } : {}) }),
        }).then(async r => {
          if (!r.ok) throw new Error(String(r.status))
          const d = await r.json().catch(() => null)
          // calls trigger memory work too, exactly like typed chat
          if (d?.consolidate) {
            void fetch('/api/xcharacter/chat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'consolidate', characterId: char.id }),
            }).catch(() => {})
          }
        }).catch(() => { turnsRef.current.push(...pair) })   // end-of-call sweep gets it
      }
      setPh('listening')
    }
  }

  const startLive = async () => {
    if (endedRef.current) return
    setPh('connecting')
    try {
      const res = await fetch('/api/xcharacter/live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'token', characterId: char.id }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.token) {
        setErr(d?.error ?? 'Live is unavailable — falling back to voice chat.')
        void switchMode('voice')
        return
      }
      const mod: any = await import('@google/genai')
      // Docs shape for ephemeral tokens (SDK ≥2.16): plain apiKey, no
      // apiVersion pin — the SDK routes token auth itself.
      const ai = new mod.GoogleGenAI({ apiKey: d.token })
      const session = await ai.live.connect({
        model: d.model,
        config: { responseModalities: [mod.Modality.AUDIO] },
        callbacks: {
          onmessage: handleLiveMsg,
          onerror: (e: any) => {
            console.warn('[call] live error:', e?.message ?? e)
            if (!endedRef.current) setErr('Live connection error')
          },
          onclose: (e: any) => {
            console.warn('[call] live closed:', e?.code, e?.reason)
            // Gemini closed the socket (session limit, network, GoAway).
            // Only re-dial if THIS session is still the live one — endCall
            // and switchMode close it deliberately.
            if (!endedRef.current && modeRef.current === 'live' && liveRef.current === session) {
              liveRef.current = null
              void redial(t('xc.call.reconnect'))
            }
          },
        },
      })
      if (endedRef.current || modeRef.current !== 'live') { try { session.close() } catch {}; return }
      liveRef.current = session
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      micStreamRef.current = stream
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      micCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      proc.onaudioprocess = (e: any) => {
        if (endedRef.current || mutedRef.current || modeRef.current !== 'live') return
        const i16 = downTo16k(e.inputBuffer.getChannelData(0), ctx.sampleRate)
        try {
          liveRef.current?.sendRealtimeInput({ audio: { data: pcm16ToB64(i16), mimeType: 'audio/pcm;rate=16000' } })
        } catch {}
      }
      // ScriptProcessor must reach the destination to tick; a zero gain
      // keeps the raw mic from echoing out of the speakers.
      const silent = ctx.createGain(); silent.gain.value = 0
      src.connect(proc); proc.connect(silent); silent.connect(ctx.destination)
      liveEnterRef.current = Date.now()
      callIdRef.current = crypto.randomUUID()
      // Ephemeral sessions can't cross the ~10-min boundary — save the
      // segment and re-dial seamlessly instead of hanging up (the silent
      // hang-up here was most of "the call just dropped", Aug 12).
      liveCapRef.current = setTimeout(() => { void redial(t('xc.call.redial')) }, LIVE_MAX_MS)
      setPh('listening')
    } catch (e: any) {
      console.warn('[call] live start failed:', e?.message)
      setErr('Could not start the live call — falling back to voice chat.')
      void switchMode('voice')
    }
  }

  const stopLive = () => {
    clearTimeout(liveCapRef.current)
    if (liveEnterRef.current) {
      liveAccumRef.current += Date.now() - liveEnterRef.current
      liveEnterRef.current = 0
    }
    try { liveRef.current?.close() } catch {}
    liveRef.current = null
    for (const s of srcListRef.current) { try { s.stop() } catch {} }
    srcListRef.current = []; nextPlayRef.current = 0
    try { micStreamRef.current?.getTracks().forEach(tk => tk.stop()) } catch {}
    micStreamRef.current = null
    try { void micCtxRef.current?.close() } catch {}
    micCtxRef.current = null
    try { void outCtxRef.current?.close() } catch {}
    outCtxRef.current = null
  }

  const saveLiveTranscript = async () => {
    // LOCKED, and the stopwatch/turns are captured-and-zeroed BEFORE the
    // request goes out: three concurrent callers of the old version all
    // read the same 8 minutes and the user paid for 24 (ledger, Aug 12).
    if (savingRef.current) return
    savingRef.current = true
    try {
      if (inTxtRef.current.trim()) turnsRef.current.push({ role: 'user', text: inTxtRef.current.trim() })
      if (outTxtRef.current.trim()) turnsRef.current.push({ role: 'character', text: outTxtRef.current.trim() })
      inTxtRef.current = ''; outTxtRef.current = ''
      const turns = turnsRef.current; turnsRef.current = []
      const seconds = Math.round(liveAccumRef.current / 1000); liveAccumRef.current = 0
      const callId = callIdRef.current
      if (!turns.length && seconds < 5) return
      // fold the settled segment into the visible total — the running
      // stopwatch it came from was just zeroed
      setCost(c => c + (seconds / 60) * LIVE_USD_PER_MIN)
      await fetch('/api/xcharacter/live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ action: 'end', characterId: char.id, turns, seconds, callId, ...(threadId ? { threadId } : {}) }),
      })
    } catch {}
    finally { savingRef.current = false }
  }

  /** The call survives its session (owner, Aug 12: "the call sometimes
   *  just dropped"): the 10-minute session boundary and a dropped Gemini
   *  socket now SAVE the segment and re-dial in place, instead of ending
   *  the call silently. The overlay stays up; the caller hears a beat of
   *  quiet, not a hang-up. */
  const redial = async (why: string) => {
    if (endedRef.current || modeRef.current !== 'live') return
    if (redialsRef.current >= 6) { void endCall(); return }   // runaway guard
    redialsRef.current += 1
    setErr(why)
    stopLive()
    await saveLiveTranscript()   // debit THIS segment honestly, then reconnect
    if (!endedRef.current && modeRef.current === 'live') {
      await startLive()
      setErr(null)
    }
  }

  const switchMode = async (m: 'voice' | 'live') => {
    if (m === modeRef.current || endedRef.current) return
    // wind down the old engine completely before the new one owns the mic
    if (modeRef.current === 'live') { stopLive(); await saveLiveTranscript() }
    else { clearTimeout(pauseRef.current); try { recRef.current?.abort?.() } catch {}; try { audioRef.current?.pause() } catch {} }
    modeRef.current = m; setMode(m); setCaption('')
    try { localStorage.setItem('xc_call_mode', m) } catch {}
    if (m === 'live') void startLive()
    else startListening()
  }

  const endCall = async () => {
    if (modeRef.current === 'live') {
      stopLive()
      await saveLiveTranscript()   // folds the last segment into cost itself
    }
    onEnd()
  }

  const toggleMute = () => {
    const m = !mutedRef.current
    mutedRef.current = m; setMuted(m)
    if (modeRef.current === 'voice') {
      if (m) { clearTimeout(pauseRef.current); try { recRef.current?.stop() } catch {} }
      else if (phaseRef.current === 'listening') startListening()
    }
    // live mode: the onaudioprocess gate simply drops frames while muted
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const status = muted ? t('xc.call.muted')
    : phase === 'connecting' ? t('xc.call.connecting')
    : phase === 'listening' ? t('xc.call.listening')
    : phase === 'thinking' ? t('xc.call.thinking')
    : t('xc.call.speaking')
  const glow = phase === 'listening' ? 'var(--green)'
    : phase === 'speaking' ? 'var(--red)' : 'var(--muted2)'
  // running estimate: settled cost + the live stopwatch still ticking
  const liveMs = liveAccumRef.current + (liveEnterRef.current ? Date.now() - liveEnterRef.current : 0)
  const shownCost = cost + (liveMs / 1000 / 60) * LIVE_USD_PER_MIN

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: '1px solid ' + (active ? 'var(--red)' : 'var(--border2)'),
    background: active ? 'var(--red)' : 'none',
    color: active ? '#fff' : 'var(--muted)',
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99700, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 18, padding: '26px 30px', width: 'min(420px, 92vw)', textAlign: 'center' }}>
        {/* mode chips — Voice chat = her own mind & voice, per turn.
            Live call = Gemini Live realtime, per minute. Both labeled. */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 20 }}>
          <button onClick={() => void switchMode('voice')} style={chip(mode === 'voice')}
            title={`${char.name} · ${t('xc.call.voice')}`}>
            🎙 {t('xc.call.voice')}
          </button>
          <button onClick={() => void switchMode('live')} style={chip(mode === 'live')}
            title={`Gemini Live · ≈$${LIVE_USD_PER_MIN.toFixed(3)}/min`}>
            ⚡ {t('xc.call.live')} · Gemini
          </button>
        </div>
        <span style={{ display: 'inline-block', borderRadius: '50%', padding: 5, boxShadow: `0 0 0 3px ${glow}`, transition: 'box-shadow 0.4s' }}>
          <Avatar path={char.avatar_path} name={char.name} size={110} />
        </span>
        <div style={{ fontWeight: 800, fontSize: 19, marginTop: 12, fontFamily: 'var(--font-display), inherit' }}>{char.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{status}</div>
        <div style={{ minHeight: 58, margin: '14px 0 6px', fontSize: 13.5, lineHeight: 1.5, color: captionRole === 'her' ? 'var(--white)' : 'var(--muted)', whiteSpace: 'pre-wrap' }}>
          {caption && <>{captionRole === 'you' ? '🗣 ' : ''}{caption.length > 220 ? '…' + caption.slice(-220) : caption}</>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 16 }}>
          {mmss}{shownCost > 0 ? ` · $${shownCost.toFixed(4)}` : ''}{mode === 'live' ? ' · Gemini Live' : ''}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={toggleMute} aria-label="mute" style={{
            width: 52, height: 52, borderRadius: '50%', fontSize: 20, cursor: 'pointer',
            border: '1.5px solid ' + (muted ? 'var(--red)' : 'var(--border2)'),
            background: muted ? 'var(--red-dim)' : 'var(--surface)',
          }}>{muted ? '🔇' : '🎤'}</button>
          <button onClick={() => void endCall()} aria-label={t('xc.call.end')} style={{
            minWidth: 120, height: 52, borderRadius: 999, border: 'none', background: 'var(--red)',
            color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer',
          }}>📞 {t('xc.call.end')}</button>
        </div>
        {err && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}
      </div>
    </div>
  )
}

function Avatar({ path, name, size }: { path: string | null; name: string; size: number }) {
  const url = avatarUrl(path)
  return url ? (
    <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
  ) : (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--red-dim)', color: 'var(--red)', fontWeight: 800,
      fontSize: size * 0.42, fontFamily: 'var(--font-display), inherit',
    }}>{(name || '?').slice(0, 1)}</span>
  )
}

export default function CharactersRoom({ models, charId, standalone }: TemplateProps & {
  /** Mounted on /xtalk/c/[id] — chat only, no roster/builder, the page IS
   *  the character (owner, Aug 13). The landing mounts without it and
   *  redirects any ?char= deep link to the dedicated page. */
  standalone?: boolean
}) {
  const t = useT()
  const { lang } = useLang()
  const [view, setView] = useState<'list' | 'build' | 'chat'>('list')
  const [chars, setChars] = useState<CharRow[] | null>(null)
  const [active, setActive] = useState<CharRow | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const api = async (body: any) => {
    const res = await fetch('/api/xcharacter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json().catch(() => null)
    if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return null }
    setErr(null); return d
  }
  const refresh = async () => { const d = await api({ action: 'list' }); if (d) setChars(d.characters) }
  useEffect(() => { void refresh() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const modelOf = (id: string) => models.find(m => m.id === id)

  // ── builder state ───────────────────────────────────────────────────
  const [editing, setEditing] = useState<CharRow | null>(null)
  const [bName, setBName] = useState('')
  const [bPersona, setBPersona] = useState('')
  const [bAppear, setBAppear] = useState('')
  const [bModel, setBModel] = useState<Speaker | null>(null)
  const [bThinking, setBThinking] = useState<string | null>(null)
  const [bAvatar, setBAvatar] = useState<string | null>(null)
  const [bPhotos, setBPhotos] = useState<string[]>([])
  const [bSearch, setBSearch] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  // voice (stage 2): bVoice is the API voice id; bVoiceDesc non-null marks
  // it as a designed voice (steers synthesis to the voice-design model).
  const [bVoice, setBVoice] = useState<string | null>(null)
  const [bVoiceDesc, setBVoiceDesc] = useState<string | null>(null)
  const [bVoiceRate, setBVoiceRate] = useState(1)
  const [bVoiceDraft, setBVoiceDraft] = useState('')
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [auditioning, setAuditioning] = useState<string | null>(null)
  const [designing, setDesigning] = useState(false)

  // One page-wide player: a new play always silences the previous one, so
  // two messages can never talk over each other. rateRef carries the user's
  // playback speed onto every new player (declared here, set in the chat
  // section below).
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rateRef = useRef(1)
  const playUrl = (url: string) => {
    try { audioRef.current?.pause() } catch {}
    const a = new Audio(url)
    a.playbackRate = rateRef.current
    audioRef.current = a
    void a.play().catch(() => {})
  }
  useEffect(() => () => { try { audioRef.current?.pause() } catch {} }, [])

  const audition = async (voiceId: string, designed: boolean) => {
    if (auditioning) return
    setAuditioning(voiceId)
    try {
      const res = await fetch('/api/xcharacter/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', voice: voiceId, designed, lang }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return }
      playUrl(d.url)
    } catch { setErr('Network error — try again.') }
    finally { setAuditioning(null) }
  }

  const design = async () => {
    const desc = bVoiceDraft.trim()
    if (desc.length < 8 || designing) return
    setDesigning(true)
    try {
      const res = await fetch('/api/xcharacter/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'design', description: desc, name: bName, lang }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return }
      setErr(null); setBVoice(d.voice); setBVoiceDesc(desc)
      if (d.url) playUrl(d.url)
    } catch { setErr('Network error — try again.') }
    finally { setDesigning(false) }
  }

  const openBuilder = (c: CharRow | null) => {
    setEditing(c)
    setBName(c?.name ?? ''); setBPersona(c?.persona ?? ''); setBAppear(c?.appearance ?? '')
    setBModel(c ? (modelOf(c.model_id) ?? null) : null)
    setBThinking(c?.thinking ?? null); setBAvatar(c?.avatar_path ?? null)
    setBPhotos(c?.photos ?? []); setBSearch(c?.search === true)
    setBVoice(c?.voice ?? null); setBVoiceDesc(c?.voice_desc ?? null)
    setBVoiceDraft(c?.voice_desc ?? ''); setVoiceOpen(!!c?.voice_desc)
    const r = Number(c?.voice_rate)
    setBVoiceRate(VOICE_RATES.includes(r) ? r : 1)
    rateRef.current = VOICE_RATES.includes(r) ? r : 1
    setView('build')
  }

  const uploadBlob = async (blob: Blob, ext: string): Promise<string | null> => {
    setUploading(true)
    try {
      const client = supa()
      const { data: { user } } = await client.auth.getUser()
      if (!user) return null
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`
      const { error } = await client.storage.from('x-characters').upload(path, blob, {
        contentType: blob.type || 'image/png',
      })
      if (error) { setErr(error.message); return null }
      return path
    } finally { setUploading(false) }
  }

  const save = async () => {
    if (saving || !bModel || (!editing && !bName.trim())) return
    setSaving(true)
    const d = await api({
      action: editing ? 'update' : 'create', id: editing?.id,
      name: bName, persona: bPersona, appearance: bAppear,
      modelId: bModel.id, thinking: bThinking, avatarPath: bAvatar,
      photos: bPhotos, search: bSearch,
      voice: bVoice, voiceDesc: bVoiceDesc, voiceRate: bVoiceRate,
    })
    setSaving(false)
    if (d) { await refresh(); setView('list') }
  }

  const remove = async () => {
    if (!editing || !confirm(t('xc.delete.confirm'))) return
    const d = await api({ action: 'delete', id: editing.id })
    if (d) { await refresh(); setView('list') }
  }

  // ── chat state ──────────────────────────────────────────────────────
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [memorizing, setMemorizing] = useState(false)
  // ── voice input (stage 1): browser speech recognition ───────────────
  // speechOK is set in an effect, not computed at render — the server
  // renders no button, so deciding client-side avoids a hydration
  // mismatch. speechBase holds whatever was typed before the mic opened,
  // so dictation appends instead of replacing.
  const [recording, setRecording] = useState(false)
  const [speechOK, setSpeechOK] = useState(false)
  const recRef = useRef<any>(null)
  const speechBase = useRef('')
  useEffect(() => {
    setSpeechOK(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition))
    return () => { try { recRef.current?.stop() } catch {} }
  }, [])
  const toggleMic = () => {
    if (recording) { try { recRef.current?.stop() } catch {}; return }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = SPEECH_LOCALE[lang] ?? 'en-US'
    rec.interimResults = true
    rec.continuous = true
    speechBase.current = input ? `${input.replace(/\s+$/, '')} ` : ''
    rec.onresult = (e: any) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      setInput(speechBase.current + text)
    }
    rec.onend = () => setRecording(false)
    rec.onerror = (e: any) => {
      setRecording(false)
      if (e?.error === 'not-allowed') setErr('Microphone permission denied — allow it in the address bar.')
    }
    recRef.current = rec
    setRecording(true)
    rec.start()
  }
  const [memory, setMemory] = useState<{ criticalTokens: number; chapterCount: number } | null>(null)
  // Lifetime spend with this character — every debit that references her:
  // chat turns, TTS, live minutes, memory consolidation (owner, Aug 12:
  // "I don't know how much money I spent here").
  const [spent, setSpent] = useState<number | null>(null)
  // Threads (migration 80): episodes of one relationship. The character's
  // memory crosses them; only the verbatim window is per-thread.
  const [threads, setThreads] = useState<Array<{ id: string; title: string }>>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const threadIdRef = useRef<string | null>(null)
  useEffect(() => { threadIdRef.current = threadId }, [threadId])
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // ── voice output (stage 2): the character speaks ────────────────────
  // autoVoice is a per-browser preference, not a character property —
  // localStorage, read in an effect for hydration safety. Defaults ON
  // (owner, Aug 8): a character given a voice should simply use it.
  const [autoVoice, setAutoVoice] = useState(false)
  useEffect(() => { try { setAutoVoice((localStorage.getItem('xc_voice_auto') ?? '1') === '1') } catch {} }, [])
  const toggleAutoVoice = () => setAutoVoice(v => {
    const n = !v
    try { localStorage.setItem('xc_voice_auto', n ? '1' : '0') } catch {}
    return n
  })
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)
  // Call mode (Phase A). Ending a call reloads history so every spoken
  // turn appears as a normal bubble — the call was just chat, out loud.
  const [calling, setCalling] = useState(false)
  const speak = async (c: CharRow, text: string, idx: number) => {
    const say = splitPlay(text).clean   // never read a [[play: …]] aloud
    if (!c.voice || !say || speakingIdx !== null) return
    setSpeakingIdx(idx)
    try {
      const res = await fetch('/api/xcharacter/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, text: say, lang }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return }
      playUrl(d.url)
    } catch { setErr('Network error — try again.') }
    finally { setSpeakingIdx(null) }
  }

  // Deep link: /xtalk?char=<id> (nav history rows) opens straight into that
  // character's chat once the roster has loaded. ONE-SHOT per id — without
  // the ref, any roster refresh re-fired this and the back button bounced
  // the user straight back into the chat they just left.
  const openedCharRef = useRef<string | null>(null)
  useEffect(() => {
    if (!charId || openedCharRef.current === charId) return
    // Old deep links (/xtalk?char=…) live in nav history and bookmarks —
    // forward them to the character's own page instead of opening in the
    // landing's cramped frame.
    if (!standalone) {
      openedCharRef.current = charId
      try { window.location.replace(`/xtalk/c/${charId}`) } catch {}
      return
    }
    if (!chars) return
    const c = chars.find(x => x.id === charId)
    if (c) { openedCharRef.current = charId; void openChat(c) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId, chars])

  // Messages at index >= liveFromRef arrived in THIS session — only those
  // may autoplay their song card; reopening history stays quiet.
  const liveFromRef = useRef(Number.MAX_SAFE_INTEGER)

  const openChat = async (c: CharRow, wantThread?: string) => {
    setActive(c); setMsgs([]); setMemory(null); setSpent(null); setView('chat')
    liveFromRef.current = Number.MAX_SAFE_INTEGER
    const r = Number(c.voice_rate)
    rateRef.current = VOICE_RATES.includes(r) ? r : 1
    // The chat owns its URL (owner ask, Aug 8): same shape the nav history
    // deep-links use, so it's shareable and the back button leaves cleanly.
    openedCharRef.current = c.id
    if (!standalone) {
      try {
        if (new URLSearchParams(window.location.search).get('char') !== c.id) {
          window.history.pushState({}, '', `/xtalk?char=${c.id}`)
        }
      } catch {}
    }
    const res = await fetch('/api/xcharacter/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'history', characterId: c.id, ...(wantThread ? { threadId: wantThread } : {}) }),
    })
    const d = await res.json().catch(() => null)
    if (res.ok && d) {
      setMsgs(d.messages.map((m: any) => ({ role: m.role, text: m.text, cost_usd: Number(m.cost_usd) || 0 })))
      setMemory(d.memory)
      if (typeof d.spentUsd === 'number') setSpent(d.spentUsd)
      setThreads(d.threads ?? [])
      setThreadId(d.threadId ?? null)
      liveFromRef.current = d.messages.length
    }
  }

  // Episode boundary = memory moment (owner, Aug 12): leaving a thread
  // consolidates what was said in it, so the NEXT episode starts with her
  // already knowing. The server skips when there's nothing meaningful, so
  // firing eagerly is free.
  const consolidateOnLeave = () => {
    if (active) void fetch('/api/xcharacter/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'consolidate', characterId: active.id }),
    }).then(() => { void refreshMemoryChip() }).catch(() => {})
  }
  const refreshMemoryChip = async () => {
    if (!active) return
    try {
      const res = await fetch('/api/xcharacter/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'history', characterId: active.id, ...(threadIdRef.current ? { threadId: threadIdRef.current } : {}) }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.memory) setMemory(d.memory)
    } catch {}
  }

  const newThread = async () => {
    if (!active) return
    consolidateOnLeave()
    const res = await fetch('/api/xcharacter/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'new_thread', characterId: active.id }),
    })
    const d = await res.json().catch(() => null)
    if (res.ok && d?.thread) {
      setThreads(prev => [{ id: d.thread.id, title: d.thread.title }, ...prev])
      setThreadId(d.thread.id)
      setMsgs([])
    }
  }

  const [renamingThread, setRenamingThread] = useState<string | null>(null)
  const [threadDraft, setThreadDraft] = useState('')
  const renameThread = async (id: string) => {
    const title = threadDraft.trim().slice(0, 60)
    setRenamingThread(null)
    if (!active || !title) return
    setThreads(prev => prev.map(x => x.id === id ? { ...x, title } : x))
    await fetch('/api/xcharacter/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename_thread', characterId: active.id, threadId: id, title }),
    }).catch(() => {})
  }

  const dropThread = async (id: string) => {
    if (!active) return
    await fetch('/api/xcharacter/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_thread', characterId: active.id, threadId: id }),
    }).catch(() => {})
    const rest = threads.filter(x => x.id !== id)
    setThreads(rest)
    if (threadId === id) {
      if (rest[0]) void openChat(active, rest[0].id)
      else void newThread()
    }
  }

  // Browser back/forward: the URL is the state, the view follows it.
  useEffect(() => {
    if (standalone) return
    const onPop = () => {
      let id: string | null = null
      try { id = new URLSearchParams(window.location.search).get('char') } catch {}
      if (!id) {
        openedCharRef.current = null
        setActive(null)
        setView(v => (v === 'chat' ? 'list' : v))
      } else if (chars) {
        const c = chars.find(x => x.id === id)
        if (c) void openChat(c)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars])

  const consolidate = async (c: CharRow) => {
    setMemorizing(true)
    try {
      const res = await fetch('/api/xcharacter/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'consolidate', characterId: c.id }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && d && !d.skipped) {
        setMemory(prev => prev ? { ...prev, chapterCount: d.chapters ?? prev.chapterCount } : prev)
      }
    } finally { setMemorizing(false) }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !active || busy) return
    setInput(''); setBusy(true)
    // Index the reply will occupy — needed to point the autoplay spinner at
    // the right bubble once the stream finishes.
    const replyIdx = msgs.length + 1
    let reply = ''
    setMsgs(prev => [...prev, { role: 'user', text }, { role: 'character', text: '' }])
    try {
      const res = await fetch('/api/xcharacter/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: active.id, text, ...(threadId ? { threadId } : {}) }),
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => null)
        setErr(d?.error ?? `HTTP ${res.status}`)
        setMsgs(prev => prev.slice(0, -1))
        return
      }
      // first words name the episode — mirror the server's auto-title
      setThreads(prev => prev.map(x => x.id === threadId && x.title === 'New chat' ? { ...x, title: text.slice(0, 60) } : x))
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
        for (const p of parts) {
          const ev = /event: (\w+)/.exec(p)?.[1]
          const raw = /data: (.*)/.exec(p)?.[1]
          if (!ev || !raw) continue
          const d = JSON.parse(raw)
          if (ev === 'delta') {
            reply += d.text
            setMsgs(prev => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], text: next[next.length - 1].text + d.text }
              return next
            })
          } else if (ev === 'done') {
            setMsgs(prev => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], cost_usd: d.cost ?? 0 }
              return next
            })
            // When the reply carries a song, the song IS the audio — auto-
            // voice stays quiet rather than talking over the intro. The
            // per-message 🔊 still reads the text on demand.
            const media = splitPlay(reply)
            if (autoVoice && active.voice && media.clean && !media.play && !media.vid) void speak(active, reply, replyIdx)
            if (d.consolidate) void consolidate(active)
          } else if (ev === 'error') {
            setErr(d.message)
          }
        }
      }
    } catch { setErr('Network error — try again.') }
    finally { setBusy(false) }
  }

  // ── views ───────────────────────────────────────────────────────────
  if (view === 'build') {
    const levels = bModel?.output_config?.text?.thinking_levels ?? []
    return (
      <div style={{ maxWidth: 640 }}>
        <div className="prompt-label" style={{ marginBottom: 14 }}>
          {editing ? t('xc.edit') : t('xc.new')}
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ border: '2px dashed var(--border2)', background: 'none', borderRadius: '50%', padding: 3, cursor: 'pointer' }}
            title={t('xc.upload')}>
            {uploading ? <span style={{ display: 'inline-block', width: 72, height: 72, lineHeight: '72px' }}>…</span>
              : <Avatar path={bAvatar} name={bName} size={72} />}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = '' }} />
          <input value={bName} onChange={e => setBName(e.target.value)} placeholder={t('xc.nameph')} maxLength={60}
            style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 16, fontWeight: 700, outline: 'none' }} />
        </div>
        {cropFile && (
          <CropModal
            file={cropFile}
            onCancel={() => setCropFile(null)}
            onDone={async (blob) => {
              setCropFile(null)
              const path = await uploadBlob(blob, 'png')
              if (path) setBAvatar(path)
            }}
          />
        )}

        <div className="prompt-label" style={{ marginBottom: 6 }}>{t('xc.persona')}</div>
        <textarea value={bPersona} onChange={e => setBPersona(e.target.value)} placeholder={t('xc.personaph')} rows={5} maxLength={4000}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
        {/* The persona rides EVERY message this character ever sends — the
            counter keeps that cost visible while writing it. */}
        <div style={{ fontSize: 10.5, color: bPersona.length > 3600 ? 'var(--red)' : 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', textAlign: 'right', margin: '3px 0 14px' }}>
          {bPersona.length.toLocaleString()} / 4,000
        </div>

        <div className="prompt-label" style={{ marginBottom: 6 }}>
          {t('xc.appearance')} <span style={{ color: 'var(--muted2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {t('xc.optional')}</span>
        </div>
        <textarea value={bAppear} onChange={e => setBAppear(e.target.value)} placeholder={t('xc.appearph')} rows={2} maxLength={1000}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 14 }} />

        <div className="prompt-label" style={{ marginBottom: 6 }}>
          {t('xc.photos')} <span style={{ color: 'var(--muted2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {t('xc.optional')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {bPhotos.map(p => (
            <span key={p} style={{ position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl(p) ?? ''} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
              <button onClick={() => setBPhotos(prev => prev.filter(x => x !== p))} aria-label="remove photo"
                style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </span>
          ))}
          {bPhotos.length < 12 && (
            <button onClick={() => photoRef.current?.click()} disabled={uploading}
              style={{ width: 72, height: 72, borderRadius: 10, border: '2px dashed var(--border2)', background: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}
              title={t('xc.addphoto')}>{uploading ? '…' : '＋'}</button>
          )}
          <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }}
            onChange={async e => {
              const files = Array.from(e.target.files ?? []).slice(0, 12 - bPhotos.length)
              e.target.value = ''
              for (const f of files) {
                const ext = (f.name.split('.').pop() || 'png').toLowerCase().slice(0, 5)
                const path = await uploadBlob(f, ext)
                if (path) setBPhotos(prev => [...prev, path])
              }
            }} />
        </div>

        <div className="prompt-label" style={{ marginBottom: 6 }}>{t('xc.model')}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <button onClick={() => setPickerOpen(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px',
            borderRadius: 10, border: '1.5px solid ' + (bModel ? 'var(--border)' : 'var(--red)'),
            background: 'var(--surface)', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--white)',
          }}>
            {bModel ? (<><ProviderLogo provider={bModel.provider} size={15} />{bModel.display_name}</>) : `☰ ${t('gm.choosemodel')}`}
          </button>
          {levels.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em' }}>{t('gm.configmodel')}</span>
              {[null, ...levels].map(lv => (
                <button key={lv ?? 'auto'} onClick={() => setBThinking(lv)} style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid ' + (bThinking === lv ? 'var(--red)' : 'var(--border2)'),
                  background: bThinking === lv ? 'var(--red)' : 'none',
                  color: bThinking === lv ? '#fff' : 'var(--muted)',
                }}>{lv ?? t('gm.auto')}</button>
              ))}
            </span>
          )}
          {(bModel?.output_config?.text?.capabilities ?? []).includes('web_search') && (
            <button onClick={() => setBSearch(s => !s)} style={{
              padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: '1px solid ' + (bSearch ? 'var(--red)' : 'var(--border2)'),
              background: bSearch ? 'var(--red)' : 'none',
              color: bSearch ? '#fff' : 'var(--muted)',
            }}>🔍 {t('xc.search')}{bSearch ? ' ✓' : ''}</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 18 }}>{t('xc.modelnote')}</div>

        {pickerOpen && (
          <ModelPickerDialog
            mode="text" recipeMode="text_to_text" slotIds={[]}
            onClose={() => setPickerOpen(false)}
            onSelect={(m: any) => { setBModel(m); setBThinking(null); setPickerOpen(false) }}
          />
        )}

        <div className="prompt-label" style={{ marginBottom: 6 }}>
          {t('xc.voicesec')} <span style={{ color: 'var(--muted2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {t('xc.optional')}</span>
        </div>
        {/* Clicking a preset both selects and auditions it — hearing the
            voice IS the picker. The audition is billed like everything else
            (sub-cent, shown on the chat bubble when it ever rounds up). */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button onClick={() => { setBVoice(null); setBVoiceDesc(null); setVoiceOpen(false) }} style={{
            padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            border: '1px solid ' + (!bVoice ? 'var(--red)' : 'var(--border2)'),
            background: !bVoice ? 'var(--red)' : 'none', color: !bVoice ? '#fff' : 'var(--muted)',
          }}>{t('xc.voicenone')}</button>
          {VOICES.map(v => {
            const sel = bVoice === v.id && !bVoiceDesc
            return (
              <button key={v.id} title={v.desc}
                onClick={() => { setBVoice(v.id); setBVoiceDesc(null); setVoiceOpen(false); void audition(v.id, false) }}
                style={{
                  padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid ' + (sel ? 'var(--red)' : 'var(--border2)'),
                  background: sel ? 'var(--red)' : 'none', color: sel ? '#fff' : 'var(--muted)',
                }}>
                {auditioning === v.id ? '♪…' : v.id}
              </button>
            )
          })}
          <button onClick={() => setVoiceOpen(o => !o)} style={{
            padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            border: '1px solid ' + (bVoiceDesc ? 'var(--red)' : 'var(--border2)'),
            background: bVoiceDesc ? 'var(--red)' : 'none', color: bVoiceDesc ? '#fff' : 'var(--muted)',
          }}>✨ {t('xc.voicecustom')}</button>
        </div>
        {bVoice && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em' }}>{t('xc.speed')}</span>
            {VOICE_RATES.map(r => (
              <button key={r} onClick={() => { setBVoiceRate(r); rateRef.current = r }} style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'var(--font-mono), monospace',
                border: '1px solid ' + (bVoiceRate === r ? 'var(--red)' : 'var(--border2)'),
                background: bVoiceRate === r ? 'var(--red)' : 'none',
                color: bVoiceRate === r ? '#fff' : 'var(--muted)',
              }}>{r}×</button>
            ))}
          </div>
        )}
        {voiceOpen && (
          <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
            <textarea value={bVoiceDraft} onChange={e => setBVoiceDraft(e.target.value)} placeholder={t('xc.voicedescph')} rows={2} maxLength={500}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
              <button onClick={design} disabled={designing || bVoiceDraft.trim().length < 8}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: designing || bVoiceDraft.trim().length < 8 ? 0.5 : 1 }}>
                {designing ? '♪ …' : `✨ ${t('xc.voicegen')}`}
              </button>
              {bVoiceDesc && !designing && (
                <button onClick={() => void audition(bVoice!, true)}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {auditioning ? '♪ …' : '▶'}
                </button>
              )}
            </div>
            <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--muted2)' }}>{t('xc.voicenote')}</div>
          </div>
        )}
        <div style={{ marginBottom: 18 }} />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={save} disabled={saving || !bModel || (!editing && !bName.trim())}
            style={{ padding: '11px 26px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: saving || !bModel || (!editing && !bName.trim()) ? 0.5 : 1 }}>
            {saving ? '…' : editing ? t('xc.save') : t('xc.create')}
          </button>
          <button onClick={() => setView('list')} style={{ padding: '11px 18px', borderRadius: 10, border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t('fb.cancel')}
          </button>
          {editing && (
            <button onClick={remove} style={{ marginLeft: 'auto', padding: '11px 18px', borderRadius: 10, border: '1px solid var(--red-dim)', background: 'none', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {t('xc.delete')}
            </button>
          )}
        </div>
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
          {t('xc.agegate')}
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
      </div>
    )
  }

  if (view === 'chat' && active) {
    const m = modelOf(active.model_id)
    return (
      /* The page frame (owner, Aug 13): header, thread strip and composer
         are PINNED; the transcript is the only thing that scrolls. Height
         is viewport-bounded (the XDirect rail lesson: max, not fixed, so
         short pages don't stretch). */
      <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 170px)', minHeight: 420 }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 10 }}>
          <button onClick={() => {
            if (standalone) { window.location.href = '/xtalk'; return }
            setView('list'); void refresh()
            openedCharRef.current = null
            try { window.history.replaceState({}, '', '/xtalk') } catch {}
          }} aria-label="back"
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', padding: 2 }}>‹</button>
          <Avatar path={active.avatar_path} name={active.name} size={40} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 800, fontSize: 15 }}>{active.name}</span>
            <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
              {m?.display_name ?? '—'}{active.thinking ? ` (${active.thinking})` : ''}
              {memory ? ` · 🧠 ${memory.chapterCount}` : ''}
              {spent != null ? ` · Σ $${spent.toFixed(2)}` : ''}
            </span>
          </span>
          {memorizing && (
            <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'var(--font-mono), monospace', flexShrink: 0 }}>
              💭 {t('xc.memorizing')}
            </span>
          )}
          {active.voice && speechOK && (
            <button onClick={() => { try { audioRef.current?.pause() } catch {}; setCalling(true) }}
              title={t('xc.call')} aria-label={t('xc.call')}
              style={{
                flexShrink: 0, padding: '3px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', border: '1px solid var(--green)', background: 'none', color: 'var(--green)',
              }}>
              📞 {t('xc.call')}
            </button>
          )}
          {active.voice && (
            <button onClick={toggleAutoVoice} title={t('xc.autoplay')} aria-label={t('xc.autoplay')}
              style={{
                flexShrink: 0, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: '1px solid ' + (autoVoice ? 'var(--red)' : 'var(--border2)'),
                background: autoVoice ? 'var(--red)' : 'none', color: autoVoice ? '#fff' : 'var(--muted)',
              }}>
              {autoVoice ? '🔊' : '🔇'} {t('xc.autoplay')}
            </button>
          )}
        </div>

        {/* Episodes of one relationship — pinned above the transcript so
            switching never fights the scroll (owner, Aug 13: the chips were
            inside the scroller, drifting away and getting overlapped). */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 6, overflowX: 'auto', alignItems: 'center', padding: '2px 2px 8px' }}>
            <button onClick={() => void newThread()} title={t('xc.thread.new')}
              style={{ padding: '3px 10px', borderRadius: 999, flexShrink: 0, border: '1px dashed var(--border2)', background: 'none', color: 'var(--muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >+ {t('xc.thread.new')}</button>
            {threads.map(th => (
              <span key={th.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {renamingThread === th.id ? (
                  <input
                    autoFocus value={threadDraft}
                    onChange={e => setThreadDraft(e.target.value)}
                    onBlur={() => void renameThread(th.id)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void renameThread(th.id); if (e.key === 'Escape') setRenamingThread(null) }}
                    style={{ width: 150, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid var(--red)', background: 'var(--surface)', color: 'var(--white)', outline: 'none' }}
                  />
                ) : (
                <button
                  onClick={() => { if (threadId !== th.id && active) { consolidateOnLeave(); void openChat(active, th.id) } }}
                  style={{
                    padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    border: '1px solid ' + (threadId === th.id ? 'var(--red)' : 'var(--border2)'),
                    background: threadId === th.id ? 'var(--red-dim)' : 'none',
                    color: threadId === th.id ? 'var(--red)' : 'var(--muted)',
                  }}
                >{th.title === 'New chat' ? t('xc.thread.fresh') : th.title}</button>
                )}
                {threadId === th.id && renamingThread !== th.id && (
                  <button onClick={() => { setThreadDraft(th.title === 'New chat' ? '' : th.title); setRenamingThread(th.id) }} title={t('hist.rename')}
                    style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 10, padding: 0, opacity: 0.7 }}
                  >✏</button>
                )}
                {threadId === th.id && renamingThread !== th.id && threads.length > 1 && (
                  <button onClick={() => void dropThread(th.id)} title={t('hist.delete')}
                    style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}
                  >✕</button>
                )}
              </span>
            ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', padding: '4px 2px', marginBottom: 12 }}>
          {msgs.length === 0 && (
            <div style={{ color: 'var(--muted2)', fontSize: 13, textAlign: 'center', padding: 40 }}>{t('xc.firstline')}</div>
          )}
          {msgs.map((mg, i) => {
            const { clean, play, vid } = mg.role === 'character' ? splitPlay(mg.text) : { clean: mg.text, play: null, vid: null }
            return (
            <div key={i} style={{
              alignSelf: mg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%', padding: '9px 13px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.55,
              background: mg.role === 'user' ? 'var(--red-dim)' : 'var(--surface)',
              border: '1px solid ' + (mg.role === 'user' ? 'var(--red-dim)' : 'var(--border2)'),
              whiteSpace: 'pre-wrap',
              minWidth: (play || vid) ? 'min(320px, 70vw)' : undefined,
            }}>
              {clean || (busy && i === msgs.length - 1 ? '…' : '')}
              {(play || vid) && <YTCard query={play ?? 'YouTube'} fixedId={vid} autoplay={i >= liveFromRef.current} />}
              {mg.role === 'character' && ((mg.cost_usd ?? 0) > 0 || (!!mg.text && !!active.voice)) && (
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  {!!mg.text && !!active.voice && (
                    <button onClick={() => void speak(active, mg.text, i)} aria-label={t('xc.voicesec')} title={t('xc.voicesec')}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: 0, lineHeight: 1 }}>
                      {speakingIdx === i ? '♪…' : '🔊'}
                    </button>
                  )}
                  {(mg.cost_usd ?? 0) > 0 && (
                    <span style={{ fontSize: 9.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                      ${(mg.cost_usd ?? 0).toFixed(4)}
                    </span>
                  )}
                </span>
              )}
            </div>
          )})}
          <div ref={bottomRef} />
        </div>

        <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
          <input
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send() }}
            placeholder={recording ? '🎙 …' : t('xc.chatph').replace('{name}', active.name)}
            style={{ flex: 1, padding: '11px 14px', borderRadius: 10, border: '1.5px solid ' + (recording ? 'var(--red)' : 'var(--border2)'), background: 'var(--surface)', color: 'var(--white)', fontSize: 14, outline: 'none' }}
          />
          {speechOK && (
            <button onClick={toggleMic} aria-label={t('xc.voice')} title={t('xc.voice')}
              style={{
                width: 44, borderRadius: 10, fontSize: 16, cursor: 'pointer', flexShrink: 0,
                border: '1.5px solid ' + (recording ? 'var(--red)' : 'var(--border2)'),
                background: recording ? 'var(--red)' : 'var(--surface)',
              }}>
              {recording ? '⏹' : '🎤'}
            </button>
          )}
          <button onClick={send} disabled={busy || !input.trim()}
            style={{ padding: '11px 22px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}>
            {busy ? '…' : t('xc.send')}
          </button>
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        {calling && (
          <CallOverlay
            char={active} lang={lang} threadId={threadIdRef.current}
            onEnd={() => { setCalling(false); consolidateOnLeave(); void openChat(active, threadIdRef.current ?? undefined) }}
          />
        )}
      </div>
    )
  }

  // Standalone page still resolving its character: a quiet beat, never
  // the roster — this page is one relationship, not the shelf.
  if (standalone) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
        <span className="nav-history-spin" aria-label="loading" />
      </div>
    )
  }

  // ── list ────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {(chars ?? []).map(c => (
          <div key={c.id} style={{
            width: 200, border: '1.5px solid var(--border)', borderRadius: 14,
            background: 'var(--surface)', padding: '18px 16px 14px', position: 'relative',
          }}>
            <button onClick={() => { window.location.href = `/xtalk/c/${c.id}` }} style={{ border: 'none', background: 'none', cursor: 'pointer', width: '100%', textAlign: 'center', padding: 0 }}>
              <Avatar path={c.avatar_path} name={c.name} size={64} />
              <span style={{ display: 'block', fontWeight: 800, fontSize: 15, marginTop: 10, color: 'var(--white)' }}>{c.name}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginTop: 3 }}>
                {modelOf(c.model_id)?.display_name ?? '—'}
              </span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted2)', marginTop: 6 }}>
                {c.msg_count > 0 ? t('xc.msgs').replace('{n}', String(c.msg_count)) : t('xc.fresh')}
              </span>
            </button>
            <button onClick={() => openBuilder(c)} aria-label="edit" title={t('xc.edit')}
              style={{ position: 'absolute', top: 8, right: 10, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, opacity: 0.6 }}>✏</button>
          </div>
        ))}
        <button onClick={() => openBuilder(null)} style={{
          width: 200, minHeight: 170, border: '2px dashed var(--border2)', borderRadius: 14,
          background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13.5, fontWeight: 700,
        }}>
          ＋ {t('xc.new')}
        </button>
      </div>
      {chars !== null && chars.length === 0 && (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted2)' }}>{t('xc.empty')}</div>
      )}
      {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
    </div>
  )
}
