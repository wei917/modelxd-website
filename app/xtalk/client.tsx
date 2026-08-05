'use client'
// app/xtalk/client.tsx
// The XTalk shell. It loads the models, lets you choose a template, and
// hands over. Everything about how a given format actually runs lives in
// that template's own component — see ./templates.ts.
//
// Kept deliberately thin: when the third and fourth templates arrive this
// file should not have to change at all.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import { XTALK_TEMPLATES, templateById, type Speaker } from './templates'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

export default function XTalkClient({ resumeId = null }: { resumeId?: string | null }) {
  useRequireAuth()
  const t = useT()
  const router = useRouter()
  const [models, setModels] = useState<Speaker[]>([])
  // /xtalk/<id> opens straight onto the werewolf table it names; picking a
  // template by hand drops the resume — you asked for something new.
  const [active, setActive] = useState(resumeId ? 'werewolf' : XTALK_TEMPLATES[0].id)
  const [resume, setResume] = useState<string | null>(resumeId)
  // Templates own their own state, so switching has to unmount the old one
  // rather than leave a half-finished game behind a chip.
  const [nonce, setNonce] = useState(0)
  // Which template's how-to-play sheet is open, by id.
  const [helpFor, setHelpFor] = useState<string | null>(null)

  useEffect(() => {
    if (!helpFor) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelpFor(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helpFor])

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
              // The ? is a SIBLING of the card, never a child: a button
              // inside a button is invalid and the browser lifts the inner
              // one out, which quietly breaks both. Same trap as the seat
              // slots in ModelSlots.tsx.
              <div key={x.id} className="xt-tpl-wrap">
              <button
                className={`xt-tpl${on ? ' is-on' : ''}`}
                onClick={() => { setActive(x.id); setResume(null); setNonce(n => n + 1) }}
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

              {x.help && (
                <button
                  type="button"
                  className="xt-tpl-help"
                  aria-label={t('xt.help')}
                  title={t('xt.help')}
                  onClick={() => setHelpFor(x.id)}
                >?</button>
              )}
              </div>
            )
          })}
        </div>

        {helpFor !== null && (() => {
          const h = templateById(helpFor)
          if (!h.help) return null
          return (
            <div
              onClick={e => { if (e.target === e.currentTarget) setHelpFor(null) }}
              style={{
                position: 'fixed', inset: 0, zIndex: 1200,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
              }}
            >
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 12,
                width: '100%', maxWidth: 620, maxHeight: '80vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '15px 20px', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, fontWeight: 700,
                    letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--white)',
                  }}>{t(h.helpTitleKey ?? 'xt.help')}</span>
                  <button
                    onClick={() => setHelpFor(null)}
                    aria-label={t('common.close')}
                    style={{
                      width: 28, height: 28, background: 'transparent',
                      border: '1px solid var(--border2)', borderRadius: 6,
                      color: 'var(--muted2)', fontSize: 13, cursor: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                </div>
                <div style={{ overflowY: 'auto', padding: '4px 20px 22px' }}>
                  {h.help.map((s, i) => (
                    <div key={i} style={{ marginTop: 18 }}>
                      <div style={{
                        fontFamily: 'var(--font-mono), monospace', fontSize: 10,
                        letterSpacing: '0.16em', textTransform: 'uppercase',
                        color: 'var(--red)', marginBottom: 7,
                      }}>{t(s.headKey)}</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.75, color: 'var(--muted2)', whiteSpace: 'pre-line' }}>
                        {t(s.bodyKey)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        <Room
          key={`${tpl.id}-${nonce}`}
          models={models}
          resumeId={active === 'werewolf' ? resume : null}
          onExit={() => {
            // Navigate for real when leaving a /xtalk/<id> game (remounts to
            // the picker); a plain reset kept the game URL and Next's router
            // out of sync. On the bare /xtalk this is a no-op push and the
            // local reset returns a discussion room to the picker.
            router.push('/xtalk')
            setActive(XTALK_TEMPLATES[0].id); setResume(null); setNonce(n => n + 1)
          }}
        />
      </div>
    </div>
  )
}
