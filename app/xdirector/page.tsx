// app/xdirector/page.tsx
// Legacy path. /xdirector was the agent's first home (July 26), then a
// redirect into /xcreate?agent=1 (July 31), and the surface finally became
// a real page again as /xdirect (Aug 5) — this route survives only so the
// ?c= conversation permalinks already in the wild keep resolving.
//
// No gate here: /xdirect does its own auth/feature resolution, and a
// redirect that 404s for signed-out visitors would strand exactly the
// people following an old shared link.
import { redirect } from 'next/navigation'

export default async function XDirectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const c = typeof sp.c === 'string' ? sp.c : null
  const q = typeof sp.q === 'string' ? sp.q : null
  const qs = new URLSearchParams()
  if (c) qs.set('c', c)
  if (q) qs.set('q', q)
  const s = qs.toString()
  redirect(`/xdirect${s ? `?${s}` : ''}`)
}
