// app/xdev/page.tsx — XDev server shell: API keys + MCP for external agents.
// Beta gate (FEATURE_XDEV_EMAILS); 404 rather than 403 so the page's
// existence isn't advertised to accounts that can't open it.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasFeature } from '@/lib/features'
import XDevClient from './client'

export const metadata: Metadata = {
  title: 'XDev — ModelXD for Agents | ModelXD',
  description: 'Mint API keys and connect any MCP client — Claude Code, Cursor, n8n — to generate through ModelXD with honest, vote-backed model picking.',
}

export default async function XDevPage() {
  if (!(await hasFeature('xdev'))) notFound()
  return <XDevClient />
}
