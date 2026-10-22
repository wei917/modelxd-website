'use client'
// The one interactive bit of the bible page: the browser's print dialog is
// the PDF writer ("Save as PDF" on every desktop browser).
import { useT } from '../../../../lib/i18n'

export default function SaveAsPdfButton() {
  const t = useT()
  return (
    <button
      onClick={() => window.print()}
      title={t('xd.bible.printhint')}
      style={{ padding: '8px 18px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
    >📄 {t('xd.bible.save')}</button>
  )
}
