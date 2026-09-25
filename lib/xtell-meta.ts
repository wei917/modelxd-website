import type { Metadata } from 'next'

/** Tab title + description for the XTell host, chosen the way LangProvider
 *  chooses the UI language there (lib/i18n.tsx): the browser's list is
 *  consulted only for ja / ko / zh-Hans; everything else, an English browser
 *  included, gets 繁體. English exists only as a saved picker choice, which
 *  the server cannot see, so XTellNav re-titles on the client. Used by the
 *  root layout (default for pages without their own metadata) and by the two
 *  explorer entries (`/` and `/xtell`), which would otherwise override it. */
const XTELL_META: Record<'zh-Hant' | 'zh-Hans' | 'ja' | 'ko', Metadata> = {
  'zh-Hant': { title: 'X先知 | 探索殿堂', description: '探索關帝、媽祖、月老與各地命理傳統。免費排盤、抽籤，再與你選的 AI 老師聊聊。僅供參考與娛樂。' },
  'zh-Hans': { title: 'X先知 | 探索殿堂', description: '探索关帝、妈祖、月老与各地命理传统。免费排盘、抽签，再与你选的 AI 老师聊聊。仅供参考与娱乐。' },
  ja: { title: 'X占い | 殿堂をめぐる', description: '関帝、媽祖、月老など各地の占いの伝統をめぐる。命盤作成とおみくじは無料、そのあと選んだAIの読み手と話せます。参考と娯楽のためのものです。' },
  ko: { title: 'X운세 | 전당 둘러보기', description: '관제, 마조, 월로 등 여러 지역의 운세 전통을 둘러보세요. 명반과 제비뽑기는 무료, 그다음 고른 AI 풀이사와 이야기하세요. 참고와 재미를 위한 것입니다.' },
}

export function xtellMetadata(h: Headers): Metadata {
  const tags = (h.get('accept-language') ?? '').toLowerCase().split(',').map(s => s.split(';')[0].trim())
  let lang: keyof typeof XTELL_META = 'zh-Hant'
  for (const tag of tags) {
    if (tag.startsWith('ja')) { lang = 'ja'; break }
    if (tag.startsWith('ko')) { lang = 'ko'; break }
    if (tag.startsWith('zh')) { lang = /hans|-cn|-sg/.test(tag) ? 'zh-Hans' : 'zh-Hant'; break }
  }
  return { ...XTELL_META[lang] }
}
