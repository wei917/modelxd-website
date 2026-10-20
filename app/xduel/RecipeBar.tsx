'use client'
// 影片's kinds as a "Mode:" row (owner, Oct 19: "something like this? A
// left/right scrollable buttons"): an icon and a name per kind, the chosen
// one in red, arrows at both ends that grey out at the row's ends, and a
// fade where the row goes on. On a phone the row is swiped and the arrows
// step aside. The kinds, their order, names and icons are X創作's (owner:
// "the modes do not match what XCreate's video tab"): RECIPES.video and
// `recipefrom.<id>`, less what a duel cannot hold (lib/xduel-recipes.ts).
// X創作's video tab shows the same row with its own kinds, every video mode
// its catalog serves (owner, Oct 19: XDuel's video tab, "can you follow it?").

import { useEffect, useRef, useState } from 'react'
import { VIDEO_RECIPES, type VideoRecipe } from '@/lib/xduel-recipes'
import { RECIPES, RECIPE_ICONS, InputIcon } from '../xcreate/recipes'

const KINDS = RECIPES.video.map(r => r.id).filter((id): id is VideoRecipe => VIDEO_RECIPES.some(v => v.key === id))

const Icon = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export default function RecipeBar<K extends string = VideoRecipe>({ recipe, onPick, t, kinds }: {
  recipe: K
  onPick: (r: K) => void
  t: (k: string) => string
  /** The kinds offered, in order; a duel's own when left out. */
  kinds?: readonly K[]
}) {
  const row = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState({ left: false, right: false })

  // Which ends still have more to scroll to: the arrows and fades follow.
  const measure = () => {
    const el = row.current
    if (!el) return
    setEnds({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }
  useEffect(() => {
    const el = row.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure) }
  }, [])
  // The chosen kind in view (the row only, never the page), e.g. after a
  // link straight to 配樂・對嘴 at the row's end.
  useEffect(() => {
    const el = row.current, on = el?.querySelector<HTMLElement>('.on')
    if (el && on) {
      const r = on.getBoundingClientRect(), box = el.getBoundingClientRect()
      if (r.left < box.left || r.right > box.right) el.scrollLeft += r.left - box.left - 12
    }
    measure()
  }, [recipe])

  const step = (dir: -1 | 1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className="xduel-modebar">
      <span className="xduel-modebar-label">{t('xduel.recipe.mode')}</span>
      <button type="button" className="xduel-modebar-arrow" onClick={() => step(-1)} disabled={!ends.left} aria-label={t('xduel.recipe.left')}>
        <Icon size={18}><path d="m15 18-6-6 6-6" /></Icon>
      </button>
      <div className={`xduel-modebar-row${ends.left ? ' fade-l' : ''}${ends.right ? ' fade-r' : ''}`} ref={row} role="tablist" aria-label={t('xduel.recipe.label')}>
        {(kinds ?? (KINDS as readonly string[] as readonly K[])).map(k => (
          <button key={k} type="button" role="tab" aria-selected={k === recipe}
            className={k === recipe ? 'on' : ''} onClick={() => onPick(k)}>
            <InputIcon kind={RECIPE_ICONS[k]?.[0] ?? 'video'} size={20} />
            <span>{t('recipefrom.' + k)}</span>
          </button>
        ))}
      </div>
      <button type="button" className="xduel-modebar-arrow" onClick={() => step(1)} disabled={!ends.right} aria-label={t('xduel.recipe.right')}>
        <Icon size={18}><path d="m9 18 6-6-6-6" /></Icon>
      </button>
    </div>
  )
}

/** The same choice as a dropdown inside the prompt box (owner, Oct 20: "we
 *  can still have the dropdown in the prompt box"; "a dropdown is much
 *  easier to select"), kept in step with the row: both read and set one
 *  mode. Closes on a press outside or Escape. */
export function ModeDropdown<K extends string = VideoRecipe>({ recipe, onPick, t, kinds, disabled }: {
  recipe: K
  onPick: (r: K) => void
  t: (k: string) => string
  kinds?: readonly K[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])
  const list = kinds ?? (KINDS as readonly string[] as readonly K[])
  return (
    <div className="xduel-modedrop" ref={box}>
      <button type="button" className="xduel-modedrop-btn" aria-haspopup="listbox" aria-expanded={open}
        disabled={disabled} onClick={() => setOpen(o => !o)}>
        <span className="xduel-modedrop-label">{t('xduel.recipe.mode')}</span>
        <InputIcon kind={RECIPE_ICONS[recipe]?.[0] ?? 'video'} size={16} />
        <span>{t('recipefrom.' + recipe)}</span>
        <span aria-hidden className="xduel-modedrop-caret">▾</span>
      </button>
      {open && (
        <div className="xduel-modedrop-menu" role="listbox" aria-label={t('xduel.recipe.label')}>
          {list.map(k => (
            <button key={k} type="button" role="option" aria-selected={k === recipe}
              className={k === recipe ? 'on' : ''} onClick={() => { onPick(k); setOpen(false) }}>
              <InputIcon kind={RECIPE_ICONS[k]?.[0] ?? 'video'} size={18} />
              <span>{t('recipefrom.' + k)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
