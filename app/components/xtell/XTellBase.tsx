'use client'
// app/components/xtell/XTellBase.tsx — where the XTell street lives on this
// page: '' on xtell.modelxd.com (the door at `/`), '/xtell' when the door's
// content is www's page at /xtell, inside www's own shell (owner, Oct 4: no
// subdomains). XTellClient provides it; the street and temple links read it
// (lib/site.ts doorHome, templeHref). Anything outside the XTell content
// (the door's own top bar on the subdomain) gets '' — the default.

import { createContext, useContext } from 'react'
import type { XTellBase } from '../../../lib/site'

const BaseContext = createContext<XTellBase>('')

export function XTellBaseProvider({ base, children }: { base: XTellBase; children: React.ReactNode }) {
  return <BaseContext.Provider value={base}>{children}</BaseContext.Provider>
}

export const useXTellBase = (): XTellBase => useContext(BaseContext)
