'use client'
// app/components/LabeledSlotsPicker.tsx
//
// Generic 1-N labeled image-slot picker. Replaces the generic
// AttachmentButton when a slot mode (start_end_frames, reference_frames)
// or a template needs clearly labeled upload positions.
//
// Examples:
//   • start_end_frames: slots=[{label:'FIRST FRAME'}, {label:'LAST FRAME'}]
//     arrows=true → renders "first" → "last" with a temporal arrow.
//   • Titanic template:  slots=[{label:'ROSE'}, {label:'JACK'}]
//     arrows=false       → renders two equal character slots.
//   • Single-character:  slots=[{label:'ASTRONAUT'}]
//     arrows=false       → single slot, no arrow, no swap.
//
// Slot order is preserved 1:1 onto `attachments[]`, so the provider
// router receives the same shape as the generic picker would have built.

import { useRef, useState } from 'react'
import { pendingAttachment, type Attachment } from './AttachmentButton'

const MAX_MB    = 100
const MIN_DIM   = 300  // HappyHorse R2V rejects anything under 300px on either axis;
                       // Veo / Wan tolerate smaller but their output benefits from
                       // ≥300px references too. Enforce client-side to avoid a slow
                       // server round-trip + cryptic provider error.
const ALLOWED   = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ACCEPT    = ALLOWED.join(',')  // default: images only

/** Read intrinsic dimensions of an image File via a one-shot Image element.
 *  Resolves to null if the file isn't a decodable image. */
function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

export interface SlotLabel {
  label: string
  hint?: string
}

export default function LabeledSlotsPicker({
  slots,
  attachments,
  onChange,
  disabled,
  context = 'xcreate',
  arrows = false,
  swappable = false,
  compact = false,
  accept,
}: {
  slots:       SlotLabel[]
  attachments: Attachment[]
  onChange:    (a: Attachment[]) => void
  disabled?:   boolean
  context?:    'xduel' | 'xcreate'
  /** If true, render → arrows between slots (temporal modes). */
  arrows?:     boolean
  /** If true, show a Swap button when both first two slots are filled.
   *  Only meaningful when slots.length === 2. */
  swappable?:  boolean
  /** Compact mode for rendering INSIDE the composer frame: smaller
   *  thumbnails, no own box chrome, hint becomes a tooltip. */
  compact?:    boolean
  /** Comma-separated mime types the slots accept. Defaults to images.
   *  Non-image mimes skip the min-dimension check. */
  accept?:     string
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

  // Read by slot tag, NOT by array position. This is what fixes the
  // "I uploaded to JACK but it appeared in ROSE" bug: each attachment
  // carries its own slot index, so a single upload to slot 1 stays
  // in slot 1 even when attachments[] only has one entry.
  const slotAt = (i: number): Attachment | null =>
    attachments.find(a => (a.slotIndex ?? -1) === i) ?? null

  const allowedTypes = (accept ?? ACCEPT).split(',').map(s => s.trim())

  // Validates and wraps — no network. The bytes stay in the browser until
  // the run is submitted (commitAttachments), so a slot the user fills and
  // then clears never reaches storage at all.
  const uploadOne = async (file: File, idx: number) => {
    if (!allowedTypes.includes(file.type)) { alert(`Unsupported file type: ${file.type || 'unknown'}`); return null }
    if (file.size > MAX_MB * 1024 * 1024) { alert(`${file.name} too large — max ${MAX_MB}MB`); return null }

    // Check dimensions up front (images only). HappyHorse R2V rejects
    // sub-300px references with a slow round-trip error; bail early with
    // a clear message instead. Decoding a large photo isn't instant, so
    // the slot shows its spinner while we read it.
    if (file.type.startsWith('image/')) {
      setUploadingIdx(idx)
      let dims: { width: number; height: number } | null
      try { dims = await readImageDimensions(file) } finally { setUploadingIdx(null) }
      if (!dims) { alert(`Couldn't read image dimensions for ${file.name}.`); return null }
      if (dims.width < MIN_DIM || dims.height < MIN_DIM) {
        alert(
          `Image is too small (${dims.width}×${dims.height}). ` +
          `Reference images need to be at least ${MIN_DIM}×${MIN_DIM} pixels on each side. ` +
          `Pick a larger photo and try again.`
        )
        return null
      }
    }

    return pendingAttachment(file, context, idx)
  }

  // Keep the parent's `attachments` array sorted by slotIndex so the
  // provider (which reads in order) sees ROSE at index 0, JACK at index
  // 1, etc. — independent of which slot the user uploaded to first.
  const persistSorted = (arr: Attachment[]) => {
    const sorted = [...arr].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0))
    onChange(sorted)
  }

  const setSlot = async (idx: number, files: FileList | null) => {
    if (!files || files.length === 0) return
    const att = await uploadOne(files[0], idx)
    if (!att) return
    // Replace any existing attachment with the same slotIndex, then add the new one.
    const next = attachments.filter(a => (a.slotIndex ?? -1) !== idx)
    next.push(att)
    persistSorted(next)
    const el = inputRefs.current[idx]
    if (el) el.value = ''
  }

  const clearSlot = (idx: number) => {
    persistSorted(attachments.filter(a => (a.slotIndex ?? -1) !== idx))
  }

  const swap = () => {
    if (slots.length < 2) return
    const a = slotAt(0)
    const b = slotAt(1)
    if (!a || !b) return
    // Swap their slotIndex tags, then re-sort.
    const swapped = attachments.map(x => {
      if (x === a) return { ...x, slotIndex: 1 }
      if (x === b) return { ...x, slotIndex: 0 }
      return x
    })
    persistSorted(swapped)
  }

  const bothFilled = slots.length === 2 && slotAt(0) && slotAt(1)

  return (
    <div style={compact ? {
      // Compact: no chrome of its own — the composer frame is the box.
      display: 'flex', alignItems: 'center', gap: 10,
      flexWrap: 'wrap' as const,
    } : {
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 12px',
      background: '#ffffff',
      border: '1px solid var(--border2)',
      borderRadius: 10,
      flexWrap: 'wrap' as const,
    }}>
      {slots.map((slot, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 12 }}>
          <FrameSlot
            label={slot.label}
            hint={slot.hint}
            attachment={slotAt(idx)}
            uploading={uploadingIdx === idx}
            disabled={!!disabled}
            compact={compact}
            accept={accept ?? ACCEPT}
            inputRef={(el) => { inputRefs.current[idx] = el }}
            onPick={files => setSlot(idx, files)}
            onClear={() => clearSlot(idx)}
          />
          {idx < slots.length - 1 && arrows && <ArrowDivider compact={compact} />}
        </div>
      ))}

      {swappable && bothFilled && !disabled && (
        <button
          type="button"
          onClick={swap}
          title={`Swap ${slots[0]?.label} and ${slots[1]?.label}`}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--border2)',
            borderRadius: 8,
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'var(--font-mono), monospace',
            letterSpacing: '0.08em',
          }}
        >⇄ Swap</button>
      )}
    </div>
  )
}

