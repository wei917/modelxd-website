// app/xdirect/page.tsx
// XDirect — the director's stage: chat rail + canvas board, one screen.
// Server shell resolves auth/feature state before the client renders.
//
// Gate shape (CC, Aug 5): a SIGNED-IN user outside the beta gets a 404, so
// the surface isn't advertised to people who can't use it yet. A SIGNED-OUT
// visitor gets the page shell + auth modal instead — the landing agent
// routes strangers here with their request in ?q=, and a 404 would throw
// away exactly the visitor the routing just won. The auth redirect keeps
// the query string, so OAuth lands them back here with the request intact.

import { notFound } from 'next/navigation'
import { hasFeature } from '@/lib/features'
import { createSupabaseServer } from '@/lib/supabase-server'
import XDirectClient from './client'

export default async function XDirectPage() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (user && !(await hasFeature('xdirector'))) notFound()
  return <XDirectClient />
}
