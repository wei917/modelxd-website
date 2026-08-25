'use client'
// app/components/MusicVideoSetup.tsx — the Music Video template's setup form
// (owner, Aug 14: "a better form for users to pick / preview before start").
//
// The fields ARE the skill's minimal-brief contract — orientation, style
// anchor, title text, cast offer — which the director otherwise collects by
// ASKING. Pre-answered here, the first director turn is the storyboard:
// zero question round-trips. Market pattern (Higgsfield presets, Kaiber
// flows): pick from cards, chips for aspect/duration, labeled reference
// slots, free text last and optional.

import { useState } from 'react'
import { useT } from '../../lib/i18n'
import AttachmentButton, { type Attachment } from './AttachmentButton'
import type { StoryExtra } from './StorySetup'

/** Client-side twin of isSupportedVideoUrl() in lib/providers/google.ts.
 *  Kept deliberately dumb — it only decides whether to collapse the style
 *  cards. The server validates for real before spending anything. */
function isYouTube(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const h = u.hostname.replace(/^www\./, '').toLowerCase()
    return (u.protocol === 'https:' || u.protocol === 'http:')
      && (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be')
  } catch { return false }
}

const FORMS = [
  { id: 'kpop',      emoji: '🎤', i18n: 'xd.mv.form.kpop' },
  { id: 'narrative', emoji: '🎬', i18n: 'xd.mv.form.narrative' },
  { id: 'concept',   emoji: '🌀', i18n: 'xd.mv.form.concept' },
  { id: 'live',      emoji: '🎸', i18n: 'xd.mv.form.live' },
  { id: 'anime',     emoji: '✨', i18n: 'xd.mv.form.anime' },
  { id: 'lyric',     emoji: '📝', i18n: 'xd.mv.form.lyric' },
] as const

const FORM_BRIEF: Record<string, string> = {
  kpop:      'K-pop performance style',
  narrative: 'narrative film style',
  concept:   'concept/abstract style',
  live:      'live-session band style',
  anime:     'anime/illustrated style',
  lyric:     'lyric-forward typography style',
}

const DURATIONS = [15, 18, 30, 60]

