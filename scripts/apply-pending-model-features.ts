// One-off: flip on the catalog features whose CODE shipped in commits
// 08588e3 (Veo extension) and this one (seedance2_5 config), but whose
// DATA is held back because dev and prod share one Supabase project —
// advertising them before BOTH deployments carry the code would let a
// prod user trigger silently-wrong generations.
//
// RUN AFTER `main` IS DEPLOYED WITH THIS CODE:   npx tsx scripts/apply-pending-model-features.ts
//
// What it does:
//   1. veo-3.1-generate-preview  += extend_video mode  (video_in port appears)
//   2. seedance2_5               gets output_config: 480p/720p/1080p,
//      six aspect ratios, 4–30s durations, audio (UI pickers appear)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

async function main() {
  const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

  // 1) Veo extension mode
  {
    const { data: row, error } = await sb.from('ai_models').select('modes')
      .eq('model_name', 'veo-3.1-generate-preview').single()
    if (error) throw error
    if (!row.modes.includes('extend_video')) {
      const modes = [...row.modes, 'extend_video']
      const { error: e2 } = await sb.from('ai_models').update({ modes }).eq('model_name', 'veo-3.1-generate-preview')
      if (e2) throw e2
      console.log('veo-3.1-generate-preview modes ->', modes)
    } else {
      console.log('veo-3.1-generate-preview already has extend_video')
    }
  }

  // 2) seedance2_5 output_config (API reference, read 2026-08-20)
  {
    const output_config = {
      video: {
        audio: true,
        sizes: ['480p', '720p', '1080p'],
        aspect_ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
        // Docs say min 4; upstream rejects 4 and accepts 5 (probed live
        // 2026-08-20) — carry the real floor.
        durations_by_resolution: {
          '480p':  { min: 5, max: 30 },
          '720p':  { min: 5, max: 30 },
          '1080p': { min: 5, max: 30 },
        },
      },
    }
    const { error } = await sb.from('ai_models').update({ output_config }).eq('model_name', 'seedance2_5')
    if (error) throw error
    console.log('seedance2_5 output_config set:', JSON.stringify(output_config))
  }

  console.log('done — both features are now live on every deployment')
}

main().catch(err => { console.error(err); process.exit(1) })
