'use client'
// app/xcreate/StudioHistory.tsx: your latest runs of one type, under the
// composer on the X創作 door (owner, Oct 1: "we need history in both tool
// page and profile page. check how XTell is doing"). Shaped like XTell's
// TempleHistory: up to five rows of title and time with Continue, rename
// and delete, and nothing at all when signed out or empty. The account
// page's Library holds the rest ("See all").
//
// Studio runs only, i.e. rows without a node_kind: XDirect board nodes,
// upload "Source:" rows and XCut renders carry one and stay in the Library.
// A film is a video row whose first slot names it, so Video leaves films
// out and Film keeps only them. Delete is soft (deleted_at), like www's
// Recent list; every reader filters it.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { useLang } from '@/lib/i18n'
import { xcreateStudioCopy } from './standalone-copy'
import type { StudioType } from '../components/xcreate/studio-type'

type Row = { id: string; prompt: string | null; title: string | null; created_at: string }

const SHOW = 5
const TITLE_MAX = 80

export default function StudioHistory({ type, userId }: { type: StudioType; userId: string }) {
  const { lang } = useLang()
  const copy = xcreateStudioCopy(lang)
  const [rows, setRows] = useState<Row[]>([])
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<{ id: string; what: 'rename' | 'delete' } | null>(null)

  useEffect(() => {
    let dead = false
    let q = createSupabaseBrowser().from('xcreates')
      .select('id, prompt, title, created_at')
      .eq('user_id', userId).is('deleted_at', null).is('node_kind', null)
      .eq('mode', type === 'film' ? 'video' : type)
    if (type === 'film') q = q.not('slots->0->options->>film', 'is', null)
    if (type === 'video') q = q.is('slots->0->options->>film', null)
    q.order('created_at', { ascending: false }).limit(SHOW)
      .then(({ data, error }) => { if (!dead) setRows(error ? [] : (data ?? []) as Row[]) })
    return () => { dead = true }
  }, [type, userId, reload])

  // A different type is a different list: drop any open editor or prompt.
  useEffect(() => { setEditing(null); setConfirming(null); setFailed(null) }, [type])

  if (rows.length === 0) return null

  const when = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(lang, {
      ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
  }

  const rename = async (id: string) => {
    if (busy) return
    setBusy(true); setFailed(null)
    const clean = draft.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
    // .select() so an update that RLS quietly matched to nothing counts as a failure.
    const { data, error } = await createSupabaseBrowser().from('xcreates')
      .update({ title: clean || null }).eq('id', id).select('id')
    setBusy(false)
    if (error || !data?.length) { setFailed({ id, what: 'rename' }); return }
    setRows(rs => rs.map(r => r.id === id ? { ...r, title: clean || null } : r))
    setEditing(null)
  }

  const remove = async (id: string) => {
    if (busy) return
    setBusy(true); setFailed(null)
    const { data, error } = await createSupabaseBrowser().from('xcreates')
      .update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id')
    setBusy(false)
    if (error || !data?.length) { setFailed({ id, what: 'delete' }); return }
    setConfirming(null)
    setRows(rs => rs.filter(r => r.id !== id))
    setReload(n => n + 1)   // the next one moves up into the five
  }

  return (
    <section className="xcs-history" aria-label={copy.history}>
      <div className="xcs-history-head">
        <h2>{copy.history}</h2>
        <Link href="/profile">{copy.seeAll}</Link>
      </div>
      <ul>
        {rows.map(r => {
          const title = r.title || r.prompt || copy.untitled
          return (
            <li key={r.id}>
              {editing === r.id ? (
                <form className="xcs-history-rename" onSubmit={e => { e.preventDefault(); void rename(r.id) }}>
                  <input value={draft} maxLength={TITLE_MAX * 2} autoFocus disabled={busy} aria-label={copy.rename}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setEditing(null) } }} />
                  <button type="submit" className="xcs-primary" disabled={busy}>{copy.renameSave}</button>
                  <button type="button" className="xcs-secondary" disabled={busy} onClick={() => setEditing(null)}>{copy.renameCancel}</button>
                </form>
              ) : (
                <div className="xcs-history-row">
                  <div className="xcs-history-text">
                    <span className="xcs-history-title" title={title}>{title}</span>
                    <time dateTime={r.created_at}>{when(r.created_at)}</time>
                  </div>
                  <div className="xcs-history-actions">
                    {confirming === r.id ? (
                      <>
                        <span>{copy.deleteConfirm}</span>
                        <button type="button" className="xcs-history-danger" disabled={busy} onClick={() => void remove(r.id)}>{copy.delete}</button>
                        <button type="button" disabled={busy} onClick={() => setConfirming(null)}>{copy.renameCancel}</button>
                      </>
                    ) : (
                      <>
                        <Link href={`/?id=${encodeURIComponent(r.id)}`} className="xcs-history-open">{copy.continue}</Link>
                        <button type="button" onClick={() => { setEditing(r.id); setDraft(r.title || r.prompt || ''); setConfirming(null); setFailed(null) }}>{copy.rename}</button>
                        <button type="button" onClick={() => { setConfirming(r.id); setEditing(null); setFailed(null) }}>{copy.delete}</button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {failed?.id === r.id && <p role="alert" className="xcs-history-error">{failed.what === 'rename' ? copy.renameFailed : copy.deleteFailed}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
