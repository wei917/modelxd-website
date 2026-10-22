// app/xfilm/layout.tsx — XFilm (Oct 22; owner: "advanced video/audio
// multimedia should go XFilm"): XDirect, XCut and X創作's 成片 and 同款 as one
// app with four tabs, each its own page under the same top bar. The tabs'
// API routes, tables and stored values keep their old names (/api/xdirector,
// /api/xcut, /api/xcreate/film, /api/xcreate/remake); the old addresses
// forward here (lib/renamed-apps.js, next.config.js).

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { serverLang } from '@/lib/lang'
import { xfilmMetadata } from '@/lib/xfilm-meta'
import XFilmBar from './XFilmBar'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  return xfilmMetadata(serverLang(h, 'modelxd'))
}

export default function XFilmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="xfilm-shell">
      <XFilmBar />
      {children}
    </div>
  )
}
