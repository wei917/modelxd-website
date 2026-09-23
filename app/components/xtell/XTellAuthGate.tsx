'use client'

import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../../../lib/AuthModalContext'

/** Ask once per entry, so dismissing the dialog does not reopen it. The API
 * still authenticates every chart and reading independently. */
export default function XTellAuthGate() {
  const { show } = useAuthModal()
  const prompt = useRef(show)
  useEffect(() => {
    let active = true
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    void client.auth.getUser().then(({ data }) => {
      if (active && !data.user) prompt.current()
    })
    return () => { active = false }
  }, [])
  return null
}
