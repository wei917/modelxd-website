// lib/ports.ts — the typed-port contract of the canvas (owner, Aug 15:
// ComfyUI-style — "a video model that takes reference images has a port for
// them; if it also takes audio, there is an audio port").
//
// A model's ports are DERIVED from its catalog row: input_modalities say
// which media types it accepts, modes say in which roles. One schema serves
// three masters: the canvas renders it (empty ports included — an unwired
// ♪ on H3 teaches that audio input exists), generation validates against
// it, and drag-to-wire will consult it for legality.
//
// Wires are persisted per generation on xcreates.input_ports (migration
// 81) — the canonical record of what fed what, replacing filename
// conventions and attachment-order inference.

export type PortType = 'image' | 'audio' | 'video'

export type PortSpec = {
  /** The provider-facing role: first_frame, reference_image, … */
  name: string
  type: PortType
  /** Maximum wires this port accepts. */
  max: number
  /** Ports in DIFFERENT conflict groups cannot be wired together —
   *  H3's frame mode vs reference mode, probed live Aug 14. */
  conflict?: 'frame' | 'reference'
}

export type PortWireSource =
  | { kind: 'row'; row_id: string; slot?: number }
  | { kind: 'file'; bucket: string; path: string; name?: string }

export type PortWire = {
  port: string
  type: PortType
  source: PortWireSource
}

type CatalogModel = {
  provider?: string
  model_name?: string
  input_modalities?: string[] | null
  modes?: string[] | null
  output_modalities?: string[] | null
}

/** Derive the input-port schema for a catalog model. Prompt/text is a
 *  parameter, not a wire — only media ports appear here. */
export function portSchemaFor(m: CatalogModel): PortSpec[] {
  const modes = m.modes ?? []
  const inputs = m.input_modalities ?? []
  const ports: PortSpec[] = []
  const video = (m.output_modalities ?? []).includes('video')

  if (video) {
    if (modes.includes('image_to_video')) {
      ports.push({ name: 'first_frame', type: 'image', max: 1, conflict: 'frame' })
    }
    if (modes.includes('start_end_frames')) {
      if (!ports.some(p => p.name === 'first_frame')) {
        ports.push({ name: 'first_frame', type: 'image', max: 1, conflict: 'frame' })
      }
      ports.push({ name: 'last_frame', type: 'image', max: 1, conflict: 'frame' })
    }
    if (modes.includes('reference_frames')) {
      ports.push({
        name: 'reference_image', type: 'image',
        max: m.provider === 'minimax' ? 9 : 4,
        conflict: 'reference',
      })
    }
    if (inputs.includes('audio')) {
      ports.push({ name: 'reference_audio', type: 'audio', max: 3, conflict: 'reference' })
    }
    if (modes.includes('extend_video') || modes.includes('video_edit') || modes.includes('video_to_video')) {
      ports.push({ name: 'video_in', type: 'video', max: 1 })
    }
  } else if ((m.output_modalities ?? []).includes('image')) {
    if (modes.includes('image_edit') || modes.includes('image_to_image')) {
      ports.push({ name: 'source_image', type: 'image', max: 9 })
    }
  }
  return ports
}

/** True when the wire set violates the schema's conflict groups —
 *  e.g. a first_frame wired together with any reference port. */
export function wiresConflict(schema: PortSpec[], wires: PortWire[]): string | null {
  const groups = new Set(
    wires
      .map(w => schema.find(p => p.name === w.port)?.conflict)
      .filter(Boolean) as string[],
  )
  if (groups.size > 1) {
    return 'frame mode and reference mode are exclusive — pin the first frame OR use references (with audio), never both'
  }
  return null
}

/** Assign schema ports to attachments in order. Caller-set ports win;
 *  the rest fill by media type. When audio is present and the audio port
 *  belongs to a conflict group (H3: reference), that group governs every
 *  conflicted assignment — the same rule minimax.ts used to infer, now
 *  decided once, here, for all providers. Returns shallow copies; never
 *  mutates (the same attachment array serves several models per run). */
export function assignPorts<T extends { mediaType: string; port?: string }>(
  schema: PortSpec[],
  atts: T[],
): T[] {
  if (schema.length === 0) return atts
  // A caller-declared port's group governs first (declaring reference_image
  // means the whole run is reference mode); otherwise audio decides.
  const declared = atts
    .map(a => a.port && schema.find(p => p.name === a.port)?.conflict)
    .find(Boolean) as PortSpec['conflict'] | undefined
  const hasAudio = atts.some(a => a.mediaType.startsWith('audio/'))
  const audioPort = schema.find(p => p.type === 'audio')
  const forced = declared ?? (hasAudio ? audioPort?.conflict ?? null : null)
  const usable = schema.filter(p => !forced || !p.conflict || p.conflict === forced)

  const used = new Map<string, number>()
  for (const a of atts) if (a.port) used.set(a.port, (used.get(a.port) ?? 0) + 1)

  return atts.map(a => {
    if (a.port && schema.some(p => p.name === a.port)) return a
    const type = a.mediaType.split('/')[0] as PortType
    const slot = usable.find(p => p.type === type && (used.get(p.name) ?? 0) < p.max)
    if (!slot) return a
    used.set(slot.name, (used.get(slot.name) ?? 0) + 1)
    return { ...a, port: slot.name }
  })
}

/** The persistable wire list for a run: attachments that landed on a port
 *  AND know where they came from. */
export function toWires(
  atts: Array<{ mediaType: string; port?: string; wireSource?: PortWireSource }>,
): PortWire[] {
  return atts
    .filter(a => a.port && a.wireSource)
    .map(a => ({
      port: a.port!,
      type: a.mediaType.split('/')[0] as PortType,
      source: a.wireSource!,
    }))
}

export const PORT_COLORS: Record<PortType, string> = {
  image: 'var(--blue)',
  audio: '#a78bfa',
  video: 'var(--red)',
}
