'use client'
// app/xgame/client.tsx
// The XGame shell (CC, Aug 6). Werewolf's room component moved here from
// XTalk unchanged — the game itself (server-held state, /api/xtalk/werewolf)
// did not move, only its address. Every game is an entry here, not a page.
//
// Oct 20 (owner: "modify the xgame page UI to be the same as xtell/xoracle:
// the top nav bar is a list of games (icon + text), remove the search bar"):
// X先知's layout on XDuel's paper (.xduel-xt). The games are the rooms of a
// top bar (XGameBar) instead of a grid of cards; the chosen game's line and
// blurb sit under the lobby's headline. ?game= names the game, so a link
// opens it and the server draws it on first paint. The Omnibox search bar
// left /xgame (app/components/Omnibox.tsx).
//
// Oct 21 (Codex's XOracle-style tab pages, approved by the owner): under the
// bar, a scenic feature that browses every game (XGameHero), the Play /
// Spectate panel, and the setup in a white card headed by the game's icon,
// name, seats and blurb (app/xgame/xgame.css). No XGAME eyebrow or slogan in
// the lobby (owner, Oct 21); a saved table keeps XGAME and its game's name.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import { templateById, type Speaker } from '../xtalk/templates'
import GomokuLive from './GomokuLive'
import DrawLive from './DrawLive'
import ChessLive from './ChessLive'
import PokerLive from './PokerLive'
import XiangqiLive from './XiangqiLive'
import BridgeLive from './BridgeLive'
import XGameBar, { gameIconStyle } from './XGameBar'
import { GAME_NAME_KEY, type GameKey } from '../../lib/xgame-games'
import XGameHero from './XGameHero'
import GameHistory from './GameHistory'
import './xgame.css'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

/** Each game's blurb and seat count, as its lobby card had them (the line
 *  under the name became the feature's headline, xg.hero.<game>.title). */
const INTRO: Record<Exclude<GameKey, 'werewolf'>, { blurb: string; seats: string }> = {
  gomoku: { blurb: 'xg.gomoku.blurb', seats: '2' },
  draw: { blurb: 'xg.draw.blurb', seats: '2' },
  chess: { blurb: 'xg.chess.blurb', seats: '2' },
  poker: { blurb: 'xg.poker.blurb', seats: '2–9' },
  xiangqi: { blurb: 'xg.xiangqi.blurb', seats: '2' },
  bridge: { blurb: 'xg.bridge.blurb', seats: '4' },
}

