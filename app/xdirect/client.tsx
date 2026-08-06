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

import { Suspense, useCallback, useRef, useState } from 'react'
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
  const conv = useSearchParams()?.get('c') ?? 'new'
  return <XDirectBody key={conv} />
}

function XDirectBody() {
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
  const onBusy = useCallback((b: boolean) => setChatBusy(b), [])

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena" style={{ maxWidth: 1560 }}>
        <div className="prompt-label eyebrow">{t('xdirector.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 24 }}>{t('xdirector.title')}</h1>

        <div className="xdirect-split">
          {/* Chat rail — the director. Provides its own subtitle/intro. */}
          <div className="xdirect-chat">
            <XDirectorChat
              onConversationId={onConversationId}
              onActivity={onActivity}
              storyboard={storyboard}
              onStoryboard={onStoryboard}
              runnerRef={runnerRef}
              onBusy={onBusy}
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
              <WorkflowCanvas
                nodes={nodes}
                selectedIds={sel}
                height={storyboard.length > 0 ? 430 : 640}
                onSelect={(n: CanvasNode, additive: boolean) => {
                  setSel(prev => additive
                    ? (prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id])
                    : [n.id])
                  if (!additive && n.thumb) setHero({ url: n.thumb, isVideo: n.isVideo })
                }}
                onClearSelection={() => setSel([])}
              />
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
      {hero && (
        <div
          onClick={() => setHero(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 99000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          {hero.isVideo ? (
            <video src={hero.url} controls autoPlay loop style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
          ) : (
            <img src={hero.url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 0 80px rgba(0,0,0,0.8)' }} />
          )}
        </div>
      )}
    </div>
  )
}
