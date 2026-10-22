// app/page.tsx — `/` is a different page for each front door.
//
// On www it is the ModelXD landing (HomeClient.tsx, the former page.tsx,
// unchanged). On xtell.modelxd.com it is the temple street itself, rendered
// here rather than reached by a proxy rewrite: a rewrite left the server
// believing the pathname was
// /xoracle while the browser said /, and every usePathname() consumer (Nav's
// active link) hydrated with a mismatch (Codex, browser QA Sep 23).
// Choosing the component on the server keeps the URL and the pathname the
// same thing.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../lib/site'
import { serverLang } from '../lib/lang'
import { xoracleMetadata } from '../lib/xoracle-meta'
import HomeClient from './HomeClient'
import XOracleClient from './xoracle/client'
import { almanacSection } from './components/xoracle/AlmanacSection'

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const h = await headers()
  const site = siteFromHeaders(h)
  // A shared link names its temple (?t=, lib/xoracle-share.ts): the preview
  // shows that temple.
  if (site === 'xoracle') { const t = (await searchParams).t; return xoracleMetadata(serverLang(h, site), typeof t === 'string' ? t : null) }
  return {
    title: 'ModelXD',
    description: 'XDuel to Find Your Best Models. Blind-test AI models, vote on quality, then see the price.',
  }
}

export default async function Page() {
  const h = await headers()
  const site = siteFromHeaders(h)
  // The street's 黃曆 is its own section (AlmanacSection): computed on the
  // server, in its own Suspense and error boundary.
  if (site === 'xoracle') return <XOracleClient almanacSection={almanacSection()} country={h.get('x-vercel-ip-country')} />
  return <HomeClient />
}
