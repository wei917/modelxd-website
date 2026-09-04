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

import { useEffect, useState } from 'react'
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

// Round numbers only. 15 and 18 were here because an early test song was 18
// seconds long — a preset that fits one file is not a preset (owner, Sep 4:
// "why do we need 18s?"). The song's own length is offered separately when
// there is a song, which is the answer 18 was pretending to be.
const DURATIONS = [10, 30, 60]

// Not an adjective — each level switches on a different set of REQUIREMENTS
// the board must satisfy (owner, Aug 28, after an 18s cut came back as the
// same shot at three focal lengths). "More dramatic" pasted into a shot
// prompt buys harder lighting and nothing else; the drama lives in whether
// anything REVERSES, so the dial has to change the board, not the wording.
const DRAMA = [
  { id: 'performance', i18n: 'xd.mv.drama.perf' },
  { id: 'story',       i18n: 'xd.mv.drama.story' },
  { id: 'drama',       i18n: 'xd.mv.drama.drama' },
] as const

const DRAMA_BRIEF: Record<string, string> = {
  performance: 'DRAMA LEVEL 1 — PERFORMANCE. The hook is the point. One spine sentence, but no turn is required and one location is fine. Chosen deliberately: do not land here by failing to find a story.',
  story:       'DRAMA LEVEL 2 — STORY. Full Step 1.5: spine sentence, both people on the board, setup/build/turn/payoff, the last cut shows the change, one place and one hour.',
  drama:       'DRAMA LEVEL 3 — DRAMA. Story, plus all four or the board is not at this level: a REVERSAL (the situation flips against the wanting — escalation is not reversal), a COST paid or deliberately withheld on screen, at least ONE UNPRETTY frame that is allowed to be uncomfortable, and a first and last cut that CONTRADICT rather than merely differ.',
}

// The song's FEELING — a different axis from the visual style, and from GENRE.
// The first version of this list was mostly genres (rock / country / electronic /
// hip-hop / folk / R&B), which left a love song nowhere to go: 'ballad' means
// slow, not romantic, and a song can be both warm and quick (owner, Aug 28:
// "which one is romance?"). Genre the director can hear for itself; how the
// song FEELS is the thing only the user knows.
// The form had
// no way to say it (owner, Aug 25: "we also want users to enter the style of
// the song? 輕快 鄉村 搖滾 深情"). A reference video answers what the film
// LOOKS like; the mood answers how it MOVES — cutting energy, section
// grammar, how hard the chorus lands. 深情 against a bright coastal reference
// is a different film from 輕快 against the same one, and until now nothing
// in the pipeline knew which was meant.
const MOODS = [
  { id: 'romantic',   i18n: 'xd.mv.mood.romantic' },
  { id: 'heartfelt',  i18n: 'xd.mv.mood.heartfelt' },
  { id: 'upbeat',     i18n: 'xd.mv.mood.upbeat' },
  { id: 'melancholy', i18n: 'xd.mv.mood.melancholy' },
  { id: 'driving',    i18n: 'xd.mv.mood.driving' },
  { id: 'laidback',   i18n: 'xd.mv.mood.laidback' },
  { id: 'nostalgic',  i18n: 'xd.mv.mood.nostalgic' },
  { id: 'defiant',    i18n: 'xd.mv.mood.defiant' },
] as const

/** Written for the DIRECTOR, in craft terms — a genre word alone would just
 *  invite the clichés the skill spends a whole section warning against. */
const MOOD_BRIEF: Record<string, string> = {
  romantic:   'warm and close — two people in the same frame, soft light, the camera lingering a beat past comfortable',
  heartfelt:  'deep and unhurried — long takes, stillness, the emotion carried by the face and the light',
  upbeat:     'bright and light-footed — quick cuts, motion in frame, the chorus lifts',
  melancholy: 'cool and spacious — wide frames, the subject small in them, held longer than feels comfortable',
  driving:    'hard and physical — heavier contrast, handheld energy, cuts landing on the beat',
  laidback:   'loose and unhurried — slow moves, rich shadow, texture and skin, nothing rushed',
  nostalgic:  'remembered rather than seen — softer grade, grain, warm falloff, moments caught slightly late',
  defiant:    'confident and grounded — strong poses, low angles, hard cuts, attitude over prettiness',
}

