import type { Metadata } from 'next'
import TgsClient from './client'

// Public: no sign-in, no model call, no credits. The gallery only shows
// pictures and prompts; the two actions open XDuel / XDirect with the prompt
// filled in and nothing runs until the visitor presses start there.
export const metadata: Metadata = {
  title: 'TGS 2026 · AI fan art gallery — ModelXD',
  description: 'Unofficial AI fan concepts of famous Japanese games, generated for the Tokyo Game Show 2026 showcase. Open a work for its prompt and run it as an XDuel.',
}

export default function TgsPage() {
  return <TgsClient />
}
