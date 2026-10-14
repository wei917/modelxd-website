// scripts/xsports-highlights-check.ts — checks lib/xsports-highlights.ts
// against real league data saved on disk (no network while checking).
//
//   npx tsx scripts/xsports-highlights-check.ts --fetch <dir> [mlbPk] [espnId]
//       saves the fixtures (network): mlb-content.json (statsapi
//       /api/v1/game/{pk}/content), mlb-feed.json (/api/v1.1/game/{pk}/feed/live)
//       and espn-summary.json (site.api.espn.com .../nba/summary?event={id}).
//       Pick a FINISHED MLB game with in-game clips and an NBA game whose ESPN
//       clips are country-limited. Defaults: ALCS Game 2, CLE at TB (849813)
//       and Warriors at Lakers (401898718), both Oct 13, 2026.
//   npx tsx scripts/xsports-highlights-check.ts <dir>
//       runs the checks; exit code 1 on any failure.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stateOf, playIndexOf } from '../lib/mlb'
import { mlbClips, espnClips, espnAllowed, ytForGame, ytAllowed, seconds } from '../lib/xsports-highlights'

const args = process.argv.slice(2)

async function fetchFixtures(dir: string, mlbPk = '849813', espnId = '401898718') {
  mkdirSync(dir, { recursive: true })
  const get = async (url: string, file: string) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} ${res.status}`)
    writeFileSync(join(dir, file), await res.text())
    console.log('saved', file)
  }
  await get(`https://statsapi.mlb.com/api/v1/game/${mlbPk}/content`, 'mlb-content.json')
  await get(`https://statsapi.mlb.com/api/v1.1/game/${mlbPk}/feed/live`, 'mlb-feed.json')
  await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${espnId}`, 'espn-summary.json')
}

function check(dir: string) {
  let fails = 0
  const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'))

  // MLB: each in-game clip's guid is a playId in the live feed.
  const feed = read('mlb-feed.json'), content = read('mlb-content.json')
  const g = stateOf(feed)
  const items: any[] = content?.highlights?.highlights?.items ?? []
  const index = playIndexOf(feed.liveData.plays.allPlays, g.events)
  const clips = mlbClips(items, index)
  const shown = new Set(g.events.map(e => e.id))
  const videos = items.filter(it => it?.type === 'video')
  ok(clips.length === videos.length, `every MLB video item is a clip (${clips.length}/${videos.length})`)
  const linked = clips.filter(c => c.event)
  const guided = items.filter(it => typeof it?.guid === 'string' && index.has(it.guid)).length
  ok(linked.length === guided && linked.length > 0, `clips whose guid is a feed playId sit on that play (${linked.length})`)
  ok(linked.every(c => shown.has(c.event!)), 'every linked play is one the page lists')
  for (const c of linked.slice(0, 3)) console.log(`      ${c.title}  ->  ${g.events.find(e => e.id === c.event)?.text.slice(0, 60)}`)
  ok(clips.filter(c => c.kind === 'game').every(c => !c.event), 'game-level clips (recaps, reels) are not tied to a play')
  ok(clips.every(c => c.embed?.startsWith('https://www.mlb.com/unified-player/embed/') && c.url.startsWith('https://www.mlb.com/video/')), "MLB's own player and page")
  ok(clips.every(c => !c.thumb || c.thumb.startsWith('https://img.mlbstatic.com/')), "MLB's own thumbnails")
  ok(seconds('00:19:37') === 1177 && seconds('0:32') === 32 && seconds('PT1M5S') === 65 && seconds('') === null && seconds(17) === 17, 'durations parse')
  ok(mlbClips([], index).length === 0 && mlbClips([{ type: 'video', slug: 'Bad Slug!' }], index).length === 0, 'empty and malformed items: no clips')
  const before = new Set(mlbClips(items.slice(1), index).map(c => c.id))
  ok(clips.filter(c => !before.has(c.id)).length === 1, 'a clip that arrives on the next poll is the one new clip')

  // ESPN (NBA): country lists; never guessed onto plays.
  const videosNba: any[] = read('espn-summary.json')?.videos ?? []
  ok(videosNba.length > 0, `ESPN listed ${videosNba.length} clips`)
  for (const country of ['TW', 'JP', 'US']) {
    const r = espnClips(videosNba, country)
    const allowed = videosNba.filter(v => espnAllowed(v.geoRestrictions, country)).length
    ok(r.clips.length === allowed && r.hidden === videosNba.length - allowed, `${country}: ${r.clips.length} shown, ${r.hidden} withheld by ESPN's country list`)
  }
  ok(espnClips(videosNba, null).clips.length === videosNba.length, 'no country (localhost): all shown; the player enforces its own rules')
  ok(espnClips(videosNba, 'US').clips.every(c => c.event === null), 'NBA clips stay in the game list, not on a guessed play')
  ok(espnClips(videosNba, 'US').clips.every(c => c.embed === null && !c.playable && c.url.startsWith('https://www.espn.com/video/clip/')), "ESPN clips open on ESPN's own page (in-page playback unverified)")
  ok(espnAllowed({ type: 'blacklist', countries: ['TW'] }, 'TW') === false && espnAllowed({ type: 'whitelist', countries: ['UK'] }, 'GB'), 'ESPN black and white lists (UK means GB)')
  ok(espnClips([], 'US').clips.length === 0, 'no ESPN clips: empty')

  // YouTube: a title must name both clubs, inside the game's window.
  const game = { away: { club: 'Guardians', name: 'Cleveland Guardians' }, home: { club: 'Rays', name: 'Tampa Bay Rays' }, start: '2026-10-14T00:08:00Z' } as any
  const yt = (title: string, at: string) => ytForGame({ id: 'x', title, publishedAt: at, thumb: null }, game)
  ok(yt('GUARDIANS vs. RAYS: ALCS Full Game 2 Highlights (October 13) | 2026 MLB Postseason', '2026-10-14T03:21:39Z'), 'full-game highlights match')
  ok(!yt('FULL 3-RUN INNING: Rays strike first in 2026 ALCS Game 2! | MLB Highlights', '2026-10-14T01:33:27Z'), 'one club named: no match')
  ok(!yt('Guardians vs. Rays ALCS Game 3 Highlights', '2026-10-15T03:00:00Z'), "the next day's game: outside the window")
  ok(ytAllowed({ blocked: ['CN', 'TW'] }, 'TW') === false && ytAllowed({ blocked: ['CN', 'TW'] }, 'JP') && !ytAllowed({ allowed: ['US'] }, 'TW') && ytAllowed(null, 'TW') && ytAllowed({ blocked: ['TW'] }, null), 'YouTube region rules')

  console.log(fails ? `${fails} FAILED` : 'all passed')
  process.exitCode = fails ? 1 : 0
}

if (args[0] === '--fetch' && args[1]) fetchFixtures(args[1], args[2], args[3]).catch(e => { console.error(e); process.exitCode = 1 })
else if (args[0]) check(args[0])
else console.log('usage: npx tsx scripts/xsports-highlights-check.ts [--fetch] <dir> [mlbPk] [espnId]')
