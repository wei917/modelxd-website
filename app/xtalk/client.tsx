'use client'
// app/xtalk/client.tsx
// The XTalk shell. It loads the models, lets you choose a template, and
// hands over. Everything about how a given format actually runs lives in
// that template's own component — see ./templates.ts.
//
// Kept deliberately thin: when the third and fourth templates arrive this
// file should not have to change at all.

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import { XTALK_TEMPLATES, templateById, type Speaker } from './templates'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

export default function XTalkClient() {
  useRequireAuth()
  const t = useT()
  const [models, setModels] = useState<Speaker[]>([])
  const [active, setActive] = useState(XTALK_TEMPLATES[0].id)
  // Templates own their own state, so switching has to unmount the old one
  // rather than leave a half-finished game behind a chip.
  const [nonce, setNonce] = useState(0)

  // Text models only — every template so far is a conversation, and an image
  // model has nothing to say in one.
  useEffect(() => {
    createSupabaseBrowser()
      .from('ai_models')
      .select('id, display_name, provider, model_pricing, output_config, output_modalities, enabled')
      .eq('enabled', true)
      .contains('output_modalities', ['text'])
      .order('is_popular', { ascending: false })
      .then(({ data }) => setModels((data ?? []) as any))
  }, [])

  const tpl = templateById(active)
  const Room = tpl.component

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena">
        <div className="prompt-label eyebrow">XTALK</div>

        <h1 className="page-headline" style={{ marginBottom: 20 }}>{t('xt.shell.title')}</h1>

        {/* A gallery, not a switch. The old two-segment pill borrowed
            XCreate's Studio/Agent styling, so it read as a binary mode
            toggle — the wrong promise when the list keeps growing.

            Layout (CC's mock, Aug 2): a wide banner sets the mood, a square
            mark identifies the format, and a chip row states the table in
            words. The banner does the work the old 46px thumbnail could not
            — at that size a boardroom and a village at night were two grey
            smudges. Selection is the red frame plus a check on the banner. */}
        <div className="prompt-label" style={{ marginBottom: 10 }}>{t('xt.shell.choose')}</div>
        <div className="xt-tpl-grid">
          {XTALK_TEMPLATES.map(x => {
            const on = active === x.id
            return (
              <button
                key={x.id}
                className={`xt-tpl${on ? ' is-on' : ''}`}
                onClick={() => { setActive(x.id); setNonce(n => n + 1) }}
              >
                {/* No check badge and no square mark. The banner already
                    says which format this is, and the red frame already says
                    which one is chosen — a tick and an icon were a third and
                    fourth thing saying the same two things. (CC, Aug 2) */}
                <span className="xt-tpl-banner">
                  <img src={x.banner} alt="" loading="lazy" />
                </span>

                <span className="xt-tpl-body">
                  <span className="xt-tpl-text">
                    <span className="xt-tpl-head">
                      <span className="xt-tpl-name">{t(x.nameKey)}</span>
                      <span className="xt-tpl-seats">
                        {t('xt.seats').replace('{n}', x.minPlayers === x.maxPlayers
                          ? String(x.minPlayers)
                          : `${x.minPlayers}\u2013${x.maxPlayers}`)}
                      </span>
                    </span>
                    <span className="xt-tpl-tag">{t(x.tagKey)}</span>
                    {/* Second line. It was dropped entirely when the card was
                        rebuilt around the banner, so xt.tpl.*.blurb rendered
                        nowhere for several revisions — the strings were still
                        in i18n, which is exactly why nothing looked broken. */}
                    <span className="xt-tpl-blurb">{t(x.blurbKey)}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <Room
          key={`${tpl.id}-${nonce}`}
          models={models}
          onExit={() => { setActive(XTALK_TEMPLATES[0].id); setNonce(n => n + 1) }}
        />
      </div>
    </div>
  )
}
