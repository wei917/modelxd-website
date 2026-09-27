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

export function xtellMetadata(lang: Lang): Metadata {
  return { ...XTELL_META[lang] }
}
