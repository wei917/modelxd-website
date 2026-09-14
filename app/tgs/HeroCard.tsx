'use client'
// The Japanese home's first screen (owner, Sep 14): one of the TGS artworks
// in the hero's second column, leading to /tgs. The English home is
// unchanged (app/page.tsx renders this only when lang === 'ja').
import Link from 'next/link'
import { useState } from 'react'
import { useLang } from '../../lib/i18n'
import { TGS_HERO_WORK, pick } from './works'

export default function TgsHeroCard() {
  const { lang, t } = useLang()
  const [broken, setBroken] = useState(false)
  const w = TGS_HERO_WORK
  return (
    <Link href="/tgs" className="tgs-hero-card">
      <span className="tgs-hero-img">
        {broken
          ? <span className="tgs-img-fallback">{pick(w.title, lang)}</span>
          : <img src={w.thumb} alt={pick(w.alt, lang)} onError={() => setBroken(true)} />}
        <span className="tgs-badge">{t('tgs.badge')}</span>
      </span>
      <span className="tgs-hero-body">
        <span className="tgs-hero-eyebrow">{t('tgs.home.eyebrow')}</span>
        <span className="tgs-hero-title">{t('tgs.home.title')}</span>
        <span className="tgs-hero-cta">{t('tgs.home.cta')} →</span>
      </span>
    </Link>
  )
}