function FrameSlot({
  label, hint, attachment, uploading, disabled, compact, accept, inputRef, onPick, onClear,
}: {
  label:      string
  hint?:      string
  attachment: Attachment | null
  uploading:  boolean
  disabled:   boolean
  compact?:   boolean
  accept?:    string
  inputRef:   (el: HTMLInputElement | null) => void
  onPick:     (files: FileList | null) => void
  onClear:    () => void
}) {
  const localInputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const empty = !attachment
  const size = compact ? 52 : 84
  return (
    <div
      title={compact ? (hint ?? label) : undefined}
      style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: compact ? 3 : 4 }}
    >
      <span style={{
        fontSize: 9, color: 'var(--muted)',
        fontFamily: 'var(--font-mono), monospace',
        letterSpacing: '0.15em', textTransform: 'uppercase' as const,
      }}>{label}</span>

      <input
        ref={(el) => { localInputRef.current = el; inputRef(el) }}
        type="file"
        accept={accept ?? ACCEPT}
        style={{ display: 'none' }}
        onChange={e => onPick(e.target.files)}
      />

      <div
        onClick={() => !disabled && !uploading && empty && localInputRef.current?.click()}
        // Drag & drop: dropping a file on a slot uploads into THAT slot
        // (replacing whatever was there). dragOver preventDefault is what
        // makes the tile a valid drop target.
        onDragOver={e => { if (disabled || uploading) return; e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          if (disabled || uploading) return
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onPick(e.dataTransfer.files)
        }}
        style={{
          width: size, height: size,
          borderRadius: 8,
          border: dragOver
            ? '2px dashed var(--red)'
            : empty
              ? `1px dashed ${disabled ? 'var(--border)' : 'var(--border2)'}`
              : `1px solid var(--border)`,
          background: dragOver ? 'rgba(214,59,50,0.06)' : empty ? 'transparent' : '#000',
          cursor: disabled || uploading ? 'default' : empty ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative' as const,
          overflow: 'hidden',
          transition: 'border-color 0.15s',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {uploading ? (
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid var(--border2)', borderTopColor: 'var(--muted)',
            animation: 'spin 0.6s linear infinite',
          }} />
        ) : empty ? (
          <div style={{ color: 'var(--muted)', fontSize: compact ? 18 : 24, lineHeight: 1 }}>+</div>
        ) : (
          <>
            {attachment.mediaType?.startsWith('image/') ? (
              <img
                src={attachment.previewUrl}
                alt={label}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : attachment.mediaType === 'application/pdf' || attachment.mediaType?.startsWith('text/') ? (
              // Document: generated "page" thumbnail — light sheet with a
              // page glyph and the file extension (TXT / PDF / …).
              <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <span style={{ fontSize: compact ? 16 : 22, lineHeight: 1 }}>📄</span>
                <span style={{ fontSize: 8, fontWeight: 700, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                  {(attachment.fileName?.split('.').pop() ?? 'DOC').toUpperCase().slice(0, 4)}
                </span>
              </div>
            ) : (
              // Video: no thumbnail — dark tile with a play glyph.
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>▶</div>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onClear() }}
                title="Remove"
                style={{
                  position: 'absolute' as const, top: 4, right: 4,
                  width: 18, height: 18, borderRadius: 9,
                  background: 'rgba(0,0,0,0.55)', border: 'none',
                  color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, lineHeight: 1, padding: 0,
                }}
              >×</button>
            )}
          </>
        )}
      </div>
      {/* Hint text only in the roomy variant — compact uses a tooltip. */}
      {hint && !compact && (
        <span style={{ fontSize: 9, color: 'var(--muted2)', maxWidth: 96, textAlign: 'center' as const, lineHeight: 1.3 }}>
          {hint}
        </span>
      )}
    </div>
  )
}

function ArrowDivider({ compact }: { compact?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4,
      paddingTop: 14,
    }}>
      <span style={{
        fontSize: 9, color: 'transparent',
        fontFamily: 'var(--font-mono), monospace',
        letterSpacing: '0.15em',
      }}>·</span>
      <div style={{
        display: 'flex', alignItems: 'center',
        color: 'var(--muted2)',
        height: compact ? 52 : 84,
      }}>
        <svg width="24" height="14" viewBox="0 0 24 14" fill="none">
          <path d="M0 7 L20 7 M14 1 L20 7 L14 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}
