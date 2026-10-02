// lib/xtell-guest.ts — the rooms a signed-out visitor may use.
//
// Owner, Oct 1: visitors from the ads were leaving at the sign-in dialog
// every room opened with (Sep 25). Now a signed-out visitor can open a room
// and cast its free chart, which is not saved; asking a teacher costs
// credits, so that is where sign-in is asked.
//
// Two rooms stay sign-in first, because their free step calls a model on
// our account: 解夢 scans with one, and the fortune cookie writes its slip
// with one and gives two a meal per account, which a visitor without an
// account cannot be counted against. The room keeps its sign-in dialog for
// these, and the chart route refuses them without a session.
//
// 孫子兵法 scans with a model too, but opened to signed-out visitors on Oct 2
// for a ChatGPT ad (owner: an ad for a room that is not 迷信, so it can be
// approved): three lookups a day from one address, counted in the chart
// route, nothing saved.
//
// Client-safe: read by the street (app/xtell/client.tsx) and the chart route.

import type { Temple } from './xtell'

export const SIGN_IN_FIRST: ReadonlySet<Temple> = new Set<Temple>(['jiemeng', 'cookie'])
