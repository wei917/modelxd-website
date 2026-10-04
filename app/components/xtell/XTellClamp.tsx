'use client'
// app/components/xtell/XTellClamp.tsx — four lines of a homepage card, the
// rest one press away (owner, Oct 3). The content is all there from the
// start, loaded with the page; the box keeps a fixed height so the row
// never jumps as data arrives, and 更多 opens it in place (收起 closes it).
// The button shows only when there is more than fits.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useLang } from '../../../lib/i18n'

/** `openSignal`: a number that changes when something outside (the guide) wants it open. */
export default function XTellClamp({ children, openSignal = 0 }: { children: ReactNode; openSignal?: number }) {
  const { t } = useLang()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => { if (openSignal) setOpen(true) }, [openSignal])
  useEffect(() => {
    const el = box.current, content = inner.current
    if (!el || !content) return
    const check = () => setMore(content.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el); ro.observe(content)
    return () => ro.disconnect()
  }, [])
  return <>
    <div id={id} ref={box} className={'xtell-clamp' + (open ? ' is-open' : more ? ' is-cut' : '')}>
      <div ref={inner}>{children}</div>
    </div>
    {(more || open) && (
      <button type="button" className="xtell-home-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        {t(open ? 'xtell.home.less' : 'xtell.home.more')} <span aria-hidden="true">{open ? '↑' : '↓'}</span>
      </button>
    )}
  </>
}
