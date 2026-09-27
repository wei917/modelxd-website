// lib/consent.ts
//
// Where prior consent is required before advertising or analytics storage:
// the EEA, the UK and Switzerland. The site has no consent banner, so there
// the Google Ads tag defaults to denied (app/layout.tsx) and the visit log
// (/api/visit, VisitTracker) does not run at all. Disclosed in /privacy §4.
// Country codes as Vercel's x-vercel-ip-country header sends them.

export const CONSENT_REGIONS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH']

/** True when the visitor's country needs consent we do not ask for. An absent
 *  header (localhost) is not a consent region. */
export function needsConsent(country: string | null | undefined): boolean {
  return !!country && CONSENT_REGIONS.includes(country.toUpperCase())
}
