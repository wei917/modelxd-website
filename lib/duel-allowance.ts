// lib/duel-allowance.ts
//
// How many models an XDuel runs and how many duels a day are free.
// Client-safe: the page and /api/xduel read this one rule; lib/duel-quota.ts
// spends the allowance.

export type DuelMode = 'text' | 'image' | 'video'

// Every duel is two models, 1v1 (owner, Oct 18: "ok, go 1v1"). Choosing
// between two is the judgment people make quickly and the same way twice;
// it is the pairwise comparison the rating is built on; and the price
// question ("now that you know, would you switch?") is this one or that
// one. 3- and 4-model duels (Jul 19 – Oct 18) recorded the models you did
// not pick as tied with each other, which nobody had said. Comparing up to
// four side by side is XCreate's job.
export const DUEL_MODELS = 2

// One daily allowance across every type (owner, Oct 17: "we count how many
// users make, when reach 10, we tell user you hit the limit, please try
// again tomorrow"; it was 10 text, 3 image and 1 video a day, each shown
// on the page). Video takes from the same ten with no cap of its own since
// Oct 18 (owner: "can we increase it to 10?"; it was 1 a day). A 1v1 video
// duel costs the house about $1.41 (median of the last 35; mean $2.17, the
// most $6.40), so one person's ten can run $15-25 a day.
// Days are UTC, as in duel_quotas.
export const DAILY_DUELS = 10

export type DuelUsed = Record<DuelMode, number>

/** Free duels left today, after `used`: one allowance for every type. */
export function duelsLeft(_mode: DuelMode, used: DuelUsed): number {
  return Math.max(0, DAILY_DUELS - used.text - used.image - used.video)
}
