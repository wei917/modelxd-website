import type { Metadata } from 'next'
import type { Lang } from './lang'

/** Tab title + description for the XTell host, in the language the page
 *  renders in (lib/lang.ts `serverLang`: `?lang=`, the saved choice, then the
 *  browser's own language, where anything but ja / ko / zh-Hans is 繁體). English
 *  appears only as a saved or linked choice. The titles are the client's
 *  `xtell.site.tab` strings (scripts/test-lang.ts holds them equal), so the
 *  first paint's tab title is the one XTellNav keeps. Used by the root layout
 *  (default for pages without their own metadata) and by the two explorer
 *  entries (`/` and `/xtell`), which would otherwise override it. */
const XTELL_META: Record<Lang, Metadata> = {
  en: { title: 'XTell | Explore the temples', description: 'Explore the traditions of Guandi, Mazu, the Matchmaker and more. Free charts and stick draws, then talk with the AI teacher you choose. For reflection and entertainment only.' },
  'zh-Hant': { title: 'X先知 | 探索殿堂', description: '探索關帝、媽祖、月老與各地命理傳統。免費排盤、抽籤，再與你選的 AI 老師聊聊。僅供參考與娛樂。' },
  'zh-Hans': { title: 'X先知 | 探索殿堂', description: '探索关帝、妈祖、月老与各地命理传统。免费排盘、抽签，再与你选的 AI 老师聊聊。仅供参考与娱乐。' },
  ja: { title: 'X占い | 殿堂をめぐる', description: '関帝、媽祖、月老など各地の占いの伝統をめぐる。命盤作成とおみくじは無料、そのあと選んだAIの読み手と話せます。参考と娯楽のためのものです。' },
  ko: { title: 'X운세 | 전당 둘러보기', description: '관제, 마조, 월로 등 여러 지역의 운세 전통을 둘러보세요. 명반과 제비뽑기는 무료, 그다음 고른 AI 풀이사와 이야기하세요. 참고와 재미를 위한 것입니다.' },
}

/** Each temple's name, for a shared link's preview (`?t=<temple>`, lib/xtell-share.ts).
 *  The client's `xtell.site.focus.<temple>.name` strings, copied here because
 *  lib/i18n.tsx is a client module (scripts/test-lang.ts holds them equal). */
export const XTELL_TEMPLE_NAMES: Record<string, Record<Lang, string>> = {
  bazi: {"en": "BaZi Temple", "zh-Hant": "八字廟", "zh-Hans": "八字庙", "ja": "八字廟", "ko": "팔자묘"},
  ziwei: {"en": "Zi Wei Temple", "zh-Hant": "紫微斗數廟", "zh-Hans": "紫微斗数庙", "ja": "紫微斗数廟", "ko": "자미두수묘"},
  yuelao: {"en": "Yue Lao Temple", "zh-Hant": "月老廟", "zh-Hans": "月老庙", "ja": "月老廟", "ko": "월하노인 궁합"},
  guandi: {"en": "Guan Di Temple", "zh-Hant": "關帝廟", "zh-Hans": "关帝庙", "ja": "関帝廟", "ko": "관제묘"},
  mazu: {"en": "Mazu Temple", "zh-Hant": "媽祖廟", "zh-Hans": "妈祖庙", "ja": "媽祖廟", "ko": "마조묘"},
  simianfo: {"en": "Four-Faced Buddha", "zh-Hant": "四面佛", "zh-Hans": "四面佛", "ja": "四面仏", "ko": "사면불"},
  navagraha: {"en": "Navagraha Temple", "zh-Hant": "九曜廟", "zh-Hans": "九曜庙", "ja": "九曜廟", "ko": "구요묘"},
  zhanxing: {"en": "Astrology Tower", "zh-Hant": "占星塔", "zh-Hans": "占星塔", "ja": "占星塔", "ko": "점성탑"},
  xingming: {"en": "Name Study", "zh-Hant": "姓名學", "zh-Hans": "姓名学", "ja": "姓名判断", "ko": "성명학"},
  cezi: {"en": "Character Reading", "zh-Hant": "測字", "zh-Hans": "测字", "ja": "字占い", "ko": "글자 점"},
  yixue: {"en": "I Ching Hall", "zh-Hant": "易學堂", "zh-Hans": "易学堂", "ja": "易学堂", "ko": "역학당"},
  jiemeng: {"en": "Dream Hall", "zh-Hant": "周公解夢", "zh-Hans": "周公解梦", "ja": "夢占い（周公解夢）", "ko": "주공해몽"},
  guanyin: {"en": "Guanyin Temple", "zh-Hant": "觀音廟", "zh-Hans": "观音庙", "ja": "観音堂", "ko": "관음사"},
  cookie: {"en": "Fortune Cookie", "zh-Hant": "幸運餅乾", "zh-Hans": "幸运饼干", "ja": "フォーチュンクッキー", "ko": "포춘 쿠키"},
  tarot: {"en": "Tarot Parlour", "zh-Hant": "塔羅館", "zh-Hans": "塔罗馆", "ja": "タロットの館", "ko": "타로 하우스"},
}
const BRAND: Record<Lang, string> = { en: 'XTell', 'zh-Hant': 'X先知', 'zh-Hans': 'X先知', ja: 'X占い', ko: 'X운세' }

/** `temple`: the room a shared link names; its preview gets the temple's own
 *  title and picture (public/xtell/og/, scripts/xtell-og-images.mjs). Without
 *  one, the street's picture. */
export function xtellMetadata(lang: Lang, temple?: string | null): Metadata {
  const base = XTELL_META[lang]
  const name = temple ? XTELL_TEMPLE_NAMES[temple]?.[lang] : undefined
  const title = name ? `${name} | ${BRAND[lang]}` : String(base.title)
  const description = String(base.description)
  const image = `/xtell/og/${name ? temple : 'street'}.jpg`
  return {
    ...base,
    title,
    metadataBase: new URL('https://xtell.modelxd.com'),
    openGraph: { title, description, siteName: BRAND[lang], type: 'website', images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}
