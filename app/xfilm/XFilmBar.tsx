'use client'
// XFilm's top bar (Oct 22): X先知's own bar on www (.xtell-embedded-bar and
// its temple row), as XDuel's, XGame's and /profile's, with XFilm's four
// places as its rooms, icon over a label: 導演 (XDirect), 剪輯 (XCut),
// 自動成片 (X創作's 成片) and 同款 (X創作's 同款). Each is its own page, so
// the links are plain navigations; the story bible belongs to 導演.
//
// Icons: no approved set exists for these four yet, so they are line
// drawings like /profile's (導演 and 剪輯 are the left menu's own strokes).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/lib/i18n'

export type XFilmTab = 'direct' | 'edit' | 'auto' | 'remake'
export const XFILM_TABS: XFilmTab[] = ['direct', 'edit', 'auto', 'remake']

export function xfilmTabOf(pathname: string | null): XFilmTab | null {
  const part = pathname?.match(/^\/xfilm\/([a-z]+)/)?.[1]
  if (part === 'bible') return 'direct'
  return (XFILM_TABS as string[]).includes(part ?? '') ? (part as XFilmTab) : null
}

function TabIcon({ tab }: { tab: XFilmTab }) {
  const p = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (tab) {
    case 'direct': return <svg {...p}><path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9z"/><path d="M4 11l-1-4l16-4l1 4z"/><path d="M8 10l2-4"/><path d="M13 9l2-4"/></svg>
    case 'edit':   return <svg {...p}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/></svg>
    case 'auto':   return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14"/><path d="M17 5v14"/><path d="M3 9.5h4"/><path d="M3 14.5h4"/><path d="M17 9.5h4"/><path d="M17 14.5h4"/></svg>
    case 'remake': return <svg {...p}><path d="M17 2l4 4l-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4l4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
  }
}

export default function XFilmBar() {
  const t = useT()
  const current = xfilmTabOf(usePathname())
  return (
    <div className="xtell-embedded-bar xfilm-bar">
      <div className="xtell-embedded-inner">
        <div className="xtell-temple-wrap">
          <nav className="xtell-temple-nav" aria-label={t('nav.xfilm')}>
            {XFILM_TABS.map(tab => (
              <Link key={tab} href={`/xfilm/${tab}`} aria-current={current === tab ? 'page' : undefined}>
                <span className="xtell-nav-icon xfilm-bar-icon"><TabIcon tab={tab} /></span>
                <span>{t(`xfilm.tab.${tab}`)}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
