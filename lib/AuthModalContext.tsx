'use client'

import { createContext, useContext, useState } from 'react'

const AuthModalContext = createContext<{
  open: boolean
  nextPath: string | null
  show: (next?: string) => void
  hide: () => void
}>({ open: false, nextPath: null, show: () => {}, hide: () => {} })

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [nextPath, setNextPath] = useState<string | null>(null)
  return (
    <AuthModalContext.Provider value={{
      open,
      nextPath,
      show: (next?: string) => { setNextPath(next ?? null); setOpen(true) },
      hide: () => { setNextPath(null); setOpen(false) },
    }}>
      {children}
    </AuthModalContext.Provider>
  )
}

export const useAuthModal = () => useContext(AuthModalContext)
