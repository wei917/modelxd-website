// app/xtell/page.tsx — XTell (X算命) server shell. Auth like XCut/XDirect:
// the client shows the sign-in modal to strangers.
import type { Metadata } from 'next'
import XTellClient from './client'

export const metadata: Metadata = {
  title: 'XTell — X算命 | ModelXD',
  description: '八字與紫微斗數線上排盤。排盤由開源曆法引擎精確計算，再由你挑選的 AI 老師解讀，價格公開。',
}

export default function XTellPage() {
  return <XTellClient />
}
