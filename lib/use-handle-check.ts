'use client'
// lib/use-handle-check.ts — is the @ID being typed free? (Oct 13; the account
// page's editor and the room's first-message panel.) The shape is checked at
// once (lib/handle.ts); reserved words and other people's IDs by
// /api/profile/handle, a moment after typing stops. Reserved words are left
// to the server, which knows whether this is the official account.

import { useEffect, useState } from 'react'
import { checkHandle, cleanHandle } from './handle'

/** idle (unchanged), checking, ok, or an error code (face.err.<code>). */
export type HandleCheckState = 'idle' | 'checking' | 'ok' | string

const CODES = new Set(['handle_short', 'handle_long', 'handle_chars', 'handle_reserved', 'handle_taken'])

export function useHandleCheck(current: string | null | undefined, draft: string, enabled = true) {
  const clean = cleanHandle(draft)
  const changed = enabled && !!current && clean !== current
  const [state, setState] = useState<HandleCheckState>('idle')
  useEffect(() => {
    if (!changed) { setState('idle'); return }
    const checked = checkHandle(clean, { admin: true })
    if (!checked.ok) { setState(checked.error); return }
    setState('checking')
    let live = true
    const timer = setTimeout(() => {
      fetch(`/api/profile/handle?check=${encodeURIComponent(checked.handle)}`)
        .then(r => r.json())
        // A check that cannot answer lets the save try; the server decides.
        .then((j: { ok?: boolean; error?: string }) => { if (live) setState(j.ok ? 'ok' : j.error && CODES.has(j.error) ? j.error : 'ok') })
        .catch(() => { if (live) setState('ok') })
    }, 350)
    return () => { live = false; clearTimeout(timer) }
  }, [changed, clean])
  return { clean, changed, state, blocked: changed && state !== 'ok' }
}
