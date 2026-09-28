import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../../lib/site'
import { serverLang } from '../../lib/lang'
import { xtellMetadata } from '../../lib/xtell-meta'
import XTellClient from './client'
import { almanacSection } from '../components/xtell/AlmanacSection'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  if (siteFromHeaders(h) === 'xtell') return { ...xtellMetadata(serverLang(h, 'xtell')), alternates: { canonical: 'https://xtell.modelxd.com' } }
  return {
    title: 'XTell — X算命 | ModelXD',
    description: '八字與紫微斗數線上排盤。先核對命盤，再請你選擇的 AI 老師解讀，送出問題前可查看預估費用。',
  }
}

export default async function XTellPage() {
  const h = await headers()
  const site = siteFromHeaders(h)
  // The 黃曆 is its own section (see app/page.tsx).
  return <XTellClient standalone={site === 'xtell'} almanacSection={almanacSection()} />
}
