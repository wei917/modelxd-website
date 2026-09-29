// scripts/test-trending-models.ts — which models the trending feed is about, no I/O.
//
//   npx tsx scripts/test-trending-models.ts
//
// Runs lib/trending-models.ts on the catalog as it stood on Sep 27 (32
// enabled image/video rows) and on the 18 posts trending_posts held then:
// families and searches come from the catalog, never Midjourney or a
// model-agnostic catch-all; a post is eligible only when every model it
// credits is one XCreate offers (combined labels, notes, explicit Image or
// Video, the ChatGPT app); presets that no longer run lose their button.

import assert from 'node:assert/strict'
import {
  derivedName, eligibility, groupQuery, namesIn, otherGeneratorsIn, presetModel, presetRunsOn, searchGroups,
  supportFrom, usableKinds, type CatalogRow, type MediaKind,
} from '../lib/trending-models'

const row = (provider: string, model_name: string, display_name: string, out: string, modes: string[], extra: Partial<CatalogRow> = {}): CatalogRow =>
  ({ provider, model_name, display_name, output_modalities: [out], modes, blocked_features: [], enabled: true, ...extra })

const V = 'video', I = 'image'
const CATALOG: CatalogRow[] = [
  row('alibaba', 'happyhorse-1.0-i2v', 'HappyHorse 1.0 Image to Video', V, ['image_to_video']),
  row('alibaba', 'happyhorse-1.0-r2v', 'HappyHorse 1.0 Reference to Video', V, ['reference_frames']),
  row('alibaba', 'happyhorse-1.0-t2v', 'HappyHorse 1.0 Text to Video', V, ['text_to_video']),
  row('alibaba', 'happyhorse-1.0-video-edit', 'HappyHorse Video Edit', V, ['video_edit']),
  row('alibaba', 'happyhorse-1.1-i2v', 'HappyHorse 1.1 Image to Video', V, ['image_to_video']),
  row('alibaba', 'happyhorse-1.1-r2v', 'HappyHorse 1.1 Reference to Video', V, ['reference_frames']),
  row('alibaba', 'happyhorse-1.1-t2v', 'HappyHorse 1.1 Text to Video', V, ['text_to_video']),
  row('alibaba', 'qwen-image-2.0-pro', 'Qwen Image 2.0 Pro', I, ['text_to_image', 'image_edit']),
  row('alibaba', 'qwen-image-3.0-pro', 'Qwen Image 3.0 Pro', I, ['text_to_image', 'image_edit']),
  row('alibaba', 'wan2.1-vace-plus', 'Wan VACE Region Edit', V, ['video_edit', 'region_edit']),
  row('alibaba', 'wan2.7-i2v', 'Wan 2.7 Image to Video', V, ['image_to_video', 'start_end_frames', 'extend_video']),
  row('alibaba', 'wan2.7-r2v', 'Wan 2.7 R2V', V, ['reference_frames']),
  row('alibaba', 'wan2.7-t2v', 'Wan 2.7 T2V', V, ['text_to_video']),
  row('alibaba', 'wan3.0-video', 'Wan 3.0', V, ['text_to_video', 'image_to_video', 'start_end_frames', 'reference_frames', 'audio_to_video']),
  row('google', 'gemini-2.5-flash-image', 'Nano Banana - Gemini 2.5 Flash Image', I, ['text_to_image', 'image_edit', 'reference_frames']),
  row('google', 'gemini-3-pro-image', 'Nano Banana Pro - Gemini 3 Pro Image', I, ['text_to_image', 'image_edit', 'reference_frames']),
  row('google', 'gemini-3.1-flash-image', 'Nano Banana 2 - Gemini 3.1 Flash Image', I, ['text_to_image', 'image_edit', 'reference_frames']),
  row('google', 'gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite - Gemini 3.1 Flash Lite Image', I, ['text_to_image', 'image_edit', 'reference_frames']),
  row('google', 'gemini-omni-1.1-flash', 'Gemini Omni 1.1 Flash', V, ['text_to_video', 'image_to_video', 'reference_frames', 'video_to_video']),
  row('google', 'gemini-omni-flash-preview', 'Gemini Omni Flash Preview', V, ['text_to_video', 'image_to_video', 'reference_frames', 'video_to_video']),
  row('google', 'veo-3.1-generate-preview', 'Veo 3.1 Preview', V, ['text_to_video', 'image_to_video', 'start_end_frames', 'reference_frames', 'extend_video']),
  row('minimax', 'MiniMax-H3', 'MiniMax H3', V, ['text_to_video', 'image_to_video', 'start_end_frames', 'reference_frames', 'audio_to_video']),
  row('openai', 'gpt-image-2', 'GPT Image 2', I, ['text_to_image', 'image_edit', 'reference_frames', 'region_edit']),
  row('openai', 'gpt-image-2.5-flare', 'GPT Image 2.5 Flare', I, ['text_to_image', 'image_edit', 'reference_frames', 'region_edit']),
  row('openai', 'gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst', I, ['text_to_image', 'image_edit', 'reference_frames', 'region_edit']),
  row('runway', 'gen4_turbo', 'Runway Gen-4 Turbo', V, ['image_to_video']),
  row('runway', 'gen4.5', 'Runway Gen-4.5', V, ['text_to_video', 'image_to_video']),
  row('runway', 'seedance2_5', 'Seedance 2.5', V, ['text_to_video', 'image_to_video', 'start_end_frames', 'reference_frames', 'extend_video'], { blocked_features: ['xduel'] }),
  row('xai', 'grok-imagine-image', 'Grok Imagine Image', I, ['text_to_image', 'image_edit']),
  row('xai', 'grok-imagine-image-2.0', 'Grok Imagine Image 2.0', I, ['text_to_image', 'image_edit']),
  row('xai', 'grok-imagine-video', 'Grok Imagine Video', V, ['text_to_video', 'image_to_video', 'reference_frames', 'video_to_video']),
  row('xai', 'grok-imagine-video-1.5', 'Grok Imagine Video 1.5', V, ['image_to_video']),
]
assert.equal(CATALOG.length, 32)
const full = supportFrom(CATALOG)

