// app/api/dev/grant-credits/route.ts
//
// DEV-ONLY endpoint for granting credits to a user without going through
// Stripe. Used to seed balances during development and to test the debit
// path in /api/xcreate once it's wired in Phase 2.
//
// Responds 404 in production so we can't accidentally forget to gate it
// behind an admin check before shipping.
//
// Usage:
//   curl -X POST http://localhost:3000/api/dev/grant-credits \
//     -H 'Content-Type: application/json' \
//     -d '{"userId":"<uuid>","amountCents":5000,"description":"dev top-up"}'
//
// The userId comes from auth.users.id — check the Supabase dashboard or
// your own profile page (the email is shown there along with the id in
// the devtools network tab).

import { grantCredits } from '@/lib/credits'

export const dynamic = 'force-dynamic'

interface GrantBody {
  userId?: string
  amountCents?: number
  description?: string
  referenceType?: string
  referenceId?: string
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 })
  }

  let body: GrantBody
  try {
    body = (await request.json()) as GrantBody
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { userId, amountCents, description, referenceType, referenceId } = body
  if (!userId || typeof userId !== 'string') {
    return Response.json({ error: 'userId (uuid) required' }, { status: 400 })
  }
  if (!Number.isInteger(amountCents) || !amountCents || amountCents <= 0) {
    return Response.json({ error: 'amountCents must be a positive integer (cents)' }, { status: 400 })
  }

  try {
    const newBalanceCents = await grantCredits({
      userId,
      amountCents,
      kind: 'grant',
      referenceType: referenceType ?? 'admin_grant',
      referenceId:   referenceId,
      description:   description ?? 'Dev admin grant',
    })
    return Response.json({
      ok: true,
      userId,
      amountCents,
      newBalanceCents,
      newBalanceUsd: (newBalanceCents / 100).toFixed(2),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
