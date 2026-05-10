// app/admin/models/page.tsx
// Admin-only catalog editor. Server-side auth gate; client component
// renders the table + edit form.

import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getAdminUser } from '@/lib/admin'
import AdminModelsClient, { type AdminModel } from './AdminModelsClient'

export const dynamic = 'force-dynamic'

export default async function AdminModelsPage() {
  const admin = await getAdminUser()
  if (!admin) {
    // Send unauthenticated visitors home; signed-in non-admins also bounce.
    // We don't expose /admin's existence in the nav, so this is mostly
    // about keeping someone who guessed the URL out.
    redirect('/')
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
  const { data, error } = await sb
    .from('ai_models')
    .select('*')
    .order('provider')
    .order('model_name')
  if (error) {
    return <div style={{ padding: 32, color: 'var(--red)' }}>Failed to load: {error.message}</div>
  }

  return <AdminModelsClient initialModels={(data as AdminModel[]) ?? []} />
}
