// app/xcreate/templates.ts
//
// XCreate templates — one-click presets that fill in mode, model picks,
// per-slot options, a starter prompt, AND name the attachment slots so
// users understand what to upload ("ROSE" + "JACK", not "image 1" +
// "image 2"). The user can edit anything after applying.
//
// Two flavors:
//   • Character-swap scene templates → use `reference_frames` mode +
//     1-2 named character slots. The wow factor: upload photos of you
//     and your friend, generate a video with you both in an iconic
//     scene. Best models: Veo 3.1, Wan 2.7, HappyHorse R2V.
//   • Generic prompt templates → text-driven, no attachments. Useful
//     for "I just want to compare two models on a single task".
//
// Templates are matched against the live ai_models catalog by
// model_name (the stable provider-side identifier). If a recommended
// model isn't enabled, the template silently falls back to whatever's
// available for the right mode — never blocks the user.
//
// Fill-in convention: {{double braces}} mark the part of a starterPrompt
// the user is meant to replace, with a working default already inside —
// "change only {{the blue sofa}} to {{a vintage brown leather chesterfield}}".
// The prompt still generates fine if they don't touch it (models read the
// braced text as the value). The composer shows a hint whenever {{...}}
// is present (see the prompt box in xcreate/page.tsx). Don't write
// meta-instructions like "(edit this prompt to say...)".

/**
 * Bundled sample files live in the public `samples` storage bucket, not in
 * public/. Repo assets have to be committed AND deployed to exist, and when
 * they aren't the password-gate middleware answers 200 with its own HTML
 * rather than a 404 — which is how the novel silently became a login page
 * for every model (see attachSampleFile in AttachmentButton). Storage has
 * neither failure mode: no gate, no .gitignore, no deploy coupling.
 *
 * Upload with x-upsert to replace a sample in place; the URL never changes.
 */
