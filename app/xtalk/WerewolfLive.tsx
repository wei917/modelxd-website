'use client'
// app/xtalk/WerewolfLive.tsx
// The screen for a server-held game. This component knows nothing: it asks
// the server to advance, renders what comes back, and hands over whatever
// the server says it is waiting for. There is no game state here to inspect,
// which is the only reason a human can sit at this table honestly.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProviderLogo from '../components/ProviderLogo'
import { isSubmitEnter } from '../../lib/ime'
import { useLang, useT } from '../../lib/i18n'
import { composition } from '../../lib/werewolf-engine'
import { createBrowserClient } from '@supabase/ssr'
import { type SeatOpts } from './SeatConfig'
import ModelSlots from './ModelSlots'

const COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399', '#f59e0b', '#ec4899', '#38bdf8', '#fb7185']
const ROLE_KEY: Record<string, string> = { wolf: 'ww.role.wolf', seer: 'ww.role.seer', doctor: 'ww.role.doctor', villager: 'ww.role.villager' }

type Board = {
  sessionId: string
  title: string | null
  status: 'active' | 'over'
  phase: string
  day: number
  humanSeat: number | null
  winner: 'wolves' | 'village' | null
  cost: number
  players: { seat: number; name: string; provider: string; alive: boolean; isHuman: boolean; role: string | null }[]
  transcript: { seat?: number; speaker: string; text: string; reasoning?: string; privateTo?: number[]; kind?: string; system?: boolean; cost?: number }[]
  awaiting: null | { kind: 'kill' | 'check' | 'protect' | 'speak' | 'vote'; targets: { seat: number; name: string }[] }
}

/** The one board XTalk runs: 2 wolves, seer, doctor, 3 villagers. */
const TABLE_SIZE = 7

