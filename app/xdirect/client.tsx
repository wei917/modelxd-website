'use client'
// app/xdirect/client.tsx
// XDirect — the film surface: director chat beside the stage. The board id
// IS the conversation id, so the panes are views of one thing — the chat
// tells the story, the stage shows the work.
//
// Phase 2 (CC, Aug 6): the stage grew its second lane. Every VIDEO request
// now lands as a STORYBOARD — scene cards the user edits in place — above
// the canvas, which keeps showing derivation (what was made from what).
// Sequence on the strip, lineage on the canvas: two grammars, one stage.
// The storyboard state lives HERE and flows down to both the chat (which
// sends it to the director and persists it) and the strip (which edits it).

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useBoardNodes } from '../../lib/board-nodes'
import XDirectorChat, { type SceneRunnerHandle } from '../components/XDirectorChat'
import SceneStrip, { sceneLabels, type Scene } from '../components/SceneStrip'
import WorkflowCanvas, { type CanvasNode } from '../components/WorkflowCanvas'

// useSearchParams needs a Suspense boundary (same pattern as XCreate), and
// the ?c= param KEYS the whole body: a different conversation is a different
// chat instance, so switching via the nav history remounts everything —
// chat, storyboard, board — instead of leaking the previous conversation's
// state into the next. The chat's own restore effect is mount-only by
// design; the key is what makes that correct. (CC, Aug 6)
export default function XDirectClient() {
  return (
    <Suspense fallback={null}>
      <XDirectKeyed />
    </Suspense>
  )
}

function XDirectKeyed() {
  const c = useSearchParams()?.get('c') ?? null
  // The chat MINTS its conversation id mid-send and writes it to the URL
  // with history.replaceState — which Next's router syncs into
  // useSearchParams. If that id changed the key, the first message of every
  // new conversation would remount (and wipe) the chat that was busy
  // sending it. A minted id keeps the mount's original key; only navigating
  // to a DIFFERENT conversation remounts. (CC, Aug 6 — found because it
  // shipped without this and new conversations self-destructed on send.)
  const minted = useRef<string | null>(null)
  if (c && minted.current && c !== minted.current) minted.current = null
  const key = c && c === minted.current ? 'new' : (c ?? 'new')
  return <XDirectBody key={key} onMinted={(id) => { minted.current = id }} />
}

