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
