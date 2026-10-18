// lib/remake/music.ts: the remake's music (owner, Oct 17: "you should be able
// to analyze the music or video style to generate a matching music"). The
// read listens to the original's music, and a music model (Lyria 3.5 or
// ElevenLabs Music, lib/providers) makes an ORIGINAL track in that style at
// the remake's length. Never the original's melody or lyrics: the prompt asks
// for a new composition, and both models refuse copyrighted lyrics and
// artist voices anyway.

import type { BreakdownMusic, MusicTarget, MusicTune } from './config'

export type MusicStyle = {
  present: boolean
  /** Genre and era, e.g. "J-rock anime opening, 2020s". */
  genre: string
  instruments: string[]
  bpm: number | null
  /** Key and mode if it can be heard, e.g. "D minor"; "" if not. */
  key: string
  /** How the energy moves over the video, e.g. "builds from the first cut, peaks at 11 s". */
  energy: string
  /** "none", or who sings and how, e.g. "solo female, powerful, Japanese". */
  vocals: string
  mood: string
}

/** For Gemini watching the video (with its sound). JSON only. */
export const MUSIC_STYLE_PROMPT = `Listen to this video's music (ignore speech and sound effects). Describe the music so a composer could write a NEW piece in the same style, without copying it.
Return JSON only:
{"present": boolean (is there music at all),
 "genre": string (genre, sub-genre and era, in English),
 "instruments": [string] (the main instruments and sounds you hear, in English),
 "bpm": number | null (the tempo),
 "key": string (key and mode if you can hear it, else ""),
 "energy": string (how the energy moves over the video, with times in seconds),
 "vocals": string ("none", or who sings and how: voice type, delivery, language),
 "mood": string (in English)}
Never transcribe lyrics, and never name the song or the artist.`

export function normalizeMusicStyle(text: string): MusicStyle | null {
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    const j = JSON.parse(text.slice(s, e + 1))
    const str = (v: unknown, max = 240) => (typeof v === 'string' ? v : '').trim().slice(0, max)
    const bpm = Number(j.bpm)
    return {
      present: !!j.present,
      genre: str(j.genre),
      instruments: Array.isArray(j.instruments) ? j.instruments.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 10) : [],
      bpm: Number.isFinite(bpm) && bpm >= 40 && bpm <= 220 ? Math.round(bpm) : null,
      key: str(j.key, 40),
      energy: str(j.energy, 400),
      vocals: str(j.vocals, 160) || 'none',
      mood: str(j.mood, 160),
    }
  } catch { return null }
}

const TARGET_WORDS: Record<MusicTarget, string> = {
  pop: 'pop', country: 'country', rock: 'rock', edm: 'EDM / electronic dance', hiphop: 'hip-hop', lofi: 'lo-fi chill',
  jazz: 'jazz', classical: 'classical orchestral', kpop: 'K-pop', cinematic: 'cinematic orchestral score',
}

/** The page's language as the music model hears it, for sung lyrics. */
export const SUNG_LANGUAGE: Record<string, string> = {
  en: 'English', 'zh-Hant': 'Mandarin Chinese (as sung in Taiwan)', 'zh-Hans': 'Mandarin Chinese', ja: 'Japanese', ko: 'Korean',
}

/** The read's music as a style the prompt can use. */
export function styleFromRead(m: BreakdownMusic): MusicStyle {
  return {
    present: m.present, genre: m.genre ?? '', instruments: m.instruments ?? [], bpm: m.bpm,
    key: m.key ?? '', energy: m.energy ?? '', vocals: m.vocals || 'none', mood: m.mood,
  }
}

/** The music model's prompt: a new piece in the original's style at the
 *  remake's length, or that style tuned toward another (the page's sliders).
 *  `instrumental` leaves the voice out even when the original had one (an AI
 *  singer is the riskiest part to get wrong); `accents` are the remake's
 *  change times, so the piece can hit them. */
export function musicPrompt(style: MusicStyle, seconds: number, opts: { instrumental?: boolean; accents?: number[]; tune?: MusicTune | null; language?: string } = {}): string {
  const t = opts.tune
  const original = style.genre || 'music'
  const target = t ? TARGET_WORDS[t.target] : ''
  const amount = t ? Math.max(0, Math.min(100, Math.round(t.amount))) : 0
  const genre = !t || amount === 0 ? `${original} piece`
    : amount <= 35 ? `${original} piece with a light touch of ${target}`
    : amount <= 70 ? `blend of ${original} and ${target}, about ${amount}% ${target}`
    : `${target} piece with only hints of the original ${original}`
  const bpm = style.bpm && t ? Math.round(style.bpm * (1 + Math.max(-50, Math.min(50, t.tempo)) / 200)) : style.bpm
  const energy = !t || Math.abs(t.energy) < 10 ? '' : t.energy <= -30 ? 'Much calmer than the original.' : t.energy < 0 ? 'A little calmer than the original.' : t.energy < 30 ? 'A little more intense than the original.' : 'Much more intense than the original.'
  const vocals = t ? t.vocals : !opts.instrumental && !!style.vocals && !/^none$/i.test(style.vocals)
  const parts = [
    `An original ${genre}, newly composed: its own melody and arrangement, not a cover and not based on any existing song.`,
    bpm ? `${bpm} BPM, a steady tempo throughout.` : '',
    style.key && (!t || amount <= 35) ? `In ${style.key}.` : '',
    style.instruments.length && (!t || amount <= 70) ? `Instruments: ${style.instruments.join(', ')}${t && amount > 35 ? `, mixed with ${target} instruments` : ''}.` : '',
    style.mood ? `Mood: ${style.mood}.` : '',
    style.energy && !t ? `Energy: ${style.energy}.` : energy,
    vocals ? `Vocals: ${style.vocals && !/^none$/i.test(style.vocals) ? style.vocals : 'a lead singer'}, with new, original lyrics${opts.language ? ` in ${opts.language}` : ''}.` : 'Instrumental only, no vocals.',
    opts.accents?.length ? `Strong hits or accents at ${opts.accents.map(x => `${x.toFixed(1)} s`).join(', ')}.` : '',
    `Exactly ${Math.round(seconds)} seconds long, ending cleanly on the last beat.`,
  ]
  return parts.filter(Boolean).join(' ')
}
