// lib/models.ts
// Load models from Supabase ai_models table

import { createClient } from '@supabase/supabase-js'
import type { ModelInfo } from './providers/types'

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export type { ModelInfo }

export async function getModelsByMode(mode: string): Promise<ModelInfo[]> {
  const { data, error } = await supabase()
    .from('ai_models')
    .select('*')
    .eq('enabled', true)
    .contains('modes', [mode])
    .order('provider')

  if (error) throw new Error(`Failed to load models: ${error.message}`)
  return (data ?? []) as ModelInfo[]
}

export async function getModelById(id: string): Promise<ModelInfo | null> {
  const { data, error } = await supabase()
    .from('ai_models')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data as ModelInfo
}

export async function getModelByProviderName(provider: string, modelName: string): Promise<ModelInfo | null> {
  const { data, error } = await supabase()
    .from('ai_models')
    .select('*')
    .eq('provider', provider)
    .eq('model_name', modelName)
    .single()

  if (error) return null
  return data as ModelInfo
}
