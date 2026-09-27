// app/xcreate/trending.ts
//
// "Trending on social media" for XCreate's Studio and Templates tabs: the
// most-liked AI videos and images made with models XCreate offers, shown as
// each platform's own embed, so a deleted post disappears on its own. A post
// that shares its prompt also gets a preset button.
//
// The list lives in `trending_posts` (supabase/108, 110), up to
// TRENDING_LIVE_MAX per kind per week, and reaches the page through
// /api/trending. trending-seed.json is the
// same seed the migration inserts (both generated from one script); the route
// serves it only while 108 hasn't been run (or the read fails), so the
// section never blanks.
//
// What belongs on the list (owner, Sep 26): posts made with a video or image
// model that NAME it. Never posts made through an LLM agent (Claude Opus
// briefs), posts built on someone else's characters, or suggestive ones.
// Since Sep 27 only models XCreate offers ("remove midjourney"): the route
// skips a post crediting any other model (lib/trending-models.ts), the seed
// included.

import type { Lang } from '@/lib/i18n'
import type { Template } from './templates'
import seed from './trending-seed.json'

export type TrendingKind = 'video' | 'image'
/** What a feed shows: one kind (Templates' tabs) or both (Studio). */
export type TrendingFeedKind = TrendingKind | 'all'

/** What "Use this preset" applies in XCreate. Saved even when the credited
 *  name fits no single model (owner, Sep 27): /api/trending picks the model
 *  on every read, so a served preset always has one. */
export type TrendingPreset = {
  model?: string                            // ai_models.model_name; absent = chosen from the post's `models` when served
  recipe: string                            // XCreate recipe: text_to_video, image_to_video, reference_frames…
  duration?: number
  aspect?: string
  needsImage?: boolean                      // the creator started from their own picture; the user adds theirs
  imageRole?: 'first_frame' | 'character_reference'  // what that picture is for
  modelName?: string                        // the model's catalog name, added by /api/trending on every read
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

/** The most one /api/trending page returns: a request bound. */
export const TRENDING_MAX = 20
/** Posts one week can hold live per kind (/admin/trending's publish). It was
 *  20, the page size, until the owner asked for the month's supply (Sep 27:
 *  50+); migration 110 lifts the database's matching CHECK on rank. */
export const TRENDING_LIVE_MAX = 200
/** First page and each further page of the feed (owner, Sep 27: "at least 10
 *  ... infinite load"). */
export const TRENDING_PAGE = 10

// Week of Sep 21 (Grok x_search over Sep 19–26).
export const FALLBACK_TRENDING = seed as TrendingPost[]

/** The post as an XCreate template, so the preset goes through applyTemplate
 *  like any other: mode, recipe, prompt, model and per-slot options at once. */
export function presetTemplate(post: TrendingPost, lang: Lang): Template | null {
  if (!post.preset?.model || !post.prompt) return null
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

type Copy = { title: string; loadMore: string; loading: string; end: string; failed: string; use: string; open: string } & Record<TrendingFeedKind, string>

export const TRENDING_COPY: Record<Lang, Copy> = {
  en: {
    title: 'Trending on social media',
    video: 'Popular AI videos, with credit to the original creators. Use a preset when a prompt is available.',
    image: 'Popular AI images, with credit to the original creators. Use a preset when a prompt is available.',
    all: 'Popular AI videos and images, with credit to the original creators. Use a preset when a prompt is available.',
    loadMore: 'Load more',
    loading: 'Loading…',
    end: 'That is everything so far.',
    failed: 'Could not load more posts.',
    use: 'Use this preset',
    open: 'Open on X',
  },
  'zh-Hant': {
    title: '社群媒體熱門',
    video: '熱門 AI 影片，版權與署名歸原作者。有公開提示詞的，可以直接套用設定。',
    image: '熱門 AI 圖片，版權與署名歸原作者。有公開提示詞的，可以直接套用設定。',
    all: '熱門 AI 影片與圖片，版權與署名歸原作者。有公開提示詞的，可以直接套用設定。',
    loadMore: '載入更多',
    loading: '載入中…',
    end: '目前就是這些。',
    failed: '無法載入更多貼文。',
    use: '套用這組設定',
    open: '在 X 上開啟',
  },
  'zh-Hans': {
    title: '社交媒体热门',
    video: '热门 AI 视频，版权与署名归原作者。有公开提示词的，可以直接套用设置。',
    image: '热门 AI 图片，版权与署名归原作者。有公开提示词的，可以直接套用设置。',
    all: '热门 AI 视频与图片，版权与署名归原作者。有公开提示词的，可以直接套用设置。',
    loadMore: '加载更多',
    loading: '加载中…',
    end: '目前就是这些。',
    failed: '无法加载更多帖子。',
    use: '套用这组设置',
    open: '在 X 上打开',
  },
  ja: {
    title: 'SNS で話題',
    video: '人気の AI 動画。権利とクレジットは作者に帰属します。プロンプトが公開されていれば、プリセットとして使えます。',
    image: '人気の AI 画像。権利とクレジットは作者に帰属します。プロンプトが公開されていれば、プリセットとして使えます。',
    all: '人気の AI 動画と画像。権利とクレジットは作者に帰属します。プロンプトが公開されていれば、プリセットとして使えます。',
    loadMore: 'さらに読み込む',
    loading: '読み込み中…',
    end: '現在はここまでです。',
    failed: '続きを読み込めませんでした。',
    use: 'このプリセットを使う',
    open: 'Xで開く',
  },
  ko: {
    title: '소셜 미디어 인기',
    video: '인기 AI 영상입니다. 권리와 크레딧은 제작자에게 있습니다. 프롬프트가 공개된 경우 프리셋으로 쓸 수 있어요.',
    image: '인기 AI 이미지입니다. 권리와 크레딧은 제작자에게 있습니다. 프롬프트가 공개된 경우 프리셋으로 쓸 수 있어요.',
    all: '인기 AI 영상과 이미지입니다. 권리와 크레딧은 제작자에게 있습니다. 프롬프트가 공개된 경우 프리셋으로 쓸 수 있어요.',
    loadMore: '더 보기',
    loading: '불러오는 중…',
    end: '지금은 여기까지예요.',
    failed: '더 불러오지 못했어요.',
    use: '이 프리셋 사용',
    open: 'X에서 열기',
  },
}
