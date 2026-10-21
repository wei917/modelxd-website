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
import XGameBar from './XGameBar'
import { GAME_NAME_KEY, type GameKey } from '../../lib/xgame-games'
import TemplateHelp from '../xtalk/TemplateHelp'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

/** Each game's line, blurb and seat count, as its lobby card had them. */
const INTRO: Record<Exclude<GameKey, 'werewolf'>, { tag: string; blurb: string; seats: string }> = {
  gomoku: { tag: 'xg.gomoku.tag', blurb: 'xg.gomoku.blurb', seats: '2' },
  draw: { tag: 'xg.draw.tag', blurb: 'xg.draw.blurb', seats: '2' },
  chess: { tag: 'xg.chess.tag', blurb: 'xg.chess.blurb', seats: '2' },
  poker: { tag: 'xg.poker.tag', blurb: 'xg.poker.blurb', seats: '2–9' },
  xiangqi: { tag: 'xg.xiangqi.tag', blurb: 'xg.xiangqi.blurb', seats: '2' },
  bridge: { tag: 'xg.bridge.tag', blurb: 'xg.bridge.blurb', seats: '4' },
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
    const probe = (route: string) =>
      fetch(`/api/xgame/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'state', id: resumeId }) })
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
    setActive(k); setNonce(n => n + 1)
    try { window.history.replaceState(window.history.state, '', `/xgame?game=${k}`) } catch { /* the address is a nicety */ }
  }
  // "New game" at a table goes back to that game's lobby.
  const exit = () => { router.push(active ? `/xgame?game=${active}` : '/xgame'); setResume(null); setNonce(n => n + 1) }

  const intro = active && active !== 'werewolf' ? INTRO[active] : null

  return (
    <div className="xduel-xt">
      {/* Outside .xduel-page, whose overflow would swallow the bar's sticky. */}
      <XGameBar current={active} onPick={pick} />
      <div className="xduel-page">
        <div className="arena xcreate-arena">
          {/* The lobby opens straight on the chosen game: no XGAME eyebrow
              and no slogan above it (owner, Oct 21: "please remove ... on all
              tab pages"). A table's headline is simply the game you are at.
              (owner, Aug 6) */}
          {resume && (
            <div className="prompt-header">
              <Link href="/xgame" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>XGAME</Link>
              <h1 className="page-headline" style={{ marginBottom: 20 }}>
                {active ? t(GAME_NAME_KEY[active]) : ' '}
              </h1>
            </div>
          )}

          {/* The chosen game, as its lobby card said it (Oct 20: the cards
              became the top bar). A resumed game is the TABLE: it gets the
              page to itself. (owner, Aug 6) */}
          {!resume && active && (
            <div className="xgame-intro">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 19, fontWeight: 700 }}>{t(GAME_NAME_KEY[active])}</span>
                <span style={{ fontSize: 12, color: 'var(--muted2)' }}>
                  {t('xt.seats').replace('{n}', active === 'werewolf' ? String(tpl.minPlayers) : intro!.seats)}
                </span>
                {active === 'werewolf' && <TemplateHelp templateId="werewolf" variant="icon" />}
              </div>
              <div className="xgame-tag">{t(active === 'werewolf' ? tpl.tagKey : intro!.tag)}</div>
              <div className="xgame-blurb">{t(active === 'werewolf' ? tpl.blurbKey : intro!.blurb)}</div>
            </div>
          )}
          {/* Play vs spectate, said outright (TGS audit, Sep 14): every table
              seats you OR runs AI against AI. The Practice (練習) card left
              the lobby on Oct 14; /xgame/practice is still served, unlinked. */}
          {!resume && (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 6, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              <span><b style={{ color: 'var(--white)' }}>{t('xg.lobby.play')}</b> {t('xg.lobby.play.desc')}</span>
              <span><b style={{ color: 'var(--white)' }}>{t('xg.lobby.spectate')}</b> {t('xg.lobby.spectate.desc')}</span>
            </div>
          )}

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
        </div>
      </div>
    </div>
  )
}
