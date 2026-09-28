'use client'
// A short summary in the reader's language above a page whose full text is
// English (Terms, Privacy, Methodology). The English text below it stays the
// governing version, and the box says so. Bullets restate what the page
// already says — no new terms (TGS pass, Sep 14). Japanese first; 繁中, 简中
// and 한국어 since Sep 28. A box renders only in a language every one of its
// strings has, so a page not yet translated shows no half-English summary.
import { useLang, STRINGS } from '../../lib/i18n'

export default function LocaleSummary({ items, noteKey = 'legal.summary.note' }: { items: string[]; noteKey?: string }) {
  const { lang, t } = useLang()
  if (lang === 'en' || ![...items, noteKey, 'legal.summary.title'].every(k => (STRINGS as any)[k]?.[lang])) return null
  return (
    <aside lang={lang} style={{ margin: '0 0 28px', padding: '16px 18px', border: '1px solid var(--border2)', borderRadius: 10, background: 'var(--surface)' }}>
      <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.08em', color: 'var(--red)', marginBottom: 6 }}>{t('legal.summary.title')}</div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.6 }}>{t(noteKey)}</p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.8, color: 'var(--white)' }}>
        {items.map(k => <li key={k}>{t(k)}</li>)}
      </ul>
    </aside>
  )
}