export const SAMPLES_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/samples`

export type TemplateMode = 'text' | 'image' | 'video'

/**
 * E-commerce platform presets (owner ask, Aug 31): a product template can
 * offer a second row of chips — General / Shopee / Taobao / Amazon — that
 * re-applies the template with that marketplace's listing conventions
 * baked in. A preset is CONVENTIONS, not a different generator: canvas
 * ratio, background rule, fill ratio, text policy, and (video) length.
 * The spec text is appended to the starter prompt as a labelled block so
 * the user can still see and edit exactly what was asked.
 *
 * Keep specs CHECKABLE (the Dailies/compliance agent will verify these
 * same rules later): "pure white RGB(255,255,255)" can be judged from
 * pixels; "looks professional" cannot.
 */
export interface PlatformPreset {
  id:    string
  /** Chip label — proper nouns stay untranslated. */
  label: string
  emoji: string
  /** Brand mark under /public/platforms. Sources: Shopee = simple-icons;
   *  Taobao = Ant Design icons (Alibaba's own set — their circular 淘
   *  glyph stays legible at 15px where the simple-icons 淘宝 seal turns
   *  to mush); Amazon = Font Awesome brands (CC BY 4.0). Chips fall back
   *  to the emoji when absent. */
  logo?:  string
  /** Brand accent for the active chip state. */
  brand?: string
  image?: { aspectRatio?: string; promptSpec: string }
  video?: { aspectRatio?: string; duration?: number; promptSpec: string }
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: 'general', label: 'General', emoji: '✦',
    // No overrides — the template's own defaults.
  },
  {
    id: 'shopee', label: 'Shopee', emoji: '🛒',
    logo: '/platforms/shopee.svg', brand: '#EE4D2D',
    image: {
      aspectRatio: '1:1',
      promptSpec: 'PLATFORM SPEC (Shopee main image): square 1:1 frame. Clean pure white background. The product fills most of the frame (at least 80%), fully inside the frame with a small even margin, front-facing hero angle, crisp edges and true-to-life colors. No text, no watermarks, no logos overlaid, no borders, no props that are not the product.',
    },
    video: {
      aspectRatio: '1:1', duration: 10,
      promptSpec: 'PLATFORM SPEC (Shopee product video): square 1:1 frame, around 10 seconds. Bright clean background, the product large and centered throughout; show the product itself and one clear use or detail moment. No on-screen text, no captions, no watermarks, no logos overlaid.',
    },
  },
  {
    id: 'taobao', label: 'Taobao', emoji: '🧧',
    logo: '/platforms/taobao.svg', brand: '#E94F20',
    image: {
      aspectRatio: '1:1',
      promptSpec: 'PLATFORM SPEC (淘宝/天猫 主图): square 1:1 frame. Bright, clean, premium composition — pure light background or a very subtle lifestyle surface. The product is the clear hero at 70–80% of the frame with breathing room around it. Absolutely no promotional text, no price tags, no watermarks, no logo overlays, no borders (平台主图规范). Commercial studio lighting, true colors.',
    },
    video: {
      aspectRatio: '1:1', duration: 10,
      promptSpec: 'PLATFORM SPEC (淘宝主图视频): square 1:1 frame, 9–15 seconds. Open on the product hero angle within the first second, keep the product dominant in every shot, end on a clean stable hero frame. No on-screen text, no price claims, no watermarks or logo overlays.',
    },
  },
  {
    id: 'amazon', label: 'Amazon', emoji: '📦',
    logo: '/platforms/amazon.svg', brand: '#FF9900',
    image: {
      aspectRatio: '1:1',
      promptSpec: 'PLATFORM SPEC (Amazon main image): square 1:1 frame on a PURE WHITE background (RGB 255,255,255) with no gradient and no scene. The product fills at least 85% of the frame, shown complete and front-facing, with only a soft natural contact shadow. Strictly no text, no logos overlaid, no watermarks, no borders, no props, no packaging inserts, no mannequins.',
    },
    video: {
      aspectRatio: '16:9', duration: 15,
      promptSpec: 'PLATFORM SPEC (Amazon product video): 16:9 frame, about 15 seconds. Show the real product clearly on a clean neutral set — features and scale, one simple demonstration moment. No on-screen claims or promotional text, no logos overlaid, no pricing.',
    },
  },
]

export interface TemplateSlot {
  /** Label shown above the upload slot, e.g. "ROSE" or "YOU". */
  label: string
  /** Helper text under the label, e.g. "Upload a female portrait". */
  hint?: string
}

export interface Template {
  id:             string
  emoji:          string
  title:          string
  subtitle:       string                 // one-line description shown on the card
  mode:           TemplateMode
  slotMode:       string                 // per-slot input shape
  starterPrompt:  string                 // pre-fills the prompt textarea

  /** 'tool' = task verb on the user's own media ("Remove Background",
   *  "Fix Colors") — rendered as a compact utility card, no preview.
   *  Undefined / 'template' = style/scene preset with a preview card. */
  kind?:          'tool' | 'template'
  /** Shown in the Popular strip above the prompt box. Keep this to ~4-6
   *  per mode — it's the one-click starting lineup, not the catalog. */
  popular?:       boolean
  aspectRatio?:   string
  duration?:      number                 // seconds (video modes only)
  recommendedModels: string[]            // model_name list, in pick order
  attachmentSlots: TemplateSlot[]        // [] = no uploads; named slots appear in the dedicated picker

  /** Optional preview image shown on the template card. Drop a file at
   *  /public/templates/<filename>.jpg (or .webp). Recommended dimensions:
   *  480×270 (16:9) for video, 400×400 (1:1) for image/text. If absent,
   *  the card falls back to a gradient + large emoji. Generate previews
   *  by running each template once on your own account and saving the
   *  best result — "eat your own dog food" pattern. */
  previewUrl?:    string
  /** Optional gradient color (any CSS color) used by the no-preview
   *  fallback card background. Defaults to slot-color-rotation if unset. */
  previewBgColor?: string

  /** Optional bundled sample file auto-attached when the template is
   *  applied, so a doc-analysis template is one click from a real run
   *  instead of "now go find a PDF". Mirrors XDuel's popular-prompt
   *  chips (see POPULAR_PROMPTS in app/xduel/page.tsx). Drop the file at
   *  public/samples/<name> and keep it under the 10MB doc cap in
   *  AttachmentButton. The user can remove it and attach their own. */
  sampleUrl?:     string
  sampleName?:    string
  sampleType?:    string   // MIME type; defaults to text/plain

  /** True on product/e-commerce templates: the composer offers the
   *  PLATFORM_PRESETS chip row (General / Shopee / Taobao / Amazon),
   *  which re-applies the template with that marketplace's conventions. */
  ecommerce?:     boolean
}

export const XCREATE_TEMPLATES: Template[] = [
  // ── Image tools (task verbs on the user's own photo) ─────────────────────
  //
  // Same engine as templates (image_edit + one upload slot + tuned starter
  // prompt); presented as compact utility cards. Every tool still runs on
  // up to 4 models at once — "remove the background with 2 models, keep
  // the cleaner cut" is a workflow nobody else offers.
  {
    id:                'tool-remove-background',
    kind:              'tool',
    popular:           true,
    emoji:             '✂️',
    title:             'Remove Background',
    subtitle:          'Clean subject cutout on a white backdrop',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Remove the background from this photo completely. Keep the main subject perfectly intact with clean precise edges, preserving fine detail like hair and fabric. Replace the background with pure white.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/tool-remove-background.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload the photo to cut out' },
    ],
  },
  {
    // Merged with the old Swap Background tool (July 2026): one card covers
    // both flows. The NEW BACKGROUND slot is optional — with it, the second
    // image becomes the backdrop; without it, the prompt's description does.
    id:                'tool-change-background',
    kind:              'tool',
    emoji:             '🏝',
    title:             'Change Background',
    subtitle:          'Describe it — or attach a backdrop photo',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Replace the background of the first image. If a second image is attached, use it as the new background; otherwise create this background: {{a sunlit tropical beach at golden hour}}. Keep the subject completely unchanged with clean precise edges, and match the lighting, shadows and color temperature to the new background so the result looks like one real photograph.',
    recommendedModels: ['gemini-3.1-flash-image', 'gpt-image-2'],
    previewUrl:        '/templates/tool-change-background.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO',     hint: 'Upload the photo to edit' },
      { label: 'NEW BACKGROUND', hint: 'Optional — or describe it in the prompt' },
    ],
  },
  {
    id:                'tool-upscale',
    kind:              'tool',
    emoji:             '🔍',
    title:             'Upscale & Sharpen',
    subtitle:          'Boost resolution and fine detail',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Upscale this image to a sharp high-resolution version: increase fine detail, remove blur, noise and compression artifacts. Keep the original art style EXACTLY as it is — a photograph stays photographic, an anime or comic frame keeps its line work, cel shading and flat colors, an illustration stays illustrated. Do not change the content, composition or style in any way.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/tool-upscale.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload the photo to upscale' },
    ],
  },
  {
    id:                'tool-remove-objects',
    kind:              'tool',
    emoji:             '🧹',
    title:             'Remove Strangers',
    subtitle:          'Erase strangers and clutter',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Remove {{the strangers and clutter in the background}} from this photo, filling the space naturally so the edit is invisible. Keep the main subject untouched.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/tool-remove-objects.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload the photo to clean up' },
    ],
  },
  {
    // Upgraded July 2026 (CC: "we want a more special one") — from one
    // sticker to a full 9-emotion sticker sheet. The messaging-app
    // sticker-pack experience, self-made from one photo. Character
    // consistency across 9 poses = Gemini 3 Pro's showcase strength,
    // and here a grid inside one image is the DESIRED output.
    id:                'tool-sticker-maker',
    kind:              'tool',
    emoji:             '🏷️',
    title:             'Sticker Pack',
    subtitle:          'Your photo → a 9-emotion sticker sheet',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Turn the subject in this photo into a cute cartoon sticker character, and create a sticker sheet of 9 die-cut stickers arranged in a 3x3 grid on a plain white background. The 9 stickers: {{happy, laughing hard, crying dramatically, angry with puffed cheeks, shocked, sleepy, thumbs up, heart eyes, and celebrating with confetti}}. Bold clean outlines, playful cel-shaded style, a thick white sticker border around each sticker, the SAME character instantly recognizable in every one, and {{with}} the emotion word hand-lettered below each sticker.',
    recommendedModels: ['gemini-3-pro-image', 'gemini-3.1-flash-image'],
    previewUrl:        '/templates/tool-sticker-maker.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Any subject — a clear face works best' },
    ],
  },
  {
    // Renamed from "Change One Thing" July 16 (CC) — id + thumbnail keep
    // the old slug so nothing else moves.
    id:                'tool-change-one-thing',
    kind:              'tool',
    emoji:             '🛋',
    title:             'Replace Anything',
    subtitle:          'Edit a single item, keep the rest',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'In this photo, change only {{the old grey sofa}} to {{a sleek modern tan leather sofa}}. Keep everything else exactly the same.',
    recommendedModels: ['gemini-3.1-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/tool-change-one-thing.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'A room, outfit, or scene to edit' },
    ],
  },
  {
    id:                'tool-beautify-skin',
    kind:              'tool',
    emoji:             '✨',
    title:             'Beautify Skin',
    subtitle:          'Natural retouch — blemishes gone, texture kept',
    mode:              'image',
    slotMode:          'image_edit',
    // The whole game is the ANTI-airbrush clause: without it, models
    // return the plastic Instagram-filter look. Identity lock matters
    // just as much — "beautify" must never mean "different face".
    starterPrompt:     'Retouch the skin in this photo naturally: remove temporary blemishes, pimples, acne marks and stray flyaway hairs, reduce oily shine and redness, and gently even out the skin tone. Keep real skin texture and pores visible — absolutely no plastic, blurred or airbrushed look — and do not change the person\'s identity, facial structure, expression, body shape, makeup, or anything else in the photo.',
    recommendedModels: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'],
    previewUrl:        '/templates/tool-beautify-skin.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'A portrait — face clearly visible' },
    ],
  },
  // ── Video ─────────────────────────────────────────────────────────────
  //
  // The only start_end_frames template — this recipe is the one people don't
  // discover on their own, because "two photos" reads like a reference-image
  // flow until you see the result. Both Veo 3.1 and Wan 2.7 lock the clip to
  // 8s in this mode, so duration is fixed rather than a suggestion.
  {
    id:                'video-start-end-frames',
    emoji:             '🎞',
    popular:           true,
    title:             'Start + End Frames',
    subtitle:          'Your first and last frame — we generate the video between',
    mode:              'video',
    slotMode:          'start_end_frames',
    // The braced part is the motion to fill in; the rest is identity-lock
    // and continuity, which is what stops models treating the two frames as
    // separate scenes and cutting between them.
    starterPrompt:     'Animate smoothly from the first frame to the last frame — {{she turns and her dress flares as she spins}}. Keep her identity, outfit, and the location exactly as in the two photos. One continuous take, natural motion throughout, no cuts and no scene changes. Golden-hour light, slow cinematic camera drift. Soft ambient sound.',
    aspectRatio:       '16:9',
    duration:          8,
    recommendedModels: ['veo-3.1-generate-preview', 'wan2.7-i2v'],
    previewUrl:        '/templates/video-start-end-frames.jpg',
    attachmentSlots: [
      { label: 'FIRST FRAME', hint: 'How the clip starts' },
      { label: 'LAST FRAME',  hint: 'How it ends — same person and place' },
    ],
  },
  {
    id:                'video-understand',
    emoji:             '👁️',
    title:             'Ask about a Video',
    subtitle:          'The model WATCHES it — describe, summarize, answer questions',
    mode:              'text',
    slotMode:          'video_to_text',
    // The counterpart to audio-transcribe below: this one SEES frames and
    // reasons about them; that one LISTENS and writes down the words. Same
    // input file, opposite senses — the card copy is the differentiation.
    starterPrompt:     '{{What do you want to know? e.g. "Describe every scene and camera move", "Summarize what happens", "Is the product logo visible throughout?"}}',
    recommendedModels: ['gemini-3.1-flash-lite', 'qwen3.6-plus'],
    previewBgColor:    '#2d3a52',
    attachmentSlots: [
      { label: 'VIDEO', hint: 'MP4 / WebM / MOV — the clip to analyze' },
    ],
  },
  {
    id:                'audio-transcribe',
    emoji:             '🎵',
    popular:           true,
    title:             'Lyrics & Transcripts from Audio',
    subtitle:          'The model LISTENS — verbatim words with exact timestamps',
    mode:              'text',
    slotMode:          'audio_to_text',
    // The prompt doubles as Whisper's BIAS: pasting the known lyrics in
    // snaps the timestamps to the real words — dramatically better on
    // singing than a cold transcription pass.
    starterPrompt:     '{{Optional: paste the known lyrics or expected text here — timestamps will snap to them. Leave empty for a plain transcription.}}',
    // Two engines seated for a real comparison (owner, Aug 10): Whisper 1
    // (OpenAI) vs Fun-ASR (Alibaba, Mandarin-strong). Fun-ASR replaced
    // qwen3-asr-flash-filetrans, which returned "Beep boop beep" on a full
    // music track — the flash-filetrans variant can't do songs; fun-asr
    // transcribed the Mandarin lyrics cleanly. Same song, both transcripts,
    // real prices — the ModelXD thesis in audio.
    recommendedModels: ['whisper-1', 'fun-asr'],
    previewBgColor:    '#2d4152',
    attachmentSlots: [
      { label: 'AUDIO', hint: 'MP3 / M4A / WAV — or an MP4 video (audio track is read, ≤25MB)' },
    ],
  },
  {
    id:                'video-extend',
    emoji:             '⏩',
    popular:           true,
    title:             'Extend a Video',
    subtitle:          'Continue an existing clip — motion carries through',
    mode:              'video',
    slotMode:          'extend_video',
    // Native continuation — the model reads the WHOLE input clip, so
    // motion and identity carry into the continuation (unlike the
    // last-frame trick). Two engines, priced 4.5x apart — the choice IS
    // the product: Wan 2.7 `first_clip` at $0.10/s (input ≤10s, total
    // ≤15s) vs Seedance 2.5 via Runway `mode:"extend"` at ~$0.45/s
    // combined (≤30s in+out, output matches input length).
    starterPrompt:     'Continue this video: {{the camera keeps pulling back to reveal the whole scene}}. Same subject, same lighting, same motion energy — one continuous take, no cuts.',
    duration:          8,
    recommendedModels: ['wan2.7-i2v', 'seedance2_5'],
    previewUrl:        '/templates/video-extend.jpg',
    previewBgColor:    '#4a2d52',
    attachmentSlots: [
      { label: 'YOUR VIDEO', hint: 'The clip to continue (MP4, 2–10s best)' },
    ],
  },
  {
    id:                'video-music-sync',
    emoji:             '🎤',
    popular:           true,
    title:             'Sync to Music',
    subtitle:          'Your song drives the performance',
    mode:              'video',
    slotMode:          'reference_frames',
    // Wan 3.0's reference_audio: the uploaded track drives pacing and
    // performance (probed live 2026-08-26). Upstream constraints carried
    // into the hint because they are hard rejections, not preferences:
    // wav/mp3 ONLY (m4a refused) and ≤15s of audio. Optional image refs
    // set the performer/scene; they ride the same reference media array.
    starterPrompt:     'A singer performs this song on a moody neon-lit stage, camera slowly circling, expressive close-ups on the beat, shallow depth of field, cinematic concert lighting. The performance follows the music\'s rhythm and energy.',
    aspectRatio:       '16:9',
    duration:          10,
    recommendedModels: ['wan3.0-video'],
    previewUrl:        '/templates/video-music-sync.jpg',
    attachmentSlots: [
      { label: 'AUDIO',   hint: 'Any audio file — we use the first 15 seconds to drive the performance' },
      { label: 'IMAGE 1', hint: 'Optional — who performs / the scene' },
      { label: 'IMAGE 2', hint: 'Optional — another reference' },
    ],
  },
  {
    id:                'video-outfit-swap',
    emoji:             '🧥',
    popular:           true,
    title:             'Outfit Swap in Video',
    subtitle:          'Change what someone wears — in a real video',
    mode:              'video',
    slotMode:          'video_edit',
    starterPrompt:     'Make the person in the video wear {{the outfit from the reference image}}. Keep their identity, face, movement, the background and everything else in the video exactly the same. The new clothing should move naturally with their body.',
    aspectRatio:       '16:9',
    duration:          8,
    recommendedModels: ['happyhorse-1.0-video-edit'],
    previewUrl:        '/templates/video-outfit-swap.jpg',
    attachmentSlots: [
      { label: 'VIDEO',      hint: 'A video of a person (MP4/MOV, 3–60s)' },
      { label: 'NEW OUTFIT', hint: 'Photo of the clothing to wear' },
    ],
  },
  // ── Image tools (task verbs on the user's own photo) ─────────────────────
  //
  // Same engine as templates (image_edit + one upload slot + tuned starter
  // prompt); presented as compact utility cards. Every tool still runs on
  // up to 4 models at once — "remove the background with 2 models, keep
  // the cleaner cut" is a workflow nobody else offers.
  {
    id:                'video-asmr-glass-fruit',
    emoji:             '🍓',
    title:             'ASMR Glass Fruit',
    subtitle:          'Slicing glass fruit — sound ON',
    mode:              'video',
    slotMode:          'text_to_video',
    // The reigning native-audio showcase genre: photoreal macro of a knife
    // slicing "fruit" made of glass, and the AUDIO carries the clip —
    // crystalline crack + tinkling shards. Veo 3.1 generates the sound;
    // the prompt describes it in detail because that is what gets scored.
    //
    // Three deliberate choices, from the community Veo 3 prompting guides
    // (github.com/snubroot/Veo-3-Prompting-Guide and the glass-cutting
    // write-ups) — don't "tidy" them away:
    //   1. Audio lives in its own sentence prefixed "Audio:". Burying sound
    //      inside the visual description is what causes Veo to hallucinate
    //      music or ambience nobody asked for.
    //   2. "no on-screen text whatsoever" — Veo readily burns in captions,
    //      which ruins an ASMR clip. Stacked with no talking / no music.
    //   3. "Only the hand, the knife and the fruit are visible" bounds the
    //      frame, and the break-away beat ("front section breaks away
    //      cleanly") gives the clip a payoff instead of a continuous saw.
    starterPrompt:     'Extreme macro shot: a sharp chef\'s knife slowly slices clean through {{a ripe strawberry}} made entirely of translucent colored glass, resting on a dark wooden cutting board. The blade meets resistance, then the front section breaks away cleanly and thin glass slices topple over. Studio product lighting, sharp refractions and caustics through the glass flesh and tiny glass seeds, shallow depth of field, slow deliberate movement. Only the hand, the knife and the fruit are visible. Audio: a crisp crystalline crack as the blade bites, delicate high-pitched tinkling as the slices settle, quiet room tone. No talking, no music, no on-screen text whatsoever.',
    aspectRatio:       '16:9',
    duration:          8,
    recommendedModels: ['veo-3.1-generate-preview', 'happyhorse-1.0-t2v'],
    previewUrl:        '/templates/video-asmr-glass-fruit.jpg',
    attachmentSlots: [],
  },
  {
    id:                'video-product-video',
    emoji:             '📦',
    title:             'Product Video',
    subtitle:          'Product refs in → cinematic ad out',
    ecommerce:         true,
    mode:              'video',
    slotMode:          'reference_frames',
    // The utility sibling of the Product Shots image template — and same
    // multi-reference flow (July 16, CC): 1-3+ product photos in, a
    // polished 8-second hero ad out. reference_frames (not i2v) so extra
    // angles teach the model the product's full geometry. Prompt is
    // product-agnostic: identity lock first, then one continuous camera
    // move + light sweep that flatters ANY object, and an explicit
    // no-added-text clause (Veo loves inventing captions/logos).
    starterPrompt:     'Create a premium cinematic product commercial of the product shown in the reference images. The product\'s design, shape, colors, materials, branding and proportions must stay exactly as in the references. One continuous shot: the camera orbits the product in a slow smooth arc on an elegant dark studio pedestal while a soft beam of light sweeps across its surface, revealing its edges, textures and details; fine dust particles drift in the light. End on a crisp hero angle with the product perfectly sharp and centered. Premium minimal aesthetic, shallow depth of field, subtle deep ambient music, and no added text, captions or logos.',
    aspectRatio:       '16:9',
    duration:          8,
    recommendedModels: ['veo-3.1-generate-preview', 'happyhorse-1.0-r2v'],
    previewUrl:        '/templates/video-product-video.jpg',
    attachmentSlots: [
      { label: 'IMAGE 1', hint: 'A clear photo of the product' },
      { label: 'IMAGE 2', hint: 'Optional — another angle' },
      { label: 'IMAGE 3', hint: 'Optional' },
    ],
  },


  // ── Image style templates (restyle a user photo) ─────────────────────────
  //
  // (An "IG Post" photoreal-polish template was tried and removed July
  // 2026: global photoreal enhancement with zero identity drift is the
  // one edit current models do badly — they either no-op or drift faces.
  // Stylization templates work because full transformation is allowed;
  // tools work because edits are localized. Don't re-add without testing.)
  //
  // Each takes one uploaded portrait/scene and restyles it via image_edit.
  // IP-safety pattern: titles avoid trademark names (no "Ghibli" / "Disney"
  // / "Pixar"); prompts describe the aesthetic rather than the studio.
  // Result: similar visual outcome, no IP exposure.
  {
    id:                'style-watercolor-anime',
    emoji:             '🌸',
    popular:           true,
    // Title AND prompt name the studio by CC's explicit call (July 15).
    // If a provider starts refusing/softening the named style, drop the
    // first clause — the descriptors alone reproduce the look.
    title:             'Ghibli Style',
    subtitle:          'Hand-painted anime film look',
    mode:              'image',
    slotMode:          'image_edit',
    // This IS the "Ghibli-style" template — evocative title, generic
    // prompt per the IP-safety pattern. Prompt sharpened July 2026 to
    // land the aesthetic harder: lush hand-painted backgrounds, wholesome
    // pastoral warmth, painterly clouds.
    starterPrompt:     'Restyle this photo in Studio Ghibli style: a hand-painted watercolor anime film still with lush painterly backgrounds, big luminous clouds in a blue summer sky, warm nostalgic pastoral atmosphere, gentle wind-swept grass and hair, soft pastel palette, wholesome storybook mood.',
    recommendedModels: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'],
    previewUrl:        '/templates/style-watercolor-anime.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait or scene' },
    ],
  },
  {
    id:                'style-pixel-art',
    emoji:             '👾',
    title:             'Pixel Art',
    subtitle:          'Retro 16-bit game sprite style',
    mode:              'image',
    slotMode:          'image_edit',
    // The {{grid size}} placeholder is the pixelation-strength dial: 32x32 ≈
    // extremely chunky 8-bit, 64x64 ≈ classic 16-bit, 128x128 ≈ fine
    // 32-bit era. A concrete grid number steers models far better than
    // adjectives like "very pixelated".
    starterPrompt:     'Restyle this photo as retro pixel art, as if rendered on a {{64x64}} pixel grid: big visible square pixels, a limited vibrant color palette, careful dithering for shading, crisp sprite-style outlines — like a scene from a classic 90s video game. Keep the subject instantly recognizable.',
    recommendedModels: ['gemini-3.1-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/style-pixel-art.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait or scene' },
    ],
  },
  {
    id:                'style-3d-animated',
    emoji:             '✨',
    title:             '3D Animated Feature',
    subtitle:          'Polished 3D animation look',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Restyle this photo as a 3D animated feature film still. Expressive character design with big eyes and smooth shading, polished cinematic lighting, vivid family-friendly color palette, theatrical depth-of-field.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/style-3d-animated.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait' },
    ],
  },
  {
    id:                'style-anime-portrait',
    emoji:             '🎌',
    title:             'Anime Portrait',
    subtitle:          'Japanese anime / manga character art',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Restyle this photo in the style of a Japanese anime portrait. Clean line work, expressive large eyes, vibrant cel-shaded colors, dynamic hair detail, manga character composition.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/style-anime-portrait.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait' },
    ],
  },
  {
    id:                'style-oil-painting',
    emoji:             '🎨',
    title:             'Oil Painting',
    subtitle:          'Classical museum-style portrait',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Restyle this photo as a classical oil painting portrait in the style of European Renaissance masters. Rich textured brushstrokes, dramatic chiaroscuro lighting, deep warm earth tones, museum-quality composition.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/style-oil-painting.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait' },
    ],
  },
  {
    id:                'style-vintage-polaroid',
    emoji:             '📷',
    title:             'Vintage Polaroid',
    subtitle:          '1970s instant film aesthetic',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Restyle this photo as a vintage 1970s Polaroid photograph. Soft faded colors with warm grain, slight chromatic vignetting, instant film border, casual home-photo composition.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/style-vintage-polaroid.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait or scene' },
    ],
  },
  {
    id:                'style-cyberpunk-neon',
    emoji:             '🌃',
    title:             'Cyberpunk Neon',
    subtitle:          'Futuristic neon-lit dystopia',
    mode:              'image',
    slotMode:          'image_edit',
    starterPrompt:     'Restyle this photo in a cyberpunk neon aesthetic. Magenta and cyan rim lighting on the subject, rain-slicked street reflections, holographic signage in the background, dystopian futuristic mood, high contrast.',
    recommendedModels: ['gemini-2.5-flash-image', 'qwen-image-2.0-pro'],
    previewUrl:        '/templates/style-cyberpunk-neon.jpg',
    attachmentSlots: [
      { label: 'YOUR PHOTO', hint: 'Upload a portrait' },
    ],
  },

  // ── Image templates ──────────────────────────────────────────────────────
  // (Concept Art, Travel Poster and Minimalist Wallpaper all removed July
  // 2026 — none passed the "is it special?" bar. Image templates are now
  // upload-driven; pure text_to_image lives in the blank composer.)
  // Product Shots — the e-commerce marquee (July 2026, merger of the old
  // Studio Product Shot + Product in Scene tools). reference_frames flow:
  // 1-3 product reference images in, and because the template pre-picks
  // FOUR models (3 Gemini tiers + gpt-image-2, which takes up to 16 ref
  // images via the edits endpoint), every run returns four store-ready
  // variations. The [setting] bracket defaults to studio white (old
  // Studio Shot) and can be rewritten to any scene (old Product in Scene).
  {
    id:                'product-shots',
    emoji:             '🛍',
    popular:           true,
    ecommerce:         true,
    title:             'Product Shots',
    subtitle:          'Product refs in → store-ready photos out',
    mode:              'image',
    slotMode:          'reference_frames',
    // Kept deliberately simple (CC) — runs as-is with nothing to fill in.
    // SINGLE-scene phrasing on purpose: "a set of photos" makes gpt-image-2
    // render a 3x3 collage grid inside one image (verified via live API,
    // July 13 — the raw Images API can't decompose a request the way
    // ChatGPT's chat model does). One scene per generation; the SET comes
    // from the 4 pre-picked models × Output Count.
    starterPrompt:     'Create ONE professional e-commerce photo of the product in the reference images — a single scene, never a collage or grid. Choose one of: a new angle, a different background, or a real usage scene. Keep the product\'s design, colors, branding and proportions exactly unchanged, with commercial-quality lighting and sharp focus on the product.',
    aspectRatio:       '1:1',
    recommendedModels: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gpt-image-2', 'gemini-2.5-flash-image'],
    previewUrl:        '/templates/product-shots.jpg',
    // 3 generic slots by default (CC: no semantic labels needed — the
    // prompt explains itself); reference_frames templates grow one slot
    // at a time once these are filled (up to the models' shared ref
    // capacity) — see the slot IIFE in xcreate/page.tsx.
    attachmentSlots: [
      { label: 'IMAGE 1' },
      { label: 'IMAGE 2', hint: 'Optional' },
      { label: 'IMAGE 3', hint: 'Optional' },
    ],
  },
  {
    // Virtual try-on (July 16, CC): person + garment photo → person
    // wearing it. THE fashion-ecommerce use case, and a natural fit for
    // the multi-model twist — fabric drape + identity lock is exactly
    // where the Gemini tiers and gpt-image-2 differ visibly.
    id:                'try-on-outfit',
    emoji:             '👗',
    popular:           true,
    title:             'Virtual Try-On',
    subtitle:          'You + a garment photo → you wearing it',
    mode:              'image',
    slotMode:          'reference_frames',
    starterPrompt:     'Make the person in the first image wear the clothing from the second image. Keep the person\'s identity, face, hairstyle, pose, body shape and the background exactly the same. Fit the garment naturally to their pose with realistic fabric drape, folds, lighting and shadows, and preserve the garment\'s exact design, colors, patterns and details.',
    recommendedModels: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gpt-image-2', 'gemini-2.5-flash-image'],
    previewUrl:        '/templates/try-on-outfit.jpg',
    attachmentSlots: [
      { label: 'PERSON',     hint: 'Full or half-body photo works best' },
      { label: 'NEW OUTFIT', hint: 'The clothing to try on' },
    ],
  },
  // (Travel Poster + Minimalist Wallpaper removed July 2026 per CC —
  // neither earned its card. Text-rendering tests live on in XDuel.)
  // (Comic Strip removed July 2026 per CC, same pass as Travel Poster +
  // Minimalist Wallpaper — didn't earn its card.)

  // ── Text mode (July 15: culled to ONE entry per CC — the single best
  // gotcha. Reasoning Compare, Strawberry, River Riddle, Acrostic, ELI5
  // and 中英翻譯挑戰 all removed; don't re-add without a stronger hook.) ──

  {
    id:                'text-decimals',
    emoji:             '🔢',
    popular:           true,
    title:             '9.9 vs 9.11',
    subtitle:          'Which number is larger?',
    mode:              'text',
    slotMode:          'text_to_text',
    starterPrompt:     'Which number is larger: 9.9 or 9.11? Explain your reasoning step by step before giving the final answer.',
    recommendedModels: ['gemini-3.1-flash-lite', 'qwen3.5-flash'],
    // Designed typographic card (PIL, site type system) — not AI-generated.
    previewUrl:        '/templates/text-decimals.jpg',
    attachmentSlots: [],
  },
  // ── Text templates shared with XDuel's popular prompts (CC, July 20) —
  // same tasks, same thumbnails, so both pages feel consistent. ──
  {
    id:                'text-explain-5',
    emoji:             '🧒',
    popular:           true,
    title:             "Explain like I'm 5",
    subtitle:          'How do airplanes fly?',
    mode:              'text',
    slotMode:          'text_to_text',
    starterPrompt:     'Explain how airplanes stay in the air to a 5-year-old.',
    recommendedModels: ['gemini-3.1-flash-lite', 'qwen3.6-plus'],
    previewUrl:        '/templates/xduel-explain-like-i-m-5.jpg',
    attachmentSlots: [],
  },
  {
    id:                'text-monday-haiku',
    emoji:             '✍️',
    popular:           true,
    title:             'Monday Haiku',
    subtitle:          'A tiny writing task',
    mode:              'text',
    slotMode:          'text_to_text',
    starterPrompt:     'Write a haiku about Monday mornings.',
    recommendedModels: ['gpt-5.6-luna', 'gemini-3.1-flash-lite'],
    previewUrl:        '/templates/xduel-monday-haiku.jpg',
    attachmentSlots: [],
  },
  {
    id:                'text-summarization',
    emoji:             '📖',
    popular:           true,
    title:             'Summarization',
    subtitle:          'Attach a document to summarize',
    mode:              'text',
    slotMode:          'text_to_text',
    starterPrompt:     'Summarize this document in three paragraphs, then give one insight most readers miss.',
    recommendedModels: ['gpt-5.6-sol', 'qwen3.6-plus'],
    previewUrl:        '/templates/xduel-summarization.jpg',
    attachmentSlots: [{ label: 'DOCUMENT', hint: 'PDF or .txt to summarize' }],
  },
  // Document-reasoning task with a built-in skeptic step (part 3). Models
  // that just paraphrase the Highlights page fail it, which is exactly the
  // kind of gap a side-by-side run should expose. Tuned against Tesla's
  // Q2-2026 deck: "strong quarter" up front, operating margin 4.1% -> 1.4%
  // and FCF +$146M -> -$1.1B in the tables behind it.
  {
    id:                'text-earnings-analysis',
    emoji:             '📊',
    popular:           true,
    title:             'Earnings Report Analysis',
    subtitle:          'Attach a quarterly report to analyze',
    mode:              'text',
    slotMode:          'text_to_text',
    starterPrompt:     'Analyze this earnings report. Give me: (1) the headline numbers and how they moved year over year, (2) the two metrics that matter most for this business and what they signal, (3) anything the report frames favorably that a careful reader should question. End with a one-line verdict.',
    recommendedModels: ['claude-opus-5', 'gpt-5.6-sol'],
    previewUrl:        '/templates/text-earnings-analysis.jpg',
    // Bundled so the template runs on one click. Tesla's Q2-2026 deck,
    // recompressed 10.1MB -> 2.2MB (images downsampled to 72dpi; every
    // table and number preserved, and the doc path folds PDFs to text
    // anyway). Swap in a newer quarter by upserting over this object in
    // the samples bucket — no deploy needed.
    sampleUrl:         `${SAMPLES_BASE}/tesla-q2-2026-update.pdf`,
    sampleName:        'tesla-q2-2026-update.pdf',
    sampleType:        'application/pdf',
    attachmentSlots: [{ label: 'EARNINGS REPORT', hint: 'PDF of a quarterly or annual report' }],
  },
]
