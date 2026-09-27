import type { Metadata } from 'next'
import { Barlow, JetBrains_Mono, Archivo_Black, Noto_Sans_TC, Noto_Sans_JP, DM_Sans } from 'next/font/google'
import { AuthModalProvider } from '../lib/AuthModalContext'
import { LangProvider } from '../lib/i18n'
import AuthModal from './components/AuthModal'
import Nav from './components/Nav'
import Omnibox from './components/Omnibox'
import GlobalCursor from './components/GlobalCursor'
import { Analytics } from '@vercel/analytics/next'
import { PageTitleProvider } from '../lib/PageTitleContext'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../lib/site'
import { xtellMetadata } from '../lib/xtell-meta'
import { xcreateMetadata } from '../lib/xcreate-meta'
import { SiteProvider } from '../lib/useSite'
import { serverLang, LANG_BOOT } from '../lib/lang'
import { XCreateFooter } from './components/xcreate/XCreateNav'
import './globals.css'

// Barlow at body weights — used for paragraph copy and UI labels.
const barlow = Barlow({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-body',
})
// Same family, different CSS variable — fills the slot that used to be
// Barlow Condensed. Barlow Condensed had unreadably narrow letterforms in
// short labels and headings; Barlow at the same weights reads cleaner
// without losing the editorial-display feel. Browsers reuse the cached
// Barlow font payload, so this doesn't double the font download.
const barlowDisplay = Barlow({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-display',
})
// The mono SOURCE token. The public `--font-mono` is composed from it on
// <body> in globals.css, so Japanese mode can append Noto Sans JP as a
// per-glyph fallback: digits and code stay JetBrains Mono, kana and kanji
// in mono-styled labels get real glyphs (Sep 14).
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-mono-src',
})
// Wide, single-weight display font — used for the ModelXD logo so the
// letters look chunky and distinct instead of narrow like Barlow Condensed.
const archivoBlack = Archivo_Black({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-logo',
})
// Traditional Chinese (Taiwan) — used when the site is switched to 中文.
// CJK glyph ranges are huge, so we don't preload; the browser fetches the
// needed ranges on demand via unicode-range.
const notoTC = Noto_Sans_TC({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-zh',
  preload: false,
  display: 'swap',
})
// Japanese — used when the site is switched to 日本語 (Sep 14, TGS pass).
// Japanese used to fall through to system glyphs; the zh override must not
// be reused for it (different glyph forms). Same on-demand loading as TC.
const notoJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-ja',
  preload: false,
  display: 'swap',
})

// xcreate.modelxd.com's type (Sep 26): DM Sans for text, and a Barlow under
// its own variable that the CJK rules in globals.css do not re-point, so
// the wordmark and headings stay Latin Barlow in every language. The classes
// go on <body> on that host only; preload is off so www never fetches them.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-xc',
  preload: false,
  display: 'swap',
})
const barlowXCreate = Barlow({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-xc-display',
  preload: false,
  display: 'swap',
})

// Default title per front door: pages without their own metadata (the
// client-rendered profile, terms, privacy) otherwise say "ModelXD" in the
// tab on the XTell and XCreate hosts. In the language the page renders in.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const site = siteFromHeaders(h)
  if (site === 'xtell') return xtellMetadata(serverLang(h, site))
  if (site === 'xcreate') return xcreateMetadata(serverLang(h, site))
  return {
    title: 'ModelXD',
    description: 'XDuel to Find Your Best Models. Blind-test AI models, vote on quality, then see the price.',
  }
}

// Tell mobile browsers to use the device's real width instead of
// rendering at a desktop "virtual viewport" and then scaling down.
// Without this every page looks zoomed-out on phones.
export const viewport = {
  width:         'device-width',
  initialScale:  1,
  maximumScale:  5,        // allow pinch-zoom for accessibility
  viewportFit:   'cover',
}

// Google Ads tag (owner, Sep 26), on every page of every front door (www,
// xtell., xcreate.), in <head> as Google specifies. Production deployments
// only: localhost and the dev site must not count as ad traffic. Before the
// config, Consent Mode denies ad and analytics storage by default in the
// EEA, the UK and Switzerland, where prior consent is required and there is
// no consent banner; Taiwan, Japan and everywhere else load the tag as
// Google supplied it. Disclosed in /privacy §4.
const GOOGLE_ADS_ID = 'AW-18476997246'
const CONSENT_REGIONS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH']
const GTAG_INIT = [
  'window.dataLayer = window.dataLayer || [];',
  'function gtag(){dataLayer.push(arguments);}',
  `gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', region: ${JSON.stringify(CONSENT_REGIONS)} });`,
  "gtag('js', new Date());",
  `gtag('config', '${GOOGLE_ADS_ID}');`,
].join('\n')

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Which front door (www, xtell. or xcreate.modelxd.com) — stamped by proxy.ts. Read
  // here so the shell is right on the server render; this makes every route
  // dynamic, which they effectively were already (auth on nearly all).
  const h = await headers()
  const site = siteFromHeaders(h)
  // The language the whole page renders in, decided before anything is sent
  // (lib/lang.ts: ?lang=, the saved choice, the browser's list). <html lang>,
  // the title and LangProvider's first render all use it, so the first
  // paint is already in the visitor's language and hydration matches.
  const lang = serverLang(h, site)
  const googleAds = process.env.VERCEL_ENV === 'production'
  return (
    <html lang={lang} data-site={site}>
      <head>
        {/* The first inline script in <head> (Next hoists its async chunks
            and styles above it), so it runs before any of <body> is parsed:
            a language saved only in localStorage (before the cookie existed)
            becomes the cookie, with one reload if this page was rendered in
            another language. */}
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT }} />
        {googleAds && <>
          {/* Google tag (gtag.js) */}
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`} />
          <script dangerouslySetInnerHTML={{ __html: GTAG_INIT }} />
        </>}
      </head>
      <body className={`${barlow.variable} ${barlowDisplay.variable} ${jetbrainsMono.variable} ${archivoBlack.variable} ${notoTC.variable} ${notoJP.variable}${site === 'xcreate' ? ` ${dmSans.variable} ${barlowXCreate.variable}` : ''}`}>
        <SiteProvider site={site}>
        <LangProvider initial={lang}>
          <AuthModalProvider>
            <PageTitleProvider>
            <div className="app-shell">
              <Nav />
              <div className="app-main">
                <Omnibox />
                {children}
                {/* The XCreate shell's footer sits under every page on that
                    host (studio, account, legal); XTell's pages carry their own. */}
                {site === 'xcreate' && <XCreateFooter />}
              </div>
            </div>
            <AuthModal />
            {/* Default custom cursor for every page — see GlobalCursor.tsx.
                Ends the "new page ships with an invisible mouse" bug class
                (CC, July 27). */}
            <GlobalCursor />
            </PageTitleProvider>
          </AuthModalProvider>
        </LangProvider>
        </SiteProvider>
        {/* Vercel Web Analytics — anonymous visitor stats (country, pages,
            referrers). No-ops outside Vercel deployments, so localhost and
            self-hosted runs cost nothing. Enable also requires the dashboard
            toggle: project → Analytics → Enable. */}
        <Analytics />
      </body>
    </html>
  )
}
