'use client'
// app/components/ContactEmail.tsx — the mailto: that actually works.
// Chrome without a configured mail handler swallows mailto clicks silently
// (owner hit this, Aug 6: "I click it, nothing happened"). The link now
// REVEALS the address and copies it to the clipboard on click — and still
// fires mailto for browsers that do have a handler. Worst case you can read
// the address and it's already in your clipboard; best case your mail app
// opens too.

import { useState } from 'react'
import { useT } from '../../lib/i18n'

const EMAIL = 'founder@modelxd.com'

export default function ContactEmail({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <a
      href={`mailto:${EMAIL}`}
      className={className}
      style={style}
      title={`${EMAIL} — click to copy`}
      onClick={() => {
        try { void navigator.clipboard?.writeText(EMAIL) } catch { /* the revealed text is the fallback */ }
        setCopied(true)
      }}
    >
      {copied ? `${EMAIL} ✓` : t('nav.contact')}
    </a>
  )
}
