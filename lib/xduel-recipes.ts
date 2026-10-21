// lib/xduel-recipes.ts — the kinds of video duel (owner, Oct 19: "break
// video xduel into detailed areas, ex: start frame, ... start+end frame,
// reference frame, text, music"). Shared by the page and the route.
//
// Each kind says which models may enter the draw (by their declared
// `modes`), which inputs both of them get (by typed port, lib/ports.ts),
// and whether the prompt may be left empty. Both models always get the
// same files: that is what makes the vote a comparison.
//
// The kinds, their order and names are X創作's own (app/xcreate/recipes.tsx,
// `recipefrom.<id>`; owner, Oct 19: "the modes do not match what XCreate's
// video tab"), less the two no duel can hold: 延長影片 (Veo extends only
// videos it made itself in the last 2 days, so an uploaded clip has one
// taker, Wan 2.7) and 用參考圖編輯 (video_edit: HappyHorse Video Edit alone,
// Wan VACE needs a painted mask).

export type VideoRecipe =
  | 'text_to_video' | 'image_to_video' | 'start_end_frames'
  | 'reference_frames' | 'video_to_video' | 'audio_to_video'

export type RecipeSlot = {
  /** The typed port the file lands on (lib/ports.ts). */
  port: 'first_frame' | 'last_frame' | 'reference_image' | 'video_in' | 'reference_audio'
  type: 'image' | 'video' | 'audio'
  /** i18n keys of the slot's label and hint (X創作's wording where it has one). */
  label: string
  hint: string
  required: boolean
}

export type RecipeSpec = {
  key: VideoRecipe
  slots: RecipeSlot[]
  /** The inputs carry the task, so the prompt may be empty. */
  promptOptional: boolean
  /** Draw an arrow between the slots (a start and an end). */
  arrows?: boolean
}

// In X創作's order (app/xcreate/recipes.tsx RECIPES.video). 頭尾幀's end
// frame is optional, as in X創作 (owner, Oct 19: "頭尾幀 可以只有開頭畫面");
// Veo, Wan and MiniMax H3 then start from the first picture alone.
export const VIDEO_RECIPES: RecipeSpec[] = [
  { key: 'text_to_video',    slots: [], promptOptional: false },
  { key: 'image_to_video',   slots: [{ port: 'first_frame', type: 'image', label: 'xc.slot.image', hint: 'xduel.slot.first.hint', required: true }], promptOptional: true },
  { key: 'video_to_video',   slots: [{ port: 'video_in', type: 'video', label: 'xc.slot.video', hint: 'xduel.slot.video.hint', required: true }], promptOptional: false },
  { key: 'start_end_frames', slots: [
      { port: 'first_frame', type: 'image', label: 'xc.slot.startframe', hint: 'xduel.slot.first.hint', required: true },
      { port: 'last_frame', type: 'image', label: 'xc.slot.endframe', hint: 'xduel.slot.last.hint', required: false },
    ], promptOptional: true, arrows: true },
  { key: 'reference_frames', slots: [
      { port: 'reference_image', type: 'image', label: 'xduel.slot.ref1', hint: 'xduel.slot.ref1.hint', required: true },
      { port: 'reference_image', type: 'image', label: 'xduel.slot.ref2', hint: 'xduel.slot.ref2.hint', required: false },
      { port: 'reference_image', type: 'image', label: 'xduel.slot.ref3', hint: 'xduel.slot.ref3.hint', required: false },
    ], promptOptional: false },
  { key: 'audio_to_video',   slots: [{ port: 'reference_audio', type: 'audio', label: 'xduel.slot.audio', hint: 'xduel.slot.audio.hint', required: true }], promptOptional: false },
]

export const DEFAULT_VIDEO_RECIPE: VideoRecipe = 'text_to_video'

export const isVideoRecipe = (v: unknown): v is VideoRecipe =>
  typeof v === 'string' && VIDEO_RECIPES.some(r => r.key === v)

export const recipeSpec = (k: VideoRecipe): RecipeSpec =>
  VIDEO_RECIPES.find(r => r.key === k) ?? VIDEO_RECIPES[0]

/** May this model duel in this kind? By its declared modes, as X創作's
 *  picker filters (用提示詞編輯 is video_to_video alone). */
export function fitsRecipe(m: { modes?: string[] | null }, k: VideoRecipe): boolean {
  return (m.modes ?? []).includes(k)
}

// ── 音訊's kinds (Oct 21; owner: "do we have music generation models? we
// should do that duel too", then "do it in one tab") ──────────────────────
// One 音訊 tab, a Mode row of 語音 / 音樂. Speech reads the text at each
// model's own voice; music makes a song from the description. The kind is
// `duels.recipe` like video's, and music rates in its own pool (`xd_pool`,
// migration 146). Old speech duels have no kind saved: they are speech.

export type AudioKind = 'text_to_speech' | 'text_to_music'
export const AUDIO_KINDS: readonly AudioKind[] = ['text_to_speech', 'text_to_music']
export const DEFAULT_AUDIO_KIND: AudioKind = 'text_to_speech'
export const isAudioKind = (v: unknown): v is AudioKind => v === 'text_to_speech' || v === 'text_to_music'

/** How long a music duel's songs are. Lyria 3.5 always makes about a
 *  minute: probed Oct 21, three prompts asking for 30 seconds in different
 *  words all came back 62-63 s. So ElevenLabs, which takes a length, is set
 *  to the same minute, and the prompt is left as the person wrote it. Lyria
 *  bills per song ($0.08), ElevenLabs per second ($0.15 a minute): about
 *  $0.23 a duel. */
export const MUSIC_SECONDS = 60

/** The longest text each kind takes: speech is read out word for word, so
 *  300 characters bounds the cost and the listening (Oct 19); a song is
 *  described, not read. */
export const audioMaxChars = (k: AudioKind) => k === 'text_to_music' ? 500 : 300

/** An audio duel's kind (speech for the ones from before music). */
export const audioKindOf = (d: { mode?: string | null; recipe?: string | null }): AudioKind | null =>
  d.mode !== 'audio' ? null : isAudioKind(d.recipe) ? d.recipe : DEFAULT_AUDIO_KIND

/** A video duel's kind; duels from before migration 142 have none saved,
 *  so it is read from their input: none → text, a picture → first frame,
 *  a video → 改編. */
export function recipeOfDuel(d: { mode?: string | null; recipe?: string | null; input_media?: { mediaType?: string } | null }): VideoRecipe | null {
  if (d.mode !== 'video') return null
  if (isVideoRecipe(d.recipe)) return d.recipe
  const t = d.input_media?.mediaType ?? ''
  if (!t) return 'text_to_video'
  if (t.startsWith('video/')) return 'video_to_video'
  return 'image_to_video'
}
