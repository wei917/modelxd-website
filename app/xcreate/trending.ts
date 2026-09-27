// app/xcreate/trending.ts
//
// "Trending on social media" for XCreate's Studio and Templates tabs: the
// most-liked AI videos and images whose creators shared the prompt, shown as
// each platform's own embed, so a deleted post disappears on its own.
//
// The list lives in `trending_posts` (supabase/108), up to 20 per kind per
// week, and reaches the page through /api/trending. FALLBACK_TRENDING is the
// same seed the migration inserts; the route serves it only while 108 hasn't
// been run (or the read fails), so the section never blanks.
//
// What belongs on the list (owner, Sep 26): posts made with a video or image
// model that NAME it. Never posts made through an LLM agent (Claude Opus
// briefs), posts built on someone else's characters, or suggestive ones.

import type { Lang } from '@/lib/i18n'

export type TrendingKind = 'video' | 'image'

export type TrendingPost = {
  platform: string                          // 'x' today; 'instagram' | 'threads' | 'facebook' later
  postId: string
  handle: string                            // creator, without the @
  url: string
  kind: TrendingKind
  models: string[]                          // as the creator names them
  likes: number | null                      // when found; the embed shows the live count
  summary: Partial<Record<Lang, string>>    // our words, never the creator's text
}

/** Posts kept per kind per week; Studio shows the first STUDIO_SHOWN. */
export const TRENDING_MAX = 20
export const STUDIO_SHOWN = 6

const x = (handle: string, postId: string) => ({ platform: 'x', handle, postId, url: `https://x.com/${handle}/status/${postId}` })

// Week of Sep 21 (Grok x_search over Sep 19–26), same rows as the 108 seed.
export const FALLBACK_TRENDING: TrendingPost[] = [
  {
    ...x('nawalsehar', '2103337966416621703'), kind: 'video', likes: 3965, models: ['Seedance 2.5'],
    summary: {
      en: 'A 30-second photoreal phone vlog: one rainy morning, from bed to the lecture hall.',
      'zh-Hant': '30 秒寫實手機 vlog：一個下雨的早晨，從起床到走進教室。',
      'zh-Hans': '30 秒写实手机 vlog：一个下雨的早晨，从起床到走进教室。',
      ja: '30 秒のリアルなスマホ vlog。雨の朝、ベッドから講義室まで。',
      ko: '30초 실사 스마트폰 브이로그. 비 오는 아침, 침대에서 강의실까지.',
    },
  },
  {
    ...x('Scenario_gg', '2102365054389899695'), kind: 'video', likes: 3226, models: ['Seedance 2.5'],
    summary: {
      en: 'One café scene re-shot from thirteen new camera angles, same performance and sound.',
      'zh-Hant': '同一段咖啡館畫面，以十三個新機位重拍，表演和聲音完全不變。',
      'zh-Hans': '同一段咖啡馆画面，以十三个新机位重拍，表演和声音完全不变。',
      ja: 'カフェの一場面を 13 の新しいカメラアングルで撮り直し。演技も音もそのまま。',
      ko: '카페 장면 하나를 13가지 새 카메라 앵글로 다시 촬영. 연기와 소리는 그대로.',
    },
  },
  {
    ...x('GlitterPixely', '2102028142294483208'), kind: 'video', likes: 1528, models: ['Midjourney', 'Seedance 2.5'],
    summary: {
      en: 'A fantasy “getting ready on Monday” montage: an elf dragon-slayer’s morning routine.',
      'zh-Hant': '奇幻版「週一出門準備」蒙太奇：精靈屠龍者的早晨日常。',
      'zh-Hans': '奇幻版“周一出门准备”蒙太奇：精灵屠龙者的早晨日常。',
      ja: 'ファンタジー版「月曜の朝の身支度」モンタージュ。エルフのドラゴンスレイヤーの朝の日課。',
      ko: "판타지판 '월요일 아침 준비' 몽타주. 엘프 드래곤 슬레이어의 아침 루틴.",
    },
  },
  {
    ...x('AIwithkhan', '2103329257149898940'), kind: 'video', likes: 1042, models: ['Seedance 2.5'],
    summary: {
      en: 'A 30-second home video of a slow Friday morning in an old Seoul neighborhood, the woman kept consistent from one reference photo.',
      'zh-Hant': '30 秒家庭錄影風格：首爾老社區悠閒的週五早晨，以一張參考照鎖定人物外觀。',
      'zh-Hans': '30 秒家庭录像风格：首尔老社区悠闲的周五早晨，用一张参考照锁定人物外观。',
      ja: 'ソウルの古い住宅街で過ごす金曜の朝を 30 秒のホームビデオ風に。参考写真 1 枚で人物の見た目を固定。',
      ko: '서울 옛 동네의 여유로운 금요일 아침을 담은 30초 홈비디오. 참고 사진 한 장으로 인물 외형을 유지.',
    },
  },
  {
    ...x('Mayz1169', '2103188197933187179'), kind: 'video', likes: 940, models: ['GPT Image 2', 'Seedance 2.5'],
    summary: {
      en: 'A 15-second anime chase in one unbroken shot: a character sheet from GPT Image 2, animated with Seedance 2.5.',
      'zh-Hant': '15 秒一鏡到底的動畫追逐：先用 GPT Image 2 做角色設定圖，再用 Seedance 2.5 動起來。',
      'zh-Hans': '15 秒一镜到底的动画追逐：先用 GPT Image 2 做角色设定图，再用 Seedance 2.5 动起来。',
      ja: 'ワンカットで描く 15 秒のアニメ追走劇。GPT Image 2 で作ったキャラクターシートを Seedance 2.5 でアニメ化。',
      ko: '끊김 없는 원테이크 15초 애니메이션 추격전. GPT Image 2로 만든 캐릭터 시트를 Seedance 2.5로 움직였습니다.',
    },
  },
]

