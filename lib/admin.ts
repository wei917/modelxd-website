// lib/admin.ts
// Email-allowlist auth gate for admin pages and routes.
//
// Layered on top of the existing Supabase Google OAuth login. To grant
// admin access, add an email to the comma-separated ADMIN_EMAILS env var:
//
//   ADMIN_EMAILS=wei917@gmail.com,other@example.com
//
// Anyone else who reaches an admin URL gets a 403. There is no separate
// admin password / token — admin access is just "you signed in with
// Google as an allowlisted email".

import { createSupabaseServer } from './supabase-server'

function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? ''
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

/**
 * Server-side admin check. Returns the user object if they're allowlisted;
 * `null` if not signed in or not an admin. Use the result in server pages
 * and API routes — never trust client-side flags for admin gating.
 */
export async function getAdminUser(): Promise<{ id: string; email: string } | null> {
  const sb = await createSupabaseServer()
  const { data: { user }, error } = await sb.auth.getUser()
  if (error || !user || !user.email) return null
  if (!adminEmails().includes(user.email.toLowerCase())) return null
  return { id: user.id, email: user.email }
}

/**
 * Convenience wrapper for API routes that throws a 403 Response if the
 * caller isn't an admin. Use like:
 *
 *   const guard = await assertAdmin()
 *   if (guard) return guard               // not admin → return the 403
 *   // ... admin-only logic ...
 */
export async function assertAdmin(): Promise<Response | null> {
  const user = await getAdminUser()
  if (!user) return new Response('Forbidden', { status: 403 })
  return null
}
