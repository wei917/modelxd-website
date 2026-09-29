'use client'

import { useLang } from '@/lib/i18n'
import TemplatePicker from '../components/TemplatePicker'
import { XCREATE_TEMPLATES, type Template } from './templates'

/** The tools for the studio's current type, as a section under the composer.
 *  The templates sat here too until the owner removed them (Sep 28: "remove
 *  範本 section"); the type comes from the top bar, so there are no tabs.
 *  Choosing one applies it through applyTemplate, which brings the composer
 *  into view. Nothing renders for a type without tools. */
export default function StandaloneTools({ mode, onSelect }: {
  mode: 'image' | 'video' | 'text' | 'audio'; onSelect: (template: Template) => void
}) {
  const { t } = useLang()
  const tools = XCREATE_TEMPLATES.filter(item => item.mode === mode && item.kind === 'tool')
  if (!tools.length) return null
  return <section id="xcs-tools" className="xcs-templates" aria-labelledby="xcs-tools-title">
    <section className="xcs-template-section">
      <h2 id="xcs-tools-title">{t('xcreate.alltools')}</h2>
      <TemplatePicker templates={tools} onSelect={onSelect} layout="grid" />
    </section>
  </section>
}
