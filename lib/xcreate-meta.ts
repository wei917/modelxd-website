import type { Metadata } from 'next'

/** Tab title + description for the XCreate host, in the language LangProvider
 *  would pick there (lib/i18n.tsx): the first supported tag in the browser's
 *  list, English otherwise. The strings are the studio's own eyebrow and
 *  subtitle (`xcreate.eyebrow` / `xcreate.subtitle`) until the XCreate shell
 *  brings its brand copy. Used by the root layout (default for pages without
 *  their own metadata) and by the studio's two entries there, `/` and
 *  `/xcreate`, which also carry the canonical URL. */
const XCREATE_META: Record<'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko', Metadata> = {
  en: { title: 'XCreate', description: 'Your Private Studio. Bring Ideas to Life.' },
  'zh-Hant': { title: 'X創作', description: '你的私人創作室，讓靈感成真。' },
  'zh-Hans': { title: 'X创作', description: '你的私人创作室，让灵感成真。' },
  ja: { title: 'X作成', description: 'あなたのプライベートスタジオ。アイデアを形に。' },
  ko: { title: 'X창작', description: '나만의 프라이빗 스튜디오. 아이디어를 현실로.' },
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
