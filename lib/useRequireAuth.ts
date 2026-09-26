'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from './AuthModalContext'

/** Pops the sign-in dialog for a signed-out visitor. `enabled: false` skips
 *  it, for a page that lets strangers look around and asks at the moment
 *  something needs an account (xcreate.modelxd.com, Sep 26). The APIs
 *  authenticate every call regardless.
 *
 *  Known: AuthModalProvider hands out a new show() on every render, so this
 *  effect re-runs whenever the dialog opens or closes, and for a signed-out
 *  visitor that reopens it at once: the ✕ cannot close the dialog on a page
 *  that calls this. Left as is on www pending the owner's call (making ✕
 *  work there changes what a stranger sees); a page that passes false is
 *  out of the loop. */
export function useRequireAuth(enabled = true) {
  const { show } = useAuthModal()

  useEffect(() => {
    if (!enabled) return
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) show()
    })
  }, [show, enabled])
}
