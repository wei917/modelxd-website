// app/xdirect/bible/[id]/page.tsx — the STORY BIBLE of a Story to Video
// conversation as a print-ready page (owner, Aug 22: "are we able to save
// the output to a new pdf?"). No server-side PDF library, no font
// embedding: the page prints cleanly and the browser's own print dialog
// does "Save as PDF", with CJK fonts from the reader's OS. When printing,
// everything but the bible is hidden (the nav, the omnibox, the button).
//
// Owner-only: the conversation is read with the service client and the
// user id is checked by hand, the same ladder /api/xdirector/conversation
// uses. Anyone else gets notFound() — the page's existence isn't advertised.

import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ReactMarkdown from 'react-markdown'
import { createSupabaseServer } from '@/lib/supabase-server'
import SaveAsPdfButton from './SaveAsPdfButton'
import { findBible } from '@/lib/story-bible'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i


export default async function BiblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) notFound()

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data } = await svc.from('xdirector_conversations')
    .select('id, user_id, title, bubbles, skill, deleted_at').eq('id', id).maybeSingle()
  if (!data || data.user_id !== user.id || data.deleted_at) notFound()
  const bible = findBible(data.bubbles)
  if (!bible) notFound()

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 28px 64px' }}>
      <style>{`
        #bible-print .markdown-body { font-size: 15px; line-height: 1.75; }
        #bible-print .markdown-body h1, #bible-print .markdown-body p strong:first-child { font-family: var(--font-display), var(--font-zh), sans-serif; }
        #bible-print .markdown-body ol, #bible-print .markdown-body ul { padding-left: 22px; }
        #bible-print .markdown-body li { margin: 0 0 8px; }
        @media print {
          body * { visibility: hidden; }
          #bible-print, #bible-print * { visibility: visible; }
          #bible-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .no-print { display: none !important; }
          @page { margin: 18mm 16mm; }
        }
      `}</style>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <a href={`/xdirect?c=${data.id}`} style={{ fontSize: 12.5, color: 'var(--muted)' }}>← XDirect</a>
        <span style={{ flex: 1 }} />
        <SaveAsPdfButton />
      </div>
      <article id="bible-print">
        <div className="markdown-body">
          <ReactMarkdown skipHtml>{bible.text}</ReactMarkdown>
        </div>
        <p style={{ marginTop: 28, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace' }}>
          ModelXD · XDirect · Story to Video{bible.model ? ` · bible by ${bible.model}` : ''}{data.title ? ` · ${String(data.title).slice(0, 80)}` : ''}
        </p>
      </article>
    </div>
  )
}
