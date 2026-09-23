// app/page.tsx — `/` is two different pages depending on the front door.
//
// On www it is the ModelXD landing (HomeClient.tsx, the former page.tsx,
// unchanged). On xtell.modelxd.com it is the temple street itself, rendered
// here rather than reached by a proxy rewrite: a rewrite left the server
// believing the pathname was /xtell while the browser said /, and every
// usePathname() consumer (Nav's active link) hydrated with a mismatch
// (Codex, browser QA Sep 23). Choosing the component on the server keeps
// the URL and the pathname the same thing.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../lib/site'
import HomeClient from './HomeClient'
import XTellClient from './xtell/client'

export async function generateMetadata(): Promise<Metadata> {
  const site = siteFromHeaders(await headers())
  if (site === 'xtell') {
    return {
      title: 'XTell | 探索世界的占卜之境',
      description: '五個傳統，一個入口：中華廟宇的關帝籤與媽祖籤、命理書齋的八字、紫微、姓名與測字、曼谷四面佛的許願、印度九曜殿的吠陀占星、西洋觀星台的星盤。排盤由開源曆法引擎精確計算，再由你挑選的 AI 老師解讀。僅供參考與娛樂。',
      alternates: { canonical: 'https://xtell.modelxd.com' },
    }
  }
  return {
    title: 'ModelXD',
    description: 'XDuel to Find Your Best Models. Blind-test AI models, vote on quality, then see the price.',
  }
}

export default async function Page() {
  const site = siteFromHeaders(await headers())
  return site === 'xtell' ? <XTellClient /> : <HomeClient />
}
