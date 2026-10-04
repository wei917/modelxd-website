// lib/xcreate-tools.ts: the X創作 door's one-tap tools (Oct 3; owner: "two
// modes, one is filling prompt and another is blackbox mode that we control,
// which is what Pollo.ai does"). A tool is a photo, a few choices, and a
// prompt and model that WE pick. The run goes through /api/xcreate like any
// studio run, so billing at list price, the call log, the job poller and the
// Library are the usual ones. The user did not choose the model, so we may
// change it here at any time (CLAUDE.md, "WHO CHOSE the model"). For the
// beta the panel shows which model ran and its price (owner: "we show more
// information at the first beta version").
//
// Words a user sees are i18n keys: `xtool.<id>.name`, `.sub`, `.<choice>`,
// `.text`, `.textph`, `.p.<preset>`. Prompts are English; a user's own text
// goes in as typed (the models read Chinese and Japanese).

export type ToolCategory = 'shop' | 'background' | 'fix' | 'style'
export const TOOL_CATEGORIES: ToolCategory[] = ['shop', 'fix', 'background', 'style']

export interface ToolChoice {
  id: string
  /** The words this choice adds to the prompt. */
  prompt: string
  /** Output shape, for a tool whose choice is a shape (擴圖). */
  aspect?: string
  /** Output size, for a tool whose choice is a size (畫質增強). */
  size?: string
}

export interface XTool {
  id: string
  category: ToolCategory
  /** Card picture under /public/templates; an emoji when there is none. */
  preview?: string
  emoji: string
  /** ai_models.model_name of the model we run it on. */
  model: string
  /** The model's output size (Nano Banana 2: '1024' = 1K). */
  size: string
  /** A fixed output shape (白底圖: 1:1 like a store listing). Otherwise the
   *  photo keeps its own shape: the panel measures it and sends the nearest
   *  ratio, because Google turns "no ratio" into a square (google.ts). */
  aspect?: string
  choices?: ToolChoice[]
  /** A short text box: what to remove, what background. Presets fill it
   *  with their localized words. */
  text?: { required: boolean; max: number; presets?: string[] }
  prompt: (p: { choice: ToolChoice | null; text: string }) => string
}

const NANO_BANANA_2 = 'gemini-3.1-flash-image'

const KEEP_SUBJECT = 'Keep the main subject exactly as it is: the same face, body, clothes, product, shapes, colors, printed text and logos, not redrawn.'