// ── the catalog ──────────────────────────────────────────────────────────────

assert.equal(full.models.length, 32, 'every Sep 27 row is usable in XCreate')
const namesFor = (k: MediaKind) => full.families.filter(f => f.kinds.includes(k)).map(f => f.name)
assert.deepEqual(namesFor('video'), ['Seedance', 'Veo', 'Gemini Omni', 'Wan', 'HappyHorse', 'MiniMax', 'Runway', 'Grok Imagine'])
assert.deepEqual(namesFor('image'), ['GPT Image', 'Nano Banana', 'Qwen Image', 'Grok Imagine'])
for (const f of full.families) assert.ok(!/midjourney|flux|seedream|imagen|kling|sora/i.test(f.name), `${f.name} is not in the catalog`)

assert.deepEqual(usableKinds(row('runway', 'seedance2_5', 'Seedance 2.5', V, ['text_to_video'], { blocked_features: ['xcreate'] })), [], 'blocked for xcreate')
assert.deepEqual(usableKinds(row('runway', 'seedance2_5', 'Seedance 2.5', V, ['text_to_video'], { enabled: false })), [], 'disabled')
assert.deepEqual(usableKinds(row('openai', 'sora-2', 'Sora 2', V, ['text_to_video'])), [], 'no video generator for openai')
assert.deepEqual(usableKinds(row('anthropic', 'x-image', 'X Image', I, ['text_to_image'])), [], 'no image generator for anthropic')
assert.deepEqual(usableKinds(row('openai', 'gpt-image-x', 'GPT Image X', I, ['region_edit'])), [], 'no XCreate recipe')

// ── searches ─────────────────────────────────────────────────────────────────

const q = (k: MediaKind, n: number, s = full) => searchGroups(k, s, n).map(groupQuery)
assert.deepEqual(q('video', 4), ['Seedance', '(Veo OR "Gemini Omni")', '(Wan OR HappyHorse)', '(MiniMax OR Hailuo OR Runway OR "Grok Imagine")'])
assert.deepEqual(q('image', 2), ['("GPT Image" OR "Nano Banana")', '("Qwen Image" OR "Grok Imagine")'])
for (const k of ['video', 'image'] as MediaKind[]) {
  const listed = searchGroups(k, full, k === 'video' ? 4 : 2).flat().map(f => f.name)
  assert.deepEqual([...listed].sort(), [...namesFor(k)].sort(), `${k}: every family searched once`)
  assert.ok(!q(k, 4).some(s => /midjourney|"ai (video|art)"|^"?prompt"?$/i.test(s)), `${k}: no catch-all`)
}
const noSeedance = supportFrom(CATALOG.filter(r => r.model_name !== 'seedance2_5'))
assert.deepEqual(searchGroups('video', noSeedance, 4).map(g => g.length), [1, 2, 2, 2], 'no solo family: shared out evenly')
assert.deepEqual(searchGroups('video', full, 0), [])
assert.deepEqual(q('video', 1), ['(Seedance OR Veo OR "Gemini Omni" OR Wan OR HappyHorse OR MiniMax OR Hailuo OR Runway OR "Grok Imagine")'], 'one search: solo gives way')