export default function WerewolfLive({
  models, onExit, resumeId = null,
}: {
  models: { id: string; display_name: string; provider: string; model_pricing?: any }[]
  onExit: () => void
  resumeId?: string | null
}) {
  const { lang } = useLang()
  const t = useT()
  const router = useRouter()
  const [picked, setPicked] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)      // is the human taking a seat
  // Fixed board. See the note by the composition line for why there is no
  // longer a size control.
  const size = TABLE_SIZE
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  // Table-level, the way XDuel's search toggle was: one wolf reasoning with
  // the web against villagers without it measures the settings we handed
  // out, not the models. Thinking stays per-seat — a slower thinker is a
  // playstyle; search is an information asymmetry, which is a different
  // thing. (CC, Aug 2)
  const [wantRole, setWantRole] = useState<'random' | 'wolf' | 'seer' | 'doctor' | 'villager'>('random')
  // Whoever is signed in. It defaulted to the literal string 'You', so every
  // recorded game had a player called "You" and the transcript read like the
  // page talking to itself. Still editable — a nickname at the table is
  // reasonable — but the default should be the person's actual name.
  const [name, setName]     = useState('')
  useEffect(() => {
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    ).auth.getUser().then(({ data }) => {
      const u = data?.user
      if (!u) return
      const n = (u.user_metadata?.full_name as string | undefined)
        || (u.user_metadata?.name as string | undefined)
        || u.email?.split('@')[0]
      // Only fill an untouched field, so a nickname typed before this
      // resolves is not overwritten a moment later.
      if (n) setName(prev => prev || n.slice(0, 24))
    })
  }, [])
  const [board, setBoard]   = useState<Board | null>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [say, setSay]       = useState('')
  const [revealThinking, setRevealThinking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)

  const saveTitle = async (raw: string) => {
    if (!board) return
    const title = raw.trim().slice(0, 80) || null
    setTitleDraft(null)
    setBoard(b => b ? { ...b, title } : b)  // optimistic
    await createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    ).from('xtalk_sessions').update({ title }).eq('id', board.sessionId)
  }

  const deleteGame = async () => {
    if (!board) return
    await createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    ).from('xtalk_sessions').delete().eq('id', board.sessionId)
    // Gone — back to the picker (the nav history refetches on the way in).
    router.push('/xtalk')
  }
  const bottom = useRef<HTMLDivElement>(null)
  const running = useRef(false)

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [board?.transcript.length])

  const post = async (body: any): Promise<Board | null> => {
    const res = await fetch('/api/xtalk/werewolf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // Sent every time, not stored: switching the site language mid-game
      // should carry the table with it.
      body: JSON.stringify({ ...body, lang }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) { setError(json?.error ?? `request failed (${res.status})`); return null }
    setError(null)
    return json as Board
  }

  /** Keep stepping until the game wants something from the human, or ends. */
  const advance = async (from: Board) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    let b: Board | null = from
    // Bounded so a server-side stall can never spin forever.
    for (let i = 0; i < 200 && b && b.status === 'active' && !b.awaiting; i++) {
      b = await post({ action: 'step', sessionId: b.sessionId })
      if (b) setBoard(b)
    }
    running.current = false
    setBusy(false)
  }

  // Reopen a server-held game (/xtalk/<id> or the nav history). state is
  // read-only; if the game is still live, advance() picks up whatever AI
  // acts were pending when the tab closed.
  useEffect(() => {
    if (!resumeId) return
    ;(async () => {
      const b = await post({ action: 'state', sessionId: resumeId })
      if (b) { setBoard(b); if (b.status === 'active') advance(b) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  const start = async () => {
    const total = picked.length + (playing ? 1 : 0)
    if (total !== size) return
    setBusy(true)
    const b = await post({
      action: 'create', modelIds: picked,
      humanName: playing ? name.trim() || 'You' : null,
      humanRole: playing && wantRole !== 'random' ? wantRole : null,
      // Per-seat thinking, one table-wide search flag. Sent keyed by model
      // id rather than by seat: seats are dealt server-side, and the client
      // must not learn the seating from the shape of what it sent.
      seatOpts: Object.fromEntries(picked.map(id => [id, {
        thinking: seatOpts[id]?.thinking ?? null,
      }])),
    })
    if (b) {
      // Stay busy through the navigation — the picker must not flash back.
      router.replace(`/xtalk/${b.sessionId}`)
      return
    }
    setBusy(false)
  }

  const answer = async (payload: any) => {
    if (!board) return
    setBusy(true)
    const b = await post({ action: 'say', sessionId: board.sessionId, ...payload })
    setBusy(false)
    if (b) { setBoard(b); setSay(''); advance(b) }
  }

  const seatsForModels = size - (playing ? 1 : 0)

  /** Fill the empty chairs with a random cast (CC, Aug 3: seven hand-picks
   *  before every game is setup, not play). Random rather than top-ranked —
   *  identical casts every game would make the werewolf board a rerun.
   *  Models above $100/1M output are left for deliberate picking only: a
   *  three-day game with GPT-5.5 Pro at the table is a bill, not a default. */
  const autoFill = () => {
    const need = seatsForModels - picked.length
    if (need <= 0) return
    const rateOf = (m: any) => {
      const r = m?.model_pricing?.tokens?.text_output
      return typeof r === 'number' ? r : (r?.default ?? 0)
    }
    const pool = models
      .filter(m => !picked.includes(m.id) && rateOf(m) < 100)
      .map(m => ({ m, k: Math.random() }))
      .sort((a, b) => a.k - b.k)
      .map(x => x.m)
    setPicked(prev => [...prev, ...pool.slice(0, need).map(m => m.id)])
  }
  const toggle = (id: string) => setPicked(p =>
    p.includes(id) ? p.filter(x => x !== id) : p.length >= seatsForModels ? p : [...p, id])

  const colorOf = (seat?: number) => seat === undefined ? 'var(--muted2)' : COLORS[seat % COLORS.length]

  // ── setup ──────────────────────────────────────────────────────────────
  if (!board) {
    const total = picked.length + (playing ? 1 : 0)
    return (
      <>
        {/* The board, set as a spec line rather than a control.
            It was a section heading over a single box reading
            "7  2🐺 · 1🔮 · 1🩺 · 3🧑‍🌾" — a heading implies a choice there
            isn't one of, and the pictograms forced the eye to decode a glyph
            before it could read a number. There is one board; this states it
            in words and gets out of the way. (CC, Aug 2) */}
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap',
          padding: '0 0 14px', marginBottom: 20,
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono), monospace', fontSize: 10,
            letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)',
          }}>{t('ww.board')}</span>

          {(['wolf', 'seer', 'doctor', 'villager'] as const).map(r => {
            const n = composition(TABLE_SIZE).filter(x => x === r).length
            if (n === 0) return null
            return (
              <span key={r} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-display), sans-serif', fontSize: 15, fontWeight: 800,
                  color: r === 'wolf' ? 'var(--red)' : 'var(--white)', lineHeight: 1,
                }}>{n}</span>
                <span style={{ fontSize: 12.5, color: 'var(--muted2)' }}>{t(ROLE_KEY[r])}</span>
              </span>
            )
          })}

          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-mono), monospace', fontSize: 10,
            letterSpacing: '.1em', color: 'var(--muted)',
          }}>{t('xt.seats').replace('{n}', String(TABLE_SIZE))}</span>
        </div>

        {/* Seats are split by WHO fills them, not by one checkbox tacked on
            below the models. "I'm in" is drawn as a slot for the same reason
            the models are: the day a table takes two humans, that is another
            slot in this row and nothing else has to move. The AI count reads
            off the same arithmetic — chairs minus humans. (CC, Aug 2) */}
        <div className="prompt-label" style={{ marginBottom: 10 }}>{t('ww.sec.human')}</div>
        <div style={{
          display: 'grid', gap: 8, marginBottom: 18,
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        }}>
          {!playing ? (
            <button onClick={() => setPlaying(true)} style={{
              height: 52, padding: '0 12px', borderRadius: 10, cursor: 'none',
              border: '1px dashed var(--border2)', background: 'var(--surface)',
              color: 'var(--muted)', fontSize: 12, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> {t('ww.imin')}
            </button>
          ) : (
            <div style={{
              height: 52, padding: '0 10px 0 12px', borderRadius: 10,
              border: '1px solid var(--red)', background: 'var(--red-dim)',
              display: 'flex', alignItems: 'center', gap: 9,
            }}>
              <span style={{ fontSize: 15 }}>🙋</span>
              <input
                value={name} onChange={e => setName(e.target.value)} maxLength={24}
                placeholder={t('ww.yourname')}
                style={{
                  flex: 1, minWidth: 0, border: 'none', background: 'transparent',
                  color: 'var(--white)', fontSize: 13, fontFamily: 'inherit', padding: 0,
                }}
              />
              <button title="Remove" onClick={() => setPlaying(false)} aria-label="leave the table" style={{
                background: 'none', border: 'none', color: 'var(--red)',
                cursor: 'none', fontSize: 26, lineHeight: 1,
                padding: '4px 2px', flexShrink: 0,
              }}>×</button>
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -10, marginBottom: 16 }}>
          {playing ? t('ww.hint.play') : t('ww.hint.watch')}
        </div>

        {playing && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18, marginTop: -8 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 4 }}>{t('ww.iwantto')}</span>
            {(['random', 'wolf', 'seer', 'doctor', 'villager'] as const).map(r => (
              <button key={r} onClick={() => setWantRole(r)}
                style={{
                  padding: '5px 11px', borderRadius: 999, cursor: 'none', fontSize: 12, fontFamily: 'inherit',
                  border: `1px solid ${wantRole === r ? 'var(--red)' : 'var(--border2)'}`,
                  background: wantRole === r ? 'var(--red-dim)' : 'transparent',
                  color: wantRole === r ? 'var(--red)' : 'var(--muted)',
                }}>{r === 'random' ? t('ww.random') : t(ROLE_KEY[r])}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span className="prompt-label" style={{ margin: 0 }}>{t('ww.sec.ai')}</span>
          <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted2)' }}>
            {picked.length}/{seatsForModels}
          </span>
          <span style={{
            fontSize: 12,
            color: picked.length === seatsForModels ? 'var(--green)' : 'var(--muted)',
          }}>
            {picked.length === seatsForModels
              ? t('ww.count.ready')
              : t('ww.count.need').replace('{n}', String(seatsForModels - picked.length))}
          </span>
          {picked.length < seatsForModels && (
            <button
              onClick={autoFill}
              style={{
                padding: '4px 12px', borderRadius: 999, cursor: 'none',
                border: '1px dashed var(--border2)', background: 'transparent',
                color: 'var(--muted2)', fontSize: 12, fontFamily: 'inherit',
              }}
            >🎲 {t('ww.autofill')}</button>
          )}
        </div>
        <ModelSlots
          models={models}
          picked={picked}
          onPicked={setPicked}
          seatOpts={seatOpts}
          onSeatOpts={setSeatOpts}
          allowSearch={false}
          count={seatsForModels}
          fixed
          allowDuplicates
        />

        {/* No web search at this table — deliberately (CC, Aug 3). Werewolf
            is a closed world: everything that matters is in the transcript,
            and the internet holds no evidence about who is lying HERE. The
            toggle arrived by symmetry with Discussion and only added
            per-search fees and latency to every act. */}
        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn-next" disabled={total !== size || busy} onClick={start}>
            {busy ? t('ww.dealing') : t('ww.deal')}
          </button>
          {total !== size && !busy && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('ww.count.need').replace('{n}', String(Math.abs(size - total)))}
            </span>
          )}
        </div>
      </>
    )
  }

  // ── table ──────────────────────────────────────────────────────────────
  const me = board.humanSeat !== null ? board.players[board.humanSeat] : null
  const need = board.awaiting
  const hasThinking = board.transcript.some(t => t.reasoning)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {titleDraft !== null ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => saveTitle(titleDraft)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(titleDraft); if (e.key === 'Escape') setTitleDraft(null) }}
            placeholder={t('xt.tpl.werewolf.name')}
            style={{
              fontSize: 18, fontWeight: 700, color: 'var(--white)', fontFamily: 'inherit',
              background: 'transparent', border: 'none', borderBottom: '1px solid var(--red)',
              outline: 'none', padding: '2px 0', minWidth: 240,
            }}
          />
        ) : (
          <button
            onClick={() => setTitleDraft(board.title ?? '')}
            title={t('ww.rename')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none', border: 'none',
              cursor: 'none', padding: 0, fontFamily: 'inherit',
              fontSize: 18, fontWeight: 700, color: board.title ? 'var(--white)' : 'var(--muted2)',
            }}
          >
            {board.title || t('xt.tpl.werewolf.name')}
            <span style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.7 }}>✏</span>
          </button>
        )}
      </div>
      {hasThinking && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={() => setRevealThinking(v => !v)}
            style={{
              padding: '4px 12px', borderRadius: 999, cursor: 'none', fontSize: 11.5,
              fontFamily: 'inherit',
              border: `1px solid ${revealThinking ? 'var(--red)' : 'var(--border2)'}`,
              background: revealThinking ? 'var(--red-dim)' : 'transparent',
              color: revealThinking ? 'var(--red)' : 'var(--muted2)',
            }}
          >{revealThinking ? '🙈 ' + t('ww.thinking.hide') : '👁 ' + t('ww.thinking.show')}</button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {board.players.map(p => (
          <div key={p.seat} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999,
            border: `1px solid ${p.alive ? colorOf(p.seat) : 'var(--border2)'}`,
            background: p.alive ? `${colorOf(p.seat)}12` : 'transparent',
            color: p.alive ? colorOf(p.seat) : 'var(--muted2)',
            fontSize: 12, fontWeight: 700, textDecoration: p.alive ? 'none' : 'line-through',
          }}>
            {p.isHuman ? <span>🙋</span> : <ProviderLogo provider={p.provider} size={14} />}
            {p.name}
            {p.role && <span style={{ fontWeight: 400, opacity: 0.85 }}>{t(ROLE_KEY[p.role] ?? '')}</span>}
          </div>
        ))}
      </div>
      {me && (
        <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
          {t('ww.youare').replace('{n}', me.name).replace('{r}', t(ROLE_KEY[me.role ?? 'villager']))}
          {me.role === 'wolf' && (() => {
            const pack = board.players.filter(p => p.seat !== me.seat && p.role === 'wolf').map(p => p.name)
            return pack.length > 0 ? (
              <span style={{ color: 'var(--red)', marginLeft: 10 }}>
                {t('ww.packmate').replace('{w}', pack.join(', '))}
              </span>
            ) : null
          })()}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {board.transcript.map((turn, i) => (
          <div key={i} style={{
            border: `1px solid ${turn.privateTo ? 'rgba(232,69,60,0.35)' : 'var(--border2)'}`,
            borderRadius: 10, overflow: 'hidden',
            background: turn.system && !turn.privateTo ? 'var(--surface2)' : 'var(--surface)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 13px',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: turn.system && !turn.privateTo ? 'var(--muted)' : colorOf(turn.seat),
            }}>
              <span>{turn.speaker}</span>
              {turn.privateTo && <span style={{ color: 'var(--red)', fontWeight: 400 }}>· private</span>}
              {turn.kind === 'vote' && <span style={{ opacity: 0.7, fontWeight: 400 }}>· vote</span>}
              {typeof turn.cost === 'number' && turn.cost > 0 && (
                <span style={{ marginLeft: 'auto', color: 'var(--muted2)', fontWeight: 400 }}>
                  ${turn.cost < 0.0001 ? '<0.0001' : turn.cost.toFixed(4)}
                </span>
              )}
            </div>
            <div style={{ padding: '11px 13px', fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{turn.text}</div>
            {turn.reasoning && revealThinking && (
              <div style={{
                padding: '9px 13px', borderTop: '1px dashed var(--border2)', background: 'rgba(0,0,0,0.02)',
                fontSize: 12.5, lineHeight: 1.6, color: 'var(--muted)', fontStyle: 'italic', whiteSpace: 'pre-wrap',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono), monospace', fontStyle: 'normal', fontSize: 9.5,
                  letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted2)',
                  display: 'block', marginBottom: 4,
                }}>{t('ww.thinking.label')}</span>
                {turn.reasoning}
              </div>
            )}
          </div>
        ))}
        {busy && !need && (
          <div style={{ padding: '10px 13px', fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)' }}>
            <span className="stream-cursor">▋</span> {t('ww.talking')}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

      {need && (
        <div style={{ border: '1px solid var(--red)', borderRadius: 10, padding: '13px 15px', marginBottom: 14, background: 'rgba(232,69,60,0.04)' }}>
          <div className="prompt-label" style={{ marginBottom: 9 }}>
            {t(need.kind === 'kill' ? 'ww.turn.kill' : need.kind === 'check' ? 'ww.turn.check' : need.kind === 'protect' ? 'ww.turn.protect' : need.kind === 'vote' ? 'ww.turn.vote' : 'ww.turn.speak')}
          </div>
          {need.kind === 'speak' ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <textarea value={say} onChange={e => setSay(e.target.value)} rows={2} autoFocus
                onKeyDown={e => { if (isSubmitEnter(e)) { e.preventDefault(); answer({ text: say }) } }}
                placeholder={t('ww.sayph')}
                style={{ flex: 1, padding: '10px 13px', borderRadius: 9, resize: 'none', border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit' }} />
              <button className="btn-next" disabled={busy} onClick={() => answer({ text: say })}>{t('ww.sayit')}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {need.targets.map(t => (
                <button key={t.seat} disabled={busy} onClick={() => answer({ target: t.seat })} style={{
                  padding: '7px 14px', borderRadius: 999, cursor: 'none',
                  border: `1px solid ${colorOf(t.seat)}`, background: 'transparent',
                  color: colorOf(t.seat), fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                  opacity: busy ? 0.5 : 1,
                }}>{t.name}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)' }}>
        <span>{t('ww.day').replace('{d}', String(board.day))}</span>
        <span>Total ${board.cost < 0.0001 && board.cost > 0 ? '<0.0001' : board.cost.toFixed(4)}</span>
        {board.status === 'over' && (
          <button className="btn-next" onClick={() => router.push('/xtalk')}>{t('ww.newgame')}</button>
        )}
        {confirmDelete ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ color: 'var(--red)' }}>{t('ww.delete.confirm')}</span>
            <button onClick={deleteGame} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 700 }}>
              {t('ww.delete.yes')}
            </button>
            <button onClick={() => setConfirmDelete(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'none', fontFamily: 'inherit', fontSize: 11 }}>
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'none', fontFamily: 'inherit', fontSize: 11 }}>
            {t('ww.delete')}
          </button>
        )}
        <button onClick={onExit} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'none', fontFamily: 'inherit', fontSize: 11 }}>
          {t('ww.leave')}
        </button>
      </div>
    </>
  )
}
