'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import type { ShowcasePiece } from '@/lib/showcase'
import ModeIcon from '../components/ModeIcon'
import TemplatePicker from '../components/TemplatePicker'
import ShowcaseWall from '../components/ShowcaseWall'
import { XCREATE_TEMPLATES, type Template } from './templates'
import { xcreateStudioCopy } from './standalone-copy'

export default function StandaloneTemplates({ showcase, disabled, onSelect, onNew }: {
  showcase: ShowcasePiece[]; disabled: boolean; onSelect: (template: Template) => void; onNew: () => void
}) {
  const { lang, t } = useLang()
  const copy = xcreateStudioCopy(lang)
  // Browsing a category must never clear the studio's current draft or run.
  const [mode, setMode] = useState<'image' | 'video' | 'text' | 'audio'>('image')
  const templates = XCREATE_TEMPLATES.filter(item => item.mode === mode)
  return <section className="xcs-templates">
    <div className="xcs-template-modes" aria-label={t('xcreate.generate')}>
      {(['image', 'video', 'text', 'audio'] as const).map(value => <button key={value} type="button" aria-pressed={value === mode} onClick={() => setMode(value)}><ModeIcon m={value} />{t(`mode.${value}`)}</button>)}
    </div>
    <label className="xcs-mobile-mode">{t('xcreate.generate')}
      <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
        {(['image', 'video', 'text', 'audio'] as const).map(value => <option key={value} value={value}>{t(`mode.${value}`)}</option>)}
      </select>
    </label>
    {disabled && <div className="xcs-template-notice"><p>{copy.lockedTemplates}</p><button className="xcs-secondary" onClick={onNew}>{copy.newCreation}</button></div>}
    {templates.length === 0 ? <p className="xcs-empty">{copy.emptyTemplates}</p> : [
      { title: t('xcreate.alltemplates'), items: templates.filter(item => item.kind !== 'tool') },
      { title: t('xcreate.alltools'), items: templates.filter(item => item.kind === 'tool') },
    ].filter(group => group.items.length).map(group => <section className="xcs-template-section" key={group.title}>
      <h2>{group.title}</h2><TemplatePicker templates={group.items} onSelect={onSelect} disabled={disabled} layout="grid" />
    </section>)}
    {(mode === 'image' || mode === 'video') && <ShowcaseWall pieces={showcase.filter(piece => piece.kind === mode)} />}
  </section>
}
