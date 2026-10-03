// lib/model-facts.ts: what a model can do and what it costs, in words a buyer
// reads (Oct 3; owner: "in model picker ... the details especially the
// price"). Capabilities come from the row's own modes and output_config,
// never marketing copy. The price is the list price per unit at the settings
// the XCreate composer opens with, through the same rate lookups its
// estimate uses, so the picker and the estimate say the same number.

export type FactsMode = 'text' | 'image' | 'video' | 'audio'
export type PriceUnit = 'image' | 'second' | 'mtok' | 'mchar' | 'minute'

type FactsModel = { model_pricing?: any; output_config?: any; modes?: string[] | null; released_at?: string | null }

/** The tier a video size bills at: '480p', '720p', '1080p', '4K'. */
export function resolutionKeyForSize(size: string): string | null {
  // Plain resolution keys ('480p', '720p', '4k') pass through directly -
  // some models (Grok Imagine) declare sizes this way, and falling back
  // to the 720p rate mis-estimated 480p runs (CC, July 20).
  if (/^\d+p$/i.test(size)) return size.toLowerCase()
  if (/^4k$/i.test(size)) return '4K'
  if (!size.includes('x')) return null
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return null
  const shortSide = Math.min(w, h)
  if (shortSide >= 2000) return '4K'
  if (shortSide >= 1000) return '1080p'
  if (shortSide >= 700)  return '720p'
  return '480p'
}

/** Per-image rate. Most specific key wins: "quality:size" (gpt-image-2's
 *  measured matrix) → size tier ("1024" for Gemini) → quality → fallbacks. */
export function perImageRate(r: Record<string, number> | null | undefined, quality: string | null, size: string | null): number | null {
  if (!r) return null
  const flat = (quality && size && r[`${quality}:${size}`] != null) ? r[`${quality}:${size}`]
             : (size && r[size] != null) ? r[size]
             : (quality && r[quality] != null) ? r[quality]
             : (r.medium ?? r.default ?? Object.values(r)[0] ?? null)
  return typeof flat === 'number' ? flat : null
}

/** Per-second video rate for a size. An unmapped size falls back to the
 *  model's OWN first declared size, which is what the composer selects:
 *  falling back to 720p was a silent 2x on a model whose default tier is
 *  cheaper (Wan 3.0 opens at 480p, $0.05/s). */
export function perSecondRate(r: Record<string, number> | null | undefined, size: string | null, firstSize: string | null): number | null {
  if (!r) return null
  const key      = size ? resolutionKeyForSize(size) : null
  const firstKey = firstSize ? resolutionKeyForSize(firstSize) : null
  if (key && r[key] != null)                 return r[key]
  if (firstKey && r[firstKey] != null)       return r[firstKey]
  if (r['default'] != null)                  return r['default']
  if (r['720p'] != null)                     return r['720p']
  const first = Object.values(r)[0]
  return typeof first === 'number' ? first : null
}

/** The list price per unit at the composer's opening settings: the first
 *  size, medium quality where offered (validateOpts in app/xcreate/client.tsx). */
export function unitPrice(m: FactsModel, mode: FactsMode): { usd: number; unit: PriceUnit } | null {
  const p = m.model_pricing ?? {}
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  if (mode === 'image') {
    const qualities: string[] = m.output_config?.image?.qualities ?? []
    const sizes: string[] = m.output_config?.image?.sizes ?? []
    const q = qualities.includes('medium') ? 'medium' : (qualities[0] ?? null)
    const v = perImageRate(p.per_image, q, sizes[0] ?? null)
    return v != null ? { usd: v, unit: 'image' } : null
  }
  if (mode === 'video') {
    const first = m.output_config?.video?.sizes?.[0] ?? null
    const v = perSecondRate(p.per_video_second, first, first)
    return v != null ? { usd: v, unit: 'second' } : null
  }
  if (mode === 'audio') {
    const chars = num(p.per_1m_characters)
    if (chars != null) return { usd: chars, unit: 'mchar' }
    const out = num(p.tokens?.audio_output)
    return out != null ? { usd: out, unit: 'mtok' } : null
  }
  // Transcription is billed by the minute of audio heard (Whisper, Fun-ASR).
  const minute = num(p.per_audio_minute)
  if (minute != null) return { usd: minute, unit: 'minute' }
  const out = num(p.tokens?.text_output) ?? num(p.tokens?.text_output?.default)
  return out != null ? { usd: out, unit: 'mtok' } : null
}

/** "$0.067", "$0.0048", "$25": enough digits to be exact for small prices. */
export function formatUsd(v: number): string {
  if (v >= 1)    return `$${+v.toFixed(2)}`
  if (v >= 0.01) return `$${+v.toFixed(3)}`
  return `$${+v.toFixed(4)}`
}

/** The most the model can give: "4K", "2K", "1080p · 15s". */
export function topOf(m: FactsModel, mode: FactsMode): string | null {
  if (mode === 'image') {
    const sizes: string[] = m.output_config?.image?.sizes ?? []
    const px = Math.max(0, ...sizes.map(s => Math.max(...String(s).toLowerCase().replace(/k$/, '000').split(/[x*]/).map(n => parseInt(n, 10) || 0))))
    return px >= 3800 ? '4K' : px >= 1900 ? '2K' : px > 0 ? '1K' : null
  }
  if (mode === 'video') {
    const sizes: string[] = (m.output_config?.video?.sizes ?? []).map((s: string) => String(s).toLowerCase())
    const rank = (s: string) => (s.includes('4k') ? 2160 : s.includes('2k') ? 1440 : parseInt(s, 10) || 0)
    const best = [...sizes].sort((a, b) => rank(b) - rank(a))[0]
    const dbr = m.output_config?.video?.durations_by_resolution ?? {}
    const secs = Math.max(0, ...Object.values(dbr).flatMap((v: any) => Array.isArray(v) ? v : [v?.max ?? 0]).map(Number))
    const res = best ? (best === '4k' || best === '2k' ? best.toUpperCase() : best) : null
    return [res, secs ? `${secs}s` : null].filter(Boolean).join(' · ') || null
  }
  return null
}

/** Released in the last 60 days. */
export const isNewModel = (m: FactsModel) =>
  !!m.released_at && Date.parse(m.released_at) >= Date.now() - 60 * 86_400_000

/** What it can do, in the reader's language: one word per declared mode
 *  (i18n `xcs.cap.<mode>`; modes without a word are left out), then the
 *  most it can give. */
export function capabilityLine(m: FactsModel, mode: FactsMode, t: (k: string) => string): string {
  const caps = (m.modes ?? []).map(md => t(`xcs.cap.${md}`)).filter(w => !w.startsWith('xcs.cap.'))
  const top = topOf(m, mode)
  if (top) caps.push(t('xcs.cap.upto').replace('{v}', top))
  return caps.join(' · ')
}
