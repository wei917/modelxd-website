'use client'
// app/components/SocialPostSetup.tsx — the Social Post template's setup form
// (owner, Aug 14): upload media, pick platforms, one tap — the director
// organizes the uploads as canvas assets and plans a beautified,
// platform-sized set. Same contract as MusicVideoSetup: the form
// pre-answers every ask, so the first director turn is the plan.

import { useState } from 'react'
import { useT } from '../../lib/i18n'
import AttachmentButton, { type Attachment } from './AttachmentButton'

const PLATFORMS = [
  { id: 'ig',       label: 'Instagram', aspect: '4:5' },
  { id: 'story',    label: 'Story/Reel', aspect: '9:16' },
  { id: 'threads',  label: 'Threads', aspect: '4:5' },
  { id: 'x',        label: 'X', aspect: '16:9' },
  { id: 'xhs',      label: '小紅書', aspect: '3:4' },
  { id: 'linkedin', label: 'LinkedIn', aspect: '1.91:1' },
  { id: 'tiktok',   label: 'TikTok', aspect: '9:16' },
] as const

const TONES = [
  { id: 'clean',    i18n: 'xd.sp.tone.clean' },
  { id: 'bold',     i18n: 'xd.sp.tone.bold' },
  { id: 'editorial',i18n: 'xd.sp.tone.editorial' },
  { id: 'playful',  i18n: 'xd.sp.tone.playful' },
] as const

export default function SocialPostSetup({ busy, onStart, onSkip }: {
  busy: boolean
  onStart: (brief: string, atts: Attachment[]) => void
  onSkip: () => void
}) {
  const t = useT()
  const [picked, setPicked]   = useState<string[]>(['ig'])
  const [tone, setTone]       = useState('clean')
  const [message, setMessage] = useState('')
  const [media, setMedia]     = useState<Attachment[]>([])

  const toggle = (id: string) =>
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const ready = message.trim().length > 0 || media.length > 0

  const start = () => {
    const chosen = PLATFORMS.filter(p => picked.includes(p.id))
    const parts: string[] = []
    parts.push(`Social post set for: ${chosen.map(p => `${p.label} (${p.aspect})`).join(', ')}.`)
    parts.push(`Tone: ${t(TONES.find(x => x.id === tone)!.i18n)}.`)
    if (media.length > 0) parts.push(`My photos/videos are attached — put each on the assets shelf as a named SOURCE, then beautify from them (image_edit): my subject stays exactly mine, enhanced and cropped per platform. Do not replace or reinvent it.`)
    else parts.push('No media attached — design honest generated visuals for the message.')
    parts.push('Plan the whole set as one look (shared palette and light), one card per platform output with the platform and aspect in the card title.')
    if (message.trim()) parts.push(`The message: ${message.trim()}`)
    onStart(parts.join(' '), media)
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
        <span style={{ fontWeight: 800, fontSize: 14 }}>📱 {t('xd.sp.setup')}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onSkip} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xd.mv.skip')}</button>
      </div>

      <div>
        <span style={label}>{t('xd.sp.platforms')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => toggle(p.id)} style={chip(picked.includes(p.id))}>
              {p.label} <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, opacity: .75 }}>{p.aspect}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span style={label}>{t('xd.sp.tone')}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TONES.map(x => (
              <button key={x.id} onClick={() => setTone(x.id)} style={chip(tone === x.id)}>{t(x.i18n)}</button>
            ))}
          </div>
        </div>
        <div>
          <span style={label}>🖼 {t('xd.sp.media')}</span>
          <AttachmentButton attachments={media} onChange={setMedia} disabled={busy} context="xcreate" multiple maxFiles={8} accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" />
          <span style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{media.length === 0 ? t('xd.sp.mediahint') : ''}</span>
        </div>
      </div>

      <div>
        <span style={label}>{t('xd.sp.message')}</span>
        <textarea
          value={message} onChange={e => setMessage(e.target.value)} rows={3}
          placeholder={t('xd.sp.messageph')}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <button
        onClick={start} disabled={!ready || busy || picked.length === 0}
        title={ready ? '' : t('xd.sp.need')}
        style={{
          alignSelf: 'flex-end', padding: '10px 26px', borderRadius: 999, border: 'none',
          background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 13.5,
          cursor: (!ready || busy || picked.length === 0) ? 'default' : 'pointer',
          opacity: (!ready || busy || picked.length === 0) ? 0.45 : 1,
        }}
      >📱 {t('xd.sp.start')}</button>
    </div>
  )
}
