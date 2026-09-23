// app/xpersona/page.tsx — XPersona (X角色): the one home for your AI
// characters (owner, Sep 23). Signed-in only (the client pops the auth
// modal). ?c=<id> opens a character's builder, ?new=1 a blank one.
import type { Metadata } from 'next'
import XPersonaClient from './client'

export const metadata: Metadata = {
  title: 'XPersona: your AI characters | ModelXD',
  description: 'Create and manage your AI characters: persona, look, photos, voice, and the model each one runs on.',
}

export default async function XPersonaPage({ searchParams }: { searchParams: Promise<{ c?: string; new?: string }> }) {
  // Read server-side and passed as props, like /xtalk?char= — no
  // useSearchParams/Suspense dance in the client.
  const { c, new: fresh } = await searchParams
  return <XPersonaClient editId={typeof c === 'string' ? c : null} startNew={fresh === '1'} />
}
