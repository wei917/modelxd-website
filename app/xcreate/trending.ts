// app/xcreate/trending.ts
//
// "Trending on social media" for XCreate's Studio and Templates tabs: the
// most-liked AI videos and images whose creators shared the prompt, shown as
// each platform's own embed, so a deleted post disappears on its own.
//
// The list lives in `trending_posts` (supabase/108), up to 20 per kind per
// week, and reaches the page through /api/trending. trending-seed.json is the
// same seed the migration inserts (both generated from one script); the route
// serves it only while 108 hasn't been run (or the read fails), so the
// section never blanks.
//
// What belongs on the list (owner, Sep 26): posts made with a video or image
// model that NAME it. Never posts made through an LLM agent (Claude Opus
// briefs), posts built on someone else's characters, or suggestive ones.

import type { Lang } from '@/lib/i18n'
import type { Template } from './templates'
import seed from './trending-seed.json'

export type TrendingKind = 'video' | 'image'

/** What "Use this preset" applies in XCreate. */
export type TrendingPreset = {
  model: string                             // ai_models.model_name
  recipe: string                            // XCreate recipe: text_to_video, image_to_video, reference_frames…
  duration?: number
  aspect?: string
  needsImage?: boolean                      // the creator started from their own picture; the user adds theirs
}

export type TrendingPost = {
  platform: string                          // 'x' today; 'instagram' | 'threads' | 'facebook' later
  postId: string
  handle: string                            // creator, without the @
  url: string
  kind: TrendingKind
  models: string[]                          // as the creator names them
  likes: number | null                      // when found; the embed shows the live count
  summary: Partial<Record<Lang, string>>    // our words, never the creator's text
  prompt: string | null                     // the creator's shared prompt, for the preset
  preset: TrendingPreset | null             // null = no preset button
}

/** Posts kept per kind per week; Studio shows the first STUDIO_SHOWN. */
export const TRENDING_MAX = 20
export const STUDIO_SHOWN = 10   // owner, Sep 26: "load 10"

// Week of Sep 21 (Grok x_search over Sep 19–26).
export const FALLBACK_TRENDING = seed as TrendingPost[]

/** The post as an XCreate template, so the preset goes through applyTemplate
 *  like any other: mode, recipe, prompt, model and per-slot options at once. */
export function presetTemplate(post: TrendingPost, lang: Lang): Template | null {
  if (!post.preset || !post.prompt) return null
  return {
    id:                `trend-${post.platform}-${post.postId}`,
    emoji:             '',
    title:             `@${post.handle}`,
    subtitle:          post.summary[lang] ?? post.summary.en ?? '',
    mode:              post.kind,
    slotMode:          post.preset.recipe,
    starterPrompt:     post.prompt,
    aspectRatio:       post.preset.aspect,
    duration:          post.preset.duration,
    recommendedModels: [post.preset.model],
    attachmentSlots:   [],
  }
}

type Copy = { title: string; seeAll: string; use: string; needsImage: string; by: string } & Record<TrendingKind, string>

export const TRENDING_COPY: Record<Lang, Copy> = {
  en: {
    title: 'Trending on social media',
    video: 'The most-liked AI videos whose creators shared their prompts. Rights and credit stay with the creators.',
    image: 'The most-liked AI images whose creators shared their prompts. Rights and credit stay with the creators.',
    seeAll: 'See all {n}',
    use: 'Use this preset',
    needsImage: 'Then add your own picture',
    by: 'by',
  },
  'zh-Hant': {
    title: '社群媒體熱門',
    video: '創作者公開了提示詞、按讚數最高的 AI 影片。版權與署名歸原作者。',
    image: '創作者公開了提示詞、按讚數最高的 AI 圖片。版權與署名歸原作者。',
    seeAll: '查看全部 {n} 則',
    use: '套用這組設定',
    needsImage: '再加上你自己的圖片',
    by: '作者',
  },
  'zh-Hans': {
    title: '社交媒体热门',
    video: '创作者公开了提示词、点赞最多的 AI 视频。版权与署名归原作者。',
    image: '创作者公开了提示词、点赞最多的 AI 图片。版权与署名归原作者。',
    seeAll: '查看全部 {n} 条',
    use: '套用这组设置',
    needsImage: '再加上你自己的图片',
    by: '作者',
  },
  ja: {
    title: 'SNS で話題',
    video: '作者がプロンプトを公開している、いいねの多い AI 動画。権利とクレジットは作者に帰属します。',
    image: '作者がプロンプトを公開している、いいねの多い AI 画像。権利とクレジットは作者に帰属します。',
    seeAll: 'すべて見る（{n} 件）',
    use: 'このプリセットを使う',
    needsImage: 'あとで自分の画像を追加',
    by: '作者',
  },
  ko: {
    title: '소셜 미디어 인기',
    video: '제작자가 프롬프트를 공개한, 좋아요가 가장 많은 AI 영상입니다. 권리와 크레딧은 제작자에게 있습니다.',
    image: '제작자가 프롬프트를 공개한, 좋아요가 가장 많은 AI 이미지입니다. 권리와 크레딧은 제작자에게 있습니다.',
    seeAll: '전체 보기 ({n})',
    use: '이 프리셋 사용',
    needsImage: '그다음 내 이미지를 추가하세요',
    by: '제작',
  },
}
