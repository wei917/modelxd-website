'use client'
// The home's first screen in every locale (owner, Sep 14): the playground's
// hero artwork beside the pitch, captioned "you can make images and videos
// like this", leading to /playground.
import Link from 'next/link'
import { useState } from 'react'
import { useLang } from '../../lib/i18n'
import { PG_HERO, pick } from './works'

export default function PlaygroundHeroCard() {
  const { lang, t } = useLang()
  const [broken, setBroken] = useState(false)
  const w = PG_HERO
  return (
    <Link href="/playground" className="pg-hero-card">
      <span className="pg-hero-img">
        {broken
          ? <span className="pg-img-fallback">{pick(w.title, lang)}</span>
          : <img src={w.thumb} alt={pick(w.alt, lang)} onError={() => setBroken(true)} />}
        <span className="pg-badge">{w.original ? t('pg.badge.original') : t('pg.badge.fan')}</span>
      </span>
      <span className="pg-hero-body">
        <span className="pg-hero-eyebrow">{t('pg.home.eyebrow')}</span>
        <span className="pg-hero-title">{t('pg.home.caption')}</span>
        <span className="pg-hero-cta">{t('pg.home.cta')} →</span>
      </span>
    </Link>
  )
}
