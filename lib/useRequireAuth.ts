'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export function useRequireAuth() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace(`/login?from=${pathname}`)
      }
    })
  }, [router, pathname])
}
