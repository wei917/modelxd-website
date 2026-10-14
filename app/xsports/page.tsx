import type { Metadata } from 'next'
import { Barlow_Condensed } from 'next/font/google'
import XSportsClient from './client'

// The scoreboard voice: every score, inning, clock and date number on the
// page (app/xsports/xsports.css --xs-num). Numbers only, at 13px and up: the
// site dropped Barlow Condensed for small labels and headings, where its
// narrow letters were hard to read (app/layout.tsx).
const scoreboard = Barlow_Condensed({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-scoreboard', display: 'swap' })

export const metadata: Metadata = {
  title: 'X體育 — live MLB and NBA with fans and an AI commentator | ModelXD',
  description: 'Live MLB and NBA games: scores, play-by-play, box scores, odds, and a live chat with other fans and an AI commentator.',
}

export default function XSportsPage() {
  return <div className={scoreboard.variable}><XSportsClient /></div>
}
