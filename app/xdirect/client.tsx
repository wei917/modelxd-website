'use client'
// app/xdirect/client.tsx
// XDirect — Phase 1 of the film surface (CC, Aug 5): the director chat and
// the canvas board side by side for the first time. The board id IS the
// conversation id, so the two panes are two views of one thing — the chat
// tells the story, the canvas shows the work.
//
// The canvas here is a live view with selection + preview, NOT yet the full
// editor XCreate has (no delete, no compose-from-selection toolbar). Those
// arrive with the storyboard lane in Phase 2 — shipping a second toolbar
// now would mean building the same actions twice, once per page, a week
// before the interaction model changes under them.

import { useCallback, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useBoardNodes } from '../../lib/board-nodes'
import XDirectorChat from '../components/XDirectorChat'
import WorkflowCanvas, { type CanvasNode } from '../components/WorkflowCanvas'

export default function XDirectClient() {
  useRequireAuth()
  const t = useT()

  const [boardId, setBoardId] = useState<string | null>(null)
  const { nodes, refresh } = useBoardNodes(boardId)
  const [sel, setSel] = useState<string[]>([])
  const [hero, setHero] = useState<{ url: string; isVideo: boolean } | null>(null)

  // The chat's callbacks are module-stable so its effects, which run once,
  // never see a stale closure.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const onConversationId = useCallback((id: string) => setBoardId(id), [])
  const onActivity = useCallback(() => refreshRef.current(), [])

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena" style={{ maxWidth: 1560 }}>
        <div className="prompt-label eyebrow">{t('xdirector.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 24 }}>{t('xdirector.title')}</h1>

        <div className="xdirect-split">
          {/* Chat rail — the director. Provides its own subtitle/intro. */}
          <div className="xdirect-chat">
            <XDirectorChat onConversationId={onConversationId} onActivity={onActivity} />
          </div>

          {/* Stage — the board this conversation is building. */}
          <div className="xdirect-stage">
            {nodes.length > 0 ? (
              <WorkflowCanvas
                nodes={nodes}
                selectedIds={sel}
                height={640}
                onSelect={(n: CanvasNode, additive: boolean) => {
                  setSel(prev => additive
                    ? (prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id])
                    : [n.id])
                  if (!additive && n.thumb) setHero({ url: n.thumb, isVideo: n.isVideo })
                }}
                onClearSelection={() => setSel([])}
              />
            ) : (
              <div className="xdirect-empty">
                <div style={{ fontSize: 26, marginBottom: 10 }} aria-hidden>⬚</div>
                {t('xdirect.empty')}
              </div>
            )}
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
