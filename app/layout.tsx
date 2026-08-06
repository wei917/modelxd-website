import type { Metadata } from 'next'
import { Barlow, JetBrains_Mono, Archivo_Black, Noto_Sans_TC } from 'next/font/google'
import { AuthModalProvider } from '../lib/AuthModalContext'
import { LangProvider } from '../lib/i18n'
import AuthModal from './components/AuthModal'
import Nav from './components/Nav'
import Omnibox from './components/Omnibox'
import GlobalCursor from './components/GlobalCursor'
import { PageTitleProvider } from '../lib/PageTitleContext'
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
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-mono',
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

export const metadata: Metadata = {
  title: 'ModelXD',
  description: 'XDuel to Find Your Best Models. Blind-test AI models, vote on quality, then see the price.',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${barlow.variable} ${barlowDisplay.variable} ${jetbrainsMono.variable} ${archivoBlack.variable} ${notoTC.variable}`}>
        <LangProvider>
          <AuthModalProvider>
            <PageTitleProvider>
            <div className="app-shell">
              <Nav />
              <div className="app-main">
                <Omnibox />
                {children}
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
      </body>
    </html>
  )
}
