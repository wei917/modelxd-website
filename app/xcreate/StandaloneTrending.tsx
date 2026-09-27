'use client'

// "Trending on social media" for the standalone studio: under the Studio
// composer (video and image together) and on Templates (the tab's kind). Ten
// at a time from /api/trending (table trending_posts, supabase/108), every
// live week newest first, loading on as the reader scrolls (owner, Sep 27:
// "at least 10 ... infinite load").
//
// X videos use X's video-only embed (twttr.widgets.createVideo): the post's
// own text renders inside X's iframe at X's size, which nothing on our side
// can restyle, so the card sets the creator credit and our summary in the
// site's type instead (no model tags, owner, Sep 27: the feed only holds
// models XCreate offers). Embeds are built into an empty div React
// never touches, and only when the card nears the viewport: twenty at once is
// twenty iframes and players. "Use this preset" hands the post to XCreate as
// a template (prompt, model, recipe, duration) through the same applyTemplate
// every template uses. Other platforms get a plain link until their own
// embed is wired.

import { useCallback, useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { useLang } from '@/lib/i18n'
import type { Template } from './templates'
import { TRENDING_COPY, TRENDING_PAGE, presetTemplate, type TrendingFeedKind, type TrendingPost } from './trending'

declare global { interface Window { twttr?: any } }

const READY_EVENT = 'xcs-twttr-ready'

/** X's player draws its play button at a fixed size, which in a ~254px card
 *  covered a third of it (owner, Sep 26: "the play button is too big"). The
 *  embed renders at X's full width and the whole player is scaled down to
 *  the card, so the button shrinks with the video. Clicks and fullscreen still
 *  work: hit-testing follows the transform. */
const EMBED_W = 550

function XEmbed({ id, video }: { id: string; video: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = outer.current, el = ref.current
    if (!box || !el) return
    const fit = () => {
      const scale = Math.min(1, box.clientWidth / EMBED_W)
      el.style.transform = `scale(${scale})`
      const h = el.scrollHeight
      box.style.height = h ? `${Math.ceil(h * scale)}px` : ''
      box.style.minHeight = h ? '0px' : ''
    }
    // The inner box's layout height changes when X sizes its iframe; the
    // outer's width changes with the grid.
    const ro = new ResizeObserver(fit)
    ro.observe(box); ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const box = outer.current, el = ref.current
    if (!box || !el) return
    let near = false
    // Keyed on the element, not the effect run: dev StrictMode mounts twice
    // and a second create call would stack a duplicate embed.
    const render = () => {
      const w = window.twttr?.widgets
      if (!near || !w || el.dataset.tweet === id) return
      el.dataset.tweet = id
      // mediaMaxWidth is what produced the video-only card on the first
      // draft (a data-media-max-width blockquote); createVideo alone still
      // rendered the whole post.
      w.createTweet(id, el, video
        ? { dnt: true, conversation: 'none', mediaMaxWidth: 550 }
        : { dnt: true, conversation: 'none' })
    }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { near = true; io.disconnect(); render() }
    }, { rootMargin: '800px 0px' })
    io.observe(box)
    window.addEventListener(READY_EVENT, render)
    return () => { io.disconnect(); window.removeEventListener(READY_EVENT, render) }
  }, [id, video])
  return <div ref={outer} className="xcs-trend-embed"><div ref={ref} className="xcs-trend-embed-inner" /></div>
}

/** `added`: how many new posts the last page brought. */
type Feed = { posts: TrendingPost[]; cursor: string | null; loading: boolean; loaded: boolean; failed: boolean; added: number }
const EMPTY: Feed = { posts: [], cursor: null, loading: true, loaded: false, failed: false, added: 0 }

