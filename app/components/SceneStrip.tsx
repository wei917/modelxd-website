'use client'
// app/components/SceneStrip.tsx
// The storyboard lane of the XDirect stage (CC, Aug 6).
//
// The director drafts scenes here with set_storyboard; the user EDITS them
// here — script, shot prompt, duration, order — and generates from here.
// This strip is sequence (what plays, in what order); the canvas below it is
// derivation (how each artifact was made). Same stage, two grammars.
//
// Editing is optimistic and local: every change flows up through onChange
// and the page/chat owns persistence. Generation is delegated upward too —
// the ▶ on a card arms that scene and asks the director to run it, so the
// spend still goes through the one billing pipeline and the agent stays in
// the loop on what happened.

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import ModelPickerDialog from './ModelPickerDialog'
import { pendingAttachment, commitAttachments } from './AttachmentButton'
import { createSupabaseBrowser } from '../../lib/supabase-client'

/** A committed reference on a scene card (owner ask, Aug 8): serializable
 *  descriptor only — the storyboard jsonb persists it, and generation for
 *  THAT scene uses these files instead of the conversation's attachments.
 *  previewUrl is a session-local object URL; dead after reload (chip shows
 *  the filename instead). */
export type SceneRef = {
  storagePath: string
  bucket: string
  mediaType: string
  fileName: string
  fileSize: number
  previewUrl?: string
}

export type Scene = {
  id: string
  title: string
  script: string
  shot: string
  duration_s: number
  /** This card is a CUT — it continues the previous card's action and is
   *  chained from its final frame at generation. */
  continues?: boolean
  model_id?: string
  model_name?: string
  recipe?: string
  estimate?: number
  refs?: SceneRef[]
  status?: 'draft' | 'generating' | 'done' | 'error'
  row_id?: string
  url?: string
  cost?: number
  error?: string
  /** KEYFRAME mode (owner, Aug 11): the approved still this cut animates
   *  from. Its own row, kept apart from row_id so the still never claims
   *  the card's clip slot — and apart from takes[], because a source frame
   *  is not an alternate take. */
  still_row_id?: string
  still_url?: string
  /** The still is a SHOT with its own model choice and its own price
   *  (owner, Aug 11: "separate the prices"). Per-shot model choice is the
   *  differentiator; it applies to the keyframe as much as the clip. */
  still_model_id?: string
  still_model_name?: string
  /** The user said "straight to video" for this cut — no still step. */
  direct?: boolean
  /** ASSET (owner, Aug 12): a named reusable picture — cast sheet, look
   *  frame, key prop — living on the ASSETS shelf, not in the sequence.
   *  Assets have a still and a name; they never have duration, a video
   *  model, or a place in the film numbering. Scenes chain from them. */
  asset?: boolean
  /** PERFORMANCE ONLY — the cast acts, never appears to sing or speak
   *  (owner, Aug 11: "I don't need the model says anything. They just act.
   *  I will mix audio later."). There is no lip-sync on this product, so
   *  invented articulation is always wrong; this makes the absence a
   *  deliberate direction instead of a defect. */
  no_speech?: boolean
  /** Every video row this cut has produced — the active take plus its
   *  alternates. Binding is by row identity, never prompt text. */
  takes?: string[]
}

const MAX_SCENE_REFS = 4

/** Film numbering — EVERY card is a cut within its scene, the opener
 *  included: S1·C1, S1·C2, S2·C1... A fresh setup starts a new scene at cut
 *  1; a `continues` card increments the cut.
 *
 *  Exported because the chat must call a card what the CARD calls it (owner
 *  bug, Aug 11: clicking the card marked S4·C1 announced "▶ Scene 5" — the
 *  chat was numbering by array position, and one earlier cut had shifted
 *  every card after it by one, so the click read as the wrong scene
 *  starting). One numbering, one source. */
export function sceneLabels(scenes: Array<{ continues?: boolean; asset?: boolean; title?: string }>): string[] {
  const out: string[] = []
  let sc = 0, cut = 0
  for (const sn of scenes) {
    // Assets live on the shelf, not in the film — they carry their NAME and
    // are transparent to the numbering (owner, Aug 12: the cast sheet
    // rendered as S1·C1 while the director called it s0).
    if (sn.asset) { out.push(sn.title ?? 'ASSET'); continue }
    if (sn.continues && sc > 0) cut += 1
    else { sc += 1; cut = 1 }
    out.push(`S${sc}\u00b7C${cut}`)
  }
  return out
}

const card: React.CSSProperties = {
  width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
  padding: '12px 12px 10px', borderRadius: 12,
  border: '1px solid var(--border2)', background: 'var(--surface)',
}
const label: React.CSSProperties = {
  fontSize: 9, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
  textTransform: 'uppercase', color: 'var(--muted)',
}
const area: React.CSSProperties = {
  width: '100%', resize: 'none', border: '1px solid transparent', borderRadius: 7,
  background: 'transparent', color: 'var(--white)', fontFamily: 'inherit',
  fontSize: 13, lineHeight: 1.6, padding: '6px 8px', outline: 'none',
}
const iconBtn: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px',
  color: 'var(--muted)', fontSize: 12, lineHeight: 1,
}

