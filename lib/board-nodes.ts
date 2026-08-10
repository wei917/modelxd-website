'use client'
// lib/board-nodes.ts
// Load one canvas board as CanvasNode[] — the board query, slot flattening
// and input resolution that grew up inside app/xcreate/client.tsx, extracted
// so /xdirect can put the same board next to the director chat. (CC, Aug 5)
//
// The shape rules are inherited, not reinvented:
//   * ONE NODE PER OUTPUT, not per row — a two-model run is two outputs the
//     user paid for; collapsing them hid the second one.
//   * Edges stay ROW-level (parent_ids are row ids) and are mapped onto
//     whichever output node represents each parent row: the chosen slot if
//     there is one, else the first.
//   * Uploaded reference images become INPUT nodes, deduped by storage path,
//     so one photo feeding three generations is one node with three wires.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowser } from './supabase-client'
import type { CanvasNode } from '../app/components/WorkflowCanvas'

type InputAttachment = {
  bucket: string; storagePath: string; mediaType: string
  fileName: string; fileSize: number; url?: string
}

export function useBoardNodes(boardId: string | null) {
  const [chain,   setChain]   = useState<any[]>([])
  const [inputs,  setInputs]  = useState<Record<string, InputAttachment[]>>({})
  const [outUrls, setOutUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [tick,    setTick]    = useState(0)

  // Bump to re-query — the chat calls this when a generation settles, so the
  // board updates the moment there is something new to draw.
  const refresh = useCallback(() => setTick(v => v + 1), [])

  useEffect(() => {
    if (!boardId) { setChain([]); setInputs({}); setOutUrls({}); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const sb = createSupabaseBrowser()
        // BOTH halves of the board load together (owner ask, Aug 9): the
        // inputs call used to wait for the row ids, so the reference block
        // appeared seconds after the nodes — and every node that consumed a
        // reference then jumped a column as it gained its parent. Passing
        // boardId lets the server find the ids itself.
        const [{ data: rows, error }, inputsRes] = await Promise.all([
          sb.from('xcreates')
            .select('id, slots, created_at, parent_id, parent_ids, board_id, node_kind, prompt')
            .eq('board_id', boardId).is('deleted_at', null)
            .order('created_at', { ascending: true }),
          fetch('/api/xcreate/inputs', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardId }),
          }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        ])
        if (cancelled) return
        if (error || !rows || rows.length === 0) { setChain([]); setInputs({}); setOutUrls({}); return }
        // On failure keep the previous inputs — a transient error must not
        // strip the refs block off a board that already drew it.
        if (inputsRes) {
          setInputs(inputsRes.inputs ?? {})
          setOutUrls(inputsRes.outputs ?? {})
        }

        const flat: any[] = []
        for (const r of rows as any[]) {
          const ss: any[] = Array.isArray(r.slots) ? r.slots : []
          const parentRowIds: string[] = (Array.isArray(r.parent_ids) && r.parent_ids.length > 0)
            ? r.parent_ids
            : (r.parent_id ? [r.parent_id] : [])
          const usable = ss
            .map((sl: any, idx: number) => ({ sl, idx }))
            .filter(({ sl }) => typeof sl?.text === 'string' && sl.text && !sl.error)
          // A row whose every slot failed still gets one node, so the user
          // can see what they were charged for.
          const pool = usable.length > 0 ? usable : ss.slice(0, 1).map((sl: any, idx: number) => ({ sl, idx }))
          for (const { sl, idx } of pool) {
            flat.push({
              id: `${r.id}::${idx}`,
              rowId: r.id,
              slotIdx: idx,
              chosen: !!sl?.chosen,
              thumb: typeof sl?.text === 'string' ? sl.text.split('\n')[0] : null,
              isVideo: !!sl?.isVideo,
              parentRowIds,
              parentId: null,
              parentIds: [],
              kind: (r.node_kind ?? null) as any,
              label: sl?.name ?? sl?.model_name ?? undefined,
              cost: Number(sl?.cost ?? 0) || undefined,
              prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
              createdAt: r.created_at ?? undefined,
              // A failed slot must SAY so — without these the node rendered
              // as "expired", which reads as our storage rotting rather
              // than the model erroring (owner confusion, Aug 9).
              ...(sl?.error ? { status: 'error' as const, error: String(sl.error) } : {}),
            })
          }
        }
        setChain(flat)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [boardId, tick])

  const nodes = useMemo<CanvasNode[]>(() => {
    const primary: Record<string, string> = {}
    for (const n of chain) {
      if (!n.rowId) continue
      if (!(n.rowId in primary) || n.chosen) primary[n.rowId] = n.id
    }
    const inputNodes: CanvasNode[] = []
    const inputIdsByRow: Record<string, string[]> = {}
    // Chain frames are DERIVATION, not reference (owner correction, Aug 9):
    // "frame-of-s2.jpg" is the previous scene's closing image, so it keeps
    // its own node and its own wire — folding it into the reference stack
    // hid exactly the continuity the chain exists to show. Detected by the
    // names the chat gives them at commit time.
    const isChainFrame = (name: string) => /^(chain-frame|frame-of-)/.test(name || '')

    // All distinct TRUE reference uploads on this board, first-seen order.
    const uniq = new Map<string, InputAttachment>()
    for (const atts of Object.values(inputs)) {
      for (const a of atts) {
        if (!isChainFrame(a.fileName) && !uniq.has(a.storagePath)) uniq.set(a.storagePath, a)
      }
    }
    const grouped = uniq.size > 1
    const groupId = 'refs::group'
    if (grouped) {
      // Several references collapse into ONE stacked block (owner, Aug 9) —
      // a board with five refs was more wires than picture. Click opens the
      // gallery; any generation that consumed ANY of them wires to the stack.
      const all = [...uniq.values()]
      inputNodes.push({
        id: groupId, thumb: all[0]?.url ?? null, isVideo: false,
        parentId: null, parentIds: [],
        label: `${all.length} references`, kind: 'input',
        stack: all.map(a => ({
          url: a.url ?? null, fileName: a.fileName, mediaType: a.mediaType,
        })),
      })
    }
    for (const [rowId, atts] of Object.entries(inputs)) {
      inputIdsByRow[rowId] = []
      for (const a of atts) {
        // Chain frames never become nodes at all (owner, Aug 9: "where is
        // this image from? why two?"). They are transport — the previous
        // scene's last frame riding to the next generation — and the
        // scene→scene row edge already draws that derivation directly.
        // A block for the carrier file is noise with a mystery name.
        if (isChainFrame(a.fileName)) continue
        if (grouped) {
          // one wire to the stack per row, however many refs it consumed
          if (!inputIdsByRow[rowId].includes(groupId)) inputIdsByRow[rowId].push(groupId)
          continue
        }
        const id = `att::${a.storagePath}`
        inputIdsByRow[rowId].push(id)
        if (inputNodes.some(n => n.id === id)) continue
        inputNodes.push({
          id, thumb: a.url ?? null, isVideo: (a.mediaType || '').startsWith('video/'),
          parentId: null, parentIds: [], label: a.fileName,
          kind: 'input', attach: a,
        })
      }
    }
    const outputNodes: CanvasNode[] = chain.map(n => {
      const parents = [
        ...((n.parentRowIds ?? []) as string[]).map((p: string) => primary[p]).filter(Boolean),
        ...(inputIdsByRow[n.rowId] ?? []),
      ]
      // The ⓘ panel lists the EXACT files this run consumed (owner, Aug 9)
      // — chain frames included: they are hidden from the board as nodes,
      // but "what generated this" must name them.
      // Full generation-input descriptors (bucket/path/size ride along):
      // the ⓘ panel views them, and the regen reference picker re-uses a
      // chosen subset as the re-run's attachments without another upload.
      const sources = (inputs[n.rowId] ?? []).map(a => ({
        url: a.url ?? null, fileName: a.fileName, mediaType: a.mediaType,
        bucket: a.bucket, storagePath: a.storagePath, fileSize: a.fileSize ?? 0,
      }))
      return {
        ...n, thumb: outUrls[n.id] ?? n.thumb, parentId: parents[0] ?? null, parentIds: parents,
        ...(sources.length > 0 ? { sources } : {}),
      }
    })
    return [...inputNodes, ...outputNodes]
  }, [chain, inputs, outUrls])

  return { nodes, loading, refresh }
}
