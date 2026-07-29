// app/api/xcreate/source/route.ts
// Turn an uploaded product photo into a BOARD ROOT (CC, July 28).
//
// The product pipeline starts from an upload, not from a generation, so the
// canvas needs a node to hang everything off before a single cent is spent.
// This route creates that node: a normal xcreates row with node_kind
// 'source', cost 0, and the uploaded image as its one chosen slot.
//
// Storing the processed (resized, signed) URL in slots[0].text is what makes
// the rest of the system work for free — /api/xcreate's parent loader parses
// the storage path straight back out of that URL, so a source node is a
// valid parent for an angle run with no special-casing anywhere.
//
// Uploading several photos of the SAME product in one call groups them onto
// one board, so the angle fan-out can pass all of them as reference images
// (Nano Banana 2 accepts 14) and hold the product far more consistently than
// a single view can.

export const runtime     = 'nodejs'
export const maxDuration = 120

import { processAttachment } from '@/lib/attachment'
import { assertFeature } from '@/lib/features'
import { createClient }      from '@supabase/supabase-js'

const LOG = '[xcreate:source]'
const MAX_SOURCES = 10

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: Request) {
  const gate = await assertFeature('canvas')
  if (gate) return gate

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at) {
    return Response.json(
      { error: 'email_not_verified', message: 'Please verify your email before using XCreate.' },
      { status: 403 },
    )
  }

  const { attachments = [], boardId: boardIdInput = null } = await req.json()
  const inputs = (Array.isArray(attachments) ? attachments : []).filter((a: any) => a?.storagePath)
  if (inputs.length === 0) return Response.json({ error: 'No attachments provided' }, { status: 400 })
  if (inputs.length > MAX_SOURCES) {
    return Response.json({ error: `Too many source photos (max ${MAX_SOURCES})` }, { status: 400 })
  }

  const sb = serviceClient()
  const nodes: any[] = []
  // Every photo in one call joins one board. The first node's id becomes the
  // board id unless the caller is adding to a board that already exists.
  let boardId: string | null = (typeof boardIdInput === 'string' && boardIdInput) ? boardIdInput : null

  for (const inp of inputs) {
    try {
      const result  = await processAttachment(user.id, inp.bucket, inp.storagePath, inp.mediaType, inp.fileName, inp.fileSize)
      const isVideo = result.mediaType.startsWith('video/')
      const label   = typeof inp.fileName === 'string' && inp.fileName ? inp.fileName : 'Source photo'

      // Shaped exactly like a generated slot so the gallery, the workflow
      // strip and the canvas all read it without a branch. chosen:true
      // because a source has only one output and every consumer looks for
      // the chosen slot first.
      const slot = {
        model_id:     null,
        provider:     'upload',
        model_name:   'upload',
        name:         label,
        text:         result.resizedUrl,
        isImage:      !isVideo,
        isVideo,
        chosen:       true,
        cost:         0,
        responseTime: 0,
        error:        null,
        errorRef:     null,
        options:      {},
        responseId:   null,
        conversationHistory: null,
      }

      const { data: row, error: insErr } = await sb.from('xcreates').insert({
        user_id:       user.id,
        mode:          isVideo ? 'video' : 'image',
        prompt:        `Source: ${label}`,
        slots:         [slot],
        attachment_id: result.attachmentId,
        input_attachments: [{
          storagePath: inp.storagePath, bucket: inp.bucket, mediaType: inp.mediaType,
          fileName: inp.fileName, fileSize: inp.fileSize,
        }],
      }).select('id').single()
      if (insErr || !row) throw new Error(insErr?.message ?? 'insert failed')

      if (!boardId) boardId = row.id

      // Board columns come from a later migration than 53. Try them, and on
      // a missing-column error fall back to the root stamp alone so a
      // half-migrated database still produces a usable node.
      const base  = { root_id: row.id }
      const extra = { board_id: boardId, node_kind: 'source', parent_ids: null }
      const { error: stampErr } = await sb.from('xcreates').update({ ...base, ...extra }).eq('id', row.id)
      if (stampErr) {
        console.warn(`${LOG} board stamp failed, retrying without board columns:`, stampErr.message)
        await sb.from('xcreates').update(base).eq('id', row.id)
      }

      nodes.push({
        id: row.id, thumb: result.resizedUrl, isVideo,
        parentId: null, parentIds: [], label, cost: 0, nodeKind: 'source',
      })
      console.log(`${LOG} source node ${row.id} (${label}) on board ${boardId}`)
    } catch (err: any) {
      console.warn(`${LOG} source failed for ${inp?.fileName}:`, err?.message ?? err)
    }
  }

  if (nodes.length === 0) return Response.json({ error: 'Could not process any photo' }, { status: 500 })
  return Response.json({ nodes, boardId })
}
