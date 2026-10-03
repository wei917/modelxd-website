'use client'
// The xcreate.modelxd.com shell: top bar, footer, and the small pieces other
// shared pages borrow on that host (the wordmark for the sign-in dialog, the
// note on the legal pages). Nav.tsx swaps this in when useSite() is
// 'xcreate'; the root layout renders the footer there. The studio itself is
// app/xcreate/client.tsx (Codex). The top bar carries the four types the
// studio makes, as XTell's carries its temples (owner, Sep 28: "do the same
// as xtell"): the studio is the door's one page, with the templates under
// its composer, and the Library lives on the account page. The language
// picker moved there too, as on XTell.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { useLang } from '../../../lib/i18n'
import { useSite } from '../../../lib/useSite'
import ModeIcon from '../ModeIcon'
import { STUDIO_TYPES, requestStudioType, useStudioType } from './studio-type'
import { useFace } from '../../../lib/use-face'
import './xcreate-shell.css'

/** The mark: the ModelXD logo beside the name in the reader's language
 *  (XCreate, X創作 / X创作, X作成, X창작; owner, Sep 28, as XTell is X先知),
 *  the X in the accent as XTell's mark does it (owner, Sep 26: logo + text,
 *  no full stop). */
export function XCreateMark() {
  const { t } = useLang()
  const brand = t('xcreate.site.brand')
  // 64 px (3 KB), as XTell's mark: the site-wide logo.png is 520 px and 219
  // KB, and the page preloads it (Sep 28).
  return <span className="xcs-brand"><img className="xcs-logo" src="/xcreate/logo-64.png" alt="" width={26} height={26} /><span><span className="xcs-accent">{brand.slice(0, 1)}</span>{brand.slice(1)}</span></span>
}

/** The four types in one row, icon above the label, as XTell's temples:
 *  sideways scroll with arrows when the row does not fit (a phone). The
 *  studio's current type is marked; off the studio none is. On the studio a
 *  click switches its type in place; elsewhere the link opens the studio on
 *  that type (`/?type=`). */
function Types() {
  const { lang, t } = useLang()
  const active = useStudioType()
  const row = useRef<HTMLElement>(null)
  const [more, setMore] = useState({ left: false, right: false })
  // On a phone the row scrolls and the fifth type (the film) starts past
  // the edge: keep the current type in view, when it changes and when the
  // row changes size.
  const showCurrent = () => {
    const el = row.current
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !current) return
    const box = el.getBoundingClientRect()
    const r = current.getBoundingClientRect()
    if (r.right > box.right) el.scrollBy({ left: r.right - box.right + 8, behavior: 'smooth' })
    else if (r.left < box.left) el.scrollBy({ left: r.left - box.left - 8, behavior: 'smooth' })
  }
  useEffect(() => {
    const el = row.current
    if (!el) return
    const check = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(() => { check(); showCurrent() })
    ro.observe(el)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [lang])
  useEffect(showCurrent, [active])
  const scrollRow = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' })
  return <div className="xcs-types-wrap">
    <nav ref={row} className="xcs-types" aria-label={t('xcreate.site.navigation')}>
      {STUDIO_TYPES.map(type => <Link key={type} href={`/?type=${type}`} aria-current={active === type ? 'page' : undefined}
        onClick={event => {
          if (active === null || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          requestStudioType(type)
        }}>
        <ModeIcon m={type} /><span>{t('mode.' + type)}</span>
      </Link>)}
    </nav>
    {more.left && <button type="button" className="xcs-types-arrow is-left" tabIndex={-1} aria-hidden="true" onClick={() => scrollRow(-1)}>‹</button>}
    {more.right && <button type="button" className="xcs-types-arrow is-right" tabIndex={-1} aria-hidden="true" onClick={() => scrollRow(1)}>›</button>}
  </div>
}

/** The tab title follows the page and the language. The server's title is
 *  the first paint's and sits in <head> before it (next.config
 *  htmlLimitedBots), so a title set here is not overwritten afterwards. */
function useTabTitle() {
  const { lang, t } = useLang()
  const pathname = usePathname()
  useEffect(() => {
    const compute = () => {
      const brand = t('xcreate.site.brand')
      if (pathname === '/' || pathname === '/xcreate') return brand
      if (pathname === '/profile') return `${t('profile.account')} | ${brand}`
      if (pathname === '/terms') return `${t('xtell.site.title.terms')} | ${brand}`
      if (pathname === '/privacy') return `${t('xtell.site.title.privacy')} | ${brand}`
      if (pathname === '/tokushoho') return `${t('nav.tokushoho')} | ${brand}`
      return null
    }
    const apply = () => { const title = compute(); if (title) document.title = title }
    apply()
  }, [lang, t, pathname])
}

export default function XCreateNav({ user }: { user: User | null }) {
  const { t } = useLang()
  const { show } = useAuthModal()
  useTabTitle()
  // The saved picture and website name (Oct 2), as www's nav shows them; the
  // initial only without a picture (owner, Sep 26: a letter read as "not
  // updated after sign in").
  const face = useFace(user)
  const initial = (face.name || 'X').slice(0, 1).toUpperCase()
  const photo = face.photo
  return (
    <header className="xcs-top">
      <a href="#xcreate-main" className="xcs-skip" onClick={event => {
        event.preventDefault()
        // The studio carries #xcreate-main; shared pages (account, terms,
        // privacy) are reached through their <main> landmark.
        const main = document.getElementById('xcreate-main') ?? document.querySelector<HTMLElement>('main') ?? document.querySelector<HTMLElement>('.app-main')
        if (!main) return
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
        main.focus()
        main.scrollIntoView({ block: 'start' })
      }}>{t('xtell.site.skip')}</a>
      <div className="xcs-top-inner">
        <Link href="/" className="xcs-home" aria-label={t('xcreate.site.brand')}><XCreateMark /></Link>
        <Types />
        <div className="xcs-actions">
          {user
            ? <Link href="/profile" className="xcs-avatar" aria-label={t('profile.account')}>{photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{initial}</span>}</Link>
            : <button type="button" className="xcs-signin" onClick={() => show()}>{t('auth.signin')}</button>}
        </div>
      </div>
    </header>
  )
}

export function XCreateFooter() {
  const { t } = useLang()
  return <footer className="xcs-footer">
    <div className="xcs-footer-inner">
      <p>{t('xcreate.site.tagline')} <span className="xcs-maker">by <a href="https://www.modelxd.com" target="_blank" rel="noopener">ModelXD <span aria-hidden="true">↗</span></a></span></p>
      <nav aria-label={t('xtell.site.legal')}>
        <span>{t('xcreate.site.footnote')}</span>
        <Link href="/terms">{t('nav.terms')}</Link>
        <Link href="/privacy">{t('nav.privacy')}</Link>
        <Link href="/tokushoho">{t('nav.tokushoho')}</Link>
      </nav>
    </div>
  </footer>
}

/** One line on the shared legal pages, on the XCreate host only: the text
 *  below names ModelXD, and a visitor who came in through XCreate should
 *  know it covers them. Renders nothing on the other doors. */
export function XCreateLegalNote() {
  const { t } = useLang()
  if (useSite() !== 'xcreate') return null
  return <p className="xcs-legal-note">{t('xcreate.site.legalNote')}</p>
}