export default function MusicVideoSetup({ busy, onStart, onSkip }: {
  busy: boolean
  /** Build the first message from the form and send it with the files. */
  onStart: (brief: string, atts: Attachment[], extra: StoryExtra) => void
  onSkip: () => void
}) {
  const t = useT()
  const [reference, setRef]   = useState('')
  const [form, setForm]       = useState('kpop')
  const [aspect, setAspect]   = useState<'16:9' | '9:16'>('16:9')
  const [duration, setDur]    = useState<number>(18)
  const [section, setSection] = useState('')
  const [lyrics, setLyrics]   = useState('')
  const [title, setTitle]     = useState('')
  const [songAtts, setSong]   = useState<Attachment[]>([])
  const [styleAtts, setStyle] = useState<Attachment[]>([])
  const [castAtts, setCast]   = useState<Attachment[]>([])

  const ready = lyrics.trim().length > 0 || songAtts.length > 0
  // A valid link answers palette, grade, lens, light, location and cutting
  // rhythm better than any preset card can, so the cards step aside rather
  // than fight it. They come back the moment the link is cleared.
  const hasRef = isYouTube(reference)

  const start = () => {
    const parts: string[] = []
    parts.push(hasRef
      ? `${duration}-second music video${section.trim() ? ` of the ${section.trim()}` : ''}, ${aspect}. The look comes from the reference video that has been read for you — follow the style frames and the rhythm notes, not a preset.`
      : `${duration}-second music video${section.trim() ? ` of the ${section.trim()}` : ''}, ${FORM_BRIEF[form]}, ${aspect}.`)
    parts.push(title.trim()
      ? `Title card first: 「${title.trim()}」 — it lives INSIDE the ${duration}s runtime.`
      : 'No title card — the full runtime is the film.')
    parts.push(castAtts.length > 0
      ? 'Cast: lock the leads from the attached subject photos.'
      : 'Cast: create original leads to fit the song.')
    if (styleAtts.length > 0) parts.push('Style: match the attached style frames — build the look bible from them.')
    if (songAtts.length > 0) parts.push('The song file is attached — transcribe it for timing, and use its segments as SYNC reference audio for sung scenes.')
    if (lyrics.trim()) parts.push(`Lyrics: ${lyrics.trim()}`)
    onStart(parts.join(' '), [...songAtts, ...castAtts, ...styleAtts], {
      referenceUrl: hasRef ? reference.trim() : undefined,
      aspect,
    })
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
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>🎬 {t('xd.mv.setup')}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onSkip} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xd.mv.skip')}</button>
      </div>

      <div>
        <span style={label}>🔗 {t('xd.mv.reference')}</span>
        <input
          value={reference} onChange={e => setRef(e.target.value)} placeholder={t('xd.mv.referenceph')}
          style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1.5px solid ' + (hasRef ? 'var(--red)' : 'var(--border2)'), background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5 }}
        />
        <span style={{ fontSize: 10.5, color: hasRef ? 'var(--red)' : 'var(--muted2)', display: 'block', marginTop: 4 }}>
          {reference.trim() && !hasRef ? t('xd.mv.referencebad') : hasRef ? t('xd.mv.referenceon') : t('xd.mv.referencehint')}
        </span>
      </div>

      {/* Preset cards are a way of DESCRIBING a look. A reference video IS
          one — so when a link is present the cards would only compete with
          it, and they stand down. */}
      {!hasRef && (
        <div>
          <span style={label}>{t('xd.mv.formpick')}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FORMS.map(f => (
              <button key={f.id} onClick={() => setForm(f.id)} style={chip(form === f.id)}>
                {f.emoji} {t(f.i18n)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div>
          <span style={label}>{t('xd.mv.aspect')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setAspect('16:9')} style={chip(aspect === '16:9')}>▭ 16:9</button>
            <button onClick={() => setAspect('9:16')} style={chip(aspect === '9:16')}>▯ 9:16</button>
          </div>
        </div>
        <div>
          <span style={label}>{t('xd.mv.duration')}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {DURATIONS.map(d => (
              <button key={d} onClick={() => setDur(d)} style={chip(duration === d)}>{d}s</button>
            ))}
            <input
              type="number" min={10} max={180} value={duration}
              onChange={e => setDur(Math.min(180, Math.max(10, Math.round(Number(e.target.value) || 18))))}
              style={{ width: 58, padding: '5px 6px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5, textAlign: 'center' }}
            />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <span style={label}>{t('xd.mv.section')}</span>
          <input
            value={section} onChange={e => setSection(e.target.value)} placeholder={t('xd.mv.sectionph')}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5 }}
          />
        </div>
      </div>

      <div>
        <span style={label}>{t('xd.mv.lyrics')}</span>
        <textarea
          value={lyrics} onChange={e => setLyrics(e.target.value)} rows={3}
          placeholder={t('xd.mv.lyricsph')}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span style={label}>🎵 {t('xd.mv.song')}</span>
          <AttachmentButton attachments={songAtts} onChange={setSong} disabled={busy} context="xcreate" maxFiles={1} accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg" />
        </div>
        <div>
          <span style={label}>👤 {t('xd.mv.cast')}</span>
          <AttachmentButton attachments={castAtts} onChange={setCast} disabled={busy} context="xcreate" multiple maxFiles={3} accept="image/jpeg,image/png,image/webp" />
          <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{castAtts.length === 0 ? t('xd.mv.castoriginal') : ''}</span>
        </div>
        <div>
          <span style={label}>🎨 {t('xd.mv.stylerefs')}</span>
          <AttachmentButton attachments={styleAtts} onChange={setStyle} disabled={busy} context="xcreate" multiple maxFiles={4} accept="image/jpeg,image/png,image/webp" />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <span style={label}>🃏 {t('xd.mv.title')}</span>
          <input
            value={title} onChange={e => setTitle(e.target.value)} placeholder={t('xd.mv.titleph')}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5 }}
          />
        </div>
      </div>

      <button
        onClick={start} disabled={!ready || busy}
        title={ready ? '' : t('xd.mv.needsong')}
        style={{
          alignSelf: 'flex-end', padding: '10px 26px', borderRadius: 999, border: 'none',
          background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 13.5,
          cursor: (!ready || busy) ? 'default' : 'pointer', opacity: (!ready || busy) ? 0.45 : 1,
        }}
      >🎬 {t('xd.mv.start')}</button>
    </div>
  )
}
