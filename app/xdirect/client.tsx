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
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useBoardNodes } from '../../lib/board-nodes'
import XDirectorChat, { type SceneRunnerHandle } from '../components/XDirectorChat'
import SceneStrip, { type Scene } from '../components/SceneStrip'
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
  const { nodes, refresh } = useBoardNodes(boardId)
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
        if (cand) {
          claimed.add(cand.rowId)
          return { ...s, status: 'done' as const, url: cand.thumb, row_id: cand.rowId, ...(typeof cand.cost === 'number' ? { cost: cand.cost } : {}) }
        }
        return { ...s, status: 'draft' as const }
      }
      return s
    })
    if (changed) setStoryboard(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, chatBusy])
  const onBusy = useCallback((b: boolean) => setChatBusy(b), [])

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena" style={{ maxWidth: 1560 }}>
        <Link href="/xdirect" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xdirector.eyebrow')}</Link>
        <h1 className="page-headline" style={{ marginBottom: 24 }}>{t('xdirector.title')}</h1>

        <div className="xdirect-split">
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
            />
          </div>

          {/* Stage — storyboard lane (sequence) over the canvas (lineage). */}
          <div className="xdirect-stage">
            <SceneStrip
              scenes={storyboard}
              busy={chatBusy}
              onChange={setStoryboard}
              onGenerate={(id) => {
                const i = storyboard.findIndex(s => s.id === id)
                runnerRef.current?.generateScene(id, `${t('xd.sb.scene')} ${i + 1}: ${storyboard[i]?.title ?? id}`)
              }}
              onGenerateAll={() => {
                const ids = storyboard.filter(s => !s.status || s.status === 'draft' || s.status === 'error').map(s => s.id)
                runnerRef.current?.generateAll(ids)
              }}
              onPreview={(url, isVideo) => setHero({ url, isVideo })}
            />
            {nodes.length > 0 ? (
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
                nodes={nodes}
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
                onPlay={(n: CanvasNode) => { if (n.thumb) setHero({ url: n.thumb, isVideo: n.isVideo }) }}
                nodeOrigin={(n: CanvasNode) => {
                  if (!n.rowId) return null
                  let sc = 0, cut = 0
                  for (const s of storyboard) {
                    if (s.continues && sc > 0) cut += 1
                    else { sc += 1; cut = 1 }
                    if (s.row_id === n.rowId) return `S${sc}·C${cut} · ${s.title}`
                  }
                  return null
                }}
                sceneOf={(n: CanvasNode) => (n.rowId && storyboard.find(s => s.row_id === n.rowId)) || null}
                onRerun={(n, m, o) => {
                  if (!runnerRef.current) { console.warn('[xdirect] rerun: runner not ready'); return }
                  runnerRef.current.rerunNode(n as any, m, o)
                }}
              />
              </div>
            ) : storyboard.length === 0 ? (
              <div className="xdirect-empty">
                <div style={{ fontSize: 26, marginBottom: 10 }} aria-hidden>⬚</div>
                {t('xdirect.empty')}
              </div>
            ) : null}
          </div>
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
