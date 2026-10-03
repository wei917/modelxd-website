'use client'
// app/xcreate/StandaloneModels.tsx: section ② of the X創作 door (Oct 3
// redesign, learned from Pollo AI's Models list). Every enabled model for
// the chosen type, with what we know for certain: the maker's mark, the
// name, 新 / 熱門, what it can do (from its modes and output_config, not
// marketing copy), and its real list price, which is what the user pays.
// Tapping a card makes it the composer's model; 比較 adds it beside the
// others (up to four). Phone: four, then "see all"; wide: three columns.

import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import ProviderLogo from '../components/ProviderLogo'

export type DoorModel = {
  id: string; provider: string; model_name: string; display_name: string
  modes: string[] | null; output_modalities: string[] | null
  model_pricing: any; output_config: any; input_config: any
  released_at: string | null; is_popular: boolean | null; blocked_features: string[] | null
}

type Mode = 'text' | 'image' | 'video' | 'audio'

const NEW_DAYS = 60

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dollars = (v: number) => (v >= 1 ? `$${+v.toFixed(2)}` : v >= 0.01 ? `$${+v.toFixed(3)}` : `$${+v.toFixed(4)}`)

/** The list price in the unit people buy this type in. */
function priceOf(m: DoorModel, mode: Mode, t: (k: string) => string): string {
  const p = m.model_pricing ?? {}
  if (mode === 'image') {
    const per = p.per_image ?? {}
    const v = num(per.default) ?? num(per['1024']) ?? num(per.medium) ?? num(per['1k']) ?? Math.min(...Object.values(per).filter((x): x is number => typeof x === 'number'))
    return Number.isFinite(v) ? `${dollars(v)}${t('xcs.unit.image')}` : ''
  }
  if (mode === 'video') {
    const per = p.per_video_second ?? {}
    const v = num(per['720p']) ?? num(per.default) ?? Math.min(...Object.values(per).filter((x): x is number => typeof x === 'number'))
    return Number.isFinite(v) ? `${dollars(v)}${t('xcs.unit.second')}` : ''
  }
  if (mode === 'audio') {
    if (num(p.per_1m_characters) != null) return `${dollars(p.per_1m_characters)}${t('xcs.unit.mchar')}`
    const out = num(p.tokens?.audio_output)
    return out != null ? `${dollars(out)}${t('xcs.unit.mtok')}` : ''
  }
  // Transcription is billed by the minute of audio heard (Whisper, Fun-ASR).
  if (num(p.per_audio_minute) != null) return `${dollars(p.per_audio_minute)}${t('xcs.unit.minute')}`
  const out = num(p.tokens?.text_output) ?? num(p.tokens?.text_output?.default)
  return out != null ? `${dollars(out)}${t('xcs.unit.mtok')}` : ''
}

/** "2K", "4K", "1080p · 15s": the most the model can give, from its config. */
function topOf(m: DoorModel, mode: Mode): string | null {
  if (mode === 'image') {
    const sizes: string[] = m.output_config?.image?.sizes ?? []
    const px = Math.max(0, ...sizes.map(s => Math.max(...String(s).toLowerCase().replace(/k$/, '000').split(/[x*]/).map(n => parseInt(n, 10) || 0))))
    return px >= 3800 ? '4K' : px >= 1900 ? '2K' : px > 0 ? '1K' : null
  }
  if (mode === 'video') {
    const sizes: string[] = (m.output_config?.video?.sizes ?? []).map((s: string) => String(s).toLowerCase())
    const rank = (s: string) => (s.includes('4k') ? 2160 : s.includes('2k') ? 1440 : parseInt(s, 10) || 0)
    const best = sizes.sort((a, b) => rank(b) - rank(a))[0]
    const dbr = m.output_config?.video?.durations_by_resolution ?? {}
    const secs = Math.max(0, ...Object.values(dbr).flatMap((v: any) => Array.isArray(v) ? v : [v?.max ?? 0]).map(Number))
    const res = best ? (best === '4k' || best === '2k' ? best.toUpperCase() : best) : null
    return [res, secs ? `${secs}s` : null].filter(Boolean).join(' · ') || null
  }
  return null
}

export default function StandaloneModels({ mode, selectedIds, canCompare, onUse, onCompare }: {
  mode: Mode
  selectedIds: string[]
  /** Whether 比較 is offered for this model: a free seat, and the model
   *  runs the composer's current recipe. */
  canCompare: (m: DoorModel) => boolean
  onUse: (m: DoorModel) => void
  onCompare: (m: DoorModel) => void
}) {
  const { t } = useLang()
  const [models, setModels] = useState<DoorModel[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let dead = false
    setOpen(false)
    createSupabaseBrowser().from('ai_models')
      .select('id, provider, model_name, display_name, modes, output_modalities, model_pricing, output_config, input_config, released_at, is_popular, blocked_features')
      .eq('enabled', true)
      .contains('output_modalities', [mode])
      .then(({ data }) => {
        if (dead) return
        const list = ((data ?? []) as DoorModel[])
          .filter(m => !(m.blocked_features ?? []).includes('xcreate'))
          .sort((a, b) => Number(!!b.is_popular) - Number(!!a.is_popular) || (b.released_at ?? '').localeCompare(a.released_at ?? ''))
        setModels(list)
      })
    return () => { dead = true }
  }, [mode])

  if (!models || models.length === 0) return null
  const newSince = Date.now() - NEW_DAYS * 86_400_000

  return (
    <section className="xcs-sec" aria-label={t('xcs.sec.models')}>
      <div className="xcs-sec-head"><h2>{t('xcs.sec.models')}</h2></div>
      <div className={`xcs-models${open ? ' is-open' : ''}`}>
        {models.map(m => {
          const inUse = selectedIds.includes(m.id)
          const caps = (m.modes ?? []).map(md => t(`xcs.cap.${md}`)).filter(w => !w.startsWith('xcs.cap.'))
          const top = topOf(m, mode)
          if (top) caps.push(t('xcs.cap.upto').replace('{v}', top))
          const isNew = !!m.released_at && Date.parse(m.released_at) >= newSince
          return (
            <div key={m.id} className={`xcs-model${inUse ? ' in-use' : ''}`}>
              <button type="button" className="xcs-model-main" onClick={() => onUse(m)} aria-pressed={inUse}>
                <span className="xcs-model-logo"><ProviderLogo provider={m.provider} model={m.model_name} size={22} /></span>
                <span className="xcs-model-info">
                  <span className="xcs-model-name">
                    <b>{m.display_name.replace(/\s*-\s*Gemini.*$/, '')}</b>
                    {isNew && <i className="xcs-tag new">{t('xcs.models.new')}</i>}
                    {m.is_popular && <i className="xcs-tag hot">{t('xcs.models.hot')}</i>}
                    {inUse && <i className="xcs-tag use">{t('xcs.models.inuse')}</i>}
                  </span>
                  <span className="xcs-model-caps">{caps.join(' · ')}</span>
                </span>
              </button>
              <span className="xcs-model-side">
                <span className="xcs-model-price">{priceOf(m, mode, t)}</span>
                {!inUse && canCompare(m) && (
                  <button type="button" className="xcs-model-add" onClick={() => onCompare(m)} aria-label={`${t('xcs.models.add')} ${m.display_name}`}>＋ {t('xcs.models.add')}</button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      {models.length > 4 && (
        <button type="button" className="xcs-models-more" onClick={() => setOpen(o => !o)}>
          {open ? t('xcs.models.less') : t('xcs.models.all').replace('{n}', String(models.length))}
        </button>
      )}
    </section>
  )
}
