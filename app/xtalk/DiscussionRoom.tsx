'use client'
// app/xtalk/DiscussionRoom.tsx
// The `discussion` template: several models in an open conversation, taking
// turns over a shared transcript.
//
// Owns its turn loop on purpose: each POST to /api/xtalk is ONE speaker, so
// the user can interrupt between turns and a stalled model cannot take the
// whole round down with it.
//
// Speaking order rotates every round. Whoever goes last has read everyone
// else and looks smartest; whoever goes first sets the frame everyone argues
// inside. A fixed order would bake that advantage into the product and the
// user would read it as "that model is better". (CC, July 31)

import { useEffect, useRef, useState } from 'react'
import ProviderLogo from '../components/ProviderLogo'
import TemplateHelp from './TemplateHelp'
import { type SeatOpts } from './SeatConfig'
import ModelSlots from './ModelSlots'
import { isSubmitEnter } from '../../lib/ime'
import { useT } from '../../lib/i18n'
import type { TemplateProps, Speaker } from './templates'

type Turn = {
  /** Stable identity for the turn.
   *
   *  Streaming used to write into "the last turn in the array", which was
   *  fine while turns could only be appended by the round loop. Once you can
   *  cut in mid-round, YOUR line can become the last one after a speaker's
   *  placeholder was created — and that speaker's text then streamed into
   *  your message. Every update targets this id now. */
  id:      number
  speaker: string
  isUser:  boolean
  text:    string
  provider?: string
  cost?:   number
  error?:  string
  /** The winning bid that earned this turn (Auto order only). */
  bid?:    number
  /** Speaking credits left after paying for this turn (Auto order only). */
  credits?: number
}

let turnSeq = 0
const nextTurnId = () => ++turnSeq

/** The three speaking-order modes, labelled in the reader's language.
 *  A function, not a constant: the labels have to re-resolve when the site
 *  language changes. */
const FLOWS = (t: (k: string) => string): ['order' | 'bid' | 'manual', string][] => [
  ['order',  t('xt.d.order.inorder')],
  ['bid',    t('xt.d.order.auto')],
  ['manual', t('xt.d.order.manual')],
]

const COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399']

// Speaking-credit economy (Auto order). A seat opens with 6, earns 2 per
// round, holds at most 8: three max-urgency speeches in a row is the hard
// ceiling before a seat HAS to sit one out.
const WALLET_START = 6
const WALLET_REGEN = 2
const WALLET_CAP   = 8

// Clicking one fills the first speaker who has no character yet, so four
// clicks casts the whole room.
const PERSONA_PRESETS = [
  'a sceptic who attacks the weakest assumption',
  'an optimist who looks for the strongest version of the idea',
  'a data person who refuses to answer without numbers',
  'a founder who has actually shipped this and got burned',
  'an investor who only cares whether it makes money',
  'a beginner who asks the obvious question everyone skipped',
]

