// app/xcreate/page.tsx
// Server shell for XCreate (X創作). The beta flags it used to resolve are gone
// (canvas opened to everyone, Aug 18) — the shell survives as the
// server/client split point /xdirect also uses. Since Oct 13 this is the
// studio's only address (www and dev): the xcreate.modelxd.com door it
// shared was never released and is gone.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import CreateClient from './client'
import { serverLang } from '@/lib/lang'
import { xcreateMetadata, XCREATE_CANONICAL } from '@/lib/xcreate-meta'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  return { ...xcreateMetadata(serverLang(h, 'modelxd')), alternates: { canonical: XCREATE_CANONICAL } }
}

export default function XCreatePage() {
  return <CreateClient />
}
