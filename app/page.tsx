// app/page.tsx — `/` is a different page for each front door.
//
// On www it is the ModelXD landing (HomeClient.tsx, the former page.tsx,
// unchanged). On xtell.modelxd.com it is the temple street itself, and on
// xcreate.modelxd.com the studio, rendered here rather than reached by a
// proxy rewrite: a rewrite left the server believing the pathname was
// /xtell while the browser said /, and every usePathname() consumer (Nav's
// active link) hydrated with a mismatch (Codex, browser QA Sep 23).
// Choosing the component on the server keeps the URL and the pathname the
// same thing.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../lib/site'
import { serverLang } from '../lib/lang'
import { xtellMetadata } from '../lib/xtell-meta'
import { xcreateMetadata, XCREATE_CANONICAL } from '../lib/xcreate-meta'
import HomeClient from './HomeClient'
import XTellClient from './xtell/client'
import { almanacSection } from './components/xtell/AlmanacSection'
import XCreatePage from './xcreate/page'

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const h = await headers()
  const site = siteFromHeaders(h)
  // A shared link names its temple (?t=, lib/xtell-share.ts): the preview
  // shows that temple.
  if (site === 'xtell') { const t = (await searchParams).t; return { ...xtellMetadata(serverLang(h, site), typeof t === 'string' ? t : null), alternates: { canonical: 'https://xtell.modelxd.com' } } }
  if (site === 'xcreate') return { ...xcreateMetadata(serverLang(h, site)), alternates: { canonical: XCREATE_CANONICAL } }
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
  if (site === 'xtell') return <XTellClient almanacSection={almanacSection()} country={h.get('x-vercel-ip-country')} />
  // The studio's own server shell, so `/` here reads the gallery on the
  // server exactly as /xcreate does.
  if (site === 'xcreate') return <XCreatePage />
  return <HomeClient />
}
