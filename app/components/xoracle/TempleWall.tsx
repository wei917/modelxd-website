'use client'
// app/components/xoracle/TempleWall.tsx — 觀音廟's 廟外 (Oct 22; owner:
// 「一般廟裡如果抽到不好的簽 會讓用戶掛在廟外。有些廟則是可以讓用戶付錢許願，然後也是掛在廟外。」).
// docs/GUANYIN-HANGING-PLAN.md is the spec; lib/xoracle-wall.ts the rules.
//
//   <TempleWall />                  the section under the room's form: the
//                                   rope rack with the sticks people tied, the
//                                   wish plaques, 掛許願牌, and 我的心願.
//   <TieStrip readingId n … />      under a drawn stick: the offer to tie it
//                                   outside, then the rack with it on.
//
// Everything opens in place (owner, Oct 4: no popups). Phone width first. The
// pictures are generated (public/xoracle/wall/, scripts/guanyin-wall-art.ts);
// code only lays the words over them. Both features need an account (owner,
// Oct 22): a visitor not signed in gets the sign-in dialog, and a stick they
// asked to tie waits in sessionStorage until they come back signed in.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { useAuthModal } from '@/lib/AuthModalContext'
import { useLang } from '@/lib/i18n'
import { WISH_FOR, REPORT_REASONS, WISH_MAX, charCount, cleanWish, wishProblem, badLuck, isUp, type WallItem, type MyItem } from '@/lib/xoracle-wall'
import { wallWords } from './wall-copy'

const PENDING_TIE = 'xoracle.wall.pendingTie'
const SLIP_W = 5.5          // % of the rack's width
const PER_CORD = 12
// Where the rack's two red cords run, measured on public/xoracle/wall/rack.avif
// (1200×800): 32.3% and 52.9% of its height, from 5.6% to 94.4% of its width.
const CORDS = [32.3, 52.9]
// Slips hang between the posts, clear of them.
const CORD_X0 = 9.5, CORD_X1 = 90.5
// The slip picture is 160×360 with its own cord 8 px from the top.
const SLIP_CORD = 8 / 360

type Wall = { sticks: WallItem[]; wishes: WallItem[]; counts: { sticks: number; wishes: number }; more: boolean }
type Words = ReturnType<typeof wallWords>

// ── Shared state ──────────────────────────────────────────────────────────

function useSignedIn(): boolean | null {
  const [signed, setSigned] = useState<boolean | null>(null)
  useEffect(() => {
    const sb = createSupabaseBrowser()
    let live = true
    sb.auth.getSession().then(({ data }) => { if (live) setSigned(!!data.session) })
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSigned(!!s))
    return () => { live = false; sub.subscription.unsubscribe() }
  }, [])
  return signed
}

function useWall(signed: boolean | null) {
  const [wall, setWall] = useState<Wall | null>(null)
  const [mine, setMine] = useState<MyItem[]>([])
  const [admin, setAdmin] = useState(false)
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    let live = true
    fetch('/api/xoracle/wall').then(async r => {
      if (r.status === 503) { if (live) setClosed(true); return }
      const j = await r.json().catch(() => null)
      if (live && j?.sticks) setWall(j)
    }).catch(() => {})
    return () => { live = false }
  }, [])
  const loadMine = useCallback(async () => {
    const r = await fetch('/api/xoracle/wall?mine=1', { cache: 'no-store' }).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    setMine(Array.isArray(j?.items) ? j.items : [])
    setAdmin(!!j?.admin)
  }, [])
  useEffect(() => { if (signed) void loadMine(); else if (signed === false) setMine([]) }, [signed, loadMine])
  const loadMore = useCallback(async () => {
    const last = wall?.wishes[wall.wishes.length - 1]
    if (!last) return
    const r = await fetch(`/api/xoracle/wall?before=${encodeURIComponent(last.at)}`).catch(() => null)
    const j = r?.ok ? await r.json().catch(() => null) : null
    if (j?.wishes) setWall(w => w ? { ...w, wishes: [...w.wishes, ...j.wishes], more: !!j.more } : w)
  }, [wall])
  const put = useCallback((item: MyItem) => setMine(m => [item, ...m.filter(x => x.id !== item.id)]), [])
  // The wall is cached for a few seconds at the edge: the viewer's own rows
  // still up are laid over it, marked as theirs.
  const merged = useMemo(() => {
    // A sealed plaque of one's own shows its back here, as everyone sees it;
    // its words are in 我的心願.
    const ownUp = mine.filter(m => isUp(m)).map(m => m.sealed ? { ...m, text: null } : m)
    const ownIds = new Set(mine.map(m => m.id))
    const pick = (kind: 'stick' | 'wish', list: WallItem[]) => [...ownUp.filter(m => m.kind === kind), ...list.filter(x => !ownIds.has(x.id))]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    const extra = (kind: 'stick' | 'wish') => ownUp.filter(m => m.kind === kind && !(wall?.[kind === 'stick' ? 'sticks' : 'wishes'] ?? []).some(x => x.id === m.id)).length
    return {
      sticks: pick('stick', wall?.sticks ?? []),
      wishes: pick('wish', wall?.wishes ?? []),
      counts: { sticks: (wall?.counts.sticks ?? 0) + extra('stick'), wishes: (wall?.counts.wishes ?? 0) + extra('wish') },
    }
  }, [wall, mine])
  return { wall, mine, admin, closed, merged, loadMore, put, loadMine }
}

