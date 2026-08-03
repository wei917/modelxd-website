'use client'
// app/xdirector/client.tsx — the page shell around the shared chat
// component (auth gate + header live client-side; metadata lives in the
// server page.tsx next door).
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import XDirectorChat from '../components/XDirectorChat'

export default function XDirectorClient() {
  useRequireAuth()
  const t = useT()
  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena">
        <div className="prompt-label eyebrow">{t('xdirector.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 8 }}>{t('xdirector.title')}</h1>
        <XDirectorChat />
      </div>
    </div>
  )
}