// A catalog model no family covers is searched under its own name.
assert.equal(derivedName('Kling 3.0 Text to Video'), 'Kling')
assert.equal(derivedName('FLUX.2 Pro'), 'FLUX')
assert.equal(derivedName('Midjourney V7'), 'Midjourney')
assert.equal(derivedName('Hunyuan Video'), 'Hunyuan')
assert.equal(derivedName('X1'), null)
const withKling = supportFrom([...CATALOG, row('alibaba', 'kling-v3-t2v', 'Kling 3.0 Text to Video', V, ['text_to_video'])])
assert.ok(q('video', 4, withKling).some(s => /\bKling\b/.test(s)), 'Kling searched once offered')
assert.equal(eligibility('video', ['Kling 2.5 Turbo'], withKling).ok, true)
assert.equal(eligibility('video', ['Kling 2.5 Turbo'], full).ok, false)

// ── eligibility ──────────────────────────────────────────────────────────────

const yes = (k: MediaKind, models: string[], s = full) => assert.equal(eligibility(k, models, s).ok, true, `${k} ${JSON.stringify(models)} should be eligible`)
const no = (k: MediaKind, models: string[], why: RegExp, s = full) => {
  const v = eligibility(k, models, s)
  assert.equal(v.ok, false, `${k} ${JSON.stringify(models)} should not be eligible`)
  if (!v.ok) assert.match(v.reason, why, `${k} ${JSON.stringify(models)}: ${v.reason}`)
}

// Video.
yes('video', ['Seedance 2.5'])
yes('video', ['GPT Image 2', 'Seedance 2.5'])         // supported across kinds (Codex)
yes('video', ['Nano Banana Pro + Veo 3.1'])
yes('video', ['Hailuo 02/03'])
for (const m of ['Veo3', 'Wan2.2', 'Wan VACE', 'HappyHorse 1.1', 'Happy Horse', 'Gemini Omni Flash', 'Runway Gen-4.5', 'Gen-4 Turbo', 'MiniMax H3', 'Grok Imagine', 'Grok Imagine Video 1.5', 'Seedance 2.5 (image to video)']) yes('video', [m])
no('video', ['Midjourney', 'Seedance 2.5'], /Midjourney/)
no('video', ['Midjourney + Seedance 2.5'], /Midjourney/)                    // Codex regression 1
no('video', ['Seedance 2.5 (first frame: Midjourney V7)'], /Midjourney/)
no('video', ['Kling via Runway'], /Kling/)
no('video', ['Seedance 2.5 & Kling 2.5'], /Kling/)
no('video', ['Sora 2'], /Sora/)
no('video', ['Midjourney Video'], /Midjourney/)
no('video', ['GPT Image 2'], /no video model/)
no('video', ['Grok Imagine Image'], /no video model/)
no('video', ['Claude Opus 5.5', 'Seedance 2.5'], /LLM/)
no('video', ['Seedance 2.5 (made with Claude Opus)'], /LLM/)
no('video', ['Grok Imagine + Grok 4'], /LLM/)
no('video', ['ChatGPT', 'Seedance 2.5'], /LLM/)                              // the app exception is image-only
no('video', [], /names no model/)
no('video', ['  '], /names no model/)

// Image.
for (const m of ['GPT Image 2', 'gpt-image-2', 'GPT Images', 'Nano Banana Pro', 'Gemini 3 Pro Image', 'Qwen-Image-Edit', 'Grok Imagine', 'Grok Imagine Image 2.0']) yes('image', [m])
yes('image', ['ChatGPT', 'GPT Image 2'])
yes('image', ['GPT Image 2 (ChatGPT)'])
no('image', ['ChatGPT'], /LLM/)
no('image', ['ChatGPT', 'Midjourney'], /LLM/)
no('image', ['Midjourney v8.2'], /Midjourney/)
no('image', ['Flux 2'], /Flux/)
no('image', ['Seedream 4.0'], /Seedream/)
no('image', ['Imagen 4'], /Imagen/)
no('image', ['DALL-E 3'], /DALL-E/)
no('image', ['Gemini 3 Pro'], /LLM/)
no('image', ['Gemini Omni'], /no image model/)
no('image', ['Grok Imagine Video'], /no image model/)

