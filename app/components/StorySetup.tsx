'use client'
// app/components/StorySetup.tsx — the Story to Video template's setup form
// (owner, Aug 22: "the template is Story or Novel to video … always
// summarize it and use the summary as input … 10 scenes most"). Same
// contract as MusicVideoSetup / AnimationSetup: the form pre-answers the
// skill's asks — style, aspect, focus, cast — so the first director turn is
// cast sheets plus the storyboard. The document itself never reaches the
// director: XDirectorChat sends it to /api/xdirector/digest first and the
// director gets the STORY BIBLE.

import { useState } from 'react'
import { useT } from '../../lib/i18n'
import AttachmentButton, { type Attachment } from './AttachmentButton'

// Each style ships its full bible-register line — the form answer IS the
// style bible, appended verbatim to every generation (see the Animation
// template; the two share the register).
const STYLES = [
  { id: 'anime2d',   i18n: 'xd.st.style.anime2d',
    bible: '2D cel anime, clean dark linework, flat two-tone shading, muted pastel palette, soft 90s OVA grain' },
  { id: 'inkwash',   i18n: 'xd.st.style.inkwash',
    bible: 'Chinese ink-wash painting (水墨), expressive brush strokes, rice-paper texture, sparse composition, mist and negative space, a single vermilion accent' },
  { id: 'toon3d',    i18n: 'xd.st.style.toon3d',
    bible: '3D toon-shaded, rounded shapes, gentle subsurface glow, film-still lighting' },
  { id: 'cinematic', i18n: 'xd.st.style.cinematic',
    bible: 'cinematic live-action realism, anamorphic lens, natural motivated light, fine film grain, restrained graded palette' },
] as const

const ASPECTS = ['16:9', '9:16'] as const

/** The shared "extras" bag every setup form can hand to send() alongside the
 *  brief and the files — things the prep pipeline acts on before the director
 *  ever sees them, rather than prose for the director to interpret. Story
 *  contributes the pasted text and focus; Music Video contributes a reference
 *  link for /api/xdirector/reference to read. */
export type StoryExtra = {
  storyText?:   string
  focus?:       string
  /** A public YouTube link whose LOOK the film should borrow. */
  referenceUrl?: string
  /** Orientation the reference frames must be generated at — I2V takes its
   *  output shape from the first frame, so an unpinned aspect silently
   *  decides the video's. */
  aspect?:      '16:9' | '9:16'
}

export default function StorySetup({ busy, onStart, onSkip }: {
  busy: boolean
  /** Build the first message from the form and send it with the files. */
  onStart: (brief: string, atts: Attachment[], extra: StoryExtra) => void
  onSkip: () => void
}) {
  const t = useT()
  const [style, setStyle]   = useState<string>('anime2d')
  const [aspect, setAspect] = useState<string>('16:9')
  const [docAtts, setDoc]   = useState<Attachment[]>([])
  const [pasted, setPasted] = useState('')
  const [focus, setFocus]   = useState('')
  const [cast, setCast]     = useState<Attachment[]>([])

  const ready = docAtts.length > 0 || pasted.trim().length > 0

  const start = () => {
    const s = STYLES.find(x => x.id === style)!
    const parts: string[] = []
    parts.push(`Story-to-video short film. STYLE BIBLE (append verbatim to every generation): ${s.bible}.`)
    parts.push(`Aspect ${aspect} on every shot.`)
    parts.push(docAtts.length > 0
      ? `Source: the attached document "${docAtts[0].fileName}" — it is digested into the STORY BIBLE below, and that bible is the only script.`
      : 'Source: the pasted story — digested into the STORY BIBLE below, and that bible is the only script.')
    parts.push(focus.trim()
      ? `FOCUS: ${focus.trim()} — the scenes cover only this part; the rest of the story is context.`
      : 'FOCUS: the whole story — keep only the beats that change it.')
    parts.push(cast.length > 0
      ? 'Cast: build three-view CAST sheets from my attached photos, translated into the style with my consent — keep each person\'s recognizable cues, never a photoreal face on a drawing.'
      : 'Cast: design the characters from the bible\'s descriptions and lock each recurring one with a three-view CAST sheet before any scene.')
    parts.push('At most 10 scenes. Cast sheets first, then the storyboard, in one turn.')
    onStart(parts.join(' '), [...docAtts, ...cast], { storyText: docAtts.length === 0 ? pasted.trim() : undefined, focus: focus.trim() || undefined })
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
  const field: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)',
    background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5,
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>📖 {t('xd.st.setup')}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onSkip} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xd.mv.skip')}</button>
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span style={label}>📄 {t('xd.st.doc')}</span>
          <AttachmentButton attachments={docAtts} onChange={setDoc} disabled={busy} context="xcreate" maxFiles={1} accept=".pdf,application/pdf,.txt,text/plain" />
          <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{docAtts.length === 0 ? t('xd.st.dochint') : ''}</span>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <span style={label}>{t('xd.st.paste')}</span>
          <textarea
            value={pasted} onChange={e => setPasted(e.target.value)} rows={3} disabled={docAtts.length > 0}
            placeholder={t('xd.st.pasteph')}
            style={{ ...field, padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit', opacity: docAtts.length > 0 ? 0.5 : 1 }}
          />
        </div>
      </div>

      <div>
        <span style={label}>{t('xd.st.style')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STYLES.map(s => (
            <button key={s.id} onClick={() => setStyle(s.id)} style={chip(style === s.id)}>{t(s.i18n)}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span style={label}>{t('xd.st.aspect')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {ASPECTS.map(a => (
              <button key={a} onClick={() => setAspect(a)} style={chip(aspect === a)}>{a}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <span style={label}>🎯 {t('xd.st.focus')}</span>
          <input value={focus} onChange={e => setFocus(e.target.value)} placeholder={t('xd.st.focusph')} style={field} />
        </div>
        <div>
          <span style={label}>👤 {t('xd.st.cast')}</span>
          <AttachmentButton attachments={cast} onChange={setCast} disabled={busy} context="xcreate" multiple maxFiles={4} accept="image/jpeg,image/png,image/webp" />
          <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{cast.length === 0 ? t('xd.st.casthint') : ''}</span>
        </div>
      </div>

      <button
        onClick={start} disabled={!ready || busy}
        title={ready ? '' : t('xd.st.need')}
        style={{
          alignSelf: 'flex-end', padding: '10px 26px', borderRadius: 999, border: 'none',
          background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 13.5,
          cursor: (!ready || busy) ? 'default' : 'pointer', opacity: (!ready || busy) ? 0.45 : 1,
        }}
      >📖 {t('xd.st.start')}</button>
    </div>
  )
}
