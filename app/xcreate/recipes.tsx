// app/xcreate/recipes.tsx — the studio's input → output modes ("recipes"),
// their names' order and their icons: ONE list, read by X創作's From menu
// and by XDuel's video Mode row (owner, Oct 19: "the modes do not match
// what XCreate's video tab"; the duel had grown its own list). Names come
// from the `recipefrom.<id>` strings. Moved here from client.tsx unchanged.

import ModeIcon from '../components/ModeIcon'

export type StudioMode = 'text' | 'image' | 'video' | 'audio'
export type InputKind = 'text' | 'image' | 'video' | 'pdf' | 'frames' | 'references' | 'audio'

export type ModelMode =
  | 'text_to_text'
  | 'image_to_text'
  | 'video_to_text'
  | 'audio_to_text'
  | 'pdf_to_text'
  | 'text_to_image'
  | 'image_edit'
  | 'region_edit'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_to_video'
  | 'video_edit'
  | 'extend_video'
  | 'audio_to_video'
  | 'text_to_speech'
  | 'text_to_music'
  | 'start_end_frames'
  | 'reference_frames'


// ── Processing recipes (Layer 2) ─────────────────────────────────────────────
// Each output type (text/image/video) offers a set of "recipes" — one
// ModelMode (input→output pattern). A single recipe applies to the whole run:
// it filters the model picker to models that support it and decides what the
// user uploads (see recipeInputSlots).
export interface Recipe {
  id:      ModelMode
  title:   string   // short friendly name
  recipe:  string   // input → output, e.g. "TEXT → IMAGE"
  provide: string   // what the user supplies
}
export const RECIPES: Record<StudioMode, Recipe[]> = {
  audio: [
    { id: 'text_to_speech', title: 'Text to Speech', recipe: 'TEXT → AUDIO', provide: 'a script' },
  ],
  text: [
    { id: 'text_to_text',  title: 'Text to Text',  recipe: 'TEXT → TEXT',  provide: 'a prompt' },
    { id: 'image_to_text', title: 'Image to Text', recipe: 'IMAGE → TEXT', provide: '1 image + a prompt' },
    { id: 'pdf_to_text',   title: 'PDF to Text',   recipe: 'PDF → TEXT',   provide: '1 PDF + a prompt' },
    { id: 'video_to_text', title: 'Video to Text', recipe: 'VIDEO → TEXT', provide: '1 video + a question — the model watches it' },
    { id: 'audio_to_text', title: 'Audio to Text', recipe: 'AUDIO → TEXT', provide: '1 audio/MP4 — verbatim transcript with timestamps' },
  ],
  image: [
    { id: 'text_to_image', title: 'Text to Image',  recipe: 'TEXT → IMAGE',  provide: 'a prompt' },
    { id: 'image_edit',    title: 'Image to Image', recipe: 'IMAGE → IMAGE', provide: '1 image + a prompt' },
  ],
  video: [
    { id: 'text_to_video',    title: 'Text to Video',      recipe: 'TEXT → VIDEO',     provide: 'a prompt' },
    { id: 'image_to_video',   title: 'Image to Video',     recipe: 'IMAGE → VIDEO',    provide: '1 image + a prompt' },
    { id: 'video_to_video',   title: 'Edit with a Prompt', recipe: 'VIDEO → VIDEO',    provide: '1 video + a prompt — change it with words alone, no reference images' },
    { id: 'extend_video',     title: 'Continue a Video',   recipe: 'VIDEO → LONGER',   provide: '1 video + a prompt — the model carries the motion on past the end' },
    { id: 'video_edit',       title: 'Edit with References', recipe: 'VIDEO + REFS → VIDEO', provide: '1 video + reference images + a prompt — SHOW the model what to put in' },
    { id: 'start_end_frames', title: 'Frames to Video',    recipe: '2 FRAMES → VIDEO', provide: '2 images: first + last' },
    { id: 'reference_frames', title: 'Reference to Video', recipe: 'REFS → VIDEO',     provide: '1–2 portraits + a prompt' },
    { id: 'audio_to_video',   title: 'Audio to Video',     recipe: 'AUDIO → VIDEO',    provide: '1 song (MP3/WAV, up to 15s) + a prompt — the music drives the performance' },
  ],
}


// Input-type icon for the sub-mode menu (superset of ModeIcon: adds
// pdf / frames / references). Same 16px stroke style as ModeIcon.
export function InputIcon({ kind, size = 16 }: { kind: InputKind; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  if (kind === 'text' || kind === 'image' || kind === 'video') return <ModeIcon m={kind} size={size} />
  if (kind === 'audio')  return (<svg {...p}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>)
  if (kind === 'pdf')    return (<svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>)
  if (kind === 'frames') return (<svg {...p}><rect x="2" y="6" width="9" height="12" rx="1"/><rect x="13" y="6" width="9" height="12" rx="1"/></svg>)
  return (<svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>)
}

// recipe id → [input icon, output icon] for the sub-mode menu entries.
export const RECIPE_ICONS: Record<string, [InputKind, StudioMode]> = {
  text_to_text:     ['text',       'text'],
  image_to_text:    ['image',      'text'],
  pdf_to_text:      ['pdf',        'text'],
  video_to_text:    ['video',      'text'],
  audio_to_text:    ['audio',      'text'],
  text_to_image:    ['text',       'image'],
  image_edit:       ['image',      'image'],
  text_to_video:    ['text',       'video'],
  image_to_video:   ['image',      'video'],
  video_to_video:   ['video',      'video'],
  video_edit:       ['video',      'video'],
  extend_video:     ['video',      'video'],
  start_end_frames: ['frames',     'video'],
  reference_frames: ['references', 'video'],
  audio_to_video:   ['audio',      'video'],
}
