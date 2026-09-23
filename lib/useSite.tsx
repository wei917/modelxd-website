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
import { siteOfHost, SITE_COOKIE, type Site } from './site'

const SiteContext = createContext<Site | null>(null)

export function SiteProvider({ site, children }: { site: Site; children: React.ReactNode }) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>
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
    if (provided === null) setDetected(siteOfHost(window.location.hostname, readCookie(SITE_COOKIE)))
  }, [provided])
  return provided ?? detected
}
