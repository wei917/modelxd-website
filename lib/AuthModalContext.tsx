'use client'

import { createContext, useContext, useState } from 'react'

const AuthModalContext = createContext<{
  open: boolean
  nextPath: string | null
  /** True while a page has demanded sign-in: no ✕, no overlay click, no Escape
   *  (owner, Sep 25: the registration window must not be closable). */
  required: boolean
  show: (next?: string) => void
  /** Open the dialog and lock it until `release()` or a page load. */
  require: (next?: string) => void
  release: () => void
  hide: () => void
}>({ open: false, nextPath: null, required: false, show: () => {}, require: () => {}, release: () => {}, hide: () => {} })

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [required, setRequired] = useState(false)
  const [nextPath, setNextPath] = useState<string | null>(null)
  return (
    <AuthModalContext.Provider value={{
      open,
      nextPath,
      required,
      show: (next?: string) => { setNextPath(next ?? null); setOpen(true) },
      require: (next?: string) => { setNextPath(next ?? null); setRequired(true); setOpen(true) },
      release: () => { setRequired(false); setOpen(false); setNextPath(null) },
      // hide() is what ✕, the overlay and Escape call; a required dialog
      // ignores it. Pages that demanded sign-in call release() when they
      // stop needing it (the gate unmounts, the visitor goes back).
      hide: () => { if (required) return; setNextPath(null); setOpen(false) },
    }}>
      {children}
    </AuthModalContext.Provider>
  )
}

export const useAuthModal = () => useContext(AuthModalContext)
