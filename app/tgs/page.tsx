import { redirect } from 'next/navigation'

// /tgs was the first name of the playground (Sep 14). Old links keep
// working: redirect to /playground with the query (?lang=ja …) intact.
export default async function TgsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, val] of Object.entries(sp)) {
    if (Array.isArray(val)) val.forEach(x => qs.append(k, x))
    else if (val != null) qs.set(k, val)
  }
  const s = qs.toString()
  redirect('/playground' + (s ? `?${s}` : ''))
}
