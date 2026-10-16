// lib/visit-env.ts — the env label the visit log and its sibling tables
// (site_visits, site_signin_taps, xtell_shares, site_page_views,
// xtell_answer_votes) store. Every report counts env 'production' only.
//
// 'production' means the real site, decided by the HOST, not by Vercel:
// dev.modelxd.com is the main website (owner, Oct 16: "are you kidding me?
// dev.modelxd.com is the main website"), though Vercel labels it 'preview';
// www and the old xtell./xcreate. addresses count too. A browser of the
// owner's (supabase/129) is 'internal' there. Anything else keeps Vercel's
// label: 'preview' for a branch's own vercel.app address, 'development' on
// localhost.

const REAL_HOST = /^(?:(?:www|dev|xtell|xcreate)\.)?modelxd\.com$/

export function visitEnv(host: string, internal = false): string {
  const bare = host.replace(/:\d+$/, '').toLowerCase()
  const env = REAL_HOST.test(bare) ? 'production' : process.env.VERCEL_ENV ?? 'development'
  return internal && env === 'production' ? 'internal' : env
}
