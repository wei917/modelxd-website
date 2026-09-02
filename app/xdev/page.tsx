// app/xdev/page.tsx — XDev server shell: THE developer page. Public since
// Sep 1 (owner: docs must be readable before signup; one page, not two) —
// the reference renders for everyone, key management asks for sign-in
// inline. Money safety never depended on gating this page: a key spends
// its OWN user's credits behind the pre-flight balance check, carries a
// per-key spend cap, and can never mint another key.
import type { Metadata } from 'next'
import XDevClient from './client'

export const metadata: Metadata = {
  title: 'XDev — API keys & docs | ModelXD',
  description: 'The ModelXD developer page: mint API keys and read the full reference — OpenAI-compatible chat completions with vote-based routing, async image & video generation, and MCP for agent clients.',
}

export default async function XDevPage() {
  return <XDevClient />
}
