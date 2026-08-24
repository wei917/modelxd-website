// app/xdev/page.tsx — XDev server shell: API keys + MCP for external agents.
// Open to any signed-in user since Aug 24 (owner: "we can open XDev") — the
// beta gate that used to 404 this page is gone, along with the whole
// per-user feature system it was the last member of. Money safety does not
// depend on that gate: a key spends its OWN user's credits behind the
// pre-flight balance check, carries a per-key spend cap, and can never mint
// another key.
import type { Metadata } from 'next'
import XDevClient from './client'

export const metadata: Metadata = {
  title: 'XDev — ModelXD for Agents | ModelXD',
  description: 'Mint API keys and connect any MCP client — Claude Code, Cursor, n8n — to generate through ModelXD with honest, vote-backed model picking.',
}

export default async function XDevPage() {
  return <XDevClient />
}
