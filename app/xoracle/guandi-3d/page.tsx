// app/xoracle/guandi-3d/page.tsx — X先知's 3D 關帝廟, a prototype (Oct 22).
// Admin only while it is one (lib/hidden-apps.ts: page not found for anyone
// else, on every host but this machine). ?debug=1 shows the camera's place
// and exposes window.__temple for setting the statue by eye; ?q=100k|150k|500k
// picks one of Marble's splat files (by default our own sharper file). One
// scene, the hilltop (owner, Oct 23: "only hilltop"); an old ?scene= link
// still opens it.

import type { Metadata } from 'next'
import Temple3D from './Temple3D'

export const metadata: Metadata = {
  title: '關帝廟 3D · X先知',
  robots: { index: false, follow: false },
}

export default async function Guandi3DPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams
  const splats = q.q === '100k' || q.q === '150k' || q.q === '500k' ? q.q : undefined
  return <Temple3D debug={q.debug === '1'} splats={splats} />
}
