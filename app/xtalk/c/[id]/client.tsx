'use client'
// The character page shell: loads the text-model roster (same query the
// XTalk landing uses — the header names the character's model) and mounts
// the room in standalone mode. All chat behavior lives in CharactersRoom;
// this file only gives it a page of its own.

import { useEffect, useState } from 'react'
import { createSupabaseBrowser } from '../../../../lib/supabase-client'
import CharactersRoom from '../../CharactersRoom'
import type { Speaker } from '../../templates'

export default function CharacterPageClient({ charId }: { charId: string }) {
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
    <div style={{ padding: '0 24px 32px' }}>
      <CharactersRoom models={models} resumeId={null} charId={charId} standalone onExit={() => {}} />
    </div>
  )
}
