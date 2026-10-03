// lib/face.ts — the website name a person chooses (Oct 2; owner: "profile
// image and website name").
//
// The name is shown on ModelXD instead of the Google, LINE or X name, and
// soon other people will see it (published work, online games), so it is
// cleaned here and checked by moderation in /api/profile/face before it is
// saved. The picture rules live in that route; lib/use-face.ts is the reader.
//
// Client-safe: the editor applies the same rules before anything is sent.

export const NAME_MAX = 30

// Control characters, zero-width spaces, bidi overrides and Hangul fillers:
// invisible, so they make a blank name or fake one ("‮" flips the text
// after it). Zero-width joiners stay: emoji sequences are built from them.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009fᅟᅠ​‎‏‪-‮⁠-⁤⁦-⁯ㅤ﻿ﾠ]/g

export type NameError = 'name_empty' | 'name_long' | 'name_reserved'
export type NameCheck = { ok: true; name: string } | { ok: false; error: NameError }

/** NFC, invisible characters out, runs of spaces as one, ends trimmed. */
export function cleanName(raw: string): string {
  return raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
}

/** Characters as a person counts them: an emoji or a 漢字 is one. */
export function nameLength(s: string): number {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length
  } catch {
    return [...s].length
  }
}

/** "ModelXD" in any case, spacing or full-width form is kept for the
 *  official account. */
export function isReservedName(name: string): boolean {
  return /model[\s._-]*xd/i.test(name.normalize('NFKC'))
}

export function checkName(raw: string, opts: { admin?: boolean } = {}): NameCheck {
  const name = cleanName(raw)
  if (!name) return { ok: false, error: 'name_empty' }
  if (nameLength(name) > NAME_MAX) return { ok: false, error: 'name_long' }
  if (!opts.admin && isReservedName(name)) return { ok: false, error: 'name_reserved' }
  return { ok: true, name }
}
