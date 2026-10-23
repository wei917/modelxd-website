// app/xfilm/page.tsx — XFilm opens on 同款 (owner, Oct 23: "make /xfilm open
// on 同款", its first tab since Oct 22). A link that names a board (?c=), a
// request for the director (?q=) or New (?new=1) still goes to 導演. The
// query rides along either way.

import { redirect } from 'next/navigation'

export default async function XFilmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one)
  const tab = qs.has('c') || qs.has('q') || qs.has('new') ? 'direct' : 'remake'
  const s = qs.toString()
  redirect(`/xfilm/${tab}${s ? `?${s}` : ''}`)
}
