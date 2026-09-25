'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../../../lib/AuthModalContext'

/** Inside a temple or on the account page, a signed-out visitor must sign
 *  in: the dialog is REQUIRED (no ✕, no overlay click, no Escape — owner,
 *  Sep 25) and reopens if anything closes it, until the visitor signs in or
 *  leaves the page (the gate unmounts and releases it). The API still
 *  authenticates every chart and reading independently. */
export default function XTellAuthGate() {
  const { require, release } = useAuthModal()
  useEffect(() => {
    let active = true
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    void client.auth.getUser().then(({ data }) => { if (active && !data.user) require() })
    const { data: sub } = client.auth.onAuthStateChange((_e, session) => { if (active && session?.user) release() })
    return () => { active = false; sub.subscription.unsubscribe(); release() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
