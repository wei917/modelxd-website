'use client'
// app/xtalk/ModelSlots.tsx
//
// The seat row: one slot per speaker, each opening the same picker dialog
// XCreate uses.
//
// It replaces a wall of every model as a toggle chip. That grid answered
// "which models exist"; a table needs the opposite — "who is sitting here",
// in order, with an empty chair you can fill. Thirteen chips also gave no
// hint that order matters in Discussion, or that Werewolf needs exactly N.
//
// Slots are positional. Discussion grows one trailing empty slot at a time
// up to its maximum; Werewolf shows exactly the number of chairs the deal
// needs, so the gaps themselves say how many models are still missing.

import { useState } from 'react'
import ProviderLogo from '../components/ProviderLogo'
import ModelPickerDialog from '../components/ModelPickerDialog'
import { useT } from '../../lib/i18n'
import { SeatConfig, DEFAULT_SEAT_OPTS, type SeatOpts } from './SeatConfig'
import type { Speaker } from './templates'

const LABELS = 'ABCDEFGH'.split('')

export default function ModelSlots({
  models, picked, onPicked, seatOpts, onSeatOpts, allowSearch = true, count, fixed = false,
  allowDuplicates = false,
}: {
  /** Every text model, already loaded by the shell. */
  models: Speaker[]
  picked: string[]
  onPicked: (next: string[]) => void
  seatOpts: Record<string, SeatOpts>
  onSeatOpts: (next: Record<string, SeatOpts>) => void
  /** False when search is decided for the whole table (Werewolf). */
  allowSearch?: boolean
  /** How many slots to draw. */
  count: number
  /** Fixed tables never grow or shrink; an empty slot is a missing player. */
  fixed?: boolean
  /** Werewolf lets the same model take several chairs — a 7×Fable table is
   *  a clean test of one model against itself. Discussion does not: two of
   *  one model in a conversation is just that model twice. */
  allowDuplicates?: boolean
}) {
  const t = useT()
  const [openSlot, setOpenSlot] = useState<number | null>(null)

  const setAt = (i: number, id: string | null) => {
    const next = [...picked]
    if (id === null) next.splice(i, 1)
    else next[i] = id
    onPicked(next.filter(Boolean))
  }

  return (
    <>
      <div style={{
        display: 'grid', gap: 8, marginBottom: 16,
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      }}>
        {Array.from({ length: count }, (_, i) => {
          const id = picked[i]
          const m  = id ? models.find(x => x.id === id) : null

          if (!m) {
            return (
              <button key={`empty-${i}`} onClick={() => setOpenSlot(i)} style={{
                height: 52, padding: '0 12px', borderRadius: 10, cursor: 'none',
                border: '1px dashed var(--border2)', background: 'var(--surface)',
                color: 'var(--muted)', fontSize: 12, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <span style={{ fontSize: 17, lineHeight: 1 }}>+</span>
                {t('xcreate.modelslot').replace('{l}', LABELS[i] ?? String(i + 1))}
              </button>
            )
          }

          return (
            // A div, not a button: the gear and the × inside are buttons, and
            // nesting buttons is invalid — the browser lifts the inner ones
            // out and the slot stops responding.
            <div key={`slot-${i}`} style={{
              height: 52, padding: '0 10px 0 12px', borderRadius: 10,
              border: '1px solid var(--border2)', background: 'var(--surface)',
              display: 'flex', alignItems: 'center', gap: 9,
            }}>
              <ProviderLogo provider={m.provider} size={16} />
              <span
                onClick={() => setOpenSlot(i)}
                title="Swap this seat"
                style={{
                  flex: 1, minWidth: 0, cursor: 'none', fontSize: 13,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >{m.display_name}</span>

              <SeatConfig
                model={m}
                allowSearch={allowSearch}
                opts={seatOpts[m.id] ?? DEFAULT_SEAT_OPTS}
                onChange={next => onSeatOpts({ ...seatOpts, [m.id]: next })}
              />
              {/* On a fixed table the slot must stay — clearing it leaves the
                  chair empty rather than shrinking the game below its board. */}
              {/* Same weight and metrics as XCreate's slot — the two pickers
                  are the same control and should not read as two designs. */}
              <button
                title="Remove"
                onClick={() => setAt(i, null)}
                aria-label={`clear slot ${i + 1}`}
                style={{
                  background: 'none', border: 'none', color: 'var(--muted)',
                  cursor: 'none', fontSize: 26, lineHeight: 1,
                  padding: '4px 2px', flexShrink: 0,
                }}
              >×</button>
            </div>
          )
        })}
      </div>

      {openSlot !== null && (
        <ModelPickerDialog
          mode="text"
          // Every text model declares this, so the dialog's recipe filter is a
          // no-op here and it reads as a plain list. See its header note.
          recipeMode="text_to_text"
          slotIds={Array.from({ length: count }, (_, i) => picked[i] ?? null)}
          onSelect={sel => {
            // Discussion refuses a model already seated elsewhere; Werewolf
            // allows it (same model in several chairs, disambiguated by the
            // server with (2), (3)…).
            if (!allowDuplicates && picked.includes(sel.id) && picked[openSlot] !== sel.id) { setOpenSlot(null); return }
            setAt(openSlot, sel.id)
            setOpenSlot(null)
          }}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </>
  )
}
