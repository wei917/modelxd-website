// app/api/xoracle/temple3d/route.ts — may this visitor open the 3D 關帝廟
// (app/xoracle/guandi-3d)? The 關帝廟 room shows its way in only to those who
// can: while the page is an admin-only prototype (lib/hidden-apps.ts), the
// accounts on ADMIN_EMAILS, and anyone on this machine (proxy.ts lets
// localhost in too); once it leaves that list, everyone. The page is gated in
// proxy.ts either way; this only decides whether the link shows.

export const runtime = 'nodejs'

import { getAdminUser } from '@/lib/admin'
import { hiddenApp } from '@/lib/hidden-apps'

export async function GET(req: Request) {
  const host = (req.headers.get('host') ?? '').split(':')[0]
  const open = hiddenApp('/xoracle/guandi-3d')?.level !== 'admin'
    || host === 'localhost' || host === '127.0.0.1'
    || !!(await getAdminUser())
  return Response.json({ open }, { headers: { 'Cache-Control': 'private, no-store' } })
}