type Pending = { n: number; edition: 'yibai' | 'gansan'; ask: string; lang: string; at: number }

/** A stick drawn without a saved visit, tied once the visitor is signed in:
 *  the visit is saved through the chart route (the same free call the ritual
 *  makes; the stick's number travels from the browser either way), the stick
 *  tied to it, and the saved visit opened. False when it could not be saved. */
async function tieWithoutVisit(p: Pending): Promise<boolean> {
  const c = await fetch('/api/xoracle/chart', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temple: 'guanyin', n: p.n, edition: p.edition, ask: p.ask ?? '', name: '', city: '' }) }).catch(() => null)
  const cj = c?.ok ? await c.json().catch(() => null) : null
  if (!cj?.readingId) return false
  await fetch('/api/xoracle/wall/tie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readingId: cj.readingId, lang: p.lang }) }).catch(() => null)
  window.location.assign(`${window.location.pathname}?reading=${cj.readingId}`)
  return true
}

/** A stick a visitor asked to tie before signing in, finished when they are
 *  back signed in (after the sign-in round trip, or in place). */
function usePendingTie(signed: boolean | null) {
  const [working, setWorking] = useState(false)
  useEffect(() => {
    if (!signed) return
    let p: Pending | null = null
    try { p = JSON.parse(sessionStorage.getItem(PENDING_TIE) ?? 'null'); sessionStorage.removeItem(PENDING_TIE) } catch { p = null }
    if (!p || typeof p.n !== 'number' || Date.now() - (p.at ?? 0) > 2 * 3_600_000) return
    setWorking(true)
    void tieWithoutVisit(p).then(ok => { if (!ok) setWorking(false) })
  }, [signed])
  return working
}

