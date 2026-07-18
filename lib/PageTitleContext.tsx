'use client'
// lib/PageTitleContext.tsx
//
// Lets a page push a DYNAMIC title into the content TopBar (the "// eyebrow
// + big title" slot). Static pages don't need this — TopBar has a
// pathname-keyed TITLES map — but XDuel's title changes per wizard step,
// so it publishes the current step title here.
//
// Convention (CC, July 16): every page's eyebrow + big title live in the
// title bar, XCreate-style. Only contextual sub-lines stay in the page body.

import { createContext, useContext, useState } from 'react'

export interface PageTitle {
  eyebrow: string
  title: string
  /** Render the first character of `title` in the brand red (XBoard's X). */
  accentX?: boolean
}

const Ctx = createContext<{
  override: PageTitle | null
  setOverride: (t: PageTitle | null) => void
}>({ override: null, setOverride: () => {} })

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<PageTitle | null>(null)
  return <Ctx.Provider value={{ override, setOverride }}>{children}</Ctx.Provider>
}

export function usePageTitle() {
  return useContext(Ctx)
}
