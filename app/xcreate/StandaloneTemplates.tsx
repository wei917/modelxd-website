'use client'

import { useLang } from '@/lib/i18n'
import TemplatePicker from '../components/TemplatePicker'
import { XCREATE_TEMPLATES, type Template } from './templates'

/** The templates for the studio's current type, as a section under the
 *  composer (owner, Sep 28: "template should be in the main page a
 *  section"): the type comes from the top bar, so there are no tabs here.
 *  Choosing one applies it through applyTemplate, which brings the composer
 *  into view. Nothing renders for a type without templates. */
export default function StandaloneTemplates({ mode, onSelect }: {
  mode: 'image' | 'video' | 'text' | 'audio'; onSelect: (template: Template) => void
}) {
  const { t } = useLang()
  const templates = XCREATE_TEMPLATES.filter(item => item.mode === mode)
  const groups = [
    { title: t('xcreate.alltemplates'), items: templates.filter(item => item.kind !== 'tool') },
    { title: t('xcreate.alltools'), items: templates.filter(item => item.kind === 'tool') },
  ].filter(group => group.items.length)
  if (!groups.length) return null
  return <section id="xcs-templates" className="xcs-templates" aria-label={t('xcreate.site.nav.templates')}>
    {groups.map(group => <section className="xcs-template-section" key={group.title}>
      <h2>{group.title}</h2><TemplatePicker templates={group.items} onSelect={onSelect} layout="grid" />
    </section>)}
  </section>
}
