'use client'
// lib/useSite.ts — the client half of lib/site.ts (which the Edge proxy
// imports and therefore must stay free of React).
//
// The root layout reads the site from the request header on the server and
// hands it down through SiteProvider, so the very first paint already wears
// the right shell — no ModelXD sidebar flashing before the XTell one (found
// by Codex in browser QA, Sep 23). The hostname/cookie detection after mount
// is only the fallback for a tree rendered without the provider.

import { createContext, useContext, useEffect, useState } from 'react'
import { siteOfHost, doorOfPath, SITE_COOKIE, XTELL_PATH, type Site, type SiteBase } from './site'

const SiteContext = createContext<Site | null>(null)
const BaseContext = createContext<SiteBase | null>(null)

export function SiteProvider({ site, base = '', children }: { site: Site; base?: SiteBase; children: React.ReactNode }) {
  return <SiteContext.Provider value={site}><BaseContext.Provider value={base}>{children}</BaseContext.Provider></SiteContext.Provider>
}

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

/** The site this page is served for. Server-provided (no flash) whenever the
 *  layout's SiteProvider is above; otherwise 'modelxd' until mount. */
export function useSite(): Site {
  const provided = useContext(SiteContext)
  const [detected, setDetected] = useState<Site>('modelxd')
  useEffect(() => {
    if (provided === null) setDetected(siteOfHost(window.location.host, readCookie(SITE_COOKIE)))
  }, [provided])
  return provided ?? detected
}

/** Where the door lives on this page: '' on its subdomain, '/xtell' under
 *  the path (lib/site.ts). Server-provided whenever the layout's provider is
 *  above; otherwise read from the address after mount. */
export function useSiteBase(): SiteBase {
  const provided = useContext(BaseContext)
  const [detected, setDetected] = useState<SiteBase>('')
  useEffect(() => {
    if (provided === null && siteOfHost(window.location.host, null) === 'modelxd' && doorOfPath(window.location.pathname)) setDetected(XTELL_PATH)
  }, [provided])
  return provided ?? detected
}