export const TRENDING_COPY: Record<Lang, { title: string; seeAll: string } & Record<TrendingKind, string>> = {
  en: {
    title: 'Trending on social media',
    video: 'The most-liked AI videos whose creators shared their prompts. Rights and credit stay with the creators.',
    image: 'The most-liked AI images whose creators shared their prompts. Rights and credit stay with the creators.',
    seeAll: 'See all {n}',
  },
  'zh-Hant': {
    title: '社群媒體熱門',
    video: '創作者公開了提示詞、按讚數最高的 AI 影片。版權與署名歸原作者。',
    image: '創作者公開了提示詞、按讚數最高的 AI 圖片。版權與署名歸原作者。',
    seeAll: '查看全部 {n} 則',
  },
  'zh-Hans': {
    title: '社交媒体热门',
    video: '创作者公开了提示词、点赞最多的 AI 视频。版权与署名归原作者。',
    image: '创作者公开了提示词、点赞最多的 AI 图片。版权与署名归原作者。',
    seeAll: '查看全部 {n} 条',
  },
  ja: {
    title: 'SNS で話題',
    video: '作者がプロンプトを公開している、いいねの多い AI 動画。権利とクレジットは作者に帰属します。',
    image: '作者がプロンプトを公開している、いいねの多い AI 画像。権利とクレジットは作者に帰属します。',
    seeAll: 'すべて見る（{n} 件）',
  },
  ko: {
    title: '소셜 미디어 인기',
    video: '제작자가 프롬프트를 공개한, 좋아요가 가장 많은 AI 영상입니다. 권리와 크레딧은 제작자에게 있습니다.',
    image: '제작자가 프롬프트를 공개한, 좋아요가 가장 많은 AI 이미지입니다. 권리와 크레딧은 제작자에게 있습니다.',
    seeAll: '전체 보기 ({n})',
  },
}
