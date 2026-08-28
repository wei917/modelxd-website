'use client'
// app/components/ProviderLogo.tsx
//
// Small provider brand mark shown next to model names — XCreate slot
// cards, the model picker, and the Leaderboard provider column.
//
// NEVER render this during XDuel's blind phases (vote 1 / vote 2):
// a provider logo before the reveal breaks the whole blind-test premise.
//
// Assets live at /public/logos/<provider>.svg — one per provider, not
// per model. Sources: simple-icons (CC0) with the brand hex inlined.
// openai.svg is the blossom mark (from simple-icons v13, before the
// icon was dropped upstream), black fill per OpenAI's own light-mode
// usage. Nominative use: it labels OpenAI's models as theirs.
// Unknown providers (or a missing file) render nothing.

const KNOWN = ['openai', 'google', 'alibaba', 'anthropic', 'xai', 'runway', 'moonshot', 'modelxd']

// Ours is the brand mark itself (the same PNG the Nav lockup uses), not a
// simple-icons SVG — XEval lists ModelXD Autopilot alongside the vendors and
// it should wear our logo there, not a stand-in glyph.
const SRC: Record<string, string> = { modelxd: '/logo.png' }

export default function ProviderLogo({
  provider,
  size = 16,
  style,
}: {
  provider?: string | null
  size?: number
  style?: React.CSSProperties
}) {
  const p = (provider ?? '').toLowerCase()
  if (!KNOWN.includes(p)) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC[p] ?? `/logos/${p}.svg`}
      alt={p}
      title={p}
      width={size}
      height={size}
      loading="lazy"
      onError={e => { (e.currentTarget as HTMLElement).style.display = 'none' }}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: '-2px', ...(p === 'modelxd' ? { borderRadius: 4 } : null), ...style }}
    />
  )
}
