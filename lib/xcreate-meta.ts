import type { Metadata } from 'next'
import type { Lang } from './lang'

/** Tab title + description for the XCreate host, in the language the page
 *  renders in (lib/lang.ts `serverLang`): the title is the wordmark
 *  (`xcreate.site.brand`; owner, Sep 28: X創作, as XTell is X先知) and the
 *  description the studio's own subtitle (`xcreate.subtitle`), both held
 *  equal by scripts/test-lang.ts. Used by the root
 *  layout (default for pages without their own metadata) and by the studio's
 *  two entries there, `/` and `/xcreate`, which also carry the canonical URL.
 *  XCreateNav re-titles per view and page on the client. */
const XCREATE_META: Record<Lang, Metadata> = {
  en: { title: 'XCreate', description: 'Your Private Studio. Bring Ideas to Life.' },
  'zh-Hant': { title: 'X創作', description: '你的私人創作室，讓靈感成真。' },
  'zh-Hans': { title: 'X创作', description: '你的私人创作室，让灵感成真。' },
  ja: { title: 'X作成', description: 'あなたのプライベートスタジオ。アイデアを形に。' },
  ko: { title: 'X창작', description: '나만의 프라이빗 스튜디오. 아이디어를 현실로.' },
}

export const XCREATE_CANONICAL = 'https://xcreate.modelxd.com'

export function xcreateMetadata(lang: Lang): Metadata {
  return { ...XCREATE_META[lang] }
}
