import type { Metadata } from 'next'

/** Tab title + description for the XCreate host. The title is the wordmark,
 *  the same in every language (Sep 26); the description is the studio's own
 *  subtitle (`xcreate.subtitle`) in the language LangProvider would pick
 *  (lib/i18n.tsx): the first supported tag in the browser's list, English
 *  otherwise. Used by the root layout (default for pages without their own
 *  metadata) and by the studio's two entries there, `/` and `/xcreate`, which
 *  also carry the canonical URL. XCreateNav re-titles per view and page on
 *  the client. */
const XCREATE_META: Record<'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko', Metadata> = {
  en: { title: 'XCreate', description: 'Your Private Studio. Bring Ideas to Life.' },
  'zh-Hant': { title: 'XCreate', description: '你的私人創作室，讓靈感成真。' },
  'zh-Hans': { title: 'XCreate', description: '你的私人创作室，让灵感成真。' },
  ja: { title: 'XCreate', description: 'あなたのプライベートスタジオ。アイデアを形に。' },
  ko: { title: 'XCreate', description: '나만의 프라이빗 스튜디오. 아이디어를 현실로.' },
}

export const XCREATE_CANONICAL = 'https://xcreate.modelxd.com'

export function xcreateMetadata(h: Headers): Metadata {
  const tags = (h.get('accept-language') ?? '').toLowerCase().split(',').map(s => s.split(';')[0].trim())
  for (const tag of tags) {
    if (tag.startsWith('en')) return { ...XCREATE_META.en }
    if (tag.startsWith('ja')) return { ...XCREATE_META.ja }
    if (tag.startsWith('ko')) return { ...XCREATE_META.ko }
    if (tag.startsWith('zh')) {
      const hant = tag.includes('hant') || tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo'
      return { ...XCREATE_META[hant ? 'zh-Hant' : 'zh-Hans'] }
    }
  }
  return { ...XCREATE_META.en }
}
