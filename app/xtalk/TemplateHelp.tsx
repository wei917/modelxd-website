'use client'
// app/xtalk/TemplateHelp.tsx
// The rules sheet, plus the two things that open it.
//
// Two triggers, one sheet: a ? on the gallery card (where you are choosing a
// format and have no room for a paragraph) and a text link inside the room
// itself (where you have already chosen and are now looking at controls you
// may not recognise). They render the same content, so the rules cannot
// drift between the two places. (CC, Aug 5)

import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'
import { helpFor } from './help'

export default function TemplateHelp({
  templateId, variant = 'icon',
}: {
  templateId: string
  /** 'icon' = the ? over a gallery card. 'link' = an inline text link. */
  variant?: 'icon' | 'link'
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const def = helpFor(templateId)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!def) return null

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          className="xt-tpl-help"
          aria-label={t(def.linkKey)}
          title={t(def.linkKey)}
          onClick={() => setOpen(true)}
        >?</button>
      ) : (
        <button type="button" className="xt-help-link" onClick={() => setOpen(true)}>
          <span aria-hidden="true">?</span>{t(def.linkKey)}
        </button>
      )}

      {open && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
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
              }}>{t(def.titleKey)}</span>
              <button
                onClick={() => setOpen(false)}
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
              {def.sections.map((s, i) => (
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
      )}
    </>
  )
}