// Grok Imagine is one name on X for two models (Codex regression 2): an
// explicit Image or Video counts only when that model is offered.
const grok = (...rows: CatalogRow[]) => supportFrom(rows)
const grokImage = grok(row('xai', 'grok-imagine-image', 'Grok Imagine Image', I, ['text_to_image']))
no('image', ['Grok Imagine Video'], /Grok Imagine Video/, grokImage)
yes('image', ['Grok Imagine'], grokImage)
yes('image', ['Grok Imagine Image'], grokImage)
no('video', ['Grok Imagine'], /no video model/, grokImage)
no('video', ['Grok Imagine Video'], /Grok Imagine Video/, grokImage)
assert.deepEqual(otherGeneratorsIn('Made with Grok Imagine Video', grokImage), ['Grok Imagine Video'])
const grokVideo = grok(row('xai', 'grok-imagine-video', 'Grok Imagine Video', V, ['text_to_video']))
no('image', ['Grok Imagine Image'], /Grok Imagine Image/, grokVideo)
no('image', ['Grok Imagine'], /no image model/, grokVideo)
yes('video', ['Grok Imagine'], grokVideo)
yes('video', ['Grok Imagine Video 1.5'], grokVideo)
no('video', ['Grok Imagine Image'], /Grok Imagine Image/, grokVideo)
const grokOff = grok(row('xai', 'grok-imagine-video', 'Grok Imagine Video', V, ['text_to_video'], { enabled: false }),
                     row('xai', 'grok-imagine-image', 'Grok Imagine Image', I, ['text_to_image'], { blocked_features: ['xcreate'] }))
no('video', ['Grok Imagine'], /Grok Imagine/, grokOff)
no('image', ['Grok Imagine'], /Grok Imagine/, grokOff)

// A model leaves with its catalog row.
no('video', ['Seedance 2.5'], /Seedance/, noSeedance)

// Combined labels.
assert.deepEqual(namesIn('Midjourney + Seedance 2.5'), ['Midjourney', 'Seedance 2.5'])
assert.deepEqual(namesIn('Hailuo 02/03'), ['Hailuo 02'])
assert.deepEqual(namesIn('Seedance 2.5 (image to video)'), ['Seedance 2.5'])
assert.deepEqual(namesIn('Nano Banana and Veo'), ['Nano Banana', 'Veo'])
assert.deepEqual(namesIn('Seedance x Runway'), ['Seedance', 'Runway'])

// A candidate's own text.
assert.deepEqual(otherGeneratorsIn('Made with Midjourney and Seedance 2.5', full), ['Midjourney'])
assert.deepEqual(otherGeneratorsIn('Hailuo 02 did this, then Veo 3', full), [])
assert.deepEqual(otherGeneratorsIn('una imagen de un gato', full), [], 'Spanish "imagen" is not Imagen')
assert.deepEqual(otherGeneratorsIn('Imagen 4 test', full), ['Imagen 4'])
assert.deepEqual(otherGeneratorsIn('Kling 2.5 vs Seedance', full), ['Kling'])
assert.deepEqual(otherGeneratorsIn('Pikachu on a runway', full), [])

// The model a preset runs on now, named for the tag beside its button: the
// stored one while it runs, else the one the credited names point to (settings
// saved while the model was unclear); none once no model runs them.
const runs = (kind: 'video' | 'image', models: string[], preset: { model?: string; recipe: string } | null, s = full) =>
  presetRunsOn(kind, models, preset, s)
