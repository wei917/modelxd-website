'use client'
// lib/useSite.ts — the client half of lib/site.ts (which the Edge proxy
// imports and therefore must stay free of React).

import { useEffect, useState } from 'react'
import { siteOfHost, SITE_COOKIE, type Site } from './site'

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

/** 'modelxd' during SSR and first paint (so markup matches on every host),
 *  the real answer after mount — same pattern as Nav's beta tag. */
export function useSite(): Site {
  const [site, setSite] = useState<Site>('modelxd')
  useEffect(() => { setSite(siteOfHost(window.location.hostname, readCookie(SITE_COOKIE))) }, [])
  return site
}
