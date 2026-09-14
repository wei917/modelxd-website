// The TGS 2026 game gallery (owner, Sep 14): three fan-concept artworks of
// famous Japanese games, generated for this showcase by Codex with its
// built-in image generation (manifest.json in
// ModelXD_ChatGPT/tgs-japan-review/game-gallery-assets/, 2026-09-14). They
// are NOT XDuel results and carry no model identity, price or vote. The
// prompts are the manifest strings verbatim: they are what the gallery
// shows, copies, and prefills into XDuel / XDirect.
// image = the supplied 1672x941 PNG (lightbox); thumb = a JPEG copy of the
// same file for cards and the home hero, so the first screen does not load
// 3 MB per picture.
export type Bilingual = { en: string; ja: string }
export type TgsWork = {
  slug: 'street-fighter' | 'monster-hunter' | 'metal-gear'
  image: string
  thumb: string
  title: Bilingual
  reference: Bilingual   // "Homage to <game> (<publisher>)", always unofficial
  alt: Bilingual
  prompt: string
}

export const TGS_WORKS: TgsWork[] = [
  {
    slug: 'street-fighter',
    image: '/tgs/street-fighter.png',
    thumb: '/tgs/street-fighter.jpg',
    title: { en: 'One strike, that instant.', ja: '一撃、その瞬間。' },
    reference: { en: 'Homage to Street Fighter (CAPCOM)', ja: 'ストリートファイター（カプコン）へのオマージュ' },
    alt: { en: 'AI fan concept of Ryu from Street Fighter releasing a Hadouken in a rainy Tokyo backstreet', ja: 'ストリートファイターのリュウが雨の東京の路地で波動拳を放つAIファンアート' },
    prompt: 'Use case: stylized-concept. Asset type: landscape 16:9 game fan-art gallery image for a Japanese game-show website. Create a new unofficial fan-art illustration of Ryu from Street Fighter unleashing a Hadouken in a rain-soaked Tokyo backstreet at night. Recognizable Ryu: short dark hair, red headband, white sleeveless frayed karate gi, red sparring gloves. Dynamic grounded three-quarter pose, both hands cupping the intense blue energy wave; anatomically clear hands and limbs. Wet asphalt reflects the electric blue blast and restrained red lantern lights. Render as richly painted fighting-game key art with confident ink edges, tactile brush marks, strong silhouette and depth. Medium-wide framing, figure and energy wave both readable at thumbnail size, leave breathing room around the subject for responsive cropping. Make the face and action the focal point. A single finished artwork, no panels, no UI, no lettering, no logos, no watermark. Do not reproduce an existing promotional poster.',
  },
  {
    slug: 'monster-hunter',
    image: '/tgs/monster-hunter.png',
    thumb: '/tgs/monster-hunter.jpg',
    title: { en: 'Painting the world of the hunt.', ja: '狩りの世界を、描く。' },
    reference: { en: 'Homage to Monster Hunter (CAPCOM)', ja: 'モンスターハンター（カプコン）へのオマージュ' },
    alt: { en: 'AI fan concept of Rathalos from Monster Hunter descending on a hunter in an ancient forest', ja: 'モンスターハンターのリオレウスが古代の森でハンターに迫るAIファンアート' },
    prompt: 'Use case: stylized-concept. Asset type: landscape 16:9 game fan-art gallery image for a Japanese game-show website. Create new unofficial Monster Hunter fan art: the recognizable red fire wyvern Rathalos descending through the huge canopy of an ancient forest, confronting one armored hunter carrying an oversized great sword in the foreground. The monster has two powerful legs and two broad leathery wings, red-orange plated scales, a horned head and a heavy spiked tail; the wing membranes and silhouette must read clearly. The hunter seen three-quarter from behind establishes enormous scale. Warm shafts of late-afternoon sun, fern-covered ruins, luminous green foliage, a few embers and drifting leaves. Detailed painterly fantasy environment concept art with cinematic depth, crisp foreground silhouettes and a magnificent creature, strong separation between green forest and red monster. A single finished artwork, generous composition that survives a card crop. No injury or gore, no text, no logos, no UI, no watermark. Do not reproduce an existing promotional poster.',
  },
  {
    slug: 'metal-gear',
    image: '/tgs/metal-gear.png',
    thumb: '/tgs/metal-gear.jpg',
    title: { en: 'The tension of infiltration, in one frame.', ja: '潜入の緊張を、一枚に。' },
    reference: { en: 'Homage to Metal Gear (KONAMI)', ja: 'メタルギア（コナミ）へのオマージュ' },
    alt: { en: 'AI fan concept of Solid Snake from Metal Gear crouching in an industrial hangar with a Metal Gear silhouette behind', ja: 'メタルギアのソリッド・スネークが格納庫に潜み、背後にメタルギアの影が立つAIファンアート' },
    prompt: 'Use case: stylized-concept. Asset type: landscape 16:9 game fan-art gallery image for a Japanese game-show website. Create new unofficial Metal Gear fan art featuring the recognizable Solid Snake, with dark swept-back hair, dark gray headband and trailing ties, light stubble, fitted gray-blue tactical sneaking suit and harness. He crouches behind a concrete pier in a cold industrial infiltration scene, alert and looking toward a distant searchlight. No actor likeness. A vast bipedal Metal Gear machine looms as a silhouette through mist in a hangar background. Rain and shallow puddles catch sparse amber warning lights against cool blue-gray steel. The scene conveys stealth, patience and scale through negative space and a restrained cinematic composition. Painterly military-science-fiction concept art with precise material rendering and purposeful brushwork; Snake\'s face and full silhouette readable. A single finished landscape artwork, no collage, no text, no logos, no interface, no watermark, no gore. Do not reproduce an existing game screenshot or poster.',
  },
]

/** The artwork on the Japanese home's first screen (Ryu, per Codex's review). */
export const TGS_HERO_WORK = TGS_WORKS[0]

export const pick = (v: Bilingual, lang: string): string => (lang === 'ja' ? v.ja : v.en)
