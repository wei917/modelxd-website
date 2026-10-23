'use client'
// app/xoracle/guandi-3d/Temple3D.tsx — X先知's 3D 關帝廟 (prototype, Oct 22).
// Walk the hilltop like a game, kneel before 關聖帝君, shake the 籤筒 and throw
// the 筊杯; a stick confirmed by a 聖筊 is carried into the 關帝籤 room, which
// shows its poem and offers the masters' reading (the room's own flow and
// prices; nothing is charged here). He does not speak (owner, Oct 23:
// "remove the voice. don't actively talk please!"): the buttons lead.
//
// Phone first: a thumb stick at bottom left walks, a drag anywhere else
// looks. The scene itself is scene.ts; this file is the ritual and the
// overlays. Randomness is the browser's crypto source, as in the room
// (lib/xoracle-ritual.ts): nobody, including us, picks the stick.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { cryptoRand, drawQian, throwJiao, QIAN_COUNTS, type Jiao } from '../../../lib/xoracle-ritual'
import { TEMPLE3D_SCENE as sc, writeStick } from '../../../lib/xoracle-temple3d'
import { UI, type Lang5 } from './lines'
import type { Place, SceneHandle, SplatSize } from './scene'

type Phase = 'loading' | 'error' | 'walk' | 'kneeling' | 'ask' | 'shaking' | 'drawn' | 'throwing' | 'result'

const RED = '#c8372d'
const GOLD = '#e9c97a'

