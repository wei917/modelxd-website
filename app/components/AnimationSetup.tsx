'use client'
// app/components/AnimationSetup.tsx — the Animation template's setup form
// (owner, Aug 17: "AI 動畫 template skill"). Same contract as MusicVideoSetup
// and SocialPostSetup: the form pre-answers the skill's mandatory asks —
// above all THE STYLE, which is the one question this template must never
// skip — so the first director turn is the plan.

import { useState } from 'react'
import { useT } from '../../lib/i18n'
import AttachmentButton, { type Attachment } from './AttachmentButton'

// Each style ships its full bible-register line — the form answer IS the
// style bible, so the director never has to invent (or drift) one.
const STYLES = [
  { id: 'anime2d',    i18n: 'xd.an.style.anime2d',
    bible: '2D cel anime, clean dark linework, flat two-tone shading, muted pastel palette, soft 90s OVA grain' },
  { id: 'toon3d',     i18n: 'xd.an.style.toon3d',
    bible: '3D toon-shaded, rounded shapes, gentle subsurface glow, film-still lighting' },
  { id: 'watercolor', i18n: 'xd.an.style.watercolor',
    bible: 'soft watercolor storybook, visible paper texture, loose ink outlines, warm light' },
  { id: 'pixel',      i18n: 'xd.an.style.pixel',
    bible: 'retro pixel art, chunky dither, limited palette, 4-frame walk-cycle energy' },
] as const

const ASPECTS = ['16:9', '9:16'] as const

export default function AnimationSetup({ busy, onStart, onSkip }: {
  busy: boolean
  onStart: (brief: string, atts: Attachment[]) => void
  onSkip: () => void
}) {
  const t = useT()
  const [style, setStyle]   = useState<string>('anime2d')
  const [aspect, setAspect] = useState<string>('16:9')
  const [story, setStory]   = useState('')
  const [chars, setChars]   = useState<Attachment[]>([])

  const ready = story.trim().length > 0

  const start = () => {
    const s = STYLES.find(x => x.id === style)!
    const parts: string[] = []
    parts.push(`Animated short. STYLE BIBLE (append verbatim to every generation): ${s.bible}.`)
    parts.push(`Aspect ${aspect} on every shot.`)
    if (chars.length > 0) parts.push('My character references are attached — build model sheets from them in the bible style with my consent: keep each one\'s recognizable cues (hair, glasses, build) translated into the medium, never a photoreal face on a drawing.')
    else parts.push('No character references — design original characters and lock them with model sheets first.')
    parts.push(`The story: ${story.trim()}`)
    onStart(parts.join(' '), chars)
  }

  const label: React.CSSProperties = {
    fontSize: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
    textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: 6,
  }
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: '1.5px solid ' + (on ? 'var(--red)' : 'var(--border2)'),
    background: on ? 'var(--red-dim)' : 'none', color: on ? 'var(--red)' : 'var(--muted)',
  })

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>🎞 {t('xd.an.setup')}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onSkip} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xd.mv.skip')}</button>
      </div>

      <div>
        <span style={label}>{t('xd.an.style')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STYLES.map(s => (
            <button key={s.id} onClick={() => setStyle(s.id)} style={chip(style === s.id)}>{t(s.i18n)}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span style={label}>{t('xd.an.aspect')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {ASPECTS.map(a => (
              <button key={a} onClick={() => setAspect(a)} style={chip(aspect === a)}>{a}</button>
            ))}
          </div>
        </div>
        <div>
          <span style={label}>🧑‍🎨 {t('xd.an.chars')}</span>
          <AttachmentButton attachments={chars} onChange={setChars} disabled={busy} context="xcreate" multiple maxFiles={4} accept="image/jpeg,image/png,image/webp" />
          <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{chars.length === 0 ? t('xd.an.charshint') : ''}</span>
        </div>
      </div>

      <div>
        <span style={label}>{t('xd.an.story')}</span>
        <textarea
          value={story} onChange={e => setStory(e.target.value)} rows={3}
          placeholder={t('xd.an.storyph')}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <button
        onClick={start} disabled={!ready || busy}
        title={ready ? '' : t('xd.an.need')}
        style={{
          alignSelf: 'flex-end', padding: '10px 26px', borderRadius: 999, border: 'none',
          background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 13.5,
          cursor: (!ready || busy) ? 'default' : 'pointer',
          opacity: (!ready || busy) ? 0.45 : 1,
        }}
      >🎞 {t('xd.an.start')}</button>
    </div>
  )
}