export default function DiscussionRoom({ models }: TemplateProps) {
  const t = useT()
  const [picked,   setPicked]   = useState<string[]>([])
  const [question, setQuestion] = useState('')
  // Per-speaker character. This is the real diversity lever: without it the
  // only way to stop three models agreeing is to order them to argue, which
  // makes the disagreement an artefact of the instruction rather than a
  // difference of view. (CC, July 31)
  const [personas, setPersonas] = useState<Record<string, string>>({})
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  const [turns,    setTurns]    = useState<Turn[]>([])
  const [running,  setRunning]  = useState(false)
  const [interject, setInterject] = useState('')
  const [round,    setRound]    = useState(0)
  // Who speaks when (CC, Aug 3 — split from character setup):
  //   order  — walks the list you arranged (optionally rotating the opener)
  //   bid    — Werewolf Arena's dynamic turn-taking: every seat bids 0-4
  //            for the floor before each turn, highest bid speaks, ties go
  //            to whoever the last utterance named (arXiv 2407.13943)
  //   manual — you call on speakers one at a time
  const [flow,     setFlow]     = useState<'order' | 'bid' | 'manual'>('order')
  // Speaking-credit wallet, one per seat, Auto order only (CC, Aug 3).
  // Winning the floor COSTS the winning bid; every new round pays a small
  // allowance back. The 0-4 clamp polices honesty ("was I addressed?");
  // the wallet polices frequency — three shouted 4s and you are broke,
  // while the seat that listened all round can outbid you cold.
  const walletRef = useRef<Record<string, number>>({})
  // Rotation exists because the last speaker has read everyone else and
  // therefore looks smartest — a fixed order hands that to the same seat
  // every round. But an order you set on purpose should be honoured, so
  // this is yours to turn off.
  const [rotate,   setRotate]   = useState(true)
  const turnsRef = useRef<Turn[]>([])
  // A stable id for THIS discussion so every turn + bid it bills shares one
  // ledger reference_id and collapses into a single session row. (CC, Aug 4)
  const convId = useRef<string>(crypto.randomUUID())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { turnsRef.current = turns }, [turns])
  const pickedRef = useRef<string[]>([])
  useEffect(() => { pickedRef.current = picked }, [picked])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns])


  const chosen = picked.map(id => models.find(m => m.id === id)).filter(Boolean) as Speaker[]
  const totalCost = turns.reduce((s, t) => s + (t.cost ?? 0), 0)

  const move = (id: string, dir: -1 | 1) => setPicked(prev => {
    const i = prev.indexOf(id); const j = i + dir
    if (i < 0 || j < 0 || j >= prev.length) return prev
    const next = [...prev]; ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  const MAX_SPEAKERS = 8
  const toggle = (id: string) => setPicked(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= MAX_SPEAKERS ? prev : [...prev, id])

  /** One speaker. Streams into ITS OWN turn as it arrives — see Turn.id. */
  const runTurn = async (model: Speaker, q: string, bid?: number, credits?: number) => {
    const id = nextTurnId()
    const patch = (fn: (t: Turn) => Turn) =>
      setTurns(prev => prev.map(t => (t.id === id ? fn(t) : t)))
    setTurns(prev => [...prev, { id, speaker: model.display_name, provider: model.provider, isUser: false, text: '', bid, credits }])
    // A fetch that dies at the network layer (server mid-restart, wifi blip)
    // used to throw out of here unhandled: no error card, and the throw
    // skipped the caller's setRunning(false), wedging every button until a
    // reload. Surfaced during release testing when a dev-server recompile
    // dropped the connection at exactly the wrong moment. (CC, Aug 2)
    let res: Response
    try {
      res = await fetch('/api/xtalk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: model.id,
        convId: convId.current,
        question: q,
        transcript: turnsRef.current.map(t => ({ speaker: t.speaker, isUser: t.isUser, text: t.text })),
        speakerNames: chosen.map(m => m.display_name),
        persona: personas[model.id] ?? '',
        thinking: seatOpts[model.id]?.thinking ?? null,
        search:   seatOpts[model.id]?.search === true,
      }),
    })
    } catch (err) {
      patch(t => ({ ...t, error: `network: ${String((err as Error)?.message ?? err).slice(0, 160)}` }))
      return
    }
    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => 'turn failed')
      patch(t => ({ ...t, error: msg.slice(0, 200) }))
      return
    }
    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    try {
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
          patch(t => ({ ...t, text: t.text + d.text }))
        } else if (ev === 'done') {
          patch(t => ({ ...t, cost: d.cost }))
        } else if (ev === 'error') {
          patch(t => ({ ...t, error: d.message }))
        }
      }
    }
    } catch (err) {
      patch(t => ({ ...t, error: `stream dropped: ${String((err as Error)?.message ?? err).slice(0, 160)}` }))
    }
  }

  /** One round: everybody speaks once, in an order rotated by round number. */
  const runRound = async (q: string) => {
    setRunning(true)
    try {
    const order = rotate
      ? chosen.map((_, i) => chosen[(i + round) % chosen.length])
      : chosen
    for (const m of order) {
      // `order` was fixed when the round began, but the roster is live: drop
      // someone mid-round and they must not still get a turn. Checked
      // against the ref, since setPicked has not necessarily flushed yet.
      if (!pickedRef.current.includes(m.id)) continue
      // Re-read per speaker rather than using the `q` this round started
      // with: if you interrupt mid-round, everyone after you should be
      // answering what you just said, not what opened the round.
      await runTurn(m, latestFromHuman() || q)
      // turnsRef trails setState by a tick; the next speaker must see the
      // turn that just finished or the room has no memory.
      await new Promise(r => setTimeout(r, 60))
    }
    setRound(r => r + 1)
    } finally { setRunning(false) }
  }

  /** One seat's bid for the floor. Failures bid a polite 1 — a dead seat
   *  must not silence a model for a whole round. */
  const fetchBid = async (m: Speaker): Promise<number> => {
    try {
      const res = await fetch('/api/xtalk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: m.id, bid: true, convId: convId.current,
          question: latestFromHuman() || question.trim(),
          // The bid needs recency, not history: the tail is what decides
          // whether you were just addressed.
          transcript: turnsRef.current.slice(-8).map(t => ({ speaker: t.speaker, isUser: t.isUser, text: t.text })),
          speakerNames: chosen.map(x => x.display_name),
          persona: personas[m.id] ?? '',
        }),
      })
      if (!res.ok) return 1
      const d = await res.json()
      return typeof d.bid === 'number' ? Math.max(0, Math.min(4, d.bid)) : 1
    } catch { return 1 }
  }

  /** One Auto round: as many turns as seats, each preceded by a bid poll.
   *  Highest bid takes the floor; ties break toward whoever the last
   *  utterance named, then toward whoever has spoken least this round —
   *  Werewolf Arena's rule, plus a guard against one seat monologuing. */
  const runBidRound = async (q: string) => {
    setRunning(true)
    try {
      // Wallet upkeep: newcomers get the opening stake; everyone else earns
      // the round allowance, capped so silence can't be hoarded forever.
      const W = walletRef.current
      for (const id of pickedRef.current) {
        W[id] = W[id] == null ? WALLET_START : Math.min(WALLET_CAP, W[id] + WALLET_REGEN)
      }
      const spoken: Record<string, number> = {}
      const turnsThisRound = pickedRef.current.length
      for (let t = 0; t < turnsThisRound; t++) {
        const seats = pickedRef.current
          .map(id => models.find(m => m.id === id))
          .filter(Boolean) as Speaker[]
        if (seats.length === 0) break
        const bids = await Promise.all(seats.map(m => fetchBid(m).then(b => ({ m, b }))))
        const last = turnsRef.current[turnsRef.current.length - 1]?.text ?? ''
        const mentioned = (m: Speaker) =>
          last.includes(m.display_name) || last.includes(m.display_name.split(' ')[0])
        // Bid 4 means "someone addressed me directly and I must respond" —
        // which is CHECKABLE. A model that cries 4 without being named in
        // the last utterance is demoted to a 2, so spamming the top tier
        // buys nothing. (The paper never needed this: in werewolf, hogging
        // the floor gets you lynched. A discussion room has no such immune
        // system, so the rule is enforced here instead.)
        const effective = (x: { m: Speaker; b: number }) => {
          const honest = x.b === 4 && !mentioned(x.m) ? 2 : x.b
          // You can't bid credits you don't have.
          return Math.min(honest, W[x.m.id] ?? 0)
        }
        // Fatigue: each turn already taken this round costs 300 — enough
        // that a repeat speaker at the same bid loses to a fresh voice,
        // not enough to overrule a genuinely higher bid.
        const score = (x: { m: Speaker; b: number }) =>
          effective(x) * 1000 +
          (mentioned(x.m) ? 100 : 0) -
          (spoken[x.m.id] ?? 0) * 300 +
          Math.random()
        bids.sort((a, b) => score(b) - score(a))
        const winner = bids[0]
        const paid = effective(winner)
        W[winner.m.id] = Math.max(0, (W[winner.m.id] ?? 0) - paid)
        spoken[winner.m.id] = (spoken[winner.m.id] ?? 0) + 1
        await runTurn(winner.m, latestFromHuman() || q, paid, W[winner.m.id])
        await new Promise(r => setTimeout(r, 60))
      }
      setRound(r => r + 1)
    } finally { setRunning(false) }
  }

  /** The human's most recent line, falling back to the opener.
   *
   *  Every turn used to re-send the ORIGINAL opener as "the question", so
   *  twenty turns in the models were still being handed the first thing that
   *  was typed. That is what made an open room behave like a quiz: the frame
   *  never moved even though the conversation had. */
  const latestFromHuman = () => {
    for (let i = turnsRef.current.length - 1; i >= 0; i--) {
      const t = turnsRef.current[i]
      if (t.isUser && t.text.trim()) return t.text.trim()
    }
    return question.trim()
  }

  /** Manual mode: exactly one speaker, chosen by you. */
  const speakOne = async (m: Speaker) => {
    if (running) return
    setRunning(true)
    try {
      await runTurn(m, latestFromHuman())
      setRound(r => r + 1)
    } finally { setRunning(false) }
  }

  const start = async () => {
    if (chosen.length < 2 || !question.trim() || running) return
    setTurns([{ id: nextTurnId(), speaker: 'You', isUser: true, text: question.trim() }])
    await new Promise(r => setTimeout(r, 30))
    // Manual mode opens the room and stops — the question is on the table
    // and nobody speaks until you call on them.
    if (flow === 'order') await runRound(question.trim())
    else if (flow === 'bid') await runBidRound(question.trim())
  }

  /**
   * Say something. Works WHILE a round is running, which is the whole point
   * of calling this a conversation.
   *
   * Interrupting does not start anything: the line goes into the transcript,
   * and because every speaker builds its messages from turnsRef at the
   * moment its turn begins, whoever is still to speak in the running round
   * reads it. The people who already spoke obviously do not — same as
   * talking over someone at a real table.
   */
  const sendInterjection = async () => {
    const text = interject.trim()
    if (!text) return
    setInterject('')
    setTurns(prev => [...prev, { id: nextTurnId(), speaker: 'You', isUser: true, text }])
    await new Promise(r => setTimeout(r, 30))
    // A round is already in flight — it will pick this up. Starting another
    // here would run two loops over the same room at once.
    if (running) return
    if (flow === 'order') await runRound(text)
    else if (flow === 'bid') await runBidRound(text)
  }

  const colorOf = (t: Turn) => {
    if (t.isUser) return 'var(--muted2)'
    const i = chosen.findIndex(m => m.display_name === t.speaker)
    return COLORS[i < 0 ? 0 : i % COLORS.length]
  }
  return (
    <>
{turns.length === 0 ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <TemplateHelp templateId="discussion" variant="link" />
            </div>
            <div className="prompt-label" style={{ marginBottom: 10 }}>
              {t('xt.d.pick').replace('{n}', String(MAX_SPEAKERS))}
              {picked.length > 0 && ` · ${t('xt.d.chosen').replace('{n}', String(picked.length))}`}
            </div>
            {/* One trailing empty slot, so the row shows where the next
                speaker goes instead of asking you to hunt for them in a
                grid of everything. */}
            <ModelSlots
              models={models}
              picked={picked}
              onPicked={next => setPicked(next.slice(0, MAX_SPEAKERS))}
              seatOpts={seatOpts}
              onSeatOpts={setSeatOpts}
              count={Math.min(MAX_SPEAKERS, Math.max(2, picked.length + 1))}
            />

            {chosen.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                {/* ── Speaking order ── (its own section — CC, Aug 3) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div className="prompt-label" style={{ margin: 0 }}>{t('xt.d.order')}</div>
                  <div style={{ display: 'inline-flex', padding: 3, gap: 3, borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--surface)' }}>
                    {(FLOWS(t)).map(([k, label]) => (
                      <button key={k} className={`surface-tab${flow === k ? ' on' : ''}`} onClick={() => setFlow(k)}>{label}</button>
                    ))}
                  </div>
                  {flow === 'order' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'none' }}>
                      <input type="checkbox" checked={rotate} onChange={e => setRotate(e.target.checked)} />
                      {t('xt.d.rotate')}
                    </label>
                  )}
                </div>

                {flow === 'order' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                    {chosen.map((m, i) => (
                      <div key={m.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        border: '1px solid var(--border2)', borderRadius: 9,
                        background: 'var(--surface)', padding: '7px 12px',
                      }}>
                        <span style={{
                          width: 18, textAlign: 'center', flexShrink: 0,
                          fontFamily: 'var(--font-mono), monospace', fontSize: 11,
                          color: 'var(--muted2)',
                        }}>{i + 1}</span>
                        {/* Arrows rather than drag: the whole list is four rows,
                            and a drag target that small is worse than a button. */}
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                          <button onClick={() => move(m.id, -1)} disabled={i === 0} aria-label="move up"
                            style={{ border: 'none', background: 'none', cursor: 'none', lineHeight: 0.8, fontSize: 11, padding: 0, color: i === 0 ? 'var(--border2)' : 'var(--muted)' }}>▲</button>
                          <button onClick={() => move(m.id, 1)} disabled={i === chosen.length - 1} aria-label="move down"
                            style={{ border: 'none', background: 'none', cursor: 'none', lineHeight: 0.8, fontSize: 11, padding: 0, color: i === chosen.length - 1 ? 'var(--border2)' : 'var(--muted)' }}>▼</button>
                        </span>
                        <ProviderLogo provider={m.provider} size={15} />
                        <span style={{
                          fontSize: 12, fontWeight: 700, color: COLORS[i % COLORS.length],
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{m.display_name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {flow === 'bid' && (
                  <div style={{
                    border: '1px dashed var(--border2)', borderRadius: 9, padding: '9px 13px',
                    marginBottom: 18, fontSize: 12, lineHeight: 1.6, color: 'var(--muted2)',
                  }}>
                    {t('xt.d.bidnote')
                      .replace('{s}', String(WALLET_START))
                      .replace('{r}', String(WALLET_REGEN))
                      .replace('{c}', String(WALLET_CAP))}
                  </div>
                )}
                {flow === 'manual' && (
                  <div style={{
                    border: '1px dashed var(--border2)', borderRadius: 9, padding: '9px 13px',
                    marginBottom: 18, fontSize: 12, lineHeight: 1.6, color: 'var(--muted2)',
                  }}>
                    {t('xt.d.manualnote')}
                  </div>
                )}

                {/* ── Character ── the real diversity lever: without it the
                    only way to stop three models agreeing is to order them to
                    argue, which makes the disagreement an artefact of the
                    instruction rather than a difference of view. (CC, July 31) */}
                <div className="prompt-label" style={{ marginBottom: 10 }}>{t('xt.d.character')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {chosen.map((m, i) => (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      border: '1px solid var(--border2)', borderRadius: 9,
                      background: 'var(--surface)', padding: '8px 12px',
                    }}>
                      <ProviderLogo provider={m.provider} size={15} />
                      <span style={{
                        minWidth: 128, fontSize: 12, fontWeight: 700,
                        color: COLORS[i % COLORS.length],
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{m.display_name}</span>
                      <input
                        value={personas[m.id] ?? ''}
                        onChange={e => setPersonas(p => ({ ...p, [m.id]: e.target.value }))}
                        placeholder="e.g. a sceptical CFO who wants the numbers"
                        style={{
                          flex: 1, border: 'none', background: 'transparent',
                          color: 'var(--white)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                    </div>
                  ))}
                </div>
                {/* Presets, because typing four characters before you can ask
                    anything is exactly the friction this product avoids. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {PERSONA_PRESETS.map(p => (
                    <button key={p} onClick={() => {
                      const empty = chosen.find(m => !(personas[m.id] ?? '').trim())
                      if (empty) setPersonas(prev => ({ ...prev, [empty.id]: p }))
                    }}
                      style={{
                        padding: '5px 11px', borderRadius: 999, cursor: 'none',
                        border: '1px solid var(--border2)', background: 'transparent',
                        color: 'var(--muted)', fontSize: 12, fontFamily: 'inherit',
                      }}>+ {p}</button>
                  ))}
                  {Object.values(personas).some(v => v.trim()) && (
                    <button onClick={() => setPersonas({})}
                      style={{
                        padding: '5px 11px', borderRadius: 999, cursor: 'none',
                        border: 'none', background: 'transparent',
                        color: 'var(--muted2)', fontSize: 12, fontFamily: 'inherit',
                      }}>clear</button>
                  )}
                </div>
              </div>
            )}

            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder={t('xt.d.ph.start')}
              rows={3}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 10, resize: 'vertical',
                border: '1px solid var(--border2)', background: 'var(--surface)',
                color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', marginBottom: 14,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button className="btn-next" disabled={chosen.length < 2 || !question.trim()} onClick={start}>
                {t('xt.d.open')}
              </button>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)' }}>
                {chosen.length < 2 ? t('xt.d.need2')
                  : flow === 'manual' ? `${t('xt.d.speakers').replace('{n}', String(chosen.length))} · ${t('xt.d.sum.manual')}`
                  : flow === 'bid' ? `${t('xt.d.speakers').replace('{n}', String(chosen.length))} · ${t('xt.d.sum.bid')}`
                  : `${t('xt.d.speakers').replace('{n}', String(chosen.length))} · ${chosen.map(m => m.display_name.split(' ')[0]).join(' → ')}`}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {turns.map((t, i) => (
                <div key={i} style={{
                  border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden',
                  background: t.isUser ? 'var(--surface2)' : 'var(--surface)',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                    borderBottom: '1px solid var(--border)',
                    fontFamily: 'var(--font-mono), monospace', fontSize: 11,
                    color: colorOf(t), fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    {!t.isUser && t.provider && <ProviderLogo provider={t.provider} size={14} />}
                    <span>{t.speaker}</span>
                    {typeof t.bid === 'number' && (
                      <span title={`Bid ${t.bid} for the floor and paid it in speaking credits${typeof t.credits === 'number' ? ` — ${t.credits} left` : ''}`} style={{
                        padding: '1px 7px', borderRadius: 999, fontSize: 9.5, fontWeight: 700,
                        border: '1px solid var(--border2)', color: 'var(--muted2)', letterSpacing: '.06em',
                      }}>BID {t.bid}{typeof t.credits === 'number' ? ` · ${t.credits}cr` : ''}</span>
                    )}
                    {typeof t.cost === 'number' && t.cost > 0 && (
                      <span style={{ marginLeft: 'auto', color: 'var(--muted2)', fontWeight: 400 }}>
                        ${t.cost < 0.0001 ? '<0.0001' : t.cost.toFixed(4)}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '12px 14px', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {t.error
                      ? <span style={{ color: 'var(--red)' }}>⚠ {t.error}</span>
                      : t.text || <span className="stream-cursor">▋</span>}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Speaking order stays changeable mid-conversation (CC, Aug 3):
                a room that opened on Auto can be taken over by hand the
                moment it drifts. Switching only affects the NEXT action —
                any round already running finishes on its old rule. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="prompt-label" style={{ margin: 0 }}>{t('xt.d.order')}</span>
              <div style={{ display: 'inline-flex', padding: 3, gap: 3, borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--surface)' }}>
                {(FLOWS(t)).map(([k, label]) => (
                  <button key={k} className={`surface-tab${flow === k ? ' on' : ''}`} onClick={() => setFlow(k)}>{label}</button>
                ))}
              </div>
              {flow === 'order' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'none' }}>
                  <input type="checkbox" checked={rotate} onChange={e => setRotate(e.target.checked)} />
                  {t('xt.d.rotate')}
                </label>
              )}
            </div>

            {flow === 'manual' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12, alignItems: 'center' }}>
                <span className="prompt-label" style={{ margin: 0 }}>{t('xt.d.whonext')}</span>
                {chosen.map((m, i) => (
                  <button key={m.id} disabled={running} onClick={() => speakOne(m)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      padding: '6px 12px', borderRadius: 999, cursor: 'none',
                      border: `1px solid ${COLORS[i % COLORS.length]}`,
                      background: 'transparent', color: COLORS[i % COLORS.length],
                      fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                      opacity: running ? 0.45 : 1,
                    }}>
                    <ProviderLogo provider={m.provider} size={13} />{m.display_name}
                  </button>
                ))}
              </div>
            )}

            {/* Live roster. A conversation where nobody can arrive or leave
                is a panel, not a room — and the setup screen vanishes the
                moment the first turn lands, so this was the only place the
                cast could stay editable. A model added here reads the whole
                transcript on its first turn, the same as everyone else. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              marginBottom: 12, paddingBottom: 12, borderBottom: '1px dashed var(--border)',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 10,
                letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4,
              }}>{t('xt.d.inroom')}</span>

              {chosen.map((m, i) => (
                <span key={m.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 6px 3px 9px', borderRadius: 999, fontSize: 11.5,
                  border: `1px solid ${COLORS[i % COLORS.length]}55`,
                  color: COLORS[i % COLORS.length],
                }}>
                  {m.display_name}
                  <button
                    onClick={() => toggle(m.id)}
                    disabled={chosen.length <= 1}
                    aria-label={`remove ${m.display_name}`}
                    title={chosen.length <= 1 ? 'Someone has to be in the room' : 'They leave'}
                    style={{
                      border: 'none', background: 'none', cursor: 'none', padding: 0,
                      fontSize: 13, lineHeight: 1, color: 'inherit',
                      opacity: chosen.length <= 1 ? .3 : .6,
                    }}
                  >×</button>
                </span>
              ))}

              {models.filter(m => !picked.includes(m.id)).length > 0 && picked.length < MAX_SPEAKERS && (
                <details style={{ display: 'inline-block' }}>
                  <summary style={{
                    listStyle: 'none', cursor: 'none', padding: '3px 10px', borderRadius: 999,
                    border: '1px dashed var(--border2)', fontSize: 11.5, color: 'var(--muted2)',
                  }}>+ invite</summary>
                  <div style={{
                    display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8,
                    padding: '9px 10px', borderRadius: 10,
                    border: '1px solid var(--border2)', background: 'var(--surface)',
                  }}>
                    {models.filter(m => !picked.includes(m.id)).map(m => (
                      <button key={m.id} onClick={() => toggle(m.id)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 10px', borderRadius: 999, cursor: 'none',
                        border: '1px solid var(--border2)', background: 'var(--bg)',
                        color: 'var(--white)', fontSize: 11.5, fontFamily: 'inherit',
                      }}>
                        <ProviderLogo provider={m.provider} size={13} />
                        {m.display_name}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                value={interject}
                onChange={e => setInterject(e.target.value)}
                onKeyDown={e => { if (isSubmitEnter(e)) { e.preventDefault(); sendInterjection() } }}
                placeholder={running ? t('xt.d.ph.cutin') : flow === 'manual' ? t('xt.d.ph.manual') : t('xt.d.ph.say')}
                rows={2}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: 10, resize: 'none',
                  border: '1px solid var(--border2)', background: 'var(--surface)',
                  color: 'var(--white)', fontSize: 14, fontFamily: 'inherit',
                }}
              />
              {/* Typed text always sends, running or not. The button only
                  falls back to "start another round" when the box is empty
                  and nothing is in flight. */}
              <button
                className="btn-next"
                disabled={running && !interject.trim()}
                onClick={() => {
                  if (interject.trim()) return void sendInterjection()
                  if (running) return
                  if (flow === 'order') return void runRound(latestFromHuman())
                  if (flow === 'bid')   return void runBidRound(latestFromHuman())
                }}
              >
                {interject.trim() ? 'Say it' : running ? 'Talking…' : flow !== 'manual' ? 'Another round' : 'Say it'}
              </button>
            </div>
            <div style={{
              marginTop: 12, display: 'flex', gap: 16,
              fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)',
            }}>
              <span>Round {round}</span>
              <span>Total ${totalCost < 0.0001 && totalCost > 0 ? '<0.0001' : totalCost.toFixed(4)}</span>
              <button onClick={() => { setTurns([]); setRound(0) }}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'none', fontFamily: 'inherit', fontSize: 11 }}>
                New room
              </button>
            </div>
          </>
        )}
      </>
  )
}