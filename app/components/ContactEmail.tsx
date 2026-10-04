'use client'
// app/components/ContactEmail.tsx — the mailto: that actually works.
// Chrome without a configured mail handler swallows mailto clicks silently
// (owner hit this, Aug 6: "I click it, nothing happened"). The link now
// REVEALS the address and copies it to the clipboard on click — and still
// fires mailto for browsers that do have a handler. Worst case you can read
// the address and it's already in your clipboard; best case your mail app
// opens too.

import { useRef, useState } from 'react'
import { useT } from '../../lib/i18n'

// support@ since Sep 28 (owner): an alias of the founder inbox, so the
// public address no longer names a person.
export const SUPPORT_EMAIL = 'support@modelxd.com'
const EMAIL = SUPPORT_EMAIL

/** `plain`: the address itself as the link, no copy and no flash (owner,
 *  Sep 28: 「已複製 …」 read as a riddle). The bug form uses it; www's
 *  sidebar keeps the label with copy-on-click; the XTell footer has its own
 *  聯絡我們 mail link (Oct 4). */
export default function ContactEmail({ className, style, plain }: { className?: string; style?: React.CSSProperties; plain?: boolean }) {
  const t = useT()
  // The label STAYS "Contact Us" (owner, Aug 7) — the copy feedback is a
  // transient flash of the address, then the label comes back.
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (plain) return <a href={`mailto:${EMAIL}`} className={className} style={style}>{EMAIL}</a>
  return (
    <a
      href={`mailto:${EMAIL}`}
      className={className}
      style={style}
      title={`${EMAIL} — click to copy`}
      onClick={() => {
        try { void navigator.clipboard?.writeText(EMAIL) } catch { /* the flashed text is the fallback */ }
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 2600)
      }}
    >
      {t('nav.contact')}
      {copied && (
        <span style={{ marginLeft: 6, color: 'var(--green)', fontWeight: 600 }}>
          ✓ {t('contact.copiedfmt').replace('{e}', EMAIL)}
        </span>
      )}
    </a>
  )
}
