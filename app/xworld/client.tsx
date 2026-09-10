'use client'
// app/xworld/client.tsx — the XWorld studio: make a 3D world (World Labs
// Marble) or a 3D object from a photo (Tripo), watch it build, walk it.
//
// Both jobs are async on the provider side (a world takes ~5 min), so the
// page is a composer + a gallery of rows that poll themselves; leaving the
// page loses nothing — the row and its billing live server-side.

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { pendingAttachment, commitAttachments, type Attachment } from '../components/AttachmentButton'
import {
  WORLD_MODELS, DEFAULT_WORLD_MODEL, OBJECT_MODELS, DEFAULT_OBJECT_MODEL, worldPriceLabel, type WorldInput,
} from '../../lib/xworld-models'

const WorldViewer = dynamic(() => import('../components/WorldViewer'), { ssr: false })
const ObjectViewer = dynamic(() => import('../components/ObjectViewer'), { ssr: false })

type Item = {
  id: string; kind: 'world' | 'object'; model: string; prompt: string | null
  status: 'pending' | 'done' | 'failed'; progress: number | null; caption?: string | null
  thumbnail_url: string | null; billed_cents: number; error: string | null; created_at: string
  world?: { spz: Record<string, string> | null; pano_url: string | null; collider_url: string | null } | null
  object?: { glb_url: string } | null
}

const INPUTS: WorldInput[] = ['text', 'image', 'multi-image', 'video']
const MAX_IMAGES = 4