export default function MusicVideoSetup({ busy, onStart, onSkip }: {
  busy: boolean
  /** Build the first message from the form and send it with the files. */
  onStart: (brief: string, atts: Attachment[], extra: StoryExtra) => void
  onSkip: () => void
}) {
  const t = useT()
  // Whether the cast SINGS on camera. Only meaningful with a song attached —
  // the audio itself is the generation input that drives the mouth, so there
  // is nothing to sync to without one (owner, Aug 28).
  const [drama, setDrama]     = useState<string>('story')
  const [sync, setSync]       = useState(false)
  const [reference, setRef]   = useState('')
  const [mood, setMood]       = useState<string | null>(null)
  const [form, setForm]       = useState('kpop')
  const [aspect, setAspect]   = useState<'16:9' | '9:16'>('16:9')
  const [duration, setDur]    = useState<number>(30)
  const [section, setSection] = useState('')
  const [lyrics, setLyrics]   = useState('')
  const [title, setTitle]     = useState('')
  const [songAtts, setSong]   = useState<Attachment[]>([])
  // The song's real length, read off the file in the browser. The form used
  // to make the user eyeball it and type a number, which is the one duration
  // nobody should have to guess — the track already knows (owner, Sep 4).
  const [songSeconds, setSongSeconds] = useState<number | null>(null)
  // Whether length is TRACKING the song rather than holding a fixed number.
  // Kept as a mode so the chip can be chosen before the file is attached and
  // still be right afterwards — the length follows the song in, and follows
  // it again if the song is swapped (owner, Sep 4).
  const [matchSong, setMatchSong] = useState(false)
  const [styleAtts, setStyle] = useState<Attachment[]>([])
  const [castAtts, setCast]   = useState<Attachment[]>([])

  useEffect(() => {
    const f = songAtts[0]?.file
    if (!f) { setSongSeconds(null); return }
    // Bytes are still in the browser until the run is submitted, so this
    // needs no upload and no round trip.
    const url = URL.createObjectURL(f)
    const el = new Audio()
    let dead = false
    const done = () => {
      if (!dead && Number.isFinite(el.duration) && el.duration > 0) {
        setSongSeconds(Math.max(3, Math.min(180, Math.round(el.duration))))
      }
      URL.revokeObjectURL(url)
    }
    el.addEventListener('loadedmetadata', done)
    el.addEventListener('error', () => { URL.revokeObjectURL(url) })
    el.src = url
    return () => { dead = true; URL.revokeObjectURL(url) }
  }, [songAtts])

  useEffect(() => {
    if (matchSong && songSeconds != null) setDur(songSeconds)
  }, [matchSong, songSeconds])

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
    parts.push(DRAMA_BRIEF[drama])
    parts.push('Run the board self-check before set_storyboard — swap test, first/last test, spine test, both-people test, shot-size test — and do not generate a board that fails one for this level.')
    if (mood) parts.push(`Song mood: ${MOOD_BRIEF[mood]}. That governs PACING and energy — cut rhythm, section grammar, how hard the chorus lands. It is a separate axis from the look; do not let it override the visual reference.`)
    if (styleAtts.length > 0) parts.push('Style: match the attached style frames — build the look bible from them.')
    if (songAtts.length > 0) {
      parts.push('The song file is attached — transcribe it for timing.')
      parts.push(sync
        ? 'SING ON CAMERA (SYNC mode): the user asked for real lip-sync, so the performance scenes are SYNC takes. '
          + 'Use an audio-capable video model — Wan 3.0 or MiniMax H3 — and attach the scene\'s own slice of the song as reference audio; '
          + 'no_speech is FALSE on those scenes and the shot text ends with "sings the exact words heard in the audio". '
          + 'Two things follow and you must say both to the user before spending: a SYNC take cannot also pin an approved opening still '
          + '(the API refuses first_frame together with reference_audio, on BOTH models), so likeness rides on reference images and written '
          + 'wardrobe invariants instead; and reference audio must be wav or mp3, at most 15s per clip, so a long chorus is split at a musical boundary. '
          + 'Keep sung takes to 9-12s. Narrative B-roll scenes stay performance-only on whichever model suits them — one board, both modes.'
        : 'PERFORMANCE ONLY: the cast never sings or speaks on camera. no_speech stays true on every scene; the song is laid over the cut afterwards.')
    }
    if (lyrics.trim()) parts.push(`Lyrics: ${lyrics.trim()}`)
    onStart(parts.join(' '), [...songAtts, ...castAtts, ...styleAtts], {
      referenceUrl: hasRef ? reference.trim() : undefined,
      aspect,
    })
  }

  // Geometry borrowed from XCreate's OptPill / OptGroup (client.tsx) rather
  // than invented here. This form had 999-radius pills with 1.5px borders and
  // an emoji on every label and every chip, which made the busiest surface in
  // XDirect look like a different product from the studio next door (owner,
  // Sep 4: "the entire UI of Music Video doesn't match the website").
  const label: React.CSSProperties = {
    fontSize: 11, color: 'var(--muted2)', fontWeight: 600,
    display: 'block', marginBottom: 6,
  }
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'),
    background: on ? 'var(--red-dim)' : 'transparent',
    color: on ? 'var(--red)' : 'var(--muted)',
    transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
  })
  const field: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid var(--border2)', background: 'var(--bg)',
    color: 'var(--white)', fontSize: 12.5,
  }
  const hint: React.CSSProperties = {
    fontSize: 11, color: 'var(--muted2)', display: 'block', marginTop: 5,
  }

  return (
    <div className="mv-card" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', width: '100%', maxWidth: 780, background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 14,
      // The chat pane is a flex column that scrolls. A flex child shrinks by
      // default, so a tall form is COMPRESSED instead of overflowing: the pane
      // thinks everything fits, no scrollbar appears, and the lower fields are
      // unreachable (owner, Aug 26 — Music Video is the tallest form, so it hit
      // this first). flexShrink: 0 keeps the natural height and lets the pane scroll.
      flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>{t('xd.mv.setup')}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onSkip} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xd.mv.skip')}</button>
      </div>

      <div>
        <span style={label}>{t('xd.mv.reference')}</span>
        <input
          value={reference} onChange={e => setRef(e.target.value)} placeholder={t('xd.mv.referenceph')}
          className={'mv-field' + (hasRef ? ' is-live' : '')}
        />
        <span style={{ ...hint, color: hasRef ? 'var(--blue)' : 'var(--muted2)' }}>
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
              <button key={f.id} onClick={() => setForm(f.id)} className={'mv-chip' + (form === f.id ? ' on' : '')}>
                {t(f.i18n)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mood survives a reference link, unlike the style presets — the link
          says what the film looks like, this says how it moves. */}
      {/* How much STORY. Sits above mood on purpose: mood shapes how the film
          moves, this decides whether there is a film at all. */}
      <div>
        <span style={label}>{t('xd.mv.drama')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DRAMA.map(d => (
            <button key={d.id} onClick={() => setDrama(d.id)} className={'mv-chip' + (drama === d.id ? ' on' : '')}>
              {t(d.i18n)}
            </button>
          ))}
        </div>
        <span style={{ ...hint, maxWidth: 460 }}>
          {t(`xd.mv.drama.${drama === 'performance' ? 'perf' : drama}hint`)}
        </span>
      </div>

      <div>
        <span style={label}>{t('xd.mv.mood')}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MOODS.map(m => (
            <button key={m.id} onClick={() => setMood(mood === m.id ? null : m.id)} className={'mv-chip' + (mood === m.id ? ' on' : '')}>
              {t(m.i18n)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div>
          <span style={label}>{t('xd.mv.aspect')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setAspect('16:9')} className={'mv-chip' + (aspect === '16:9' ? ' on' : '')}>▭ 16:9</button>
            <button onClick={() => setAspect('9:16')} className={'mv-chip' + (aspect === '9:16' ? ' on' : '')}>▯ 9:16</button>
          </div>
        </div>
        <div>
          <span style={label}>{t('xd.mv.duration')}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Always offered, so the option is discoverable before a file
                exists — it just fills in its own number once one does. A music
                video that stops before the track does is almost never what was
                wanted. */}
            <button
              onClick={() => { setMatchSong(true); if (songSeconds != null) setDur(songSeconds) }}
              title={songSeconds == null ? t('xd.mv.duration.songhint') : undefined}
              className={'mv-chip' + (matchSong ? ' on' : '')}
              style={{ opacity: songSeconds == null && !matchSong ? 0.55 : 1 }}
            >
              ♪ {t('xd.mv.duration.song')}{songSeconds != null ? ` (${songSeconds}s)` : ''}
            </button>
            {DURATIONS.map(d => (
              <button key={d} onClick={() => { setMatchSong(false); setDur(d) }} className={'mv-chip' + (!matchSong && duration === d ? ' on' : '')}>{d}s</button>
            ))}
            <input
              /* Floor is the shortest clip a video model will make (3s on
                 HappyHorse, 2s on Wan 3.0), not a round number. The old min
                 of 10 was arbitrary and refused runtimes we had already shot
                 — a 6-second single-scene MV is a normal thing to want. */
              type="number" className="mv-field no-spin" min={3} max={180} value={duration}
              onChange={e => { setMatchSong(false); setDur(Math.min(180, Math.max(3, Math.round(Number(e.target.value) || 30)))) }}
              style={{ width: 62, padding: '7px 6px', textAlign: 'center' }}
            />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <span style={label}>{t('xd.mv.section')}</span>
          <input
            value={section} onChange={e => setSection(e.target.value)} placeholder={t('xd.mv.sectionph')}
            className="mv-field"
          />
        </div>
      </div>

      <div>
        <span style={label}>{t('xd.mv.lyrics')}</span>
        <textarea
          value={lyrics} onChange={e => setLyrics(e.target.value)} rows={3}
          placeholder={t('xd.mv.lyricsph')}
          className="mv-field" style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span style={label}>{t('xd.mv.song')}</span>
          <AttachmentButton attachments={songAtts} onChange={setSong} disabled={busy} context="xcreate" maxFiles={1} accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg" />
        </div>
        {/* Only offered with a song attached: the audio IS the lip-sync
            input, so without one there is nothing to sync to. */}
        {songAtts.length > 0 && (
          <div>
            <span style={label}>{t('xd.mv.perf')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setSync(false)} className={'mv-chip' + (!sync ? ' on' : '')}>{t('xd.mv.perf.silent')}</button>
              <button onClick={() => setSync(true)}  className={'mv-chip' + (sync ? ' on' : '')}>{t('xd.mv.perf.sync')}</button>
            </div>
            <span style={{ ...hint, maxWidth: 460 }}>
              {sync ? t('xd.mv.perf.synchint') : t('xd.mv.perf.silenthint')}
            </span>
          </div>
        )}
        <div>
          <span style={label}>{t('xd.mv.cast')}</span>
          <AttachmentButton attachments={castAtts} onChange={setCast} disabled={busy} context="xcreate" multiple maxFiles={3} accept="image/jpeg,image/png,image/webp" />
          <span style={hint}>{castAtts.length === 0 ? t('xd.mv.castoriginal') : ''}</span>
        </div>
        <div>
          <span style={label}>{t('xd.mv.stylerefs')}</span>
          <AttachmentButton attachments={styleAtts} onChange={setStyle} disabled={busy} context="xcreate" multiple maxFiles={4} accept="image/jpeg,image/png,image/webp" />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <span style={label}>{t('xd.mv.title')}</span>
          <input
            value={title} onChange={e => setTitle(e.target.value)} placeholder={t('xd.mv.titleph')}
            className="mv-field"
          />
        </div>
      </div>

      <button
        onClick={start} disabled={!ready || busy}
        title={ready ? '' : t('xd.mv.needsong')}
        className="mv-start"
      >{t('xd.mv.start')}</button>
    </div>
  )
}