export default function SceneStrip({ scenes, busy, onChange, onGenerate, onGenerateAll, onStop, onPreview, onCut }: {
  scenes: Scene[]
  /** true while the director is mid-turn — generation buttons pause. */
  busy: boolean
  onChange: (next: Scene[]) => void
  onGenerate: (sceneId: string, kind: 'still' | 'video') => void
  onGenerateAll: (kind: 'still' | 'video') => void
  /** Open this board as a rough cut in XCut (owner, Aug 22). */
  onCut?: () => void
  /** The brake for a mis-clicked ▶▶ — visible whenever the director is
   *  running a batch. */
  onStop?: () => void
  onPreview: (url: string, isVideo: boolean) => void
}) {
  const t = useT()
  // PRICES ARE COMPUTED, NOT QUOTED (owner, Aug 11: "it will cost $2.66?").
  // The director was writing the price into the scene itself, and its
  // arithmetic was wrong — a 15s Veo 3.1 scene came back as $10.80 when the
  // catalog rate ($0.40/s) makes it $6.00. On a product whose whole claim is
  // price honesty, the number on the card has to come from the catalog, not
  // from a model doing mental multiplication. The scene's own `estimate` is
  // only a fallback for a model we cannot resolve.
  const [catalog, setCatalog] = useState<any[]>([])
  useEffect(() => {
    let dead = false
    createSupabaseBrowser().from('ai_models')
      .select('id, display_name, model_pricing, modes')
      .eq('enabled', true)
      .then(({ data }) => { if (!dead) setCatalog(data ?? []) })
    return () => { dead = true }
  }, [])
  const cheapest = (rate: any): number | null => {
    if (typeof rate === 'number' && Number.isFinite(rate)) return rate
    if (rate && typeof rate === 'object') {
      const rates = Object.values(rate).map(Number).filter(n => Number.isFinite(n))
      if (rates.length > 0) return Math.min(...rates)
    }
    return null
  }
  const priceOf = (sc: Scene): number | null => {
    const m = catalog.find(x => x.id === sc.model_id)
      ?? catalog.find(x => x.display_name === sc.model_name)
    const perSec = cheapest(m?.model_pricing?.per_video_second)
    if (perSec != null) return perSec * (sc.duration_s || 6)
    return typeof sc.estimate === 'number' ? sc.estimate : null
  }
  // per_image is NOT a flat list of interchangeable rates (owner, Aug 11:
  // "if I change the image generation model, the price becomes $0.00").
  // Grok Imagine carries `input_image: 0.002` — a per-INPUT surcharge, not a
  // generation price — and GPT Image 2 carries a whole quality x size
  // matrix down to `low:1024x1536: 0.0047`. Taking the cheapest value
  // quoted the surcharge or the smallest thumbnail, which then rounded to
  // $0.00 and told the user an image was free.
  const stillPriceOf = (sc: Scene): number | null => {
    const m = catalog.find(x => x.id === sc.still_model_id)
      ?? catalog.find(x => x.display_name === sc.still_model_name)
    const pp = m?.model_pricing?.per_image
    if (typeof pp === 'number') return Number.isFinite(pp) ? pp : null
    if (!pp || typeof pp !== 'object') return null
    // Surcharge keys are not prices for making a picture.
    const rates = Object.entries(pp)
      .filter(([k]) => !k.toLowerCase().includes('input'))
      .map(([k, v]) => [k, Number(v)] as const)
      .filter(([, v]) => Number.isFinite(v) && v > 0)
    if (rates.length === 0) return null
    // The rate this scene would actually be billed at: the model's stated
    // default, else the standard 1024 tier, else mid quality — and only
    // then the cheapest, for a catalog shape we have not seen.
    const pick = (want: (k: string) => boolean) => rates.find(([k]) => want(k.toLowerCase()))?.[1]
    return pick(k => k === 'default')
      ?? pick(k => k === '1024' || k === '1k')
      ?? pick(k => k === 'medium')
      ?? Math.min(...rates.map(([, v]) => v))
  }
  // A price under a cent is still a price. Rounding 0.0047 to "$0.00" reads
  // as free on the one product that sells honest pricing.
  const money = (n: number): string => `$${n >= 0.01 ? n.toFixed(2) : n.toFixed(3)}`
  // Switching mode must switch the RECIPE with it (owner bug, Aug 11: a
  // DIRECT opener still carried image_to_video from its KEYFRAME plan, so
  // the run went out asking a model to animate an image that did not
  // exist). What feeds the clip differs per mode: the key still, the card's
  // references, the previous cut's closing frame, or nothing at all.
  const switchMode = (sc: Scene) => {
    const toDirect = !sc.direct
    const modes: string[] = videoModelOf(sc)?.modes ?? []
    const hasRefs = (sc.refs ?? []).length > 0
    const wants = !toDirect
      ? 'image_to_video'                                   // opens on its key still
      : hasRefs
        ? (modes.includes('reference_frames') ? 'reference_frames' : 'image_to_video')
        : sc.continues
          ? 'image_to_video'                               // chains from the previous CLIP
          : 'text_to_video'                                // nothing feeds it — words only
    // A model that cannot speak the new recipe is no longer a valid pick;
    // clear it so the picker chooses honestly rather than failing upstream.
    const keeps = modes.length === 0 || modes.includes(wants)
    patch(sc.id, {
      direct: toDirect, recipe: wants,
      ...(keeps ? {} : { model_id: undefined, model_name: undefined, estimate: undefined }),
    })
  }

  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  // A locked video ▶ must TEACH, not play dead (owner hit the wall twice,
  // Aug 13: "the characters are generated already, why is the video still
  // locked?" — cast assets were shot, scene stills weren't, and the
  // disabled button gave no path forward). Clicking the 🔒 pulses the
  // STILL row above it and names the step.
  const [nudge, setNudge] = useState<string | null>(null)
  const nudgeTimer = useRef<any>(null)
  const nudgeStill = (id: string) => {
    setNudge(id)
    clearTimeout(nudgeTimer.current)
    nudgeTimer.current = setTimeout(() => setNudge(null), 2400)
  }
  // Shot prompts are long; cards stay scannable with them folded.
  const [openShot, setOpenShot] = useState<Record<string, boolean>>({})
  // Per-scene reference upload + per-scene model picker (owner ask, Aug 8).
  const refInputRef = useRef<HTMLInputElement>(null)
  const refSceneId = useRef<string | null>(null)
  const [uploadingRef, setUploadingRef] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [stillPickerFor, setStillPickerFor] = useState<string | null>(null)

  // KEYFRAME made every non-direct cut an image_to_video shot: its own key
  // still is the opening frame. The three recipe decisions below predate
  // that and asked only "does this card carry refs, or is it a chained
  // cut?" — so S1·C1 (no card refs, not a cut) was ruled text-only and its
  // picker offered text_to_video models, for a shot that will in fact start
  // from a still (owner, Aug 11: "why does scene 1 cut 1 become text to
  // video only?").
  const opensOnStill = (sc: Scene) => !!sc.still_row_id || sc.direct !== true
  // A reference_frames-only model CANNOT open on the still (owner, Aug 11).
  // It re-anchors from the picture as a subject reference — the likeness
  // survives, the exact frame we locked does not. The picker still offers
  // these (the Aug 9 override stands: the user's choice outranks the
  // doctrine), but the card has to say what the choice costs.
  const videoModelOf = (sc: Scene) =>
    catalog.find(x => x.id === sc.model_id) ?? catalog.find(x => x.display_name === sc.model_name)
  // Two distinct severities (owner ask, Aug 12: "what is this flagging
  // thing?" — the tooltip claimed likeness carries, untrue for a text-only
  // model): a reference model keeps the SUBJECT but drops the framing; a
  // text-only model takes no picture at all — the approved still is simply
  // ignored.
  const losesTheFrame = (sc: Scene): 'partial' | 'total' | null => {
    if (!opensOnStill(sc)) return null
    const m = videoModelOf(sc)
    const modes: string[] = m?.modes ?? []
    if (modes.length === 0 || modes.includes('image_to_video')) return null
    return (modes.includes('reference_frames') || modes.includes('start_end_frames')) ? 'partial' : 'total'
  }

  if (scenes.length === 0) return null

  const patch = (id: string, p: Partial<Scene>) =>
    onChange(scenes.map(s => s.id === id ? { ...s, ...p } : s))

  const addRef = async (file: File) => {
    const id = refSceneId.current
    refSceneId.current = null
    if (!id) return
    setUploadingRef(id)
    try {
      const pending = pendingAttachment(file, 'xcreate')
      const [committed] = await commitAttachments([pending])
      if (!committed?.storagePath) return
      const sc = scenes.find(s => s.id === id)
      const refs: SceneRef[] = [...(sc?.refs ?? []), {
        storagePath: committed.storagePath, bucket: committed.bucket,
        mediaType: committed.mediaType, fileName: committed.fileName,
        fileSize: committed.fileSize, previewUrl: pending.previewUrl,
      }].slice(0, MAX_SCENE_REFS)
      // First reference flips the scene to a reference-consuming recipe.
      // The old model was picked for text-only, so it resets to '—' and the
      // picker (now filtered to image_to_video models) chooses honestly.
      const first = (sc?.refs ?? []).length === 0
      patch(id, {
        refs,
        ...(first && (!sc?.recipe || sc.recipe === 'text_to_video')
          ? { recipe: 'image_to_video', model_id: undefined, model_name: undefined, estimate: undefined }
          : {}),
      })
    } catch { /* failed upload leaves the card unchanged */ }
    finally { setUploadingRef(null) }
  }

  const removeRef = (id: string, storagePath: string) => {
    const sc = scenes.find(s => s.id === id)
    const rest = (sc?.refs ?? []).filter(r => r.storagePath !== storagePath)
    patch(id, {
      refs: rest,
      // Last reference gone: an image_to_video recipe has no input any more
      // — UNLESS the cut opens on its own key still, which is an input the
      // refs never were.
      ...(rest.length === 0 && sc?.recipe === 'image_to_video' && !(sc && opensOnStill(sc))
        ? { recipe: 'text_to_video' } : {}),
    })
  }
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= scenes.length) return
    const next = [...scenes]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  const remove = (id: string) => { setConfirmDel(null); onChange(scenes.filter(s => s.id !== id)) }
  const addScene = () => {
    const n = scenes.length + 1
    // Fresh ids must not collide with director-issued s1..s8 after deletes.
    const id = `u${Date.now().toString(36)}`
    onChange([...scenes, { id, title: `${t('xd.sb.scene')} ${n}`, script: '', shot: '', duration_s: 6, status: 'draft' }])
  }

  // Film numbering (owner's correction, Aug 6): EVERY card is a cut within
  // its scene, the opener included — S1·C1, S1·C2, S2·C1... A fresh setup
  // starts a new scene at cut 1; a continues card increments the cut. A
  // continues card with nothing before it opens scene 1 regardless.
  const labels = sceneLabels(scenes)

  const assets = scenes.filter(s => s.asset)
  const shots  = scenes.filter(s => !s.asset)
  const drafts = shots.filter(s => !s.status || s.status === 'draft' || s.status === 'error')
  // Two totals, never one (owner, Aug 11). The stills total is what a full
  // look test costs; the video total is what committing costs. Rolling them
  // into a single number is exactly the number that scared the user.
  const needStill = scenes.filter(s => !s.still_row_id && !s.direct && s.status !== 'done')   // assets included: their still IS the asset
  const stillsEst = needStill.reduce((sum, s) => sum + (stillPriceOf(s) ?? 0), 0)
  const totalEst = shots.reduce((sum, s) => sum + (s.status === 'done' ? (s.cost ?? 0) : (priceOf(s) ?? 0)), 0)
  const totalDur = shots.reduce((sum, s) => sum + (s.duration_s || 0), 0)

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 14px 12px', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
        <span style={{ ...label, color: 'var(--red)', fontWeight: 700 }}>{t('xd.sb.title')}</span>
        <span style={{ ...label }}>{shots.length} · {totalDur}s</span>
        <span style={{ flex: 1 }} />
        {(stillsEst > 0 || totalEst > 0) && (
          <span style={{ ...label, color: 'var(--muted2)' }}>
            {t('xd.sb.total')}{stillsEst > 0 ? ` ${t('xd.sb.genstill')} ${money(stillsEst)}` : ''}
            {stillsEst > 0 && totalEst > 0 ? ' · ' : ' '}
            {totalEst > 0 ? `${t('xd.sb.genvideo')} ${money(totalEst)}` : ''}
          </span>
        )}
        {(() => {
          const on = shots.every(x => x.no_speech)
          return (
            <button
              onClick={() => onChange(scenes.map(x => (x.asset ? x : { ...x, no_speech: !on })))}
              title={on ? t('xd.sb.nospeech.on') : t('xd.sb.nospeech.off')}
              style={{
                ...label, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid ' + (on ? 'var(--red-dim)' : 'var(--border2)'),
                background: on ? 'var(--red-dim)' : 'transparent',
                color: on ? 'var(--red)' : 'var(--muted2)',
              }}
            >{on ? '🔇' : '🗣'} {t('xd.sb.nospeech')}</button>
          )
        })()}
        {busy && onStop && (
          <button
            onClick={onStop}
            title={t('xd.stop.hint')}
            style={{
              ...label, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              border: '1px solid var(--red)', background: 'var(--red-dim)',
              color: 'var(--red)', fontWeight: 700,
            }}
          >⏹ {t('xd.stop')}</button>
        )}
        {scenes.length > 1 && (() => {
          const allDirect = shots.every(x => x.direct)
          return (
            <button
              onClick={() => onChange(scenes.map(x => {
                if (x.asset) return x
                const toDirect = !allDirect
                const modes: string[] = (videoModelOf(x)?.modes ?? [])
                const hasRefs = (x.refs ?? []).length > 0
                const wants = !toDirect ? 'image_to_video'
                  : hasRefs ? (modes.includes('reference_frames') ? 'reference_frames' : 'image_to_video')
                  : x.continues ? 'image_to_video' : 'text_to_video'
                const keeps = modes.length === 0 || modes.includes(wants)
                return { ...x, direct: toDirect, recipe: wants, ...(keeps ? {} : { model_id: undefined, model_name: undefined, estimate: undefined }) }
              }))}
              title={allDirect ? t('xd.sb.mode.keyframe.hint') : t('xd.sb.mode.direct.hint')}
              style={{
                ...label, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid var(--border2)', background: 'transparent', color: 'var(--muted2)',
              }}
            >{allDirect ? `▸ ${t('xd.sb.mode.keyframe')}` : `▸ ${t('xd.sb.mode.direct')}`}</button>
          )
        })()}
        {drafts.length > 1 && (() => {
          const anyStill = needStill.length > 1
          const runAll = (kind: 'still' | 'video', primary: boolean, txt: string, hint: string) => (
            <button
              onClick={() => onGenerateAll(kind)} disabled={busy}
              title={hint}
              style={{
                padding: '4px 12px', borderRadius: 999,
                border: '1px solid ' + (primary ? 'var(--red)' : 'var(--border2)'),
                background: primary ? 'var(--red-dim)' : 'transparent',
                color: primary ? 'var(--red)' : 'var(--muted2)',
                cursor: busy ? 'default' : 'pointer',
                fontFamily: 'var(--font-mono), monospace', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.07em', opacity: busy ? 0.5 : 1,
              }}
            >▶▶ {txt}</button>
          )
          // Stills lead while any cut still needs one: judging the whole look
          // book at look-test prices is the cheap decision, and the videos
          // are the one you only make once.
          return (
            <span style={{ display: 'flex', gap: 6 }}>
              {anyStill && runAll('still', true, t('xd.sb.allstills'), t('xd.sb.genstillhint'))}
              {runAll('video', !anyStill, t('xd.sb.allvideos'), t('xd.sb.genvideohint'))}
            </span>
          )
        })()}
        {onCut && (
          <button
            onClick={onCut} title="XCut"
            style={{
              padding: '4px 12px', borderRadius: 999, border: '1px solid var(--border2)', background: 'transparent',
              color: 'var(--muted2)', cursor: 'pointer', fontFamily: 'var(--font-mono), monospace', fontSize: 10,
              fontWeight: 700, letterSpacing: '0.07em',
            }}
          >✂ {t('xcut.fromboard')}</button>
        )}
      </div>

      {/* ── ASSETS shelf (owner, Aug 12): named reusable pictures — cast,
          look, props — OUTSIDE the sequence. The film starts at S1. */}
      {assets.length > 0 && (
        <div className="xd-strip-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, alignItems: 'stretch' }}>
          <span style={{ ...label, alignSelf: 'center', flexShrink: 0, color: 'var(--muted2)' }}>{t('xd.sb.assets')}</span>
          {assets.map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
              border: '1px solid var(--border2)', borderRadius: 10, padding: '6px 8px', background: 'var(--surface)',
            }}>
              {a.still_url
                ? <img src={a.still_url} alt="" onClick={() => a.still_url && onPreview(a.still_url, false)}
                    style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 7, cursor: 'zoom-in', border: '1px solid var(--border)' }} />
                : <span style={{ width: 44, height: 44, borderRadius: 7, border: '1px dashed var(--border2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 15 }}>▦</span>}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <input
                  value={a.title}
                  onChange={e => patch(a.id, { title: e.target.value })}
                  style={{ ...area, border: '1px solid transparent', width: 130, padding: '1px 4px', fontSize: 11.5, fontWeight: 700 }}
                />
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setStillPickerFor(a.id)} title={a.still_model_name ?? t('xd.sb.pickstillmodel')}
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 10, color: 'var(--muted2)', textDecoration: 'underline dotted', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >{a.still_model_name ?? `☰ ${t('xd.sb.pickmodel')}`}</button>
                  <span style={{ ...label, letterSpacing: 0 }}>{(() => { const p = stillPriceOf(a); return p != null ? money(p) : '' })()}</span>
                  {a.status === 'generating'
                    ? <span className="nav-history-spin" aria-label="generating" />
                    : <button onClick={() => onGenerate(a.id, 'still')} disabled={busy || !a.shot?.trim()}
                        title={a.still_row_id ? t('xd.sb.restill') : t('xd.sb.genstillhint')}
                        style={{ border: '1px solid ' + (a.still_row_id ? 'var(--border2)' : 'var(--red)'), background: a.still_row_id ? 'transparent' : 'var(--red-dim)', color: a.still_row_id ? 'var(--white)' : 'var(--red)', borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700, cursor: (busy || !a.shot?.trim()) ? 'default' : 'pointer', opacity: (busy || !a.shot?.trim()) ? 0.4 : 1 }}
                      >{a.still_row_id ? '↻' : '▶'}</button>}
                  <button onClick={() => remove(a.id)} title={t('hist.delete')}
                    style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="xd-strip-scroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {shots.map(s => (() => { const i = scenes.indexOf(s); return (
          <div key={s.id} style={{ ...card, borderColor: s.status === 'generating' ? 'var(--red)' : 'var(--border2)' }}>
            {/* Header: number, editable title, reorder / delete */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.continues && i > 0 && (
                <span title="continues the previous card (chained cut)" aria-label="cut" style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>🔗</span>
              )}
              <span style={{ ...label, color: 'var(--red)', flexShrink: 0 }}>{labels[i]}</span>
              {/* KEYFRAME vs DIRECT is a MODE the user chose to keep, one per
                  cut (owner, Aug 11) — not a hidden fallback. It says which
                  of the two this card is in, and switches on click. */}
              <button
                onClick={() => switchMode(s)}
                title={s.direct ? t('xd.sb.mode.direct.hint') : t('xd.sb.mode.keyframe.hint')}
                style={{
                  ...label, flexShrink: 0, padding: '1px 6px', borderRadius: 999, cursor: 'pointer',
                  border: '1px solid ' + (s.direct ? 'var(--border2)' : 'var(--red-dim)'),
                  background: s.direct ? 'transparent' : 'var(--red-dim)',
                  color: s.direct ? 'var(--muted2)' : 'var(--red)',
                }}
              >{s.direct ? t('xd.sb.mode.direct') : t('xd.sb.mode.keyframe')}</button>
              <input
                value={s.title}
                onChange={e => patch(s.id, { title: e.target.value.slice(0, 80) })}
                style={{ ...area, padding: '2px 4px', fontWeight: 700, fontSize: 13, flex: 1, minWidth: 0 }}
              />
              <button style={iconBtn} aria-label="move left"  onClick={() => move(i, -1)} disabled={i === 0}>◀</button>
              <button style={iconBtn} aria-label="move right" onClick={() => move(i, 1)}  disabled={i === scenes.length - 1}>▶</button>
              {confirmDel === s.id ? (
                <button style={{ ...iconBtn, color: 'var(--red)', fontWeight: 700 }} onClick={() => remove(s.id)}>{t('xd.sb.confirmdel')}</button>
              ) : (
                <button style={iconBtn} aria-label="delete scene" onClick={() => { setConfirmDel(s.id); setTimeout(() => setConfirmDel(c => c === s.id ? null : c), 3500) }}>✕</button>
              )}
            </div>

            {/* Output, once there is one — clicking previews it full size. */}
            {s.url && s.status === 'done' && (
              <button
                onClick={() => onPreview(s.url!, true)}
                style={{ border: 'none', padding: 0, cursor: 'pointer', borderRadius: 8, overflow: 'hidden', background: '#000', height: 150 }}
              >
                <video src={s.url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            )}

            {/* KEYFRAME mode (owner, Aug 11): the approved still that this
                cut will animate from. Shown while there is no clip yet, so
                the look gets judged at cents before spending on motion. */}
            {s.still_url && !(s.url && s.status === 'done') && (
              <button
                onClick={() => onPreview(s.still_url!, false)}
                title={t('xd.sb.stillhint')}
                style={{ position: 'relative', border: '1px solid var(--red-dim)', padding: 0, cursor: 'pointer', borderRadius: 8, overflow: 'hidden', background: '#000', height: 150 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.still_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <span style={{
                  position: 'absolute', left: 6, top: 6, background: 'var(--red)', color: '#fff',
                  fontSize: 8.5, fontFamily: 'var(--mono)', letterSpacing: '0.08em',
                  padding: '2px 6px', borderRadius: 4,
                }}>{t('xd.sb.still')}</span>
              </button>
            )}

            {/* Script — the user-facing sentence(s). */}
            <div>
              <div style={label}>{t('xd.sb.script')}</div>
              <textarea
                rows={5} value={s.script}
                onChange={e => patch(s.id, { script: e.target.value.slice(0, 500) })}
                style={{ ...area, border: '1px solid var(--border)' }}
              />
            </div>

            {/* Shot prompt — folded by default. */}
            <div>
              <button
                onClick={() => setOpenShot(o => ({ ...o, [s.id]: !o[s.id] }))}
                style={{ ...iconBtn, ...label, padding: 0, cursor: 'pointer' }}
              >{openShot[s.id] ? '▾' : '▸'} {t('xd.sb.shot')}</button>
              {openShot[s.id] && (
                <textarea
                  rows={8} value={s.shot}
                  onChange={e => patch(s.id, { shot: e.target.value.slice(0, 1200) })}
                  style={{ ...area, border: '1px solid var(--border)', fontSize: 11.5, marginTop: 4 }}
                />
              )}
            </div>

            {/* References — this scene's own visual anchors (Aug 8). */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              {(s.refs ?? []).map(r => (
                <span key={r.storagePath} title={r.fileName} style={{ position: 'relative', display: 'inline-flex' }}>
                  {r.previewUrl && r.mediaType.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.previewUrl} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                  ) : (
                    <span style={{ width: 34, height: 34, borderRadius: 6, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: 'var(--surface2)' }}>
                      {r.mediaType.startsWith('video/') ? '🎞' : '🖼'}
                    </span>
                  )}
                  <button onClick={() => removeRef(s.id, r.storagePath)} aria-label="remove reference"
                    style={{ position: 'absolute', top: -5, right: -5, width: 15, height: 15, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 8, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
                </span>
              ))}
              {(s.refs ?? []).length < MAX_SCENE_REFS && (
                <button
                  onClick={() => { refSceneId.current = s.id; refInputRef.current?.click() }}
                  disabled={uploadingRef === s.id}
                  title={t('xd.sb.addref')} aria-label={t('xd.sb.addref')}
                  style={{ width: 34, height: 34, borderRadius: 6, border: '1px dashed var(--border2)', background: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}
                >{uploadingRef === s.id ? '…' : '📎'}</button>
              )}
              {(s.refs ?? []).length > 0 && (
                <span style={{ ...label, color: 'var(--muted2)' }}>{s.recipe ?? 'image_to_video'}</span>
              )}
            </div>

            {/* Footer: two steps, two models, two prices, two buttons
                (owner, Aug 11). KEYFRAME is the default flow — the still is
                the cheap look test, the video is the expensive commitment.
                One button quoting one price hid which of the two you were
                about to buy. */}
            {(() => {
              const stillDone = !!s.still_row_id
              const videoDone = s.status === 'done'
              const gen       = s.status === 'generating'
              const blocked   = busy || !s.shot.trim()
              // Only one step can be in flight, and which one is knowable:
              // before the still exists, a running scene is shooting it.
              const genStill  = gen && !stillDone && !s.direct
              const sp = stillPriceOf(s), vp = priceOf(s)
              const rowSty: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }
              const priceSty = (c: string): React.CSSProperties => ({
                ...label, color: c, flexShrink: 0, minWidth: 34, textAlign: 'right', letterSpacing: 0,
              })
              const pickSty = (named: boolean): React.CSSProperties => ({
                fontSize: 10.5, color: named ? 'var(--muted2)' : 'var(--red)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
                textDecoration: 'underline dotted', textUnderlineOffset: 3, padding: 0,
              })
              const runSty = (on: boolean, off: boolean): React.CSSProperties => ({
                padding: '3px 8px', borderRadius: 999, flexShrink: 0,
                border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'),
                background: on ? 'var(--red-dim)' : 'transparent',
                color: on ? 'var(--red)' : 'var(--white)',
                cursor: off ? 'default' : 'pointer', opacity: off ? 0.35 : 1,
                fontFamily: 'var(--font-mono), monospace', fontSize: 10, fontWeight: 700,
              })
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 'auto' }}>
                  {/* STEP 1 — the key still. Hidden only when the user chose
                      to go straight to video for this cut. */}
                  {!s.direct && (
                    <div style={rowSty}>
                      <span style={{ ...label, width: 32, flexShrink: 0, color: stillDone ? 'var(--green)' : 'var(--muted)' }}>
                        {stillDone ? '✓ ' : ''}{t('xd.sb.genstill')}
                      </span>
                      <button
                        onClick={() => setStillPickerFor(s.id)}
                        title={s.still_model_name ?? t('xd.sb.pickstillmodel')}
                        style={pickSty(!!s.still_model_name)}
                      >{s.still_model_name ?? `☰ ${t('xd.sb.pickmodel')}`}</button>
                      <span style={priceSty('var(--muted2)')}>{sp != null ? money(sp) : ''}</span>
                      {nudge === s.id && (
                        <span style={{ ...label, color: 'var(--red)', letterSpacing: 0, flexShrink: 0 }}>{t('xd.sb.stillfirst')}</span>
                      )}
                      {genStill ? (
                        <span className="nav-history-spin" aria-label="generating" style={{ flexShrink: 0 }} />
                      ) : (
                        <button
                          onClick={() => onGenerate(s.id, 'still')} disabled={blocked || gen}
                          title={stillDone ? t('xd.sb.restill') : t('xd.sb.genstillhint')}
                          style={{ ...runSty(!stillDone && !videoDone, blocked || gen),
                            ...(nudge === s.id ? { boxShadow: '0 0 0 4px var(--red-dim)', transform: 'scale(1.2)', transition: 'transform 0.15s' } : {}) }}
                        >{stillDone ? '↻' : '▶'}</button>
                      )}
                    </div>
                  )}

                  {/* STEP 2 — the clip. Refused until a still exists, unless
                      this cut is direct: the server rejects it either way,
                      so the button must not pretend otherwise. */}
                  <div style={rowSty}>
                    <input
                      type="number" min={2} max={15} value={s.duration_s}
                      onChange={e => patch(s.id, { duration_s: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 2), 15) })}
                      style={{ ...area, border: '1px solid var(--border)', width: 38, textAlign: 'center', padding: '2px 2px', fontSize: 11.5, flexShrink: 0 }}
                    />
                    <span style={{ ...label, flexShrink: 0 }}>s</span>
                    <button
                      onClick={() => setPickerFor(s.id)}
                      title={losesTheFrame(s) === 'total' ? t('xd.sb.noframe.total')
                        : losesTheFrame(s) === 'partial' ? t('xd.sb.noframe')
                        : (s.model_name ?? t('xd.sb.pickmodel'))}
                      style={{ ...pickSty(!!s.model_name), ...(losesTheFrame(s) ? { color: 'var(--red)' } : {}) }}
                    >{losesTheFrame(s) ? '⚠ ' : ''}{s.model_name ?? `☰ ${t('xd.sb.pickmodel')}`}</button>
                    {videoDone ? (
                      <span style={priceSty('var(--green)')}>${(s.cost ?? 0).toFixed(2)}</span>
                    ) : (
                      <span style={priceSty(s.status === 'error' ? 'var(--red)' : 'var(--muted2)')}>{vp != null ? money(vp) : ''}</span>
                    )}
                    {(gen && !genStill) ? (
                      <span className="nav-history-spin" aria-label="generating" style={{ flexShrink: 0 }} />
                    ) : (
                      <button
                        onClick={() => (!stillDone && !s.direct) ? nudgeStill(s.id) : onGenerate(s.id, 'video')}
                        disabled={blocked || gen}
                        title={s.error ? `${s.error} — ${t('xd.sb.gen')}`
                          : (!stillDone && !s.direct) ? t('xd.sb.needstill') : t('xd.sb.genvideohint')}
                        style={runSty(stillDone || !!s.direct, blocked || gen || (!stillDone && !s.direct))}
                      >{s.status === 'error' ? '⚠' : videoDone ? '↻' : (!stillDone && !s.direct) ? '🔒' : '▶'}</button>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        ) })())}

        {/* Ghost card: add a scene by hand. */}
        <button
          onClick={addScene}
          style={{
            ...card, width: 140, alignItems: 'center', justifyContent: 'center',
            border: '1px dashed var(--border2)', background: 'transparent',
            color: 'var(--muted)', cursor: 'pointer', fontSize: 12, gap: 4,
          }}
        >
          <span style={{ fontSize: 18 }}>+</span>
          <span>{t('xd.sb.add')}</span>
        </button>
      </div>

      {/* One shared file input serves every card's 📎. */}
      <input
        ref={refInputRef} type="file" style={{ display: 'none' }}
        accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addRef(f) }}
      />

      {/* Per-scene model picker: refs present → only models that can eat
          them; none → text_to_video models. Same dialog as everywhere. */}
      {stillPickerFor && (() => {
        const sc = scenes.find(x => x.id === stillPickerFor)
        if (!sc) return null
        // A cut with references is an EDIT of them (that is how likeness
        // survives); a bare cut is a fresh frame.
        const hasRefs = (sc.refs ?? []).length > 0
        return (
          <ModelPickerDialog
            mode="image" recipeMode={(hasRefs ? 'image_edit' : 'text_to_image') as any} slotIds={[]}
            onClose={() => setStillPickerFor(null)}
            onSelect={(m: any) => {
              patch(sc.id, { still_model_id: m.id, still_model_name: m.display_name })
              setStillPickerFor(null)
            }}
          />
        )
      })()}

      {pickerFor && (() => {
        const sc = scenes.find(s => s.id === pickerFor)
        if (!sc) return null
        // Any scene that consumes images — card refs OR a chained cut —
        // offers BOTH families (owner override, Aug 9: excluding reference
        // models from 🔗 scenes read as a bug). The nuance lives in the
        // recipe resolution below: a cut PREFERS image_to_video (locks the
        // opening frame), a refs scene PREFERS reference recipes (keeps
        // the subject); picking a model that only speaks the other family
        // is allowed — the user's call outranks the doctrine.
        const hasRefs = (sc.refs ?? []).length > 0
        const recipeMode: any = (sc.continues || hasRefs || opensOnStill(sc))
          ? ['image_to_video', 'reference_frames']
          : 'text_to_video'
        return (
          <ModelPickerDialog
            mode="video" recipeMode={recipeMode as any} slotIds={[]}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => {
              // Cheapest listed per-second rate — same estimate rule the
              // director itself uses.
              const ps = m.model_pricing?.per_video_second
              const perSec = ps && typeof ps === 'object'
                ? Math.min(...Object.values(ps).map(Number).filter((n: any) => Number.isFinite(n)))
                : null
              // The union resolves to whatever the picked model speaks:
              // a cut prefers image_to_video (locks the opening frame), a
              // refs scene prefers reference recipes (keeps the subject) —
              // and either falls back to what the model actually supports.
              const modes: string[] = m.modes ?? []
              const recipe = Array.isArray(recipeMode)
                ? ((sc.continues || opensOnStill(sc))
                  ? (modes.includes('image_to_video') ? 'image_to_video' : 'reference_frames')
                  : (modes.includes('reference_frames') ? 'reference_frames' : 'image_to_video'))
                : recipeMode
              patch(sc.id, {
                model_id: m.id, model_name: m.display_name, recipe,
                ...(Number.isFinite(perSec as number) ? { estimate: (perSec as number) * (sc.duration_s || 6) } : {}),
              })
              setPickerFor(null)
            }}
          />
        )
      })()}
    </div>
  )
}
