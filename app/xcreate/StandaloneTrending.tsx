'use client'

// "Trending on social media" for the standalone studio (Sep 26): the top 10
// under the Studio composer with a link to the rest, all of them (up to 20)
// at the top of Templates, for the mode on screen (video or image). The list
// comes from /api/trending (table trending_posts, supabase/108).
//
// X videos use X's video-only embed (twttr.widgets.createVideo): the post's
// own text renders inside X's iframe at X's size, which nothing on our side
// can restyle, so the card sets the creator credit, our summary and the
// models in the site's type instead. Embeds are built into an empty div React
// never touches, and only when the card nears the viewport: twenty at once is
// twenty iframes and players. "Use this preset" hands the post to XCreate as
// a template (prompt, model, recipe, duration) through the same applyTemplate
// every template uses. Other platforms get a plain link until their own
// embed is wired.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import { useLang } from '@/lib/i18n'
import type { Template } from './templates'
import { TRENDING_COPY, presetTemplate, type TrendingKind, type TrendingPost } from './trending'

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

export default function StandaloneTrending({ kind, limit, moreHref, onUse, disabled }: {
  kind: TrendingKind
  /** Show only the first `limit` posts, with a link to `moreHref` for the rest. */
  limit?: number
  moreHref?: string
  /** Apply a post's preset in XCreate; no button when absent. */
  onUse?: (template: Template) => void
  disabled?: boolean
}) {
  const { lang } = useLang()
  const copy = TRENDING_COPY[lang] ?? TRENDING_COPY.en
  const [posts, setPosts] = useState<TrendingPost[]>([])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/trending?kind=${kind}`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : { posts: [] }))
      .then(d => setPosts(Array.isArray(d.posts) ? d.posts : []))
      .catch(() => { /* aborted or offline: the section just stays hidden */ })
    return () => ctrl.abort()
  }, [kind])

  if (posts.length === 0) return null
  const shown = limit ? posts.slice(0, limit) : posts

  return <section className="xcs-trending" aria-labelledby="xcs-trending-title">
    {posts.some(p => p.platform === 'x') && <Script id="twitter-widgets" src="https://platform.twitter.com/widgets.js"
      strategy="afterInteractive" onReady={() => { window.dispatchEvent(new Event(READY_EVENT)) }} />}
    <div className="xcs-trending-head">
      <div>
        <h2 id="xcs-trending-title">{copy.title}</h2>
        <p>{copy[kind]}</p>
      </div>
      {moreHref && shown.length < posts.length && <Link href={moreHref} className="xcs-trending-more">
        {copy.seeAll.replace('{n}', String(posts.length))} <span aria-hidden="true">→</span>
      </Link>}
    </div>
    <div className="xcs-trending-grid">
      {shown.map(post => {
        const preset = onUse ? presetTemplate(post, lang) : null
        return <article className="xcs-trend" key={`${post.platform}:${post.postId}`}>
          {/* No rank number (owner, Sep 26): the order already says it. */}
          <div className="xcs-trend-meta">
            <div className="xcs-trend-models">{post.models.map(m => <span key={m}>{m}</span>)}</div>
          </div>
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
  </section>
}