export const XTOOLS: XTool[] = [
  {
    id: 'white-background', category: 'shop', preview: '/templates/shop-image.jpg', emoji: '⬜',
    model: NANO_BANANA_2, size: '1024', aspect: '1:1',
    prompt: () => 'Turn this photo into a clean e-commerce product photo on a pure white background (RGB 255, 255, 255). '
      + 'Keep the product exactly the same: shape, colors, materials, labels, printed text and logos, not redrawn. '
      + 'Center it, complete and uncut, filling about 80 percent of the frame, in soft even studio light with only a faint natural contact shadow. '
      + 'Remove everything else: no props, no hands, no added text, no watermark.',
  },
  {
    id: 'product-scene', category: 'shop', preview: '/templates/product-shots.jpg', emoji: '🪴',
    model: NANO_BANANA_2, size: '1024',
    choices: [
      { id: 'wood',    prompt: 'on a warm wooden table in soft morning window light, with a few simple props blurred behind' },
      { id: 'marble',  prompt: 'on a white marble counter in a bright, clean, airy room' },
      { id: 'outdoor', prompt: 'outdoors in natural daylight with fresh greenery softly blurred behind' },
      { id: 'home',    prompt: 'in a cozy, tidy living room at home, in warm natural light' },
      { id: 'studio',  prompt: 'in a professional photo studio on a smooth single-color backdrop with soft shadows' },
      { id: 'gift',    prompt: 'in a festive gift setting with ribbons and soft bokeh lights' },
    ],
    prompt: ({ choice }) => `Place the product from this photo ${choice?.prompt ?? 'in a clean, natural setting'}, as a commercial lifestyle product photo. `
      + 'Keep the product exactly the same: shape, colors, materials, labels, printed text and logos, not redrawn. '
      + 'Realistic scale, perspective, lighting and shadows so it looks like one real photograph. No added text, no watermark.',
  },
  {
    id: 'change-background', category: 'background', preview: '/templates/tool-change-background.jpg', emoji: '🏞',
    model: NANO_BANANA_2, size: '1024',
    choices: [
      { id: 'beach',  prompt: 'a sunlit tropical beach at golden hour' },
      { id: 'city',   prompt: 'a city street at night with soft neon bokeh' },
      { id: 'nature', prompt: 'a green park with trees in soft daylight' },
      { id: 'cafe',   prompt: 'a warm, cozy cafe interior' },
      { id: 'studio', prompt: 'a plain light grey photo studio backdrop' },
      { id: 'white',  prompt: 'a pure white background' },
    ],
    text: { required: false, max: 200 },
    prompt: ({ choice, text }) => `Replace the background of this photo with: ${text.trim() || choice?.prompt || 'a plain light grey studio backdrop'}. `
      + `${KEEP_SUBJECT} Cut it out cleanly with natural edges, and match the light, shadows, perspective and color of the new background so the result looks like one real photograph. No added text, no watermark.`,
  },
  {
    id: 'blur-background', category: 'background', preview: '/templates/tool-blur-background.jpg', emoji: '🎯',
    model: NANO_BANANA_2, size: '1024',
    prompt: () => 'Keep the main subject perfectly sharp and unchanged, and blur the background as if the photo were taken with a portrait lens at f/1.8: soft, creamy, natural bokeh that grows with distance. '
      + 'Do not change the subject, the framing, the colors or the light.',
  },
  {
    id: 'remove-object', category: 'fix', preview: '/templates/tool-remove-objects.jpg', emoji: '🧽',
    model: NANO_BANANA_2, size: '1024',
    text: { required: true, max: 200, presets: ['people', 'clutter', 'wires', 'bin'] },
    prompt: ({ text }) => `Remove ${text.trim()} from this photo. Fill the cleared area naturally, continuing the surrounding background, texture and light, so the edit is invisible. Change nothing else.`,
  },
  {
    id: 'retouch', category: 'fix', preview: '/templates/tool-beautify-skin.jpg', emoji: '✨',
    model: NANO_BANANA_2, size: '1024',
    prompt: () => 'Retouch the skin in this photo naturally: remove temporary blemishes, pimples, acne marks and stray flyaway hairs, reduce oily shine and redness, and gently even out the skin tone. '
      + 'Keep real skin texture and pores visible, with no plastic, blurred or airbrushed look, and do not change the person\'s identity, facial structure, expression, body shape, makeup, or anything else in the photo.',
  },
  {
    id: 'enhance', category: 'fix', preview: '/templates/tool-upscale.jpg', emoji: '🔍',
    model: NANO_BANANA_2, size: '2048',
    choices: [
      { id: '2k', prompt: '', size: '2048' },
      { id: '4k', prompt: '', size: '4096' },
    ],
    prompt: () => 'Upscale this image to a sharp high-resolution version: increase fine detail, remove blur, noise and compression artifacts. '
      + 'Keep the original style exactly as it is: a photograph stays photographic, an anime or comic frame keeps its line work and flat colors, an illustration stays illustrated. '
      + 'Do not change the content, the faces, the composition or the style in any way.',
  },
  {
    id: 'colorize', category: 'fix', preview: '/templates/tool-colorize.jpg', emoji: '🎨',
    model: NANO_BANANA_2, size: '1024',
    prompt: () => 'Colorize this black-and-white photo with natural, realistic colors true to its time and place: skin tones, hair, clothing, sky, plants and buildings. '
      + 'Keep every detail, face, expression and the composition exactly the same; only add color. Gently restore scratches and dust if there are any.',
  },
  {
    id: 'expand', category: 'fix', preview: '/templates/tool-expand.jpg', emoji: '↔️',
    model: NANO_BANANA_2, size: '1024',
    choices: [
      { id: '1-1',  prompt: 'square 1:1',    aspect: '1:1' },
      { id: '4-3',  prompt: '4:3 landscape', aspect: '4:3' },
      { id: '3-4',  prompt: '3:4 portrait',  aspect: '3:4' },
      { id: '16-9', prompt: '16:9 wide',     aspect: '16:9' },
      { id: '9-16', prompt: '9:16 vertical', aspect: '9:16' },
    ],
    prompt: ({ choice }) => `Expand this photo outward to fill a ${choice?.prompt ?? 'wider'} frame. `
      + 'Keep everything that is already in the photo exactly the same and in the same place; add new surroundings at the edges that continue the scene seamlessly, with the same light, perspective and style. '
      + 'No borders, no blank areas, no added text.',
  },
  {
    id: 'to-anime', category: 'style', preview: '/templates/style-anime-portrait.jpg', emoji: '🌸',
    model: NANO_BANANA_2, size: '1024',
    choices: [
      { id: 'anime',      prompt: 'a Japanese anime portrait: clean line work, expressive eyes, vibrant cel-shaded colors and detailed hair' },
      { id: 'watercolor', prompt: 'a hand-painted watercolor anime film still with lush painterly backgrounds, big luminous clouds and a soft pastel palette' },
      { id: '3d',         prompt: 'a 3D animated feature film still: expressive character design, smooth shading and polished cinematic lighting' },
      { id: 'pixel',      prompt: 'retro pixel art with big visible square pixels, a limited vibrant palette and crisp sprite-style outlines, like a classic 90s video game' },
      { id: 'oil',        prompt: 'a classical oil painting with rich textured brushstrokes, dramatic light and deep warm tones' },
    ],
    prompt: ({ choice }) => `Restyle this photo as ${choice?.prompt ?? 'a Japanese anime portrait'}. `
      + 'Keep the same people, pose, composition and the main features that make them recognizable.',
  },
]

export const toolById = (id: string | null | undefined) => XTOOLS.find(t => t.id === id) ?? null

/** The output shapes Nano Banana 2 accepts (lib/providers/google.ts). */
export const TOOL_RATIOS: [string, number][] = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
]

/** The accepted ratio nearest a photo's own shape. */
export function nearestRatio(w: number, h: number): string {
  if (!w || !h) return '1:1'
  const target = Math.log(w / h)
  let best = TOOL_RATIOS[0]
  for (const r of TOOL_RATIOS) if (Math.abs(Math.log(r[1]) - target) < Math.abs(Math.log(best[1]) - target)) best = r
  return best[0]
}
