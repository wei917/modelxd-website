import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../../lib/site'
import XTellClient from './client'

export async function generateMetadata(): Promise<Metadata> {
  const standalone = siteFromHeaders(await headers()) === 'xtell'
  return {
    title: standalone ? 'XTell X算命 | 線上廟街' : 'XTell — X算命 | ModelXD',
    description: standalone
      ? '問前程，問姻緣，或問心裡那件小事。逛逛 XTell 線上廟街，免費排盤、抽籤，再與你選的 AI 老師聊聊。僅供參考與娛樂。'
      : '八字與紫微斗數線上排盤。排盤由開源曆法引擎精確計算，再由你挑選的 AI 老師解讀，價格公開。',
    ...(standalone ? { alternates: { canonical: 'https://xtell.modelxd.com' } } : {}),
  }
}

export default async function XTellPage() {
  return <XTellClient standalone={siteFromHeaders(await headers()) === 'xtell'} />
}
