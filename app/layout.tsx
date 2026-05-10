import type { Metadata } from 'next'
import { Barlow, JetBrains_Mono, Archivo_Black } from 'next/font/google'
import { AuthModalProvider } from '../lib/AuthModalContext'
import AuthModal from './components/AuthModal'
import Nav from './components/Nav'
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

export const metadata: Metadata = {
  title: 'ModelXD — Stop Overpaying for AI',
  description: 'XDuel to Find Your Best Models. Blind-test AI models, vote on quality, then see the price.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${barlow.variable} ${barlowDisplay.variable} ${jetbrainsMono.variable} ${archivoBlack.variable}`}>
        <AuthModalProvider>
          <Nav />
          {children}
          <AuthModal />
        </AuthModalProvider>
      </body>
    </html>
  )
}
