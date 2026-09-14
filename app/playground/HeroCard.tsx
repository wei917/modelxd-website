'use client'
// The Japanese home's first screen (owner, Sep 14): the playground's hero
// artwork in the hero's second column, leading to /playground. The English
// home is unchanged (app/page.tsx renders this only when lang === 'ja').
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
        <span className="pg-badge">{t('pg.badge.original')}</span>
      </span>
      <span className="pg-hero-body">
        <span className="pg-hero-eyebrow">{t('pg.home.eyebrow')}</span>
        <span className="pg-hero-title">{t('pg.home.title')}</span>
        <span className="pg-hero-cta">{t('pg.home.cta')} →</span>
      </span>
    </Link>
  )
}
