// lib/xduel-audio.ts — the speech files of audio duels (owner, Oct 19:
// 語音 joins XDuel). Server-only.
//
// XDuel keeps images and videos in PUBLIC buckets with lasting links, but no
// public bucket takes audio, and a new bucket is a change to the shared
// project. So speech goes in the private `xcreate-ai-audio` bucket (made
// for XCreate's 語音 by migration 106), each slot remembers its file in
// `audio: { bucket, path }`, and every route that serves a duel signs a
// fresh link here. A stored signed link would die in a day (Common
// Pitfall 11); this way none is ever stored for reading back.

import { createClient } from '@supabase/supabase-js'

export const XDUEL_AUDIO_BUCKET = 'xcreate-ai-audio'
const TTL = 60 * 60 * 24

type AudioRef = { bucket?: string; path?: string }

/** The slots with each audio slot's `text` replaced by a fresh signed link. */
export async function signAudioSlots<T extends { isAudio?: boolean; audio?: AudioRef; text?: string | null }>(slots: T[] | null | undefined): Promise<T[]> {
  const [signed] = await signAudioDuels([Array.isArray(slots) ? slots : []])
  return signed
}

/** The same for many duels at once (the vote feed): one signing call for
 *  all their speech files. */
export async function signAudioDuels<T extends { isAudio?: boolean; audio?: AudioRef; text?: string | null }>(duels: T[][]): Promise<T[][]> {
  const paths = duels.flatMap(slots => slots.filter(s => s?.isAudio && s.audio?.path).map(s => s.audio!.path!))
  if (paths.length === 0) return duels
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data } = await sb.storage.from(XDUEL_AUDIO_BUCKET).createSignedUrls([...new Set(paths)], TTL)
  const url = new Map((data ?? []).map(d => [d.path ?? '', d.signedUrl ?? null]))
  return duels.map(slots => slots.map(s => s?.isAudio && s.audio?.path ? { ...s, text: url.get(s.audio.path) ?? null } : s))
}