export default function XGameClient({ resumeId = null, initialGame = null }: {
  resumeId?: string | null
  /** From ?game= on the server, so the first paint is the right game. */
  initialGame?: GameKey | null
}) {
  useRequireAuth()
  const t = useT()
  const router = useRouter()
  const [models, setModels] = useState<Speaker[]>([])
  const [resume, setResume] = useState<string | null>(resumeId)
  // null = resume probe still deciding which game this id is. Defaulting to
  // werewolf here made every gomoku permalink phantom-mount WerewolfLive
  // with a gomoku id. Render NOTHING until we know. (CC, Aug 6)
  const [active, setActive] = useState<GameKey | null>(resumeId ? null : (initialGame ?? 'werewolf'))
  // A resumed id names a row whose game we can't know client-side; probe
  // each game's state action in turn, fall back to werewolf on 404s.
  useEffect(() => {
    if (!resumeId) return
    // A friend opening a table's invite link carries ?join=<token>: the
    // chess and 象棋 routes show such a table to its holder (Oct 21).
    const join = new URLSearchParams(window.location.search).get('join')
    const probe = (route: string) =>
      fetch(`/api/xgame/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'state', id: resumeId, ...(join ? { join } : {}) }) })
    probe('gomoku').then(async r => {
      if (r.ok) { setActive('gomoku'); return }
      const d = await probe('draw').catch(() => null)
      if (d?.ok) { setActive('draw'); return }
      const c = await probe('chess').catch(() => null)
      if (c?.ok) { setActive('chess'); return }
      const p = await probe('poker').catch(() => null)
      if (p?.ok) { setActive('poker'); return }
      const x = await probe('xiangqi').catch(() => null)
      if (x?.ok) { setActive('xiangqi'); return }
      const b = await probe('bridge').catch(() => null)
      setActive(b?.ok ? 'bridge' : 'werewolf')
    }).catch(() => setActive('werewolf'))
  }, [resumeId])
  const [nonce, setNonce] = useState(0)
  // The feature remounts on its first slide when the bar picks a game.
  const [heroVersion, setHeroVersion] = useState(0)

  useEffect(() => {
    createSupabaseBrowser()
      .from('ai_models')
      .select('id, model_name, display_name, provider, model_pricing, output_config, output_modalities, enabled, blocked_features')
      .eq('enabled', true)
      .contains('output_modalities', ['text'])
      .order('is_popular', { ascending: false })
      .then(({ data }) => setModels((data ?? []) as any))
  }, [])

  const tpl = templateById('werewolf')
  const Room = tpl.component

  // The bar: in the lobby a game switches in place (and the address says
  // which); at a table it leaves for that game's lobby.
  const pick = (k: GameKey) => {
    if (resume) { router.push(`/xgame?game=${k}`); return }
    // The game already open keeps its table and the seats set on it.
    if (k === active) return
    setActive(k); setNonce(n => n + 1)
    try { window.history.replaceState(window.history.state, '', `/xgame?game=${k}`) } catch { /* the address is a nicety */ }
  }
  // "New game" at a table goes back to that game's lobby.
  const exit = () => { router.push(active ? `/xgame?game=${active}` : '/xgame'); setResume(null); setNonce(n => n + 1) }

  const intro = active && active !== 'werewolf' ? INTRO[active] : null

  return (
    <div className="xduel-xt xgame-shell">
      {/* Outside .xduel-page, whose overflow would swallow the bar's sticky. */}
      <XGameBar current={active} onPick={game => { pick(game); setHeroVersion(v => v + 1) }} />
      <div className="xduel-page">
        <div className="arena xcreate-arena xgame-arena">
          {/* The lobby opens straight on the chosen game: no XGAME eyebrow
              and no slogan above it (owner, Oct 21: "please remove ... on all
              tab pages"). A table's headline is simply the game you are at.
              (owner, Aug 6) */}
          {resume && (
            <header className="xgame-page-heading">
              <Link href="/xgame">XGAME</Link>
              <h1>{active ? t(GAME_NAME_KEY[active]) : ' '}</h1>
            </header>
          )}

          {/* Play vs spectate, said outright (TGS audit, Sep 14): every table
              seats you OR runs AI against AI. The Practice (練習) card left
              the lobby on Oct 14; /xgame/practice is still served, unlinked. */}
          {!resume && active && <>
            <XGameHero key={`${active}-${heroVersion}`} initialGame={active} onEnter={game => {
              pick(game)
              requestAnimationFrame(() => {
                const table = document.getElementById('xgame-table')
                table?.focus({ preventScroll: true })
                table?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
              })
            }} />
            <div className="xgame-ways">
              <div className="xgame-way">
                <span className="xgame-way-icon" aria-hidden="true">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="7" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M3 14l3 3m15-3-3 3"/></svg>
                </span>
                <div><strong>{t('xg.lobby.play').replace(/[:：]$/, '')}</strong><p>{t('xg.lobby.play.desc')}</p></div>
              </div>
              <div className="xgame-way">
                <span className="xgame-way-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                </span>
                <div><strong>{t('xg.lobby.spectate').replace(/[:：]$/, '')}</strong><p>{t('xg.lobby.spectate.desc')}</p></div>
              </div>
            </div>
          </>}

          {/* The chosen game's setup, headed by its icon, name, seats and
              blurb. A resumed game is the TABLE: it gets the page to itself.
              (owner, Aug 6) */}
          <section id="xgame-table" className={resume ? 'xgame-live-table' : 'xgame-table'} tabIndex={-1}
            aria-label={active ? t(GAME_NAME_KEY[active]) : 'XGame'}>
            {!resume && active && <header className="xgame-table-heading">
              <span className="xgame-bar-icon" style={gameIconStyle(active)} aria-hidden="true" />
              <div>
                <h2>{t(GAME_NAME_KEY[active])}<span>{t('xt.seats').replace('{n}', active === 'werewolf' ? String(tpl.minPlayers) : intro!.seats)}</span></h2>
                <p>{t(active === 'werewolf' ? tpl.blurbKey : intro!.blurb)}</p>
              </div>
            </header>}
          {active === 'chess' ? (
            <ChessLive key={`chess-${nonce}`} models={models} resumeId={resume} onExit={exit} />
          ) : active === 'bridge' ? (
            <BridgeLive key={`bridge-${nonce}`} models={models} resumeId={resume} onExit={exit} />
          ) : active === 'xiangqi' ? (
            <XiangqiLive key={`xiangqi-${nonce}`} models={models} resumeId={resume} onExit={exit} />
          ) : active === 'poker' ? (
            <PokerLive key={`poker-${nonce}`} models={models} resumeId={resume} onExit={exit} />
          ) : active === 'draw' ? (
            <DrawLive key={`draw-${nonce}`} resumeId={resume} onExit={exit} />
          ) : active === 'gomoku' ? (
            <GomokuLive key={`gomoku-${nonce}`} models={models} resumeId={resume} onExit={exit} />
          ) : active === 'werewolf' ? (
            <Room key={`werewolf-${nonce}`} models={models} resumeId={resume} onExit={exit} />
          ) : null}
          </section>
          {/* Your games of this game, under its setup: XOracle keeps each
              temple's visits there, not in the menu (owner, Oct 21). */}
          {!resume && active && <GameHistory game={active} />}
        </div>
      </div>
    </div>
  )
}
