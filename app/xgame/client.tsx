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
// bar, a scenic feature that browses every game (XGameHero) and the setup in
// a white card headed by the game's icon, name, seats and blurb
// (app/xgame/xgame.css); the Play / Spectate panel between them went on
// Oct 22 (owner). No XGAME eyebrow or slogan in
// the lobby (owner, Oct 21); a saved table keeps XGAME and its game's name.
//
// Oct 22 (owner: "you missed the landing page for XGame. Can you check
// XOracle page?"): /xgame with no ?game= is a landing page, as /xoracle is:
// nothing marked in the bar, the slideshow, the guide box and four steps
// (XGameLanding), XOracle's footer. The bar, the slideshow's button or a
// game the guide offers opens that game's tab in place.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useLang } from '../../lib/i18n'
import { templateById, type Speaker } from '../xtalk/templates'
import GomokuLive from './GomokuLive'
import DrawLive from './DrawLive'
import ChessLive from './ChessLive'
import PokerLive from './PokerLive'
import XiangqiLive from './XiangqiLive'
import BridgeLive from './BridgeLive'
import XGameBar, { gameIconStyle } from './XGameBar'
import { GAME_INTRO, GAME_NAME_KEY, gamesFor, isGameKey, type GameKey } from '../../lib/xgame-games'
import XGameHero from './XGameHero'
import GameHistory from './GameHistory'
import XGameLanding from './XGameLanding'
import { XOracleFooter } from '../components/xoracle/XOracleNav'
import './xgame.css'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

export default function XGameClient({ resumeId = null, initialGame = null }: {
  resumeId?: string | null
  /** From ?game= on the server, so the first paint is the right game. */
  initialGame?: GameKey | null
}) {
  useRequireAuth()
  const { lang, t } = useLang()
  const router = useRouter()
  const [models, setModels] = useState<Speaker[]>([])
  const [resume, setResume] = useState<string | null>(resumeId)
  // null at a table = the resume probe still deciding which game this id is
  // (defaulting to werewolf made every gomoku permalink phantom-mount
  // WerewolfLive; render NOTHING until we know, CC Aug 6). null in the lobby
  // = the landing page (Oct 22).
  const [active, setActive] = useState<GameKey | null>(resumeId ? null : (initialGame ?? null))
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
    // Leaving the landing page is a step Back undoes; moving between games
    // only rewrites the address, as before.
    try {
      if (active) window.history.replaceState(window.history.state, '', `/xgame?game=${k}`)
      else window.history.pushState(window.history.state, '', `/xgame?game=${k}`)
    } catch { /* the address is a nicety */ }
  }
  // Back and Forward between the landing page and a game.
  useEffect(() => {
    if (resume) return
    const onPop = () => {
      const g = new URLSearchParams(window.location.search).get('game')
      setActive(isGameKey(g) ? g : null); setNonce(n => n + 1); setHeroVersion(v => v + 1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [resume])
  // "New game" at a table goes back to that game's lobby.
  const exit = () => { router.push(active ? `/xgame?game=${active}` : '/xgame'); setResume(null); setNonce(n => n + 1) }

  const landing = !resume && !active

  return (
    <div className="xduel-xt xgame-shell">
      {/* Outside .xduel-page, whose overflow would swallow the bar's sticky. */}
      <XGameBar current={active} onPick={game => { pick(game); setHeroVersion(v => v + 1) }} />
      <div className="xduel-page">
        <div className="arena xcreate-arena xgame-arena">
          {/* No heading row above the games (owner, Oct 21): not the XGAME
              eyebrow and slogan on the tab pages, and not "XGAME / 西洋棋"
              above a table either; the bar already says which game it is. */}

          {/* The slideshow. No 對戰 / 觀戰 row under it any more (owner,
              Oct 22: "why do you need this row for every game?"): each setup
              already offers 我來下 or a model for every seat, and the landing
              page's steps say so. The Practice (練習) card left the lobby on
              Oct 14; /xgame/practice is still served, unlinked. */}
          {!resume && <XGameHero key={`${active ?? 'landing'}-${heroVersion}`} initialGame={active ?? gamesFor(lang)[0]} onEnter={game => {
            pick(game)
            requestAnimationFrame(() => {
              const table = document.getElementById('xgame-table')
              table?.focus({ preventScroll: true })
              table?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
            })
          }} />}

          {/* The landing page: the guide, then the steps. */}
          {landing && <XGameLanding onOpen={game => { pick(game); setHeroVersion(v => v + 1); window.scrollTo({ top: 0, behavior: 'instant' }) }} />}

          {/* The chosen game's setup, headed by its icon, name, seats and
              blurb. A resumed game is the TABLE: it gets the page to itself.
              (owner, Aug 6) */}
          {!landing && <section id="xgame-table" className={resume ? 'xgame-live-table' : 'xgame-table'} tabIndex={-1}
            aria-label={active ? t(GAME_NAME_KEY[active]) : 'XGame'}>
            {!resume && active && <header className="xgame-table-heading">
              <span className="xgame-bar-icon" style={gameIconStyle(active)} aria-hidden="true" />
              <div>
                <h2>{t(GAME_NAME_KEY[active])}<span>{t('xt.seats').replace('{n}', active === 'werewolf' ? String(tpl.minPlayers) : GAME_INTRO[active].seats)}</span></h2>
                <p>{t(active === 'werewolf' ? tpl.blurbKey : GAME_INTRO[active].blurb)}</p>
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
          </section>}
          {/* Your games of this game, under its setup: XOracle keeps each
              temple's visits there, not in the menu (owner, Oct 21). */}
          {!resume && active && <GameHistory game={active} />}
          {/* XOracle's footer, with XGame's own line; a table keeps the page. */}
          {!resume && <XOracleFooter noteKey="xg.footer.note" />}
        </div>
      </div>
    </div>
  )
}
