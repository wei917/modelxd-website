// app/xtalk/[id]/page.tsx
// Werewolf moved to /xgame (CC, Aug 6). Every /xtalk/<id> permalink ever
// minted was a werewolf game — discussions have no rows — so this is a
// blanket forward. The gate stays in front: an ungated visitor still sees
// a 404, not a redirect that advertises the arena.
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/features'

export default async function XTalkSessionRedirect({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasFeature('xtalk'))) notFound()
  const { id } = await params
  redirect(`/xgame/${id}`)
}