assert.deepEqual(runs('video', ['Seedance 2.5'], { model: 'seedance2_5', recipe: 'image_to_video' }), { model: 'seedance2_5', name: 'Seedance 2.5' })
assert.deepEqual(runs('image', ['GPT Image 2'], { model: 'gpt-image-2', recipe: 'image_edit' }), { model: 'gpt-image-2', name: 'GPT Image 2' })
assert.deepEqual(runs('image', ['Nano Banana Pro'], { model: 'gemini-3-pro-image', recipe: 'image_edit' }), { model: 'gemini-3-pro-image', name: 'Nano Banana Pro' }, 'the name before the alias')
assert.deepEqual(runs('image', ['GPT Image 2.5'], { recipe: 'image_edit' }), { model: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare' }, 'saved without a model: picked when served')
assert.deepEqual(runs('video', ['Google veo 3.1'], { recipe: 'text_to_video' }), { model: 'veo-3.1-generate-preview', name: 'Veo 3.1 Preview' })
assert.deepEqual(runs('image', ['Grok Imagine'], { recipe: 'text_to_image' }), { model: 'grok-imagine-image-2.0', name: 'Grok Imagine Image 2.0' }, 'two Grok image models: the newer (owner, Sep 28)')
assert.deepEqual(runs('video', ['Seedance 2.5'], { model: 'gone', recipe: 'text_to_video' }), { model: 'seedance2_5', name: 'Seedance 2.5' }, 'a stored model gone: the credited name')
assert.equal(runs('video', [], { model: 'gone', recipe: 'text_to_video' }), null, 'model gone, nothing credited')
assert.equal(runs('video', ['Seedance 2.5'], { model: 'seedance2_5', recipe: 'video_edit' }), null, 'recipe not offered')
assert.equal(runs('image', ['Seedance 2.5'], { model: 'seedance2_5', recipe: 'image_to_video' }), null, 'wrong kind')
assert.equal(runs('video', ['Seedance 2.5'], { model: 'seedance2_5', recipe: 'image_to_video' }, noSeedance), null, 'model disabled')
assert.equal(runs('video', ['Seedance 2.5'], null), null)

// A newer model of the credited family when the credited one isn't offered
// (owner, Sep 28), never an older one.
assert.deepEqual(runs('video', ['Seedance 2.0'], { recipe: 'text_to_video' }), { model: 'seedance2_5', name: 'Seedance 2.5' })
assert.deepEqual(runs('video', ['Veo 3'], { recipe: 'text_to_video' }), { model: 'veo-3.1-generate-preview', name: 'Veo 3.1 Preview' })
assert.deepEqual(runs('video', ['Wan 2.2'], { recipe: 'text_to_video' }), { model: 'wan3.0-video', name: 'Wan 3.0' }, 'the newest the recipe allows')
assert.deepEqual(runs('video', ['Hailuo 02'], { recipe: 'image_to_video' }), { model: 'MiniMax-H3', name: 'MiniMax H3' })
assert.deepEqual(runs('video', ['Runway Gen-3 Alpha'], { recipe: 'text_to_video' }), { model: 'gen4.5', name: 'Runway Gen-4.5' })
assert.deepEqual(runs('image', ['GPT Image 1'], { recipe: 'text_to_image' }), { model: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare' }, 'a tie at the newest: PLAIN_NAMES')
assert.deepEqual(runs('video', ['HappyHorse 1.0'], { recipe: 'text_to_video' }), { model: 'happyhorse-1.0-t2v', name: 'HappyHorse 1.0 Text to Video' }, 'offered: the credited version, not the newer')
assert.equal(runs('video', ['Seedance 3.0'], { recipe: 'text_to_video' }), null, 'never an older model')
assert.equal(runs('video', ['Kling 2.1'], { recipe: 'text_to_video' }), null, 'not a family XCreate offers')
assert.equal(runs('image', ['Nano Banana 1'], { recipe: 'text_to_image' }), null, 'two Gemini 3.1 image models tie: none')

// Which model a preset runs: an exact name first, then one variant, never
// another version (Codex review, Sep 27: "GPT IMAGE 2" had matched
// gpt-image-2.5-sunburst as a substring).
const images = full.models.filter(m => m.kinds.includes('image'))
const videos = full.models.filter(m => m.kinds.includes('video'))
const pick = (names: string[], recipe: string, cat = images) => presetModel(names, recipe, cat)
assert.equal(pick(['GPT IMAGE 2'], 'text_to_image'), 'gpt-image-2')
assert.equal(pick(['GPT image 2.0'], 'image_edit'), 'gpt-image-2')
assert.equal(pick(['GPT Image 2.5'], 'text_to_image'), 'gpt-image-2.5-flare', 'plain 2.5 is Flare (owner, Sep 27)')
assert.equal(pick(['GPT image 2.5'], 'image_edit'), 'gpt-image-2.5-flare')
assert.equal(pick(['GPT Image 2.5 Flare'], 'text_to_image'), 'gpt-image-2.5-flare')
assert.equal(pick(['gpt-image-2.5-sunburst'], 'text_to_image'), 'gpt-image-2.5-sunburst')
assert.equal(pick(['GPT Image'], 'text_to_image'), null, 'no version named')
assert.equal(pick(['nano banana pro'], 'text_to_image'), 'gemini-3-pro-image')
assert.equal(pick(['Nano Banana'], 'text_to_image'), 'gemini-2.5-flash-image')
assert.equal(pick(['Nano Banana 2'], 'text_to_image'), 'gemini-3.1-flash-image')
assert.equal(pick(['Nano Banana 2 Lite'], 'text_to_image'), 'gemini-3.1-flash-lite-image')
assert.equal(pick(['Gemini 3 Pro Image'], 'image_edit'), 'gemini-3-pro-image')
assert.equal(pick(['Qwen Image 2.1'], 'text_to_image'), null, 'a version we do not offer')
assert.equal(pick(['Qwen Image 3'], 'text_to_image'), 'qwen-image-3.0-pro')
assert.equal(pick(['Grok Imagine'], 'text_to_image'), null, 'two Grok image models')
assert.equal(pick(['Seedance 2.5'], 'image_to_video', videos), 'seedance2_5')
assert.equal(pick(['Seedance 2.5 Pro'], 'text_to_video', videos), 'seedance2_5')
assert.equal(pick(['Veo 3.1'], 'text_to_video', videos), 'veo-3.1-generate-preview')
assert.equal(pick(['Google veo 3.1'], 'text_to_video', videos), 'veo-3.1-generate-preview', 'a maker in front')
assert.equal(pick(['OpenAI GPT Image 2'], 'text_to_image'), 'gpt-image-2')
assert.equal(pick(['Veo 3'], 'text_to_video', videos), null, 'Veo 3 is not 3.1')
assert.equal(pick(['Hailuo H3'], 'text_to_video', videos), 'MiniMax-H3')
assert.equal(pick(['Wan 2.7'], 'text_to_video', videos), 'wan2.7-t2v')
assert.equal(pick(['Wan 3.0'], 'text_to_video', videos), 'wan3.0-video')
assert.equal(pick(['Runway Gen-4.5'], 'text_to_video', videos), 'gen4.5')
assert.equal(pick(['Gen-4 Turbo'], 'text_to_video', videos), null, 'recipe not offered')
assert.equal(pick(['Gen-4 Turbo'], 'image_to_video', videos), 'gen4_turbo')
assert.equal(pick(['GPT Image 2', 'Seedance 2.5'], 'image_to_video', videos), 'seedance2_5', 'the video model of a mixed post')

// ── the posts in trending_posts on Sep 27 ────────────────────────────────────

const POSTS: [MediaKind, string, string[]][] = [
  ['image', '2101756774143451391', ['Midjourney']],
  ['image', '2102138699861360860', ['Midjourney']],
  ['image', '2103833992709677529', ['Midjourney']],
  ['image', '2102747296786272535', ['Midjourney']],
  ['image', '2103877301138235800', ['Midjourney v8.2']],
  ['video', '2103337966416621703', ['Seedance 2.5']],
  ['video', '2102365054389899695', ['Seedance 2.5']],
  ['video', '2102028142294483208', ['Midjourney', 'Seedance 2.5']],
  ['video', '2103329257149898940', ['Seedance 2.5']],
  ['video', '2103188197933187179', ['GPT Image 2', 'Seedance 2.5']],
  ['image', '2103447104303849669', ['Midjourney']],
  ['image', '2102669311706067066', ['Midjourney']],
  ['image', '2103560225186074706', ['Midjourney v8.2']],
  ['image', '2103515148405383305', ['Midjourney v8.2']],
  ['image', '2103152516422922280', ['Midjourney']],
  ['image', '2102707057506005086', ['Midjourney v8.2']],
  ['image', '2102790137038123474', ['Midjourney']],
  ['image', '2103758105226199099', ['Midjourney']],
]
const kept = POSTS.filter(([k, , m]) => eligibility(k, m, full).ok).map(([, id]) => id)
assert.deepEqual(kept, ['2103337966416621703', '2102365054389899695', '2103329257149898940', '2103188197933187179'])

console.log(`PASS: ${full.families.length} families from ${CATALOG.length} catalog rows, searches, eligibility incl. combined labels and Grok Imagine Image/Video, text check, presets; ${kept.length} of ${POSTS.length} Sep 27 posts eligible`)
