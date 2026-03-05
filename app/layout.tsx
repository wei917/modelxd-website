import type { Metadata } from 'next'
import { Barlow_Condensed, Barlow, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-body',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'ModelXD — Stop Overpaying for AI',
  description: 'XDuel to Find Your Best Models. Blind-test AI models, vote on quality, then see the price.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${barlowCondensed.variable} ${barlow.variable} ${jetbrainsMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
