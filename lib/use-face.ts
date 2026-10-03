'use client'
// lib/use-face.ts — the name and picture an account shows (Oct 2).
//
// Owner: "profile image and website name". Every page shows the ones saved
// on the account's profiles row: what the person chose (/api/profile/face),
// or, until then, what the first sign-in gave. Not the sign-in metadata
// (lib/user-face.ts), which Supabase overwrites with whichever method signed
// in LAST: one account showed its Google photo on the profile page and its X
// photo in the top bar.
//
// The row is read once per page load and kept in memory and localStorage, so
// the next page paints the saved face at once; a save announces the new one
// to every reader on the page (FACE_EVENT).

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createSupabaseBrowser } from './supabase-client'
import { userName, userPhoto } from './user-face'

export type Face = { name: string | null; photo: string | null }

export const FACE_EVENT = 'modelxd:face'
const KEY = 'modelxd_face:'
const memory = new Map<string, Face>()

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const https = (v: unknown) => { const s = str(v); return s && /^https:\/\//.test(s) ? s : null }
const asFace = (v: { name?: unknown; photo?: unknown } | null | undefined): Face => ({ name: str(v?.name), photo: https(v?.photo) })

function remembered(id: string): Face | null {
  const hit = memory.get(id)
  if (hit) return hit
  try {
    const raw = localStorage.getItem(KEY + id)
    if (raw) { const face = asFace(JSON.parse(raw)); memory.set(id, face); return face }
  } catch { /* private mode, or a bad entry */ }
  return null
}

function keep(id: string, face: Face) {
  memory.set(id, face)
  try { localStorage.setItem(KEY + id, JSON.stringify(face)) } catch { /* private mode */ }
}

/** The saved face from the account's row; null when there is no row yet. */
export async function loadFace(id: string): Promise<Face | null> {
  const { data } = await createSupabaseBrowser().from('profiles')
    .select('display_name, avatar_url').eq('id', id).maybeSingle()
  if (!data) return null
  const face = asFace({ name: data.display_name, photo: data.avatar_url })
  keep(id, face)
  return face
}

/** After a save: every reader on the page draws the new face. */
export function announceFace(id: string, face: Face) {
  keep(id, face)
  window.dispatchEvent(new CustomEvent(FACE_EVENT, { detail: { id, face } }))
}

/** The face to draw for a signed-in account: the saved one, or the sign-in's
 *  until the row has been read. */
export function useFace(user: User | null): Face {
  const id = user?.id ?? null
  const [face, setFace] = useState<Face | null>(null)
  useEffect(() => {
    if (!id) { setFace(null); return }
    setFace(remembered(id))
    let live = true
    void loadFace(id).then(f => { if (live && f) setFace(f) }).catch(() => {})
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; face: Face }>).detail
      if (d?.id === id) setFace(d.face)
    }
    window.addEventListener(FACE_EVENT, onSaved)
    return () => { live = false; window.removeEventListener(FACE_EVENT, onSaved) }
  }, [id])
  return { name: face?.name ?? userName(user), photo: face?.photo ?? userPhoto(user) }
}
