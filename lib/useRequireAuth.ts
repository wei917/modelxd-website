'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from './AuthModalContext'

export function useRequireAuth() {
  const { show } = useAuthModal()

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) show()
    })
  }, [show])
}
