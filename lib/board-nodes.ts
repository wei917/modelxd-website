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
        const { data: rows, error } = await sb.from('xcreates')
          .select('id, slots, created_at, parent_id, parent_ids, board_id, node_kind')
          .eq('board_id', boardId).is('deleted_at', null)
          .order('created_at', { ascending: true })
        if (cancelled) return
        if (error || !rows || rows.length === 0) { setChain([]); setInputs({}); setOutUrls({}); return }

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
            })
          }
        }
        setChain(flat)

        // Uploaded references + freshly re-signed output URLs (stored ones
        // carry a 24h TTL).
        try {
          const ir = await fetch('/api/xcreate/inputs', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: (rows as any[]).map(r => r.id) }),
          })
          if (ir.ok) {
            const d = await ir.json()
            if (!cancelled) {
              setInputs(d?.inputs ?? {})
              setOutUrls(d?.outputs ?? {})
            }
          }
        } catch { /* board still works without input nodes */ }
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
    const seen = new Set<string>()
    for (const [rowId, atts] of Object.entries(inputs)) {
      inputIdsByRow[rowId] = []
      for (const a of atts) {
        const id = `att::${a.storagePath}`
        inputIdsByRow[rowId].push(id)
        if (seen.has(id)) continue
        seen.add(id)
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
      return { ...n, thumb: outUrls[n.id] ?? n.thumb, parentId: parents[0] ?? null, parentIds: parents }
    })
    return [...inputNodes, ...outputNodes]
  }, [chain, inputs, outUrls])

  return { nodes, loading, refresh }
}
