'use client'
// app/create/page.tsx
// Private AI studio:
// 1. Pick up to 4 models + prompt → generate side by side
// 2. Pick one to continue → this is the vote, others dismissed
// 3. Multi-turn chat with chosen model

import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { type Attachment } from '../components/AttachmentButton'

type Mode = 'text' | 'image' | 'video'
type Phase = 'setup' | 'generating' | 'picking' | 'chatting'

interface DBModel {
  id: string          // uuid
  provider: string
  model_name: string
  name: string
  modes: string[]
  tags: string[]
  image_pricing: Record<string, number> | null
  video_pricing: Record<string, number> | null
}

interface SlotModel {
  id: string          // uuid
  provider: string
  model_name: string
  name: string
}

interface SlotState {
  text: string
  isImage: boolean
  isVideo: boolean
  streaming: boolean
  done: boolean
  cost: number
  responseTime: number
  error: string | null
  priceLabel: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isImage?: boolean
  isVideo?: boolean
}

interface GalleryItem {
  id: string
  mode: string
  prompt: string
  slots: any[]
  chosen_model_id: string | null
  created_at: string
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#e8453c', openai: '#10a37f', google: '#4285f4',
  xai: '#aaa', deepseek: '#4a9eff', meta: '#0668e1',
  mistral: '#ff7000', alibaba: '#ff6a00', bfl: '#a78bfa', recraft: '#34d399',
}
const LABELS = ['A', 'B', 'C', 'D']
const SLOT_COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399']

const providerColor   = (p: string) => PROVIDER_COLORS[p.toLowerCase()] ?? '#888'
const providerInitial = (p: string) => p.charAt(0).toUpperCase()