const dateOf = (iso: string, lang: string) => {
  try { return new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric' }).format(new Date(iso)) } catch { return iso.slice(5, 10) }
}
/** A small, steady tilt per item, from its id. */
const tilt = (id: string, max: number) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return ((Math.abs(h) % 1000) / 1000 * 2 - 1) * max }
const pill = (bg: string, fg = '#fff') => ({ padding: '9px 20px', borderRadius: 999, border: 'none', background: bg, color: fg, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', font: 'inherit' } as const)
const linkBtn = { border: 'none', background: 'none', padding: 0, color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: 'pointer', font: 'inherit' } as const

// ── The rack ──────────────────────────────────────────────────────────────

function Rack({ sticks, w, lang, fresh }: { sticks: WallItem[]; w: Words; lang: string; fresh?: string | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const shown = sticks.slice(0, PER_CORD * CORDS.length)
  const step = (CORD_X1 - CORD_X0) / PER_CORD
  const pickedItem = shown.find(s => s.id === picked) ?? null
  return (
    // At most 720 px wide: the full desktop column made the rack 600 px tall.
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="xoracle-wall-rack" style={{ position: 'relative', width: '100%', aspectRatio: '3 / 2', backgroundImage: 'url(/xoracle/wall/rack.avif)', backgroundSize: 'cover', borderRadius: 10, overflow: 'hidden', containerType: 'inline-size' }}>
        {shown.map((s, i) => {
          const cord = Math.floor(i / PER_CORD), slot = i % PER_CORD
          // The slip's height in rack-height %: its width × the rack's 3:2 × the slip's 9:4.
          const h = SLIP_W * 1.5 * 2.25
          const left = CORD_X0 + slot * step + (step - SLIP_W) / 2
          const top = CORDS[cord] - SLIP_CORD * h
          return (
            <button key={s.id} type="button" onClick={() => setPicked(p => p === s.id ? null : s.id)}
              aria-label={`${w.w('stickLabel', { n: s.n ?? '' })} ${s.luck ?? ''} ${dateOf(s.at, lang)}`}
              className={s.id === fresh ? 'xoracle-wall-new' : undefined}
              style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, width: `${SLIP_W}%`, height: `${h}%`, padding: 0, border: 'none', cursor: 'pointer',
                background: 'url(/xoracle/wall/slip.avif) top center / 100% 100% no-repeat', transform: `rotate(${tilt(s.id, 4).toFixed(1)}deg)`, transformOrigin: '50% 2%',
                filter: s.mine ? 'drop-shadow(0 0 3px #e0a100) drop-shadow(0 0 1px #e0a100)' : picked === s.id ? 'drop-shadow(0 0 2px var(--red))' : undefined }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: '24%', display: 'flex', justifyContent: 'center' }}>
                <span style={{ writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: 'var(--xoracle-serif, serif)', fontWeight: 700,
                  fontSize: 'clamp(7px, 2.3cqw, 13px)', lineHeight: 1, letterSpacing: '-0.05em', color: '#7a2a20' }}>{s.n}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div aria-live="polite" style={{ minHeight: 20, marginTop: 6, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>
        {pickedItem && <>{w.w('stickLabel', { n: pickedItem.n ?? '' })}{pickedItem.luck ? ` · ${pickedItem.luck}` : ''} · {dateOf(pickedItem.at, lang)}{pickedItem.mine ? ` · ${w.w('yours')}` : ''}</>}
      </div>
    </div>
  )
}

// ── Plaques ───────────────────────────────────────────────────────────────

/** One plaque: the front with the words, or the back (sealed) with the stamp. */
function PlaqueFace({ item, w, lang, big = false }: { item: WallItem; w: Words; lang: string; big?: boolean }) {
  const back = item.text == null || item.text === ''
  const len = charCount(item.text ?? '')
  const size = big ? (len <= 20 ? 7.5 : len <= 40 ? 6 : 5) : (len <= 12 ? 9 : len <= 30 ? 7 : 6)
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '480 / 464', containerType: 'inline-size',
      background: `url(/xoracle/wall/${back ? 'plaque-back' : 'plaque'}.avif) center / contain no-repeat` }}>
      {back ? (
        <div style={{ position: 'absolute', left: '12%', right: '12%', top: '66%', textAlign: 'center', fontFamily: 'var(--xoracle-serif, serif)', color: '#5b3a1e' }}>
          <div style={{ fontSize: '8cqw', fontWeight: 700, lineHeight: 1.2 }}>{w.forWord(item.wishFor) || w.w('sealedBack')}</div>
          <div style={{ fontSize: '4.6cqw', opacity: 0.75, marginTop: '1.5cqw' }}>{dateOf(item.at, lang)}</div>
        </div>
      ) : (
        <>
          <div style={{ position: 'absolute', left: '11%', right: '11%', top: '50%', bottom: '14%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <p style={{ margin: 0, textAlign: 'center', fontFamily: 'var(--xoracle-serif, serif)', fontWeight: 600, color: '#3d2a17', fontSize: `${size}cqw`, lineHeight: 1.35, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p>
          </div>
          <div style={{ position: 'absolute', left: '11%', right: '11%', bottom: '5.5%', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '4.4cqw', color: '#6b4a2c' }}>
            <span style={{ color: '#a3271f', fontWeight: 700 }}>{w.forWord(item.wishFor)}</span>
            <span style={{ opacity: 0.8 }}>{dateOf(item.at, lang)}</span>
          </div>
        </>
      )}
      {item.fulfilled && (
        <span style={{ position: 'absolute', right: '6%', top: '44%', padding: '0.6cqw 2.4cqw', borderRadius: 999, background: '#c8322a', color: '#fff', fontSize: '4.4cqw', fontWeight: 700, transform: 'rotate(6deg)' }}>{w.w('cameTrueTag')}</span>
      )}
    </div>
  )
}

function ReportBox({ id, w, onDone }: { id: string; w: Words; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!reason || busy) return
    setBusy(true)
    const r = await fetch('/api/xoracle/wall/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, reason, details }) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    setBusy(false)
    onDone(r?.ok ? w.w('reported') : w.err(j?.code))
  }
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{w.w('reportWhy')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {REPORT_REASONS.map(k => (
          <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k)}
            style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border2)', background: reason === k ? 'var(--surface2)' : 'transparent', color: 'var(--white)', fontSize: 12.5, cursor: 'pointer', font: 'inherit' }}>{w.reason(k)}</button>
        ))}
      </div>
      <input value={details} maxLength={300} onChange={e => setDetails(e.target.value)} placeholder={w.w('reportDetails')} aria-label={w.w('reportDetails')}
        style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', color: 'var(--white)', fontSize: 16 }} />
      <div><button type="button" disabled={!reason || busy} onClick={send} style={{ ...pill('var(--white)'), opacity: reason ? 1 : 0.5 }}>{w.w('reportSend')}</button></div>
    </div>
  )
}

function PlaqueGrid({ wishes, w, lang, signed, admin, fresh, onHidden }: { wishes: WallItem[]; w: Words; lang: string; signed: boolean | null; admin: boolean; fresh?: string | null; onHidden: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [note, setNote] = useState('')
  const { show: showSignIn } = useAuthModal()
  const hide = async (id: string) => {
    const r = await fetch('/api/xoracle/wall/wish', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'hide' }) }).catch(() => null)
    if (r?.ok) { onHidden(id); setOpen(null) }
  }
  if (!wishes.length) return null
  return (
    // Two a row on a phone (the section is ~295 px inside), five or six on a desktop.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: '12px 10px' }}>
      {wishes.map(item => {
        const isOpen = open === item.id
        return (
          <div key={item.id} className={item.id === fresh ? 'xoracle-wall-hung' : undefined}
            style={isOpen ? { gridColumn: '1 / -1', display: 'grid', justifyItems: 'center', gap: 6, padding: '6px 0 10px' } : { transform: `rotate(${tilt(item.id, 2.5).toFixed(1)}deg)`, transformOrigin: '50% 0' }}>
            <button type="button" onClick={() => { setOpen(o => o === item.id ? null : item.id); setReporting(false); setNote('') }} aria-expanded={isOpen}
              style={{ display: 'block', width: '100%', maxWidth: isOpen ? 420 : undefined, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                filter: item.mine ? 'drop-shadow(0 0 4px #e0a100)' : undefined }}>
              <PlaqueFace item={item} w={w} lang={lang} big={isOpen} />
            </button>
            {isOpen && (
              <div style={{ width: '100%', maxWidth: 420, fontSize: 12.5, color: 'var(--muted)' }}>
                <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {item.mine ? <span>{w.w('yours')}</span>
                    : item.text ? <button type="button" style={{ ...linkBtn, color: 'var(--muted)', fontWeight: 600 }} onClick={() => { if (!signed) { showSignIn(); return } setReporting(r => !r) }}>{w.w('report')}</button> : null}
                  {admin && !item.mine && <button type="button" style={{ ...linkBtn, color: 'var(--muted)', fontWeight: 600 }} onClick={() => hide(item.id)}>{w.w('hide')}</button>}
                </div>
                {note ? <p role="status" style={{ textAlign: 'center', margin: '8px 0 0' }}>{note}</p>
                  : reporting && <ReportBox id={item.id} w={w} onDone={msg => { setNote(msg); setReporting(false) }} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Writing a wish ────────────────────────────────────────────────────────

function WishEditor({ w, lang, onHung, onCancel }: { w: Words; lang: string; onHung: (item: MyItem) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const [wishFor, setWishFor] = useState<string | null>(null)
  const [sealed, setSealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [noCredit, setNoCredit] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    area.current?.focus({ preventScroll: true })
    createSupabaseBrowser().from('user_credits').select('balance_cents').maybeSingle()
      .then(({ data }) => setBalance(typeof (data as any)?.balance_cents === 'number' ? (data as any).balance_cents : null))
  }, [])
  const clean = cleanWish(text)
  const problem = wishProblem(clean)
  const live = problem === 'contact' || problem === 'too_long' ? w.err(`wish_${problem}`) : null
  const send = async () => {
    if (busy || problem) { if (problem) setErr(w.err(`wish_${problem}`)); return }
    setBusy(true); setErr(null); setNoCredit(false)
    const r = await fetch('/api/xoracle/wall/wish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, wishFor, sealed, lang }) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    setBusy(false)
    if (r?.ok && j?.item) { onHung(j.item); return }
    setErr(w.err(j?.code))
    setNoCredit(j?.code === 'no_credits')
  }
  return (
    <div className="xoracle-wall-editor" style={{ display: 'grid', gap: 12, justifyItems: 'center', padding: '14px 0 4px' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 420, aspectRatio: '480 / 464', background: 'url(/xoracle/wall/plaque.avif) center / contain no-repeat', containerType: 'inline-size' }}>
        <textarea ref={area} value={text} onChange={e => setText(e.target.value.slice(0, WISH_MAX + 20))} placeholder={w.w('placeholder')} aria-label={w.w('wishButton')}
          rows={4} style={{ position: 'absolute', left: '11%', width: '78%', top: '49%', height: '36%', resize: 'none', border: '1px dashed rgba(107,74,44,0.35)', borderRadius: 6,
            background: 'rgba(255,255,255,0.35)', textAlign: 'center', fontFamily: 'var(--xoracle-serif, serif)', fontWeight: 600, color: '#3d2a17', fontSize: 16, lineHeight: 1.4, padding: '6px 8px' }} />
      </div>
      <div style={{ fontSize: 12, color: live ? 'var(--red)' : 'var(--muted2)' }}>{live ?? `${charCount(clean)}/${WISH_MAX}`}</div>
      <div style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{w.w('wishFor')}</div>
        <div role="group" aria-label={w.w('wishFor')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {WISH_FOR.map(k => (
            <button key={k} type="button" aria-pressed={wishFor === k} onClick={() => setWishFor(f => f === k ? null : k)}
              style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${wishFor === k ? 'var(--red)' : 'var(--border2)'}`, background: wishFor === k ? 'var(--red-dim, rgba(214,59,50,0.1))' : 'transparent', color: wishFor === k ? 'var(--red)' : 'var(--white)', fontSize: 13, cursor: 'pointer', font: 'inherit' }}>{w.forWord(k)}</button>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
          <input type="checkbox" checked={sealed} onChange={e => setSealed(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{w.w('seal')}<span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted2)', marginTop: 2 }}>{w.w('sealNote')}</span></span>
        </label>
        <div style={{ fontSize: 12, color: 'var(--muted2)', marginTop: 4 }}>
          {w.w('priceLine')}{balance != null ? ` · ${w.w('balance', { b: `$${(balance / 100).toFixed(2)}` })}` : ''}
        </div>
        {err && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{err} {noCredit && <a href="/profile" style={{ color: 'var(--red)', fontWeight: 700 }}>{w.w('topUp')}</a>}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button type="button" onClick={send} disabled={busy || !clean} aria-busy={busy || undefined} style={{ ...pill('var(--red)'), opacity: busy || !clean ? 0.55 : 1 }}>{busy ? w.w('paying') : w.w('pay')}</button>
          <button type="button" onClick={onCancel} disabled={busy} style={{ ...linkBtn, color: 'var(--muted)' }}>{w.w('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

function MyWishes({ mine, w, onChange }: { mine: MyItem[]; w: Words; onChange: (item: MyItem) => void }) {
  const wishes = mine.filter(m => m.kind === 'wish' && !m.takenDown)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null)
  if (!wishes.length) return null
  const act = async (id: string, action: string) => {
    setBusy(id); setErr(null)
    const r = await fetch('/api/xoracle/wall/wish', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    setBusy(null); setConfirm(null)
    if (r?.ok && j?.item) onChange(j.item)
    else setErr({ id, msg: w.err(j?.code) })
  }
  const small = { ...linkBtn, fontSize: 12.5, fontWeight: 600 }
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{w.w('mine')}</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {wishes.map(m => {
          const left = Math.ceil((Date.parse(m.downAt) - Date.now()) / 86_400_000)
          return (
            <div key={m.id} style={{ fontSize: 13, display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                {m.wishFor && <b style={{ color: 'var(--red)' }}>{w.forWord(m.wishFor)}</b>}
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{m.text}</span>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted2)', alignItems: 'baseline' }}>
                <span>{m.hidden ? w.w('hidden') : left > 0 ? w.w('daysLeft', { d: left }) : w.w('done')}</span>
                {m.fulfilled && <span style={{ color: 'var(--red)' }}>{w.w('cameTrueTag')}</span>}
                {left > 0 && <>
                  <button type="button" disabled={busy === m.id} style={small} onClick={() => act(m.id, m.sealed ? 'open' : 'seal')}>{m.sealed ? w.w('openIt') : w.w('sealIt')}</button>
                  <button type="button" disabled={busy === m.id} style={small} onClick={() => act(m.id, m.fulfilled ? 'unfulfil' : 'fulfil')}>{m.fulfilled ? w.w('undoTrue') : w.w('cameTrue')}</button>
                  {confirm === m.id
                    ? <span>{w.w('takeDownAsk')} <button type="button" style={small} onClick={() => act(m.id, 'take_down')}>{w.w('takeDown')}</button> <button type="button" style={{ ...small, color: 'var(--muted)' }} onClick={() => setConfirm(null)}>{w.w('cancel')}</button></span>
                    : <button type="button" style={{ ...small, color: 'var(--muted)' }} onClick={() => setConfirm(m.id)}>{w.w('takeDown')}</button>}
                </>}
              </div>
              {err?.id === m.id && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{err.msg}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── The section ───────────────────────────────────────────────────────────

/** The 廟外 section: under the room's form, or opened from a drawn stick. */
export default function TempleWall({ startWriting = false, fresh = null, embedded = false }: { startWriting?: boolean; fresh?: string | null; embedded?: boolean }) {
  const { lang } = useLang()
  const w = wallWords(lang)
  const signed = useSignedIn()
  const { mine, admin, closed, merged, loadMore, put, wall } = useWall(signed)
  const working = usePendingTie(signed)
  const { show: showSignIn } = useAuthModal()
  const [writing, setWriting] = useState(startWriting)
  const [hungId, setHungId] = useState<string | null>(null)
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const wishes = merged.wishes.filter(x => !hiddenIds.includes(x.id))
  const write = () => { if (signed === false) { showSignIn(); return } setWriting(true) }
  useEffect(() => { if (startWriting && signed === false) { setWriting(false) } }, [startWriting, signed])
  if (closed) return null
  return (
    <section className="xoracle-wall" aria-labelledby="xoracle-wall-h" style={embedded ? { marginTop: 12 } : { border: '1px solid var(--border2)', borderRadius: 12, background: 'var(--surface)', padding: '16px 16px 14px', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 id="xoracle-wall-h" style={{ margin: 0, fontSize: 17, fontWeight: 800, fontFamily: 'var(--xoracle-serif, serif)' }}>{w.w('section')}</h2>
        {wall && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{merged.counts.sticks + merged.counts.wishes ? w.w('counts', { s: merged.counts.sticks, w: merged.counts.wishes }) : w.w('empty')}</span>}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted2)' }}>{w.w('sectionNote')}</p>
      {working && <p role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>{w.w('tying')}</p>}
      <Rack sticks={merged.sticks} w={w} lang={lang} fresh={fresh} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 10px' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{w.w('wishes')}</h3>
        <span style={{ flex: 1 }} />
        {!writing && <button type="button" onClick={write} style={pill('var(--red)')}>{w.w('wishButton')}</button>}
      </div>
      {writing && <WishEditor w={w} lang={lang} onCancel={() => setWriting(false)} onHung={item => { put(item); setHungId(item.id); setWriting(false) }} />}
      {hungId && !writing && <p role="status" style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--green, #2f7d4f)', textAlign: 'center' }}>{w.w('hung')}</p>}
      <PlaqueGrid wishes={wishes} w={w} lang={lang} signed={signed} admin={admin} fresh={hungId} onHidden={id => setHiddenIds(h => [...h, id])} />
      {wall?.more && <div style={{ textAlign: 'center', marginTop: 12 }}><button type="button" onClick={() => void loadMore()} style={{ ...linkBtn, color: 'var(--muted)' }}>{w.w('more')}</button></div>}
      {signed && <MyWishes mine={mine} w={w} onChange={put} />}
      <p style={{ margin: '14px 0 0', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>{w.w('entertainment')}</p>
    </section>
  )
}

// ── Under a drawn stick ───────────────────────────────────────────────────

/** The offer to tie the stick just drawn outside the temple. `readingId` is
 *  the saved visit (null for a visitor not signed in). */
export function TieStrip({ readingId, n, edition, luck, ask }: { readingId: string | null; n: number; edition: 'yibai' | 'gansan'; luck: string; ask: string }) {
  const { lang } = useLang()
  const w = wallWords(lang)
  const signed = useSignedIn()
  const { show: showSignIn } = useAuthModal()
  const [stage, setStage] = useState<'offer' | 'confirm' | 'tying' | 'tied'>('offer')
  const [fresh, setFresh] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [wishing, setWishing] = useState(false)
  const bad = badLuck(luck)
  // A reopened visit whose stick is already outside says so.
  useEffect(() => {
    if (!signed || !readingId) return
    let live = true
    fetch('/api/xoracle/wall?mine=1', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      const hit = (j?.items ?? []).find((m: MyItem) => m.kind === 'stick' && m.readingId === readingId)
      if (live && hit) setStage('tied')
    }).catch(() => {})
    return () => { live = false }
  }, [signed, readingId])
  const working = usePendingTie(signed)
  const tie = async () => {
    setErr(null)
    const pending: Pending = { n, edition, ask, lang, at: Date.now() }
    if (!signed) {
      try { sessionStorage.setItem(PENDING_TIE, JSON.stringify(pending)) } catch { /* private mode */ }
      showSignIn()
      return
    }
    setStage('tying')
    // Signed in but the visit was not saved (its save failed): save it now.
    if (!readingId) { if (!(await tieWithoutVisit(pending))) { setErr(w.err('failed')); setStage('confirm') } return }
    const r = await fetch('/api/xoracle/wall/tie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readingId, lang }) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (r?.ok && j?.item) { setFresh(j.already ? null : j.item.id); setStage('tied'); setOpen(true); return }
    setErr(w.err(j?.code)); setStage('confirm')
  }
  const box = { border: '1px solid var(--border2)', borderRadius: 12, background: 'var(--surface)', padding: '14px 16px' } as const

  if (stage === 'tied') return (
    <div className="xoracle-wall-tie" style={box}>
      <p role="status" style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--white)' }}>{fresh ? w.w('tied') : w.w('tiedAlready')}</p>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" style={linkBtn} onClick={() => setOpen(o => !o)}>{open ? w.w('hideWall') : w.w('seeWall')}</button>
        {!open && <button type="button" style={{ ...linkBtn, color: 'var(--muted)', fontWeight: 600 }} onClick={() => { setWishing(true); setOpen(true) }}>{w.w('alsoWish')}</button>}
      </div>
      {open && <TempleWall embedded fresh={fresh} startWriting={wishing} />}
    </div>
  )

  if (stage === 'offer' && !bad) return (
    <div className="xoracle-wall-tie" style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', padding: '2px 2px' }}>
      <span>{w.w('nudge')}</span>
      <button type="button" style={linkBtn} onClick={() => setStage('confirm')}>{w.w('tie')}</button>
    </div>
  )

  return (
    <div className="xoracle-wall-tie" style={box}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 30%) 1fr', gap: 14, alignItems: 'center' }}>
        <div aria-hidden="true" style={{ aspectRatio: '3 / 2', borderRadius: 8, background: 'url(/xoracle/wall/rack.avif) center / cover' }} />
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{stage === 'offer' ? w.w('nudgeBad') : w.w('tieNote')}</p>
          {err && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--red)' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {stage === 'offer'
              ? <button type="button" onClick={() => setStage('confirm')} style={pill('var(--red)')}>{w.w('tie')}</button>
              : <>
                  <button type="button" onClick={tie} disabled={stage === 'tying' || working} aria-busy={stage === 'tying' || working || undefined} style={{ ...pill('var(--red)'), opacity: stage === 'tying' || working ? 0.6 : 1 }}>{stage === 'tying' || working ? w.w('tying') : signed === false ? `${w.w('tieGo')} · ${w.w('signIn')}` : w.w('tieGo')}</button>
                  <button type="button" onClick={() => setStage('offer')} style={{ ...linkBtn, color: 'var(--muted)' }}>{w.w('notNow')}</button>
                </>}
          </div>
        </div>
      </div>
    </div>
  )
}