export default function XWorldClient() {
  const t = useT()
  const router = useRouter()
  const params = useSearchParams()
  useRequireAuth()
  const openId = params.get('w')

  const [tab, setTab] = useState<'world' | 'object'>('world')
  const [input, setInput] = useState<WorldInput>('text')
  const [model, setModel] = useState(DEFAULT_WORLD_MODEL)
  const [objModel, setObjModel] = useState(DEFAULT_OBJECT_MODEL)
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [open, setOpen] = useState<Item | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/xworld')
    const d = await res.json().catch(() => null)
    if (!res.ok) { setError(d?.error ?? `HTTP ${res.status}`); setItems([]); return }
    setItems(d.items ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  // Pending rows poll themselves. Hidden tabs don't (Supabase auth lock —
  // Common Pitfall #9); the next visible tick catches up.
  const pendingIds = (items ?? []).filter(i => i.status === 'pending').map(i => i.id).join(',')
  useEffect(() => {
    if (!pendingIds) return
    const tick = async () => {
      if (document.hidden) return
      for (const id of pendingIds.split(',')) {
        const res = await fetch(`/api/xworld/${id}`)
        const d = await res.json().catch(() => null)
        if (res.ok && d?.item) setItems(prev => (prev ?? []).map(i => i.id === id ? { ...i, ...d.item } : i))
      }
    }
    const h = setInterval(tick, 6000)
    return () => clearInterval(h)
  }, [pendingIds])

  // ?w=<id> → the viewer.
  useEffect(() => {
    if (!openId) { setOpen(null); return }
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/xworld/${openId}`)
      const d = await res.json().catch(() => null)
      if (!cancelled) setOpen(res.ok ? d.item : null)
    })()
    return () => { cancelled = true }
  }, [openId, items])

  const needsFiles = tab === 'object' ? 'image' : input === 'text' ? null : input === 'video' ? 'video' : 'image'
  const maxFiles = tab === 'object' || input === 'image' || input === 'video' ? 1 : MAX_IMAGES
  const accept = needsFiles === 'video' ? 'video/mp4,video/quicktime' : 'image/jpeg,image/png,image/webp'

  const pick = (list: FileList | null) => {
    if (!list) return
    const picked = Array.from(list).map(f => pendingAttachment(f, 'xcreate'))
    setFiles(prev => (maxFiles === 1 ? picked.slice(0, 1) : [...prev, ...picked].slice(0, maxFiles)))
    if (fileRef.current) fileRef.current.value = ''
  }
  const switchTo = (next: { tab?: 'world' | 'object'; input?: WorldInput }) => {
    if (next.tab) setTab(next.tab)
    if (next.input) setInput(next.input)
    setFiles([]); setError(null)
  }

  const price = tab === 'object'
    ? `$${(OBJECT_MODELS[objModel].cents / 100).toFixed(2)}`
    : worldPriceLabel(model, input)

  const ready = tab === 'object'
    ? files.length === 1
    : input === 'text' ? prompt.trim().length > 0
    : input === 'multi-image' ? files.length >= 2
    : files.length === 1

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      const committed = await commitAttachments(files)
      const res = await fetch('/api/xworld', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: tab, input, model: tab === 'object' ? objModel : model, prompt,
          attachments: committed.map(a => ({ bucket: a.bucket, storagePath: a.storagePath, mediaType: a.mediaType })),
        }),
      })
      const d = await res.json().catch(() => null)
      if (res.status === 402) throw new Error(t('xworld.nocredits'))
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setPrompt(''); setFiles([])
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed')
    } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    await fetch(`/api/xworld/${id}`, { method: 'DELETE' })
    router.push('/xworld')
    load()
  }

  const mono: React.CSSProperties = { fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--muted)' }
  const chip = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--red)' : 'var(--border2)'}`,
    background: active ? 'var(--red-dim, var(--surface2))' : 'var(--surface)', color: 'var(--white)',
  })
  const modelLabel = (it: Item) => it.kind === 'object' ? (OBJECT_MODELS[it.model]?.label ?? it.model) : (WORLD_MODELS[it.model]?.label ?? it.model)

  // ── Viewer ──────────────────────────────────────────────────────────
  if (openId && open) {
    const spz = open.world?.spz
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 60px' }}>
        <button onClick={() => router.push('/xworld')} style={{ ...mono, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 14 }}>← {t('xworld.back')}</button>
        {open.status === 'done' && open.kind === 'world' && spz && <WorldViewer spz={spz} hint={t('xworld.hint.world')} />}
        {open.status === 'done' && open.kind === 'object' && open.object && <ObjectViewer url={open.object.glb_url} hint={t('xworld.hint.object')} />}
        {open.status === 'pending' && <div style={{ ...mono, padding: 60, textAlign: 'center' }}>{t('xworld.pending')}{open.progress ? ` ${Math.round(open.progress)}%` : ''}</div>}
        {open.status === 'failed' && <div style={{ color: 'var(--red)', padding: 40, textAlign: 'center' }}>{t('xworld.failed')}{open.error ? `: ${open.error}` : ''}</div>}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            {open.prompt && <div style={{ fontSize: 15, color: 'var(--white)', marginBottom: 8 }}>{open.prompt}</div>}
            {open.caption && <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, maxHeight: 120, overflow: 'auto' }}>{open.caption}</div>}
            <div style={{ ...mono, marginTop: 10 }}>{modelLabel(open)} · ${(open.billed_cents / 100).toFixed(2)} · {new Date(open.created_at).toLocaleDateString()}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {spz?.full_res && <a href={spz.full_res} target="_blank" rel="noreferrer" style={chip(false)}>{t('xworld.download.spz')}</a>}
            {open.world?.collider_url && <a href={open.world.collider_url} target="_blank" rel="noreferrer" style={chip(false)}>{t('xworld.download.collider')}</a>}
            {open.object && <a href={open.object.glb_url} download="object.glb" style={chip(false)}>{t('xworld.download.glb')}</a>}
            <button onClick={() => remove(open.id)} style={{ ...chip(false), color: 'var(--muted)' }}>{t('xworld.delete')}</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Composer + gallery ──────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 24px 60px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, margin: 0, color: 'var(--white)' }}>{t('nav.xworld')}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 15, margin: '6px 0 24px' }}>{t('xworld.sub')}</p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button style={chip(tab === 'world')} onClick={() => switchTo({ tab: 'world' })}>🌐 {t('xworld.tab.world')}</button>
          <button style={chip(tab === 'object')} onClick={() => switchTo({ tab: 'object' })}>🧊 {t('xworld.tab.object')}</button>
        </div>

        {tab === 'world' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ ...mono, alignSelf: 'center', marginRight: 6 }}>{t('xworld.from')}</span>
            {INPUTS.map(i => (
              <button key={i} style={{ ...chip(input === i), padding: '5px 12px', fontSize: 12 }} onClick={() => switchTo({ input: i })}>
                {t(`xworld.input.${i}`)}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
          placeholder={tab === 'object' ? t('xworld.prompt.object') : input === 'text' ? t('xworld.prompt.world') : t('xworld.prompt.optional')}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 12, borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 14, fontFamily: 'var(--font-body)' }}
        />

        {needsFiles && (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {files.map((f, i) => (
              <div key={i} style={{ position: 'relative', width: 84, height: 84, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border2)', background: 'var(--surface2)', display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
                {f.previewUrl ? <img src={f.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🎬'}
                {input === 'multi-image' && tab === 'world' && (
                  <span style={{ position: 'absolute', left: 4, bottom: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: '1px 5px', borderRadius: 4 }}>
                    {Math.round((360 / Math.max(files.length, 1)) * i)}°
                  </span>
                )}
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 2, right: 2, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>✕</button>
              </div>
            ))}
            {files.length < maxFiles && (
              <button onClick={() => fileRef.current?.click()} style={{ ...chip(false), height: 84, minWidth: 140, borderStyle: 'dashed' }}>
                + {tab === 'object' ? t('xworld.add.object') : input === 'video' ? t('xworld.add.video') : input === 'multi-image' ? t('xworld.add.images') : t('xworld.add.image')}
              </button>
            )}
            <input ref={fileRef} type="file" hidden accept={accept} multiple={maxFiles > 1} onChange={e => pick(e.target.files)} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...mono, marginRight: 6 }}>{t('xworld.model')}</span>
          {tab === 'world'
            ? Object.entries(WORLD_MODELS).map(([id, m]) => (
                <button key={id} style={chip(model === id)} onClick={() => setModel(id)}>
                  {m.label} <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>{worldPriceLabel(id, input)}</span>
                </button>
              ))
            : Object.entries(OBJECT_MODELS).map(([id, m]) => (
                <button key={id} style={chip(objModel === id)} onClick={() => setObjModel(id)}>
                  {m.label} <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', fontSize: 12 }}>${(m.cents / 100).toFixed(2)}</span>
                </button>
              ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18, flexWrap: 'wrap' }}>
          <button onClick={submit} disabled={!ready || busy} style={{
            padding: '11px 22px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600,
            background: ready && !busy ? 'var(--red)' : 'var(--border2)', color: '#fff', cursor: ready && !busy ? 'pointer' : 'default',
          }}>
            {busy ? '…' : `${t('xworld.generate')} · ${price}`}
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {tab === 'object' ? t('xworld.time.object') : t('xworld.time.world')}
            {tab === 'world' && WORLD_MODELS[model]?.variable ? ` ${t('xworld.plus.note')}` : ''}
          </span>
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}{error === t('xworld.nocredits') && <> <a href="/profile" style={{ color: 'var(--red)' }}>→</a></>}</div>}
      </div>

      <div style={{ ...mono, margin: '32px 0 12px' }}>{t('xworld.mine')}</div>
      {items === null
        ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        : items.length === 0
        ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '30px 0' }}>{t('xworld.empty')}</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
            {items.map(it => (
              <button key={it.id} onClick={() => router.push(`/xworld?w=${it.id}`)} style={{
                textAlign: 'left', padding: 0, cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden',
              }}>
                <div style={{ aspectRatio: '16 / 10', background: 'var(--surface2)', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 12 }}>
                  {it.status === 'done' && (it.thumbnail_url || it.kind === 'object')
                    ? <img src={it.thumbnail_url ?? `/api/xworld/${it.id}/model?asset=preview`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : it.status === 'pending'
                    ? `${t('xworld.pending')}${it.progress ? ` ${Math.round(it.progress)}%` : ''}`
                    : t('xworld.failed')}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.kind === 'object' ? '🧊 ' : '🌐 '}{it.prompt || modelLabel(it)}
                  </div>
                  <div style={{ ...mono, fontSize: 9.5, marginTop: 4 }}>{modelLabel(it)} · ${(it.billed_cents / 100).toFixed(2)}</div>
                </div>
              </button>
            ))}
          </div>}
    </div>
  )
}
