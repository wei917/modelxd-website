'use client'
// The account page on xcreate.modelxd.com (app/profile/page.tsx renders
// these when useSite() is 'xcreate'). The wallet, plan, referral and
// danger zone stay the shared ModelXD ones; the per-surface tabs give way
// to the studio's own My creations view.

import Link from 'next/link'
import { useLang } from '../../../lib/i18n'

export function XCreateAccountHead() {
  const { t } = useLang()
  return <>
    <p className="xcs-eyebrow">XCreate</p>
    <h1 className="xcs-account-title">{t('profile.account')}</h1>
    <p className="xcs-account-note">{t('xcreate.site.accountNote')}</p>
  </>
}

/** Signed out, or the profile still loading. */
export function XCreateAccountWelcome({ loading, onSignIn }: { loading: boolean; onSignIn: () => void }) {
  const { t } = useLang()
  return <main id="xcreate-main" tabIndex={-1} className="xcs-account xcs-account-welcome">
    <XCreateAccountHead />
    {loading ? <p role="status">{t('common.loading')}</p> : <button type="button" className="xcs-button" onClick={onSignIn}>{t('auth.signin')}</button>}
  </main>
}

export function XCreateCreationsLink() {
  const { t } = useLang()
  return <section className="xcs-creations" aria-labelledby="xcs-creations-title">
    <div>
      <h2 id="xcs-creations-title">{t('xcreate.site.nav.creations')}</h2>
      <p>{t('xcreate.site.creationsNote')}</p>
    </div>
    <Link href="/?view=creations" className="xcs-button">{t('xcreate.site.openCreations')}</Link>
  </section>
}
