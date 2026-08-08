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

const EMAIL = 'founder@modelxd.com'

export default function ContactEmail({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const t = useT()
  // The label STAYS "Contact Us" (owner, Aug 7) — the copy feedback is a
  // transient flash of the address, then the label comes back.
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