export default function StandaloneTrending({ kind, onUse, disabled }: {
  /** One kind (Templates' tabs) or both (Studio). */
  kind: TrendingFeedKind
  /** Apply a post's preset in XCreate; no button when absent. */
  onUse?: (template: Template) => void
  disabled?: boolean
}) {
  const { lang } = useLang()
  const copy = TRENDING_COPY[lang] ?? TRENDING_COPY.en
  const [feed, setFeed] = useState<Feed>(EMPTY)
  const sentinel = useRef<HTMLDivElement>(null)
  // A page belongs to the kind it was asked for and to this mounted feed:
  // switching kind or unmounting bumps `gen` and aborts the request, so a late
  // answer is dropped, never appended.
  const gen = useRef(0)
  const inflight = useRef<AbortController | null>(null)

  const fetchPage = useCallback(async (after: string | null) => {
    if (inflight.current) return
    const mine = gen.current
    const ctrl = new AbortController()
    inflight.current = ctrl
    setFeed(f => ({ ...f, loading: true, failed: false }))
    try {
      const qs = new URLSearchParams({ kind, limit: String(TRENDING_PAGE) })
      if (after) qs.set('cursor', after)
      const r = await fetch(`/api/trending?${qs}`, { signal: ctrl.signal })
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json()
      if (mine !== gen.current) return
      setFeed(f => {
        // One set across the old posts AND this page, so a repeat inside a
        // single response is dropped too.
        const have = new Set(f.posts.map(p => `${p.platform}:${p.postId}`))
        const fresh: TrendingPost[] = []
        for (const p of (Array.isArray(d.posts) ? d.posts : []) as TrendingPost[]) {
          const id = `${p.platform}:${p.postId}`
          if (have.has(id)) continue
          have.add(id)
          fresh.push(p)
        }
        return { posts: [...f.posts, ...fresh], cursor: d.nextCursor ?? null, loading: false, loaded: true, failed: false, added: fresh.length }
      })
    } catch {
      // No automatic retry: the button below retries when the reader asks.
      if (mine === gen.current) setFeed(f => ({ ...f, loading: false, loaded: true, failed: true }))
    } finally {
      if (inflight.current === ctrl) inflight.current = null
    }
  }, [kind])

  useEffect(() => {
    setFeed(EMPTY)
    void fetchPage(null)
    return () => {
      gen.current += 1
      inflight.current?.abort()
      inflight.current = null
    }
  }, [kind, fetchPage])

  // Infinite load (owner, Sep 27): the next page comes in whenever the end of
  // the list nears, for as long as there is one. Never after a failure (the
  // button retries), and the button stays for anyone who cannot scroll.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !feed.cursor || feed.failed || feed.loading) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void fetchPage(feed.cursor)
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [feed.cursor, feed.failed, feed.loading, fetchPage])

  // A page can bring nothing and still have a cursor: the server skips posts
  // whose models XCreate no longer offers and answers after a bounded read.
  // With nothing shown yet there is no sentinel to scroll to (the section
  // renders nothing), so go on from the cursor directly.
  useEffect(() => {
    if (feed.loading || feed.failed || !feed.cursor || feed.added > 0) return
    void fetchPage(feed.cursor)
  }, [feed.loading, feed.failed, feed.cursor, feed.added, fetchPage])

  if (!feed.loaded && feed.posts.length === 0) return null
  if (feed.posts.length === 0 && !feed.failed) return null
  const titleId = `xcs-trending-title-${kind}`

  return <section className="xcs-trending" aria-labelledby={titleId}>
    {feed.posts.some(p => p.platform === 'x') && <Script id="twitter-widgets" src="https://platform.twitter.com/widgets.js"
      strategy="afterInteractive" onReady={() => { window.dispatchEvent(new Event(READY_EVENT)) }} />}
    <div className="xcs-trending-head">
      <div>
        <h2 id={titleId}>{copy.title}</h2>
        <p>{copy[kind]}</p>
      </div>
    </div>
    <div className="xcs-trending-grid">
      {feed.posts.map(post => {
        const preset = onUse ? presetTemplate(post, lang) : null
        return <article className="xcs-trend" key={`${post.platform}:${post.postId}`}>
          {/* No rank number (owner, Sep 26) and no model tags (Sep 27). */}
          <p>{post.summary[lang] ?? post.summary.en}</p>
          {post.platform === 'x' && <XEmbed id={post.postId} video={post.kind === 'video'} />}
          <div className="xcs-trend-foot">
            <a className="xcs-trend-credit" href={post.url} target="_blank" rel="noopener noreferrer">
              {copy.by} @{post.handle} <span aria-hidden="true">↗</span>
            </a>
            {preset && <button type="button" className="xcs-trend-use" disabled={disabled}
              onClick={() => onUse?.(preset)}>{copy.use}</button>}
          </div>
          {preset && post.preset?.needsImage && <p className="xcs-trend-note">{copy.needsImage}</p>}
        </article>
      })}
    </div>
    <div ref={sentinel} className="xcs-trending-tail" aria-live="polite">
      {feed.failed && <p>{copy.failed}</p>}
      {(feed.cursor || feed.failed)
        ? <button type="button" className="xcs-secondary" disabled={feed.loading}
            onClick={() => void fetchPage(feed.cursor)}>{feed.loading ? copy.loading : copy.loadMore}</button>
        : <p>{copy.end}</p>}
    </div>
  </section>
}
