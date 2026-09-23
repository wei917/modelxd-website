'use client'
// XPersona shell: loads the text-model roster (same query as XTalk — the
// builder's model picker and each card name the model) and mounts the
// characters room in manage mode. All builder behavior lives in
// CharactersRoom; this page only gives it a home of its own.

import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import CharactersRoom from '../xtalk/CharactersRoom'
import type { Speaker } from '../xtalk/templates'

export default function XPersonaClient({ editId, startNew }: { editId: string | null; startNew: boolean }) {
  const t = useT()
  useRequireAuth()
  const [models, setModels] = useState<Speaker[]>([])
  useEffect(() => {
    createSupabaseBrowser()
      .from('ai_models')
      .select('id, model_name, display_name, provider, model_pricing, output_config, output_modalities, enabled, blocked_features')
      .eq('enabled', true)
      .contains('output_modalities', ['text'])
      .order('is_popular', { ascending: false })
      .then(({ data }) => setModels((data ?? []) as any))
  }, [])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 24px 60px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, margin: 0, color: 'var(--white)' }}>{t('nav.xpersona')}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 15, margin: '6px 0 24px' }}>{t('xpersona.sub')}</p>
      <CharactersRoom models={models} resumeId={null} charId={null} manage editId={editId} startNew={startNew} onExit={() => {}} />
    </div>
  )
}
