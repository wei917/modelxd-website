// lib/xsports-highlights.ts — a game's short video highlights for X體育's
// 戰況 (owner, Oct 13: highlights beside the plays they show, played in the
// source's own player, "觀看原片" when they cannot be).
//
// Three real sources, as they publish; none promises a clip for every play
// or a time:
//   MLB      the game's content feed (statsapi /game/{pk}/content). An
//            in-game clip's `guid` is the playId of the pitch or action it
//            shows (lib/mlb.ts mlbPlayIndex), so it sits on that exact play.
//            Played in MLB's own embed player (mlb.com/unified-player/embed),
//            no region limits listed.
//   ESPN     an NBA game's summary `videos` (lib/nba.ts nbaVideos): in-game
//            clips minutes after the play, kept as the game's list (a title
//            does not say which play). Each lists the countries it may be
//            shown in; Taiwan, Japan and Korea were not among them on Oct 13.
//            They open on ESPN's own page: in our test (Codex review, Oct 13)
//            ESPN's syndicated player played its ad and then only a black
//            frame, the clip never shown (cause not established), so the
//            in-page player is not used until it is seen working.
//   YouTube  the NBA's own channel, when YOUTUBE_API_KEY is set: uploads
//            whose titles name both clubs (full-game highlights), as
//            game-level clips in the official player. A club plays at most
//            once a day, so that is the game. Not for MLB: a doubleheader
//            names the same two clubs twice (Codex review, Oct 13), and MLB's
//            own feed above already places its clips exactly. YouTube's
//            region rule is per video and checked per clip; the NBA videos
//            sampled on Oct 13 listed Taiwan and China as blocked.
// Nothing is copied: thumbnails and players are the sources' own.
//
// Server-only. The pure mapping functions are exported for tests.

import { mlbPlayIndex, type GameState } from './mlb'
import { nbaVideos } from './nba'

export interface Clip {
  id: string
  provider: 'mlb' | 'espn' | 'youtube'
  /** As the page says it: "MLB", "ESPN", "NBA · YouTube". */
  source: string
  title: string
  /** Seconds. */
  duration: number | null
  publishedAt: string | null
  thumb: string | null
  /** The source's own player; null when it has none we may frame. */
  embed: string | null
  /** The source's own page for the clip. */
  url: string
  /** False when the source says it cannot be played here (not embeddable). */
  playable: boolean
  /** The PlayEvent it shows, when known. */
  event: string | null
  /** One play, the game as a whole (recap, condensed game, full-game
   *  highlights, a player's reel), or other (interviews and the like). */
  kind: 'play' | 'game' | 'other'
}

export interface Highlights {
  clips: Clip[]
  /** Clips the sources do not allow in the viewer's country. */
  hiddenByRegion: number
  /** No source answered. */
  down: boolean
}

const TIMEOUT_MS = 8_000
async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`)
  return res.json()
}

type Entry<T> = { at: number; value?: T; pending?: Promise<T> }
async function cached<T>(map: Map<string, Entry<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key)
  if (hit?.value !== undefined && Date.now() - hit.at < ttl) return hit.value
  if (hit?.pending) return hit.pending
  const pending = load()
    .then(value => { map.set(key, { at: Date.now(), value }); return value })
    .catch(e => { if (hit?.value !== undefined) { map.set(key, { at: hit.at, value: hit.value }); return hit.value } map.delete(key); throw e })
  map.set(key, { at: hit?.at ?? 0, value: hit?.value, pending })
  if (map.size > 500) map.delete(map.keys().next().value!)
  return pending
}

/** "00:02:24" → 144; "PT1M5S" → 65. */
export function seconds(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  const s = String(v ?? '')
  const hms = /^(\d+):(\d{2}):(\d{2})$/.exec(s) ?? /^()(\d+):(\d{2})$/.exec(s)
  if (hms) return (Number(hms[1] || 0) * 3600 + Number(hms[2]) * 60 + Number(hms[3])) || null
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s)
  if (iso) return (Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0)) || null
  return null
}

// ── MLB ─────────────────────────────────────────────────────────────────────

/** MLB's 16:9 image nearest 640 px wide. */
function mlbThumb(item: any): string | null {
  const cuts = ((item?.image?.cuts ?? []) as any[]).filter(c => c?.aspectRatio === '16:9' && typeof c?.src === 'string' && /^https:\/\/img\.mlbstatic\.com\//.test(c.src))
  if (!cuts.length) return null
  cuts.sort((a, b) => Math.abs(Number(a.width) - 640) - Math.abs(Number(b.width) - 640))
  return cuts[0].src
}

const SLUG = /^[a-z0-9-]{3,160}$/

/** What an MLB item is, by MLB's own taxonomy. */
function mlbKind(it: any): Clip['kind'] {
  const tax = new Set(((it?.keywordsAll ?? []) as any[]).filter(k => k?.type === 'taxonomy').map(k => String(k.value)))
  if (tax.has('game-recap') || tax.has('condensed-game') || [...tax].some(t => t.startsWith('highlight-reel'))) return 'game'
  return tax.has('in-game-highlight') ? 'play' : 'other'
}

/** MLB's content items as clips, each on its play when MLB names it. */
export function mlbClips(items: any[], index: Map<string, string>): Clip[] {
  const out: Clip[] = []
  for (const it of items ?? []) {
    const slug = String(it?.slug ?? '')
    if (it?.type !== 'video' || !SLUG.test(slug)) continue
    // MLB's own link to a play wins: "Ian Seymour limits the damage in the
    // 7th" is a reel MLB ties to the inning's last out.
    const event = (typeof it.guid === 'string' && index.get(it.guid)) || null
    out.push({
      kind: event ? 'play' : mlbKind(it),
      id: `mlb:${slug}`,
      provider: 'mlb',
      source: 'MLB',
      title: String(it.headline ?? it.title ?? '').trim() || slug,
      duration: seconds(it.duration),
      publishedAt: typeof it.date === 'string' ? it.date : null,
      thumb: mlbThumb(it),
      embed: `https://www.mlb.com/unified-player/embed/${slug}`,
      url: `https://www.mlb.com/video/${slug}`,
      playable: true,
      event,
    })
  }
  return out
}

