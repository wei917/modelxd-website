// app/xfilm/page.tsx — XFilm opens on 導演 (owner, Oct 22: "my projects
// should be inside Direct"), whose first screen is your boards. The query
// rides along, so /xfilm?c=<board> and /xfilm?q=<request> work too.

import { redirect } from 'next/navigation'

export default async function XFilmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one)
  const s = qs.toString()
  redirect(`/xfilm/direct${s ? `?${s}` : ''}`)
}
