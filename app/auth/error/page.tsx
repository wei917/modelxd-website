'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorInner />
    </Suspense>
  )
}

function AuthErrorInner() {
  const params = useSearchParams()
  const reason = params.get('reason')
  const detail = params.get('detail')
  const [retrying, setRetrying] = useState(false)

  // Clear any stale OAuth state on mount so a manual retry has a clean slate
  useEffect(() => {
    document.cookie.split(';').forEach(c => {
      const name = c.trim().split('=')[0]
      if (!name) return
      if (name.startsWith('sb-') || name === 'auth_redirect') {
        document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
      }
    })
  }, [])

  const handleRetry = async () => {
    setRetrying(true)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
    document.cookie = `auth_redirect=/; path=/; max-age=600; SameSite=Lax`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 80px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 8,
        padding: '48px 40px',
        maxWidth: 480,
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'var(--font-display), sans-serif',
          fontSize: 26,
          fontWeight: 900,
          textTransform: 'uppercase',
          color: 'var(--white)',
          marginBottom: 12,
        }}>
          Sign-in <span style={{ color: 'var(--red)' }}>failed</span>
        </div>

        <p style={{ fontSize: 14, color: 'var(--muted2)', lineHeight: 1.6, marginBottom: 8 }}>
          We couldn&apos;t complete your Google sign-in. This usually happens when an
          earlier sign-in attempt was interrupted.
        </p>

        {(reason || detail) && (
          <div style={{
            marginTop: 16,
            marginBottom: 24,
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 11,
            color: 'var(--muted)',
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>
            {reason && <div>reason: {reason}</div>}
            {detail && <div>detail: {detail}</div>}
          </div>
        )}

        <button
          onClick={handleRetry}
          disabled={retrying}
          style={{
            width: '100%',
            padding: '14px 24px',
            background: 'var(--white)',
            border: 'none',
            borderRadius: 4,
            color: 'var(--bg)',
            fontFamily: 'var(--font-display), sans-serif',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            marginTop: 8,
            marginBottom: 12,
            opacity: retrying ? 0.5 : 1,
          }}
        >
          {retrying ? 'Redirecting…' : 'Try again with Google'}
        </button>

        <Link href="/" style={{
          display: 'inline-block',
          fontSize: 12,
          color: 'var(--muted2)',
          textDecoration: 'underline',
          marginTop: 8,
        }}>
          Back to home
        </Link>
      </div>
    </div>
  )
}
