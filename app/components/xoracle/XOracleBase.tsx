'use client'
// app/components/xoracle/XOracleBase.tsx — where the XOracle street lives on this
// page: '' on the door (the street at `/`), '/xoracle' when the door's
// content is www's page at /xoracle, inside www's own shell (owner, Oct 4: no
// subdomains). XOracleClient provides it; the street and temple links read it
// (lib/site.ts doorHome, templeHref). Anything outside the XOracle content
// (the door's own top bar on the subdomain) gets '' — the default.

import { createContext, useContext } from 'react'
import type { XOracleBase } from '../../../lib/site'

const BaseContext = createContext<XOracleBase>('')

export function XOracleBaseProvider({ base, children }: { base: XOracleBase; children: React.ReactNode }) {
  return <BaseContext.Provider value={base}>{children}</BaseContext.Provider>
}

export const useXOracleBase = (): XOracleBase => useContext(BaseContext)
