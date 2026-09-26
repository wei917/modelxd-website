// app/xcreate/page.tsx
// Server shell for XCreate. The beta flags it used to resolve are gone
// (canvas opened to everyone, Aug 18) — the shell survives as the
// server/client split point /xdirect also uses. On xcreate.modelxd.com the
// same shell is also `/` (app/page.tsx renders it there).

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import CreateClient from './client'
import { readShowcase } from '@/lib/showcase'
import { siteFromHeaders } from '@/lib/site'
import { xcreateMetadata, XCREATE_CANONICAL } from '@/lib/xcreate-meta'

// On the XCreate host, /xcreate is the same page as `/`: one canonical URL.
// www keeps the layout's metadata, as before.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  if (siteFromHeaders(h) === 'xcreate') return { ...xcreateMetadata(h), alternates: { canonical: XCREATE_CANONICAL } }
  return {}
}

// The gallery is read HERE, on the server, so its pictures are in the HTML
// rather than waiting on a client fetch. A client-side fetch renders nothing
// at all wherever React defers passive effects (any hidden or background tab),
// and costs a waterfall everywhere else.
export default async function XCreatePage() {
  const showcase = await readShowcase().catch(() => [])
  return <CreateClient showcase={showcase} />
}
