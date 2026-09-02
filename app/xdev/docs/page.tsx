// app/xdev/docs/page.tsx — server shell for the public API reference.
//
// PUBLIC on purpose: docs are read before the decision to sign up, so
// gating them behind auth would gate the pitch. The content lives in
// client.tsx (the xcreate shell/client pattern) because a reference this
// size earns its interactivity: sticky section nav with scroll-spy, copy
// buttons on every block, language tabs on the quickstart. One rule
// carries over from v1 of this page: every snippet is run against the
// live endpoint before being written down (docs/API-V1.md holds the
// verification log), and this page changes in the same commit as the API.

import type { Metadata } from 'next'
import ApiDocsClient from './client'

export const metadata: Metadata = {
  title: 'API Docs — build on the models that win | ModelXD',
  description:
    'The ModelXD API reference: OpenAI-compatible chat completions with vote-based routing (xd/auto, xd/cheap), enforced JSON schema output, async image & video generation, and MCP for agent clients.',
}

export default function ApiDocsPage() {
  return <ApiDocsClient />
}
