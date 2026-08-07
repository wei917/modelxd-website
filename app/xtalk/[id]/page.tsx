// app/xtalk/[id]/page.tsx
// A conversation's address. Discussions persist since Aug 6 (owner: "we
// should keep Discussion"), so this branches by what the id names:
// discussion rows open the room right here; everything else is a werewolf
// permalink from the pre-move era and forwards to /xgame. The gate stays
// in front: an ungated visitor sees a 404, not a redirect that advertises.
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { hasFeature } from '@/lib/features'
import XTalkClient from '../client'

export default async function XTalkSessionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasFeature('xtalk'))) notFound()
  const { id } = await params
  // Type lookup only — ownership is enforced by the session API's load
  // action, so a guessed URL renders an empty room, not someone's talk.
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
  const { data } = await svc.from('xtalk_sessions').select('game').eq('id', id).maybeSingle()
  if (data?.game === 'discussion') return <XTalkClient resumeId={id} />
  redirect(`/xgame/${id}`)
}
