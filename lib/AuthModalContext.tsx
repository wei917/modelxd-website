'use client'

import { createContext, useContext, useState } from 'react'

const AuthModalContext = createContext<{
  open: boolean
  show: () => void
  hide: () => void
}>({ open: false, show: () => {}, hide: () => {} })

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <AuthModalContext.Provider value={{ open, show: () => setOpen(true), hide: () => setOpen(false) }}>
      {children}
    </AuthModalContext.Provider>
  )
}

export const useAuthModal = () => useContext(AuthModalContext)
