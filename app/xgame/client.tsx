'use client'
// app/xgame/client.tsx
// The XGame shell (CC, Aug 6). Werewolf's room component moved here from
// XTalk unchanged — the game itself (server-held state, /api/xtalk/werewolf)
// did not move, only its address. The picker shows the roadmap: one live
// game and the seats being built, so the page reads as an arena rather
// than a single game with a grand name.
//
// Deliberately the same thin-shell pattern as XTalk's client: when 五子棋
// lands it becomes another entry here, not another page.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import { templateById, type Speaker } from '../xtalk/templates'
import GomokuLive from './GomokuLive'
import TemplateHelp from '../xtalk/TemplateHelp'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)


export default function XGameClient({ resumeId = null }: { resumeId?: string | null }) {
  useRequireAuth()
  const t = useT()
  const router = useRouter()
  const [models, setModels] = useState<Speaker[]>([])
  const [resume, setResume] = useState<string | null>(resumeId)
  // null = resume probe still deciding which game this id is. Defaulting to
  // werewolf here made every gomoku permalink phantom-mount WerewolfLive
  // with a gomoku id — it resumed the wrong row as a board (stones as
  // players, undefined seats → React key warnings) until the probe flipped
  // it. Render NOTHING until we know. (CC, Aug 6)
  const [active, setActive] = useState<'werewolf' | 'gomoku' | null>(resumeId ? null : 'werewolf')
  // A resumed id names a row whose game we can't know client-side; probe
  // gomoku's state action, fall back to werewolf on a 404.
  useEffect(() => {
    if (!resumeId) return
    fetch('/api/xgame/gomoku', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'state', id: resumeId }) })
      .then(r => setActive(r.ok ? 'gomoku' : 'werewolf'))
      .catch(() => setActive('werewolf'))
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

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena">
        <Link href="/xgame" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>XGAME</Link>
        {/* The slogan sells the LOBBY; the table's headline is simply the
            game you are at. (owner, Aug 6) */}
        <h1 className="page-headline" style={{ marginBottom: 20 }}>
          {resume ? (active ? t(active === 'gomoku' ? 'xg.game.gomoku' : 'xt.tpl.werewolf.name') : ' ') : t('xg.shell.title')}
        </h1>

        {/* The picker is the LOBBY. A resumed game is the TABLE — it gets
            the page to itself, no other game's card in sight. (owner, Aug 6) */}
        {!resume && (
        <div className="prompt-label" style={{ marginBottom: 10 }}>{t('xt.shell.choose')}</div>)}
        {!resume && (
        <div className="xt-tpl-grid">
          <div className="xt-tpl-wrap">
            <button className={`xt-tpl${active === 'werewolf' ? ' is-on' : ''}`} onClick={() => { setActive('werewolf'); setResume(null); setNonce(n => n + 1) }}>
              <span className="xt-tpl-banner"><img src={tpl.banner} alt="" loading="lazy" /></span>
              <span className="xt-tpl-body">
                <span className="xt-tpl-text">
                  <span className="xt-tpl-head">
                    <span className="xt-tpl-name">{t(tpl.nameKey)}</span>
                    <span className="xt-tpl-seats">{t('xt.seats').replace('{n}', String(tpl.minPlayers))}</span>
                  </span>
                  <span className="xt-tpl-tag">{t(tpl.tagKey)}</span>
                  <span className="xt-tpl-blurb">{t(tpl.blurbKey)}</span>
                </span>
              </span>
            </button>
            <TemplateHelp templateId="werewolf" variant="icon" />
          </div>

          <div className="xt-tpl-wrap">
            <button className={`xt-tpl${active === 'gomoku' ? ' is-on' : ''}`} onClick={() => { setActive('gomoku'); setResume(null); setNonce(n => n + 1) }}>
              <span className="xt-tpl-banner"><img src="/xgame/gomoku-banner.svg" alt="" loading="lazy" /></span>
              <span className="xt-tpl-body">
                <span className="xt-tpl-text">
                  <span className="xt-tpl-head">
                    <span className="xt-tpl-name">{t('xg.game.gomoku')}</span>
                    <span className="xt-tpl-seats">{t('xt.seats').replace('{n}', '2')}</span>
                  </span>
                  <span className="xt-tpl-tag">{t('xg.gomoku.tag')}</span>
                  <span className="xt-tpl-blurb">{t('xg.gomoku.blurb')}</span>
                </span>
              </span>
            </button>
          </div>

        </div>)}

        {active === 'gomoku' ? (
          <GomokuLive
            key={`gomoku-${nonce}`}
            models={models}
            resumeId={resume}
            onExit={() => { router.push('/xgame'); setResume(null); setNonce(n => n + 1) }}
          />
        ) : active === 'werewolf' ? (
          <Room
            key={`werewolf-${nonce}`}
            models={models}
            resumeId={resume}
            onExit={() => { router.push('/xgame'); setResume(null); setNonce(n => n + 1) }}
          />
        ) : null}
      </div>
    </div>
  )
}
