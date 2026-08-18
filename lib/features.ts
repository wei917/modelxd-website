// lib/features.ts
// Per-user feature gating (CC, July 29).
//
// Same shape as lib/admin.ts — an email allowlist in an env var — because
// that pattern already works here and needs no migration, so a beta can be
// opened to a named tester without touching the database.
//
//   FEATURE_CANVAS_EMAILS=wei917@gmail.com,tester@example.com
//   FEATURE_XDIRECTOR_EMAILS=wei917@gmail.com
//
// Two conventions:
//   * anyone on ADMIN_EMAILS passes every gate, so you never lock yourself out
//   * a single "*" opens the feature to everyone, which is how a beta ends
//     without a code change
//
// The cost of env-var gating is that adding a tester needs a redeploy. If
// that becomes annoying, swap allowedFor() for a profiles column read — this
// is the only function that would change.
//
// IMPORTANT: hiding a button is not access control. Every gated API route
// calls assertFeature() itself; the client flags from /api/features exist
// only so the UI doesn't advertise something the server will refuse.

import { createSupabaseServer } from './supabase-server'

export type Feature = 'xdev'

const ENV_VAR: Record<Feature, string> = {
  xdev: 'FEATURE_XDEV_EMAILS',
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

function adminEmails(): string[] {
  return parseList(process.env.ADMIN_EMAILS)
}

/** Does this email have the feature? Admins always do; "*" means everyone. */
export function emailHasFeature(email: string | null | undefined, feature: Feature): boolean {
  const e = (email ?? '').toLowerCase()
  if (!e) return false
  const list = parseList(process.env[ENV_VAR[feature]])
  if (list.includes('*')) return true
  if (list.includes(e)) return true
  return adminEmails().includes(e)
}

export type FeatureSet = Record<Feature, boolean>

/** Every flag for the signed-in user. All false when signed out. */
export async function getFeatures(): Promise<FeatureSet> {
  try {
    const sb = await createSupabaseServer()
    const { data: { user } } = await sb.auth.getUser()
    const email = user?.email ?? null
    return { xdev: emailHasFeature(email, 'xdev') }
  } catch {
    return { xdev: false }
  }
}

export async function hasFeature(feature: Feature): Promise<boolean> {
  return (await getFeatures())[feature]
}

/**
 * Guard for API routes. Returns a Response to return, or null to continue:
 *
 *   const guard = await assertFeature('xdirector')
 *   if (guard) return guard
 */
export async function assertFeature(feature: Feature): Promise<Response | null> {
  if (await hasFeature(feature)) return null
  return Response.json(
    { error: 'feature_not_enabled', feature, message: 'This feature is in limited beta.' },
    { status: 403 },
  )
}