function XDirectBody({ onMinted }: { onMinted?: (id: string) => void }) {
  useRequireAuth()
  const t = useT()

  const [boardId, setBoardId] = useState<string | null>(null)
  const { nodes, loading: boardLoading, refresh } = useBoardNodes(boardId)
  const [sel, setSel] = useState<string[]>([])
  const [hero, setHero] = useState<{ url: string; isVideo: boolean } | null>(null)
  const [storyboard, setStoryboard] = useState<Scene[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const runnerRef = useRef<SceneRunnerHandle | null>(null)

  // The chat's callbacks are module-stable so its effects, which run once,
  // never see a stale closure.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const onConversationId = useCallback((id: string) => setBoardId(id), [])
  const onActivity = useCallback(() => refreshRef.current(), [])
  const onStoryboard = useCallback((scenes: any[]) => setStoryboard(scenes as Scene[]), [])
  // The film's original brief (first user message) — the canvas's Prompt
  // input node and its title both derive from it (owner, Aug 9).
  const [brief, setBrief] = useState<string | null>(null)
  const onBrief = useCallback((text: string) => setBrief(text), [])
  // A cut owns every row it has ever produced — active take plus recorded
  // alternates. Matching on row identity (not prompt text) is what keeps a
  // re-run attached to its scene after the director rewrites the shot
  // (owner bug, Aug 11: a regenerated S1·C1 belonged to no scene).
  const rowsOfScene = useCallback((s: any): string[] =>
    [...new Set([
      ...(Array.isArray(s?.takes) ? s.takes : []),
      ...(s?.row_id ? [s.row_id] : []),
      ...(s?.still_row_id ? [s.still_row_id] : []),   // KEYFRAME mode's key still
    ])], [])
  const sceneForRow = useCallback((rowId?: string | null) =>
    (rowId ? storyboard.find(s => rowsOfScene(s).includes(rowId)) : undefined) ?? null, [storyboard, rowsOfScene])

  const canvasNodes = useMemo<CanvasNode[]>(() => {
    if (!brief || nodes.length === 0) return nodes
    const briefNode: CanvasNode = {
      id: 'brief::input', thumb: null, isVideo: false, parentId: null, parentIds: [],
      // prompt carries the full text so the ⓘ panel shows it, copyable.
      label: 'Prompt', kind: 'input', brief, prompt: brief,
    }
    // Every generated row descends from the brief — the director wrote all
    // of their prompts from it. The refs stack keeps its own wires.
    return [briefNode, ...nodes.map(n => n.rowId
      ? { ...n, parentIds: [...(n.parentIds ?? []), 'brief::input'] }
      : n)]
  }, [nodes, brief])
  const boardTitle = useMemo(() => {
    if (!brief) return null
    const line = brief.replace(/\s+/g, ' ').trim()
    return line.length > 80 ? line.slice(0, 80) + '…' : line
  }, [brief])

  // Scene URLs are signed for ~24h at generation time; the board loader
  // re-signs every output URL on load. Ride that: whenever fresh nodes
  // arrive, point each done scene at its row's fresh URL so preview,
  // download and frame-chaining keep working on old conversations. One-way,
  // change-detected — no render loop.
  useEffect(() => {
    if (storyboard.length === 0 || nodes.length === 0) return
    let changed = false
    const claimed = new Set(storyboard.map(s => s.row_id).filter(Boolean))
    const next = storyboard.map(s => {
      if (s.status === 'done' && s.row_id) {
        const n: any = nodes.find((n: any) => n.rowId === s.row_id && n.thumb)
        if (n?.thumb && n.thumb !== s.url) { changed = true; return { ...s, url: n.thumb } }
        return s
      }
      // Heal a stuck card (owner board, Aug 9: "it gets stuck, no video
      // showing up"). 'generating' cannot survive a reload — the poll dies
      // with the page — but the card only learns its row id at completion,
      // so it could never find the output that DID finish. While the chat
      // is idle a generating card is stale by definition: claim the newest
      // unclaimed finished video row (that run is this card's output), or
      // return to draft so ▶ works again.
      if (s.status === 'generating' && !chatBusy) {
        changed = true
        const cand: any = nodes
          .filter((n: any) => n.rowId && !claimed.has(n.rowId) && n.thumb && n.isVideo)
          .sort((a: any, b: any) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
        // A scene that ALREADY has a finished take keeps it (owner bug,
        // Aug 9: a reload mid-rerun demoted a done scene to a blank draft
        // card — the fallback threw away a clip the user had paid for).
        // Claiming a newer row is only for a card whose own run vanished.
        if (s.row_id && s.url) return { ...s, status: 'done' as const }
        if (cand) {
          claimed.add(cand.rowId)
          // The claimed node's label is its model name — without it the
          // card kept saying the OLD model under the NEW clip.
          return { ...s, status: 'done' as const, url: cand.thumb, row_id: cand.rowId, ...(cand.label ? { model_name: cand.label } : {}), ...(typeof cand.cost === 'number' ? { cost: cand.cost } : {}) }
        }
        return { ...s, status: 'draft' as const }
      }
      return s
    })
    if (changed) setStoryboard(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, chatBusy])
  const onBusy = useCallback((b: boolean) => setChatBusy(b), [])
  // "Started" = a conversation exists: id minted on first send, restored
  // from ?c=, or anything already on the board. Drives the landing layout.
  const started = !!boardId || storyboard.length > 0 || nodes.length > 0

  // Delete (owner bug, Aug 9: "delete doesn't work in canvas") — /xdirect
  // never wired the canvas's onDelete, so the button no-opped silently.
  // Same row-granular soft delete XCreate uses; a scene whose ACTIVE take
  // was deleted reverts to an honest draft (other takes stay promotable).
  // Deleting shows the loading screen until the refreshed board is back
  // (owner, Aug 9) — never the stale canvas with the dead node still on it.
  const [wiping, setWiping] = useState(false)
  const wipeSawLoad = useRef(false)
  const deleteNodes = useCallback(async (picked: CanvasNode[]) => {
    const rowIds = [...new Set(picked.filter(n => !!n.rowId).map(n => n.rowId as string))]
    if (rowIds.length === 0) return
    setSel([])
    setWiping(true)
    try {
      const res = await fetch('/api/xcreate/node', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: rowIds }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      console.info('[xdirect:canvas] deleted rows', rowIds)
    } catch (err) {
      console.warn('[xdirect:canvas] delete failed:', err)
    }
    setStoryboard(prev => prev.map(s => s.row_id && rowIds.includes(s.row_id)
      ? { ...s, status: 'draft' as const, row_id: undefined, url: undefined, cost: undefined }
      : s))
    refreshRef.current()
  }, [])
  // The wipe ends when the refresh has gone through a full loading cycle —
  // watching for the TRUE→FALSE edge, not just "not loading", because the
  // refetch starts a beat after the delete.
  useEffect(() => {
    if (!wiping) return
    if (boardLoading) { wipeSawLoad.current = true; return }
    if (wipeSawLoad.current) { wipeSawLoad.current = false; setWiping(false) }
  }, [boardLoading, wiping])

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena" style={{ maxWidth: 1560 }}>
        <Link href="/xdirect" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xdirector.eyebrow')}</Link>
        <h1 className="page-headline" style={{ marginBottom: 24 }}>{t('xdirector.title')}</h1>

        {/* Before the first turn the stage is empty noise — hide it and let
            the director + templates be the whole landing (owner, Aug 10).
            The stage appears the moment a conversation exists (id minted on
            send, or restored from ?c=) or anything lands on the board. */}
        <div className={started ? 'xdirect-split' : 'xdirect-split is-landing'}>
          {/* Chat rail — the director. Provides its own subtitle/intro. */}
          <div className="xdirect-chat">
            <XDirectorChat
              onConversationId={onConversationId}
              onMintedConversation={onMinted}
              onActivity={onActivity}
              storyboard={storyboard}
              onStoryboard={onStoryboard}
              runnerRef={runnerRef}
              onBusy={onBusy}
              boardNodes={nodes}
              onBrief={onBrief}
            />
          </div>

          {/* Stage — storyboard lane (sequence) over the canvas (lineage).
              Hidden until a conversation exists (owner, Aug 10). */}
          {started && (
          <div className="xdirect-stage">
            <SceneStrip
              scenes={storyboard}
              busy={chatBusy}
              onChange={setStoryboard}
              onGenerate={(id, kind) => {
                const i = storyboard.findIndex(s => s.id === id)
                runnerRef.current?.generateScene(id, `${sceneLabels(storyboard)[i] ?? `${t('xd.sb.scene')} ${i + 1}`} · ${storyboard[i]?.title ?? id}`, kind)
              }}
              onStop={() => runnerRef.current?.stopGeneration()}
              onGenerateAll={(kind) => {
                // Stills run covers the shelf too (assets ARE stills);
                // the video run never touches assets — they have no clip.
                const ids = storyboard
                  .filter(s => !s.status || s.status === 'draft' || s.status === 'error')
                  .filter(s => kind === 'still' ? true : !s.asset)
                  .map(s => s.id)
                runnerRef.current?.generateAll(ids, kind)
              }}
              onPreview={(url, isVideo) => setHero({ url, isVideo })}
            />
            {!wiping && nodes.length > 0 ? (
              // The stage flows on the page now (owner, Aug 9), so the
              // canvas owns its height: one viewport's worth, whatever the
              // strip above it takes — the page just gets taller.
              <div style={{ height: 'calc(100vh - 140px)', minHeight: 500, display: 'flex', flexDirection: 'column' }}>
              {/* The stage's two lanes carry their names (owner, Aug 9):
                  XStoryboard above, XCanvas below — same red eyebrow. */}
              <div style={{ padding: '10px 2px 7px' }}>
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
                  textTransform: 'uppercase', color: 'var(--red)', fontWeight: 700,
                }}>{t('xd.canvas.title')}</span>
              </div>
              <WorkflowCanvas
                nodes={canvasNodes}
                title={boardTitle}
                selectedIds={sel}
                height="calc(100% - 50px)"
                busy={chatBusy}
                onSelect={(n: CanvasNode, additive: boolean) => {
                  // Click only FOCUSES (owner, Aug 9) — playing is the ▶ on
                  // the card or in the ⓘ panel, never a side effect.
                  setSel(prev => additive
                    ? (prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id])
                    : [n.id])
                }}
                onClearSelection={() => setSel([])}
                onDelete={deleteNodes}
                onPlay={(n: CanvasNode) => { if (n.thumb) setHero({ url: n.thumb, isVideo: n.isVideo }) }}
                nodeOrigin={(n: CanvasNode) => {
                  if (!n.rowId) return null
                  let sc = 0, cut = 0
                  for (const s of storyboard) {
                    if (s.continues && sc > 0) cut += 1
                    else { sc += 1; cut = 1 }
                    if (rowsOfScene(s).includes(n.rowId)) return `S${sc}·C${cut} · ${s.title}`
                  }
                  return null
                }}
                sceneOf={(n: CanvasNode) => sceneForRow(n.rowId)}
                onUseTake={(n: CanvasNode, scene: any) => {
                  // The user picked which take the film keeps — the card's
                  // clip, model and cost switch to this node. Persisted by
                  // the chat's storyboard save debounce.
                  setStoryboard(prev => prev.map(s => s.id === scene.id
                    ? {
                        ...s, status: 'done' as const, row_id: n.rowId, url: n.thumb ?? s.url,
                        ...(n.label ? { model_name: n.label } : {}),
                        ...(typeof n.cost === 'number' ? { cost: n.cost } : {}),
                      }
                    : s))
                  // And say so in the transcript (owner, Aug 9): a take
                  // switch is a user edit the director should see on the
                  // record, without burning a turn.
                  let sc = 0, cut = 0, tag = scene.id
                  for (const s of storyboard) {
                    if (s.continues && sc > 0) cut += 1
                    else { sc += 1; cut = 1 }
                    if (s.id === scene.id) { tag = `S${sc}·C${cut}`; break }
                  }
                  runnerRef.current?.noteTake(scene.id, tag, n.label ?? 'the selected model')
                }}
                sceneSlot={(n: CanvasNode) => {
                  if (!n.rowId) return null
                  let sc = 0, cut = 0
                  for (const s of storyboard) {
                    if (s.continues && sc > 0) cut += 1
                    else { sc += 1; cut = 1 }
                    if (rowsOfScene(s).includes(n.rowId)) return { scene: sc, cut }
                  }
                  return null
                }}
                onRerun={(n, m, o) => {
                  if (!runnerRef.current) { console.warn('[xdirect] rerun: runner not ready'); return }
                  runnerRef.current.rerunNode(n as any, m, o)
                }}
              />
              </div>
            ) : wiping || boardLoading ? (
              // The board is coming (owner ask, Aug 9): a canvas-shaped
              // loading screen — same dark dotted surface — instead of a
              // blank gap that suddenly becomes a board.
              <div style={{
                flex: 1, minHeight: 500, borderRadius: 12, border: '1px solid var(--border2)',
                background: '#141518',
                backgroundImage: 'radial-gradient(circle, #2a2c31 1px, transparent 1px)',
                backgroundSize: '22px 22px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
              }}>
                <span className="nav-history-spin" style={{ width: 22, height: 22, borderWidth: 2 }} aria-hidden />
                <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6a6c73' }}>
                  {t('wf.loading')}
                </span>
              </div>
            ) : storyboard.length === 0 ? (
              <div className="xdirect-empty">
                <div style={{ fontSize: 26, marginBottom: 10 }} aria-hidden>⬚</div>
                {t('xdirect.empty')}
              </div>
            ) : null}
          </div>
          )}
        </div>
      </div>

      {/* Node preview — plain click on a node opens its full output. */}
      {hero && (() => {
        // Supabase storage turns ?download=<name> into a Content-Disposition
        // attachment, which is the only reliable cross-origin download —
        // the <a download> attribute is ignored for cross-origin URLs and
        // Chrome's built-in video-control download is flaky on signed URLs.
        const dlName = (() => {
          try { return new URL(hero.url).pathname.split('/').pop() || '' } catch { return '' }
        })() || (hero.isVideo ? 'modelxd-video.mp4' : 'modelxd-image.png')
        const dlHref = (() => {
          try { const u = new URL(hero.url); u.searchParams.set('download', dlName); return u.toString() } catch { return hero.url }
        })()
        return (
        <div
          onClick={() => setHero(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 99000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          {/* Control bar — above the media, click-through-proof. */}
          <div style={{ position: 'absolute', top: 16, right: 18, display: 'flex', gap: 10, zIndex: 1 }} onClick={e => e.stopPropagation()}>
            <a
              href={dlHref} download={dlName}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px',
                borderRadius: 999, background: 'rgba(255,255,255,0.14)', color: '#fff',
                textDecoration: 'none', fontSize: 13, fontWeight: 700,
                border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(6px)',
              }}
            >⬇ {t('xd.download')}</a>
            <button
              onClick={() => setHero(null)} aria-label="close"
              style={{
                padding: '8px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.14)',
                color: '#fff', border: '1px solid rgba(255,255,255,0.25)', fontSize: 13,
                cursor: 'pointer', backdropFilter: 'blur(6px)',
              }}
            >✕</button>
          </div>
          {hero.isVideo ? (
            <video src={hero.url} controls autoPlay loop style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
          ) : (
            <img src={hero.url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 0 80px rgba(0,0,0,0.8)' }} />
          )}
        </div>
        )
      })()}
    </div>
  )
}