export default function Temple3D({ debug = false, splats }: { debug?: boolean; splats?: SplatSize }) {
  const { lang: rawLang } = useLang()
  const lang = (rawLang ?? 'zh-Hant') as Lang5
  const u = (k: keyof typeof UI, vars?: Record<string, string | number>) =>
    Object.entries(vars ?? {}).reduce((s, [a, b]) => s.replace(`{${a}}`, String(b)), UI[k][lang] ?? UI[k]['zh-Hant'])

  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [progress, setProgress] = useState(0)
  const [near, setNear] = useState(false)
  const [atDoor, setAtDoor] = useState(false)
  const [place, setPlace] = useState<Place>('out')
  const [leaving, setLeaving] = useState(false)
  const [mobile, setMobile] = useState(true)
  const [hintOn, setHintOn] = useState(true)
  const [ask, setAsk] = useState('')
  const [stickN, setStickN] = useState<number | null>(null)
  const [result, setResult] = useState<Jiao | null>(null)
  const phaseRef = useRef<Phase>('loading')
  phaseRef.current = phase

  // ── the scene ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const isMobile = window.matchMedia('(pointer: coarse)').matches
    setMobile(isMobile)
    ;(async () => {
      try {
        const { createScene } = await import('./scene')
        const s = await createScene(el, { scene: sc, mobile: isMobile, debug, splats, onProgress: p => setProgress(p) })
        if (disposed) { s.dispose(); return }
        sceneRef.current = s
        s.onPlace(setPlace)
        if (debug) { (window as any).__temple = s.debug; (window as any).__templeHandle = s }
        await s.ready
        if (!disposed) setPhase('walk')
      } catch (e) {
        console.error('[temple3d]', e)
        if (!disposed) setPhase('error')
      }
    })()
    return () => { disposed = true; sceneRef.current?.dispose(); sceneRef.current = null }
  }, [debug, splats])

  // 參拜 is offered near the cushions; checked a few times a second.
  useEffect(() => {
    if (phase !== 'walk') { setNear(false); setAtDoor(false); return }
    const id = setInterval(() => {
      const sh = sceneRef.current
      if (!sh) return
      setNear(place === 'out' && sh.nearAltar()); setAtDoor(sh.nearDoor())
    }, 200)
    return () => clearInterval(id)
  }, [phase, place])

  // In and out of the statue, behind a short fade.
  const through = (go: () => void) => {
    setLeaving(true)
    setTimeout(() => { go(); setTimeout(() => setLeaving(false), 120) }, 450)
  }

  useEffect(() => {
    if (phase !== 'walk') return
    const id = setTimeout(() => setHintOn(false), 9000)
    return () => clearTimeout(id)
  }, [phase])

  // ── look: drag anywhere outside the stick and the panels ───────────────
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (drag.current) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setHintOn(false)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    sceneRef.current?.look(e.clientX - d.x, e.clientY - d.y)
    d.x = e.clientX; d.y = e.clientY
  }
  const onPointerUp = (e: React.PointerEvent) => { if (drag.current?.id === e.pointerId) drag.current = null }

  // ── the ritual ─────────────────────────────────────────────────────────
  const bow = async () => {
    const s = sceneRef.current
    if (!s) return
    setPhase('kneeling')
    await s.kneel()
    setPhase('ask')
  }
  const shake = async () => {
    const s = sceneRef.current
    if (!s || phaseRef.current === 'shaking') return
    setResult(null); setStickN(null)
    setPhase('shaking')
    await s.shake()
    setStickN(drawQian(cryptoRand, QIAN_COUNTS.guandi))
    setPhase('drawn')
  }
  const throwBlocks = async () => {
    const s = sceneRef.current
    if (!s || phaseRef.current === 'throwing') return
    const j = throwJiao(cryptoRand)
    setPhase('throwing')
    await s.throwBlocks(j)
    setResult(j)
    setPhase('result')
  }
  const toReading = () => {
    if (!stickN) return
    try { writeStick(window.sessionStorage, stickN, ask) } catch {}
    window.location.href = '/xoracle?t=guandi'
  }
  const standUp = async () => {
    setResult(null); setStickN(null)
    await sceneRef.current?.stand()
    setPhase('walk')
  }

  // ── the thumb stick ────────────────────────────────────────────────────
  const stickBase = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const stickId = useRef<number | null>(null)
  const moveStick = (e: React.PointerEvent) => {
    const b = stickBase.current?.getBoundingClientRect()
    if (!b) return
    const r = b.width / 2
    let x = e.clientX - (b.left + r), y = e.clientY - (b.top + r)
    const m = Math.hypot(x, y)
    if (m > r) { x = x / m * r; y = y / m * r }
    setKnob({ x, y })
    sceneRef.current?.setMove(x / r, -y / r)
  }
  const stickDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    stickId.current = e.pointerId
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setHintOn(false)
    moveStick(e)
  }
  const stickMove = (e: React.PointerEvent) => { if (stickId.current === e.pointerId) moveStick(e) }
  const stickUp = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId) return
    stickId.current = null
    setKnob({ x: 0, y: 0 })
    sceneRef.current?.setMove(0, 0)
  }

  const inRitual = !['loading', 'error', 'walk'].includes(phase)
  const resultLabel = result === '聖筊' ? u('sheng') : result === '笑筊' ? u('xiao') : result === '陰筊' ? u('yin') : ''

  return (
    <div className="t3d-root">
      <div ref={host} className="t3d-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />

      {/* top bar */}
      <div className="t3d-top">
        <a href="/xoracle?t=guandi" className="t3d-pill" aria-label={u('back')}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {u('back')}
        </a>
        <div className="t3d-title">{u('title')}<span>{u('proto')}</span></div>
      </div>

      {phase === 'loading' && (
        <div className="t3d-center">
          <div className="t3d-seal">關</div>
          <div>{u('loading')}</div>
          <div className="t3d-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </div>
      )}
      {phase === 'error' && <div className="t3d-center">{u('noWebgl')}</div>}

      {phase === 'walk' && (
        <>
          {place === 'out' && hintOn && <div className="t3d-hint">{mobile ? u('hint') : u('hintDesk')}</div>}
          {place === 'out' && !hintOn && !near && !atDoor && <div className="t3d-hint t3d-hint-soft">{u('approachStatue')}</div>}
          {/* In the lobby, the two ways on in the middle of the screen (owner:
              "2 options in the middle, top or exit"); on the deck, the way down. */}
          {place === 'lobby' && (
            <div className="t3d-rooms center">
              <div className="t3d-room-name">{u('lobbyRoom')}</div>
              <div className="t3d-room-btns">
                <button className="t3d-btn" onClick={() => through(() => sceneRef.current?.goTo('top'))}>{u('goTop')}</button>
                <button className="t3d-btn" onClick={() => through(() => sceneRef.current?.leaveStatue())}>{u('exitStatue')}</button>
              </div>
            </div>
          )}
          {place === 'top' && (
            <div className="t3d-rooms">
              <div className="t3d-room-name">{u('topRoom')}</div>
              <div className="t3d-room-btns">
                <button className="t3d-btn ghost wide" onClick={() => through(() => sceneRef.current?.leaveStatue())}>{u('down')}</button>
              </div>
            </div>
          )}
          {near && !atDoor && <button className="t3d-bow" onClick={bow}>{u('bow')}</button>}
          {atDoor && sc.climb && (
            <button className="t3d-bow" onClick={() => through(() => sceneRef.current?.enterStatue())}>{u('enterStatue')}</button>
          )}
          {mobile && (
            <div ref={stickBase} className="t3d-stick" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
              <div className="t3d-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
          )}
        </>
      )}

      {inRitual && (
        <div className="t3d-panel">
          {stickN !== null && (phase === 'drawn' || phase === 'throwing' || phase === 'result') && (
            <div className="t3d-stickno">{u('stick', { n: stickN })}{resultLabel && <b className={result === '聖筊' ? 'ok' : ''}> · {resultLabel}</b>}</div>
          )}
          {phase === 'ask' && (
            <input className="t3d-ask" value={ask} maxLength={300} onChange={e => setAsk(e.target.value)} placeholder={u('askPh')} aria-label={u('askPh')} />
          )}
          <div className="t3d-actions">
            {phase === 'ask' && <button className="t3d-btn" onClick={shake}>{u('shake')}</button>}
            {phase === 'drawn' && <button className="t3d-btn" onClick={throwBlocks}>{u('throw')}</button>}
            {phase === 'result' && result === '聖筊' && <button className="t3d-btn" onClick={toReading}>{u('read')}</button>}
            {phase === 'result' && result !== '聖筊' && <button className="t3d-btn" onClick={shake}>{u('again')}</button>}
            {['ask', 'drawn', 'result'].includes(phase) && <button className="t3d-btn ghost" onClick={standUp}>{u('leave')}</button>}
          </div>
        </div>
      )}

      {debug && <DebugReadout />}
      <div className={`t3d-fade ${leaving ? 'on' : ''}`} />

      <style>{`
        .t3d-root { position: fixed; inset: 0; z-index: 1200; background: #0b0806; color: #fff; overflow: hidden;
          font-family: var(--font-zh), var(--font-body), system-ui, sans-serif; -webkit-user-select: none; user-select: none; touch-action: none; }
        .t3d-canvas { position: absolute; inset: 0; touch-action: none; }
        .t3d-top { position: absolute; top: 0; left: 0; right: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;
          padding: max(12px, env(safe-area-inset-top)) 16px 12px; pointer-events: none;
          background: linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,0)); }
        .t3d-top > * { pointer-events: auto; }
        .t3d-top > a { justify-self: start; }
        .t3d-pill { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; font-size: 13px;
          color: #fff; background: rgba(20,14,10,.55); border: 1px solid rgba(255,255,255,.18); backdrop-filter: blur(6px); text-decoration: none; cursor: pointer; }
        .t3d-title { min-width: 0; font-size: 16px; font-weight: 700; letter-spacing: .06em; white-space: nowrap; text-shadow: 0 1px 6px rgba(0,0,0,.6);
          display: flex; flex-direction: column; align-items: center; gap: 3px; pointer-events: none; }
        .t3d-title span { font-size: 9.5px; font-weight: 600; letter-spacing: .06em; padding: 1px 7px; border-radius: 999px; background: ${RED}; }
        .t3d-center { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 14px; padding: 0 24px; text-align: center;
          font-size: 14px; color: rgba(255,255,255,.85); pointer-events: none; }
        .t3d-seal { width: 64px; height: 64px; border-radius: 14px; display: grid; place-items: center; font-size: 34px; font-weight: 800; color: ${GOLD};
          border: 2px solid ${GOLD}; background: ${RED}; box-shadow: 0 0 30px rgba(200,55,45,.5); animation: t3dPulse 1.6s ease-in-out infinite; }
        @keyframes t3dPulse { 50% { transform: scale(1.06); box-shadow: 0 0 44px rgba(233,201,122,.45); } }
        .t3d-fade { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; transition: opacity .45s; }
        .t3d-fade.on { opacity: 1; }
        .t3d-bar { width: 180px; height: 3px; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; }
        .t3d-bar i { display: block; height: 100%; background: ${GOLD}; transition: width .2s; }
        .t3d-hint { position: absolute; left: 16px; right: 16px; bottom: calc(176px + env(safe-area-inset-bottom)); text-align: center; font-size: 13px; color: rgba(255,255,255,.92);
          text-shadow: 0 1px 6px rgba(0,0,0,.8); pointer-events: none; }
        .t3d-hint-soft { color: rgba(255,255,255,.7); font-size: 12px; }
        .t3d-rooms { position: absolute; left: 16px; right: 16px; bottom: calc(150px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
        .t3d-room-name { text-align: center; font-size: 14px; color: #fff; text-shadow: 0 1px 6px rgba(0,0,0,.8); }
        .t3d-rooms.center { top: 50%; bottom: auto; transform: translateY(-50%); }
        .t3d-room-btns { display: flex; gap: 8px; }
        .t3d-btn.ghost.wide { flex: 1; font-size: 15px; }
        .t3d-bow { white-space: nowrap; position: absolute; left: 50%; bottom: calc(112px + env(safe-area-inset-bottom)); transform: translateX(-50%); height: 52px; padding: 0 30px; border-radius: 999px;
          border: 2px solid ${GOLD}; background: ${RED}; color: #fff; font-size: 17px; font-weight: 700; letter-spacing: .12em; cursor: pointer;
          box-shadow: 0 6px 24px rgba(0,0,0,.45), 0 0 24px rgba(200,55,45,.6); animation: t3dPulse 1.8s ease-in-out infinite; }
        .t3d-stick { position: absolute; left: 22px; bottom: calc(26px + env(safe-area-inset-bottom)); width: 116px; height: 116px; border-radius: 50%;
          background: rgba(20,14,10,.38); border: 1.5px solid rgba(255,255,255,.28); backdrop-filter: blur(4px); touch-action: none; display: grid; place-items: center; }
        .t3d-knob { width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,.85); box-shadow: 0 2px 10px rgba(0,0,0,.4); pointer-events: none; }
        .t3d-panel { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 16px calc(18px + env(safe-area-inset-bottom));
          display: flex; flex-direction: column; gap: 10px; align-items: stretch;
          background: linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.7) 35%); }
        .t3d-stickno { text-align: center; font-size: 15px; font-weight: 700; color: ${GOLD}; letter-spacing: .06em; text-shadow: 0 1px 6px rgba(0,0,0,.8); }
        .t3d-stickno b { color: #fff; } .t3d-stickno b.ok { color: #ffd36b; }
        .t3d-root .t3d-ask { width: 100%; box-sizing: border-box; height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.3);
          background: rgba(20,14,10,.6); color: #fff; font-size: 16px; outline: none; -webkit-user-select: text; user-select: text; }
        .t3d-root .t3d-ask::placeholder { color: rgba(255,255,255,.55); }
        .t3d-actions { display: flex; gap: 10px; }
        .t3d-btn { flex: 1; min-width: 0; height: 50px; padding: 0 12px; border-radius: 999px; border: 2px solid ${GOLD}; background: ${RED}; color: #fff; font-size: 16px; font-weight: 700;
          letter-spacing: .06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .t3d-btn.ghost { flex: 0 0 auto; padding: 0 14px; border-color: rgba(255,255,255,.35); background: rgba(20,14,10,.55); font-weight: 600; font-size: 13px; letter-spacing: .02em; }
        @media (min-width: 760px) {
          .t3d-panel { left: 50%; right: auto; width: 480px; transform: translateX(-50%); background: none; }
        }
      `}</style>
    </div>
  )
}

function DebugReadout() {
  const [txt, setTxt] = useState('')
  useEffect(() => {
    const id = setInterval(() => {
      const d = (window as any).__temple
      if (d) setTxt(JSON.stringify(d.where()))
    }, 300)
    return () => clearInterval(id)
  }, [])
  return <div style={{ position: 'absolute', left: 8, top: 64, fontSize: 10, fontFamily: 'monospace', background: 'rgba(0,0,0,.6)', padding: 4, pointerEvents: 'none', maxWidth: '90vw' }}>{txt}</div>
}