const mlbContent = new Map<string, Entry<any[]>>()

async function mlbHighlights(g: GameState): Promise<Clip[]> {
  // ~650 KB a game (the endpoint ignores `fields`): once a minute at most.
  const items = await cached(mlbContent, String(g.pk), 60_000, async () => {
    const d = await getJson(`https://statsapi.mlb.com/api/v1/game/${g.pk}/content`)
    return (d?.highlights?.highlights?.items ?? []) as any[]
  })
  return mlbClips(items, await mlbPlayIndex(g.pk))
}

// ── ESPN (NBA) ──────────────────────────────────────────────────────────────

/** Where ESPN allows a clip; null country (unknown, e.g. local) allows. */
export function espnAllowed(geo: any, country: string | null): boolean {
  if (!country || !geo || !Array.isArray(geo.countries)) return true
  const listed = (geo.countries as string[]).includes(country) || (country === 'GB' && geo.countries.includes('UK'))
  return geo.type === 'blacklist' ? !listed : listed
}

/** ESPN's clips of an NBA game. Not tied to plays: a title like "Austin
 *  Reaves knocks down the trey" does not say which three (Codex review, Oct
 *  13), so they stay in the game's list, by when they came out. */
export function espnClips(videos: any[], country: string | null): { clips: Clip[]; hidden: number } {
  const clips: Clip[] = []
  let hidden = 0
  for (const v of videos ?? []) {
    const id = Number(v?.id)
    const web = String(v?.links?.web?.href ?? '')
    if (!Number.isFinite(id) || id <= 0 || !/^https:\/\/www\.espn\.com\//.test(web)) continue
    if (!espnAllowed(v.geoRestrictions, country)) { hidden++; continue }
    const title = String(v.headline ?? '').trim()
    const publishedAt = typeof v.originalPublishDate === 'string' ? v.originalPublishDate : null
    const thumb = typeof v.thumbnail === 'string' && /^https:\/\//.test(v.thumbnail) ? v.thumbnail : null
    clips.push({
      kind: 'play',
      id: `espn:${id}`,
      provider: 'espn',
      source: 'ESPN',
      title: title || web,
      duration: seconds(v.duration),
      publishedAt,
      thumb,
      embed: null,
      url: web,
      playable: false,
      event: null,
    })
  }
  return { clips, hidden }
}

// ── YouTube (the leagues' own channels) ─────────────────────────────────────

const CHANNELS: Record<string, { id: string; label: string }> = {
  nba: { id: 'UCWJ2lWNubArHWmf3FIHbfcQ', label: 'NBA · YouTube' },
}

export interface YtVideo { id: string; title: string; publishedAt: string; thumb: string | null }
export interface YtDetail { embeddable: boolean; duration: number | null; region: { allowed?: string[]; blocked?: string[] } | null }

/** An upload is about this game when its title names both clubs and it came
 *  out between an hour before the start and 16 hours after. */
export function ytForGame(v: YtVideo, g: Pick<GameState, 'away' | 'home' | 'start'>): boolean {
  const t = v.title.toLowerCase()
  const named = (c: { club: string; name: string }) => [c.club, c.name].some(n => n && t.includes(n.toLowerCase()))
  if (!named(g.away) || !named(g.home)) return false
  const at = Date.parse(v.publishedAt), start = Date.parse(g.start)
  return Number.isFinite(at) && Number.isFinite(start) && at >= start - 3600_000 && at <= start + 16 * 3600_000
}

export function ytAllowed(region: YtDetail['region'], country: string | null): boolean {
  if (!country || !region) return true
  if (Array.isArray(region.allowed)) return region.allowed.includes(country)
  if (Array.isArray(region.blocked)) return !region.blocked.includes(country)
  return true
}

const ytUploads = new Map<string, Entry<YtVideo[]>>()
const ytDetails = new Map<string, Entry<YtDetail>>()

async function channelUploads(channel: string, key: string): Promise<YtVideo[]> {
  // One call (1 quota unit) per channel every 4 minutes, shared by every game.
  return cached(ytUploads, channel, 4 * 60_000, async () => {
    const d = await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=UU${channel.slice(2)}&key=${key}`)
    return ((d.items ?? []) as any[]).map(it => ({
      id: String(it.contentDetails?.videoId ?? ''),
      title: String(it.snippet?.title ?? ''),
      publishedAt: String(it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? ''),
      thumb: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
    })).filter(v => /^[\w-]{11}$/.test(v.id))
  })
}

async function videoDetails(ids: string[], key: string): Promise<Map<string, YtDetail>> {
  const out = new Map<string, YtDetail>()
  const missing = ids.filter(id => { const hit = ytDetails.get(id); if (hit?.value && Date.now() - hit.at < 30 * 60_000) { out.set(id, hit.value); return false } return true })
  if (missing.length) {
    const d = await getJson(`https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails&id=${missing.slice(0, 50).join(',')}&key=${key}`)
    for (const v of (d.items ?? []) as any[]) {
      const det: YtDetail = { embeddable: !!v.status?.embeddable && v.status?.privacyStatus === 'public', duration: seconds(v.contentDetails?.duration), region: v.contentDetails?.regionRestriction ?? null }
      ytDetails.set(String(v.id), { at: Date.now(), value: det })
      out.set(String(v.id), det)
    }
  }
  return out
}

async function youtubeHighlights(g: GameState, country: string | null): Promise<{ clips: Clip[]; hidden: number }> {
  const key = process.env.YOUTUBE_API_KEY
  const ch = CHANNELS[g.league ?? 'mlb']
  if (!key || !ch) return { clips: [], hidden: 0 }
  const mine = (await channelUploads(ch.id, key)).filter(v => ytForGame(v, g))
  if (!mine.length) return { clips: [], hidden: 0 }
  const det = await videoDetails(mine.map(v => v.id), key)
  const clips: Clip[] = []
  let hidden = 0
  for (const v of mine) {
    const d = det.get(v.id)
    if (!d) continue
    if (!ytAllowed(d.region, country)) { hidden++; continue }
    clips.push({
      kind: 'game',
      id: `yt:${v.id}`,
      provider: 'youtube',
      source: ch.label,
      title: v.title,
      duration: d.duration,
      publishedAt: v.publishedAt || null,
      thumb: v.thumb,
      embed: d.embeddable ? `https://www.youtube-nocookie.com/embed/${v.id}` : null,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      playable: d.embeddable,
      event: null,
    })
  }
  return { clips, hidden }
}

// ── Together ────────────────────────────────────────────────────────────────

/** The game's clips, newest first. A source that fails is left out; `down`
 *  when the league's own source (MLB, or ESPN for the NBA) failed and no
 *  other source had anything. */
export async function highlightsFor(g: GameState, country: string | null): Promise<Highlights> {
  const league = g.league ?? 'mlb'
  const jobs: Promise<{ clips: Clip[]; hidden: number }>[] = [
    league === 'nba'
      ? nbaVideos(g.pk).then(v => espnClips(v, country))
      : mlbHighlights(g).then(clips => ({ clips, hidden: 0 })),
    youtubeHighlights(g, country),
  ]
  const results = await Promise.allSettled(jobs)
  const ok = results.filter((r): r is PromiseFulfilledResult<{ clips: Clip[]; hidden: number }> => r.status === 'fulfilled')
  for (const r of results) if (r.status === 'rejected') console.warn('[xsports/highlights]', league, g.pk, r.reason?.message ?? r.reason)
  const clips = ok.flatMap(r => r.value.clips)
  clips.sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))
  return { clips, hiddenByRegion: ok.reduce((n, r) => n + r.value.hidden, 0), down: results[0].status === 'rejected' && clips.length === 0 }
}
