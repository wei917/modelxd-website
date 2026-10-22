import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { siteFromHeaders } from '../../lib/site'
import { serverLang } from '../../lib/lang'
import { xoracleMetadata } from '../../lib/xoracle-meta'
import XOracleClient from './client'
import { almanacSection } from '../components/xoracle/AlmanacSection'

// A shared link (lib/xoracle-share.ts) opens here since Oct 22, when
// xtell.modelxd.com started forwarding: ?t= names its temple, so the preview
// shows that temple's title and picture, as the door's did.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const h = await headers()
  const t = (await searchParams).t
  return xoracleMetadata(serverLang(h, siteFromHeaders(h)), typeof t === 'string' ? t : null)
}

export default async function XOraclePage() {
  const h = await headers()
  // The 黃曆 is its own section (see app/page.tsx). The door's homepage on
  // every host: on www (and dev) it sits inside www's shell (owner, Oct 4:
  // no subdomains; client.tsx).
  return <XOracleClient standalone almanacSection={almanacSection()} country={h.get('x-vercel-ip-country')} />
}
