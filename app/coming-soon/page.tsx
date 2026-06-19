'use client'
// app/coming-soon/page.tsx
//
// Under-construction placeholder + password gate. Visitors hit this
// when middleware.ts decides they haven't unlocked the site. A correct
// password sets the unlock cookie and bounces back to the originally
// requested URL (passed in via ?from=).

import { useState } from 'react'

export default function ComingSoonPage() {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/site-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        if (res.status === 401) setError('Wrong password. Try again.')
        else setError(`Server error (${res.status}).`)
        setBusy(false)
        return
      }
      // Success — bounce back to where they came from (or to home).
      const params = new URLSearchParams(window.location.search)
      const from = params.get('from')
      const target = from && from.startsWith('/') && !from.startsWith('/coming-soon') ? from : '/'
      window.location.href = target
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#fdfdfb',
      padding: 24,
      cursor: 'auto',
    }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' as const }}>
        {/* Logo image — the real /logo.png from /public, sized large
            so the placeholder feels like a real brand surface, not
            just a stray form. */}
        <img
          src="/logo.png"
          alt="ModelXD"
          style={{
            width: 96, height: 96, borderRadius: 18,
            marginBottom: 24,
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          }}
        />

        {/* Wordmark */}
        <div style={{
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          fontWeight: 900, fontSize: 48, letterSpacing: '-0.02em',
          color: '#0f0f0f', marginBottom: 14, lineHeight: 1,
        }}>
          Model<span style={{ color: '#e8453c' }}>XD</span>
        </div>

        {/* Eyebrow */}
        <div style={{
          fontFamily: 'ui-monospace, "Cascadia Mono", "Roboto Mono", monospace',
          fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase' as const,
          color: '#999', marginBottom: 36,
        }}>
          {'// under construction'}
        </div>

        {/* Tagline */}
        <div style={{
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          fontSize: 17, lineHeight: 1.6, color: '#555',
          marginBottom: 44, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto',
        }}>
          The AI model comparison platform that proves you&rsquo;re probably overpaying.{' '}
          <span style={{ color: '#888' }}>Launching soon.</span>
        </div>

        {/* Password form */}
        <form onSubmit={submit} style={{
          display: 'flex', flexDirection: 'column' as const, gap: 12,
          maxWidth: 360, margin: '0 auto',
        }}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Have a password?"
            autoComplete="off"
            disabled={busy}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 10,
              border: '1px solid #d4d4d4', background: '#ffffff',
              fontSize: 14, color: '#0f0f0f', boxSizing: 'border-box',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy || !password}
            style={{
              padding: '12px 20px', borderRadius: 10, border: 'none',
              background: password ? '#0f0f0f' : '#eeeeea',
              color: password ? '#ffffff' : '#999',
              fontFamily: 'ui-monospace, "Cascadia Mono", "Roboto Mono", monospace',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              cursor: password && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Checking…' : 'Enter site'}
          </button>
        </form>

        {error && (
          <div style={{ marginTop: 16, fontSize: 13, color: '#e8453c' }}>
            {error}
          </div>
        )}

        <div style={{
          marginTop: 56,
          fontFamily: 'ui-monospace, "Cascadia Mono", "Roboto Mono", monospace',
          fontSize: 10, color: '#aaa', letterSpacing: '0.1em',
        }}>
          Launching soon. Stay tuned.
        </div>
      </div>
    </div>
  )
}
