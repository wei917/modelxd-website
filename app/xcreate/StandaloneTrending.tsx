'use client'

// "Trending on social media" for the standalone studio (Sep 26): the top 6
// under the Studio composer with a link to the rest, all of them (up to 20)
// at the top of Templates, for the mode on screen (video or image). The list
// comes from /api/trending (table trending_posts, supabase/108).
//
// X posts are X's own embed, built with twttr.widgets.createTweet into an
// empty div React never touches, so widgets.js and React don't fight over
// the same nodes, and only when the card nears the viewport: twenty embeds
// at once is twenty iframes and players. The embed carries the creator's
// name, text and live likes itself, so the card adds only what X can't:
// rank, what it is, the models. Other platforms get a plain link until
// their own embed is wired.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import { useLang } from '@/lib/i18n'
import { TRENDING_COPY, type TrendingKind, type TrendingPost } from './trending'

declare global { interface Window { twttr?: any } }

const READY_EVENT = 'xcs-twttr-ready'

function XEmbed({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let near = false
    // Keyed on the element, not the effect run: dev StrictMode mounts twice
    // and a second createTweet would stack a duplicate embed.
    const render = () => {
      if (!near || !window.twttr?.widgets || el.dataset.tweet === id) return
      el.dataset.tweet = id
      window.twttr.widgets.createTweet(id, el, { dnt: true, conversation: 'none' })
    }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { near = true; io.disconnect(); render() }
    }, { rootMargin: '800px 0px' })
    io.observe(el)
    window.addEventListener(READY_EVENT, render)
    return () => { io.disconnect(); window.removeEventListener(READY_EVENT, render) }
  }, [id])
  return <div ref={ref} className="xcs-trend-embed" />
}

export default function StandaloneTrending({ kind, limit, moreHref }: {
  kind: TrendingKind
  /** Show only the first `limit` posts, with a link to `moreHref` for the rest. */
  limit?: number
  moreHref?: string
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
      {shown.map((post, i) => <article className="xcs-trend" key={`${post.platform}:${post.postId}`}>
        <div className="xcs-trend-meta">
          <span className="xcs-trend-rank">{String(i + 1).padStart(2, '0')}</span>
          <div className="xcs-trend-models">{post.models.map(m => <span key={m}>{m}</span>)}</div>
        </div>
        <p>{post.summary[lang] ?? post.summary.en}</p>
        {post.platform === 'x'
          ? <XEmbed id={post.postId} />
          : <a className="xcs-trend-link" href={post.url} target="_blank" rel="noopener noreferrer">@{post.handle} <span aria-hidden="true">↗</span></a>}
      </article>)}
    </div>
  </section>
}
