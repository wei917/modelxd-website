// app/xdirector/page.tsx
// XDirector is not a destination — it is the agent you talk to inside
// XCreate. This route survives only so the ?c= conversation permalinks
// already in the wild keep resolving; it forwards to the real surface.
// (CC, July 31: "XCREATE is a page to create things, XDirector is a way to
// create things living in agent mode in XCREATE.")
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { hasFeature } from '@/lib/features'

export default async function XDirectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Limited beta. 404 rather than 403 so the page's existence isn't
  // advertised to people who can't use it yet.
  if (!(await hasFeature('xdirector'))) notFound()
  const sp = await searchParams
  const c  = typeof sp.c === 'string' ? sp.c : null
  redirect(`/xcreate?agent=1${c ? `&c=${encodeURIComponent(c)}` : ''}`)
}