// ── Model Picker Dialog ───────────────────────────────────────────────────────
function ModelPickerDialog({ mode, onSelect, onClose, selectedIds }: {
  mode: Mode; onSelect: (m: SlotModel) => void; onClose: () => void; selectedIds: string[]
}) {
  const [search,  setSearch]  = useState('')
  const [models,  setModels]  = useState<DBModel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    createSupabaseBrowser().from('ai_models').select('*').eq('enabled', true).contains('modes', [mode]).order('name')
      .then(({ data }) => { setModels(data ?? []); setLoading(false) })
  }, [mode])

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase()) ||
    m.provider.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#111', border: '1px solid #222', borderRadius: 14, width: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0d0d0d', border: '1px solid #222', borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ color: '#444' }}>⌕</span>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 14, fontFamily: 'inherit' }} />
          </div>
        </div>
        <div style={{ padding: '12px 16px 8px' }}>
          <span style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px',
            background: mode === 'video' ? '#34d39922' : mode === 'image' ? '#a78bfa22' : '#4a9eff22',
            color: mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff',
          }}>{mode} models</span>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#444' }}>Loading…</div>
          : filtered.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: '#444' }}>No models found</div>
          : filtered.map(m => {
            const already = selectedIds.includes(m.id)
            const color   = providerColor(m.provider)
            return (
              <div key={m.id}
                onClick={() => !already && onSelect({ id: m.id, provider: m.provider, model_name: m.model_name, name: m.name })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #161616', cursor: already ? 'default' : 'pointer', opacity: already ? 0.4 : 1 }}
                onMouseEnter={e => { if (!already) (e.currentTarget as HTMLElement).style.background = '#1a1a1a' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: color + '22', color, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                  {providerInitial(m.provider)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: already ? '#555' : '#fff', fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.id.split('/')[1] ?? m.id}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{m.provider}</div>
                </div>
                {m.tags?.includes('reasoning') && <span style={{ fontSize: 9, color: '#a78bfa', background: '#a78bfa18', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>REASONING</span>}
                {already && <span style={{ fontSize: 11, color: '#444' }}>Added</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function Gallery({ userId }: { userId: string }) {
  const [items,    setItems]    = useState<GalleryItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    createSupabaseBrowser().from('creates').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40)
      .then(({ data }) => { setItems(data ?? []); setLoading(false) })
  }, [userId])

  if (loading) return <div style={{ color: '#444', textAlign: 'center', padding: 40 }}>Loading gallery…</div>
  if (items.length === 0) return <div style={{ color: '#333', textAlign: 'center', padding: 60, fontSize: 13 }}>Your creations will appear here.</div>

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={lightbox} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {items.map(item => {
          const slots     = (item.slots ?? []).filter(Boolean)
          const mode      = item.mode as Mode
          const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
          const chosen    = slots.find((s: any) => s.id === item.chosen_model_id)
          const preview   = chosen ?? slots[0]
          return (
            <div key={item.id} style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
              {preview && (
                preview.isVideo ? <video src={preview.text} muted loop playsInline style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover' }} />
                : preview.isImage ? <img src={preview.text} alt="" onClick={() => setLightbox(preview.text)} style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover', cursor: 'zoom-in' }} />
                : <div style={{ padding: '12px 14px', fontSize: 12, color: '#555', lineHeight: 1.6, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>{preview.text?.slice(0, 200)}</div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: modeColor, background: modeColor + '18', padding: '2px 7px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
                  {item.chosen_model_id && <span style={{ fontSize: 9, color: '#34d399', background: '#34d39918', padding: '2px 7px', borderRadius: 8, fontWeight: 700 }}>CHOSEN</span>}
                  <span style={{ fontSize: 11, color: '#333', marginLeft: 'auto' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.prompt}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {slots.map((s: any, i: number) => (
                    <span key={i} style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 6, fontFamily: 'var(--mono)',
                      maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                      color: s.id === item.chosen_model_id ? '#34d399' : '#444',
                      background: s.id === item.chosen_model_id ? '#34d39918' : '#ffffff08',
                      textDecoration: s.id !== item.chosen_model_id && item.chosen_model_id ? 'line-through' : 'none',
                    }}>
                      {s.model_name ?? s.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CreatePage() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  const [userId,         setUserId]         = useState<string | null>(null)
  const [mode,           setMode]           = useState<Mode>('text')
  const [prompt,         setPrompt]         = useState('')
  const [selectedModels, setSelectedModels] = useState<(SlotModel | null)[]>([null, null, null, null])
  const [slots,          setSlots]          = useState<SlotState[]>([])
  const [pickerSlot,     setPickerSlot]     = useState<number | null>(null)
  const [phase,          setPhase]          = useState<Phase>('setup')
  const [tab,            setTab]            = useState<'create' | 'gallery'>('create')
  const [lightbox,       setLightbox]       = useState<string | null>(null)
  const [attachment,     setAttachment]     = useState<Attachment | null>(null)

  // Post-pick state
  const [chosenIdx,      setChosenIdx]      = useState<number | null>(null)
  const [chatHistory,    setChatHistory]    = useState<ChatMessage[]>([])
  const [chatInput,      setChatInput]      = useState('')
  const [chatStreaming,  setChatStreaming]  = useState(false)
  const [createId,       setCreateId]       = useState<string | null>(null)

  // Cursor
  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, rafId: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      rafId = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    rafId = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(rafId) }
  }, [])

  useEffect(() => {
    createSupabaseBrowser().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    setSelectedModels([null, null, null, null]); setSlots([]); setPhase('setup')
    setChosenIdx(null); setChatHistory([]); setCreateId(null); setAttachment(null)
  }, [mode])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, chatStreaming])

  const activeModels = selectedModels.filter(Boolean) as SlotModel[]
  const selectedIds  = activeModels.map(m => m.id)

  const addModel    = (i: number, m: SlotModel) => { setSelectedModels(prev => prev.map((v, idx) => idx === i ? m : v)); setPickerSlot(null) }
  const removeModel = (i: number) => setSelectedModels(prev => prev.map((v, idx) => idx === i ? null : v))

  const generate = async () => {
    if (!prompt.trim() || activeModels.length === 0 || phase === 'generating') return
    setPhase('generating')
    setSlots(activeModels.map(() => ({ text: '', isImage: false, isVideo: false, streaming: true, done: false, cost: 0, responseTime: 0, error: null, priceLabel: '' })))
    setChosenIdx(null); setChatHistory([]); setCreateId(null)

    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, modelIds: activeModels.map(m => m.id), attachment: attachment ? { storagePath: attachment.storagePath, bucket: attachment.bucket, mediaType: attachment.mediaType, fileName: attachment.fileName, fileSize: attachment.fileSize } : null }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim() }
          else if (line.startsWith('data: ')) {
            try {
              const p = JSON.parse(line.slice(6))
              if (currentEvent.startsWith('delta:')) {
                const idx = p.index
                setSlots(prev => prev.map((s, i) => i !== idx ? s : { ...s, text: s.text + (p.text ?? ''), isImage: p.isImage ?? s.isImage, isVideo: p.isVideo ?? s.isVideo }))
              } else if (currentEvent.startsWith('done:')) {
                const idx = p.index
                const outputPrice = activeModels[idx]?.outputPrice ?? 0
                setSlots(prev => prev.map((s, i) => {
                  if (i !== idx) return s
                  const realCost = Number(p.cost ?? 0) || outputPrice
                  const pl = s.isVideo ? `$${(realCost * 1000).toFixed(2)} / 1k videos`
                    : s.isImage ? `$${(realCost * 1000).toFixed(2)} / 1k images`
                    : `$${outputPrice.toFixed(2)} / 1M tokens`
                  return { ...s, streaming: false, done: true, cost: realCost, responseTime: p.responseTime, priceLabel: pl }
                }))
              } else if (currentEvent.startsWith('error:')) {
                const idx = p.index
                setSlots(prev => prev.map((s, i) => i !== idx ? s : { ...s, streaming: false, done: true, error: p.message }))
              }
            } catch {}
          }
        }
      }
      setPhase('picking')
    } catch (err) {
      console.error(err)
      setPhase('setup')
    }
  }

  const pickModel = async (idx: number) => {
    if (!userId) return
    setChosenIdx(idx)
    const chosen  = activeModels[idx]
    const initial = slots[idx]

    // Seed chat with initial exchange
    setChatHistory([
      { role: 'user',      content: prompt },
      { role: 'assistant', content: initial.text, isImage: initial.isImage, isVideo: initial.isVideo },
    ])
    setPhase('chatting')

    // Save to DB with chosen model recorded
    const sb = createSupabaseBrowser()
    const { data } = await sb.from('creates').insert({
      user_id: userId, mode, prompt,
      chosen_model_id: chosen.id,
      slots: slots.map((s, i) => ({
        id: activeModels[i]?.id, name: activeModels[i]?.name, provider: activeModels[i]?.provider,
        outputPrice: activeModels[i]?.outputPrice, priceLabel: s.priceLabel,
        text: s.text, isImage: s.isImage, isVideo: s.isVideo, cost: s.cost, responseTime: s.responseTime,
        chosen: i === idx,
      })),
    }).select('id').single()
    if (data?.id) setCreateId(data.id)
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatStreaming || chosenIdx === null) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: userMsg }]
    setChatHistory(newHistory)
    setChatStreaming(true)

    const chosen = activeModels[chosenIdx]
    try {
      const res = await fetch('/api/create/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: chosen.id, messages: newHistory }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', currentEvent = '', assistantText = ''

      setChatHistory(h => [...h, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim() }
          else if (line.startsWith('data: ') && currentEvent === 'delta') {
            try {
              const p = JSON.parse(line.slice(6))
              assistantText += p.text ?? ''
              setChatHistory(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: assistantText } : m))
            } catch {}
          }
        }
      }
    } catch (err) { console.error(err) }
    setChatStreaming(false)
  }

  const reset = () => {
    setPhase('setup'); setSlots([]); setChosenIdx(null)
    setChatHistory([]); setChatInput(''); setCreateId(null)
    setPrompt(''); setAttachment(null)
  }

  const canGenerate = prompt.trim().length >= 3 && activeModels.length > 0 && phase !== 'generating'

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={lightbox} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 24, right: 32, background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 32, cursor: 'none', lineHeight: 1 }}>&times;</button>
        </div>
      )}
      {pickerSlot !== null && (
        <ModelPickerDialog mode={mode} selectedIds={selectedIds} onSelect={m => addModel(pickerSlot, m)} onClose={() => setPickerSlot(null)} />
      )}

      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <div className="xduel-page">
        <div className="arena" style={{ maxWidth: 1100 }}>

          {/* Header + tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--mono)', marginBottom: 6 }}>MODELXD — CREATE</div>
              <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, margin: 0 }}>
                Your Private <span style={{ color: 'var(--red)' }}>Studio</span>
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['create', 'gallery'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: tab === t ? 'var(--red)' : 'transparent',
                  border: `1px solid ${tab === t ? 'var(--red)' : '#222'}`,
                  color: tab === t ? '#fff' : '#666',
                }}>{t === 'create' ? '✦ Create' : '⊞ Gallery'}</button>
              ))}
            </div>
          </div>

          {tab === 'gallery' ? (
            userId ? <Gallery userId={userId} /> : <div style={{ color: '#444', textAlign: 'center', padding: 40 }}>Sign in to view your gallery.</div>
          ) : (

            /* ── CHATTING PHASE ── */
            phase === 'chatting' && chosenIdx !== null ? (
              <div>
                {/* Chosen model header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '14px 18px', background: '#0d0d0d', border: `1px solid ${SLOT_COLORS[chosenIdx]}44`, borderRadius: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: providerColor(activeModels[chosenIdx].provider) + '22', color: providerColor(activeModels[chosenIdx].provider), border: `1px solid ${providerColor(activeModels[chosenIdx].provider)}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>
                    {providerInitial(activeModels[chosenIdx].provider)}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{activeModels[chosenIdx].name}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>{activeModels[chosenIdx].provider} · {slots[chosenIdx]?.priceLabel}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#34d399', background: '#34d39918', padding: '4px 10px', borderRadius: 8 }}>✓ Your pick</span>
                    <button onClick={reset} style={{ background: 'transparent', border: '1px solid #222', color: '#555', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
                      ← New Session
                    </button>
                  </div>
                </div>

                {/* Dismissed models */}
                {activeModels.length > 1 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 11, color: '#333', alignSelf: 'center' }}>Dismissed:</span>
                    {activeModels.map((m, i) => i === chosenIdx ? null : (
                      <span key={i} style={{ fontSize: 11, color: '#333', background: '#111', border: '1px solid #1a1a1a', padding: '3px 10px', borderRadius: 8, fontFamily: 'var(--mono)', textDecoration: 'line-through' }}>
                        {m.model_name ?? m.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20, minHeight: 200 }}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      {msg.role === 'assistant' && (
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: providerColor(activeModels[chosenIdx].provider) + '22', color: providerColor(activeModels[chosenIdx].provider), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, flexShrink: 0, marginRight: 10, marginTop: 4 }}>
                          {providerInitial(activeModels[chosenIdx].provider)}
                        </div>
                      )}
                      <div style={{
                        maxWidth: '72%', padding: '12px 16px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                        background: msg.role === 'user' ? '#1a1a1a' : '#0d0d0d',
                        border: `1px solid ${msg.role === 'user' ? '#2a2a2a' : '#1a1a1a'}`,
                        fontSize: 14, lineHeight: 1.7, color: msg.role === 'user' ? '#ccc' : '#ddd',
                      }}>
                        {msg.isVideo ? <video src={msg.content} autoPlay loop muted playsInline controls style={{ width: '100%', borderRadius: 6 }} />
                        : msg.isImage ? <img src={msg.content} alt="" onClick={() => setLightbox(msg.content)} style={{ maxWidth: '100%', borderRadius: 6, cursor: 'zoom-in' }} />
                        : <div className="markdown-body"><ReactMarkdown>{msg.content}</ReactMarkdown></div>}
                        {i === chatHistory.length - 1 && msg.role === 'assistant' && chatStreaming && <span className="stream-cursor">▋</span>}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <textarea
                    value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                    placeholder="Continue the conversation…"
                    rows={2}
                    style={{ flex: 1, background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, padding: '12px 16px', color: '#fff', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
                  />
                  <button onClick={sendChat} disabled={chatStreaming || !chatInput.trim()} style={{
                    padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff',
                    fontWeight: 700, fontSize: 14, cursor: chatStreaming ? 'wait' : 'pointer', flexShrink: 0,
                    opacity: chatStreaming || !chatInput.trim() ? 0.5 : 1,
                  }}>
                    {chatStreaming ? '…' : '→'}
                  </button>
                </div>
              </div>

            ) : (
              /* ── SETUP / GENERATING / PICKING ── */
              <>
                {/* Mode */}
                <div className="mode-selector" style={{ marginBottom: 24 }}>
                  {(['text', 'image', 'video'] as Mode[]).map(m => (
                    <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`} onClick={() => { if (phase === 'setup') setMode(m) }}>
                      <span className="mode-dot" />{m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Model slots */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                  {[0, 1, 2, 3].map(i => {
                    const model = selectedModels[i]
                    const color = SLOT_COLORS[i]
                    return model ? (
                      <div key={i} style={{ background: '#0d0d0d', border: `1px solid ${color}44`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: providerColor(model.provider) + '22', color: providerColor(model.provider), border: `1px solid ${providerColor(model.provider)}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                          {providerInitial(model.provider)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color, fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.model_name}</div>
                          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{model.provider}</div>
                        </div>
                        {phase === 'setup' && <button onClick={() => removeModel(i)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>}
                      </div>
                    ) : (
                      <button key={i} onClick={() => phase === 'setup' && setPickerSlot(i)}
                        disabled={phase !== 'setup'}
                        style={{ background: '#0a0a0a', border: '1px dashed #1e1e1e', borderRadius: 10, padding: '14px', color: '#333', fontSize: 12, cursor: phase === 'setup' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s', opacity: phase !== 'setup' ? 0.4 : 1 }}
                        onMouseEnter={e => { if (phase === 'setup') { const el = e.currentTarget as HTMLElement; el.style.borderColor = color; el.style.color = color } }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#1e1e1e'; el.style.color = '#333' }}
                      >
                        <span style={{ fontSize: 18 }}>+</span> Model {LABELS[i]}
                      </button>
                    )
                  })}
                </div>

                {/* Prompt */}
                <div className="prompt-box">
                  <textarea className="prompt-textarea"
                    placeholder={mode === 'image' ? "Describe an image…" : mode === 'video' ? "Describe a video…" : "Ask anything…"}
                    value={prompt} onChange={e => setPrompt(e.target.value)}
                    disabled={phase !== 'setup'}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canGenerate) generate() } }}
                  />
                  <div className="prompt-actions">
                    <AttachmentButton attachment={attachment} onChange={setAttachment} disabled={phase !== 'setup'} context="create" />
                    <span className="prompt-counter">{activeModels.length === 0 ? 'Pick at least one model' : `${activeModels.length} model${activeModels.length > 1 ? 's' : ''} selected`}</span>
                    {phase === 'setup' || phase === 'generating' ? (
                      <button className="btn-battle" onClick={generate} disabled={!canGenerate}>
                        {phase === 'generating' ? '⏳ Generating…' : '✦ Generate →'}
                      </button>
                    ) : (
                      <button className="btn-secondary" onClick={reset}>← Start Over</button>
                    )}
                  </div>
                </div>

                {/* Results */}
                {slots.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    {phase === 'picking' && (
                      <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ fontSize: 13, color: '#e8453c', fontWeight: 700, marginBottom: 4 }}>Which model do you want to continue with?</div>
                        <div style={{ fontSize: 12, color: '#555' }}>Pick one — the others will be dismissed</div>
                      </div>
                    )}
                    <div className="battle-arena" style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}>
                      {slots.map((slot, i) => {
                        const model = activeModels[i]
                        const color = SLOT_COLORS[i]
                        return (
                          <div key={i} className="battle-card"
                            onMouseEnter={() => setCursor(color)}
                            onMouseLeave={() => setCursor('#e8453c')}
                          >
                            <div className={`battle-card-header ${mode !== 'text' ? 'image-mode' : ''}`}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 20, height: 20, borderRadius: '50%', background: providerColor(model.provider) + '22', color: providerColor(model.provider), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>
                                  {providerInitial(model.provider)}
                                </div>
                                <div className="battle-model-id" style={{ color, fontSize: 12 }}>{model.model_name}</div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {slot.done && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)' }}>⏱ {(slot.responseTime / 1000).toFixed(2)}s</span>}
                                {slot.done && slot.priceLabel && <span className="price-badge" style={{ color }}>{slot.priceLabel}</span>}
                              </div>
                            </div>
                            <div className={`battle-response ${mode !== 'text' ? 'image-response' : ''} ${slot.streaming && !slot.text ? 'loading' : ''}`}>
                              {slot.streaming && !slot.text
                                ? <><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></>
                                : slot.error ? <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>⚠️ {slot.error}</div>
                                : slot.isVideo ? <video src={slot.text} autoPlay loop muted playsInline controls style={{ width: '100%', display: 'block' }} />
                                : slot.isImage ? <img src={slot.text} alt="Generated" onClick={() => setLightbox(slot.text)} style={{ width: '100%', display: 'block', cursor: 'zoom-in' }} />
                                : <><div className="markdown-body"><ReactMarkdown>{slot.text}</ReactMarkdown></div>{slot.streaming && <span className="stream-cursor">▋</span>}</>
                              }
                            </div>
                            {/* Pick button */}
                            {phase === 'picking' && slot.done && !slot.error && (
                              <div style={{ padding: 12, borderTop: '1px solid #111' }}>
                                <button onClick={() => pickModel(i)} style={{
                                  width: '100%', padding: '10px 0', borderRadius: 8,
                                  background: 'transparent', border: `1px solid ${color}`,
                                  color, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                                  transition: 'all 0.15s',
                                }}
                                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = color + '18' }}
                                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent' }}
                                >
                                  Continue with {model.name} →
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </>
  )
}
