import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../../lib/site'
import { xtellMetadata } from '../../lib/xtell-meta'
import XTellClient from './client'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  if (siteFromHeaders(h) === 'xtell') return { ...xtellMetadata(h), alternates: { canonical: 'https://xtell.modelxd.com' } }
  return {
    title: 'XTell — X算命 | ModelXD',
    description: '八字與紫微斗數線上排盤。排盤由開源曆法引擎精確計算，再由你挑選的 AI 老師解讀，價格公開。',
  }
}

export default async function XTellPage() {
  return <XTellClient standalone={siteFromHeaders(await headers()) === 'xtell'} />
}
