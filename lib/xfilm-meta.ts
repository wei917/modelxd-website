import type { Metadata } from 'next'
import type { Lang } from './lang'

/** Tab title + description for XFilm (/xfilm/*), in the language the page
 *  renders in (lib/lang.ts `serverLang`): the app's name in that language
 *  (`nav.xfilm`; owner, Oct 22: X影音, as X創作 and X先知 are named). */
const XFILM_META: Record<Lang, Metadata> = {
  en: { title: 'XFilm', description: 'Direct, edit, auto-make and remake films with every AI model.' },
  'zh-Hant': { title: 'X影音', description: '用每一個 AI 模型導演、剪輯、自動成片與做同款。' },
  'zh-Hans': { title: 'X影音', description: '用每一个 AI 模型导演、剪辑、自动成片与做同款。' },
  ja: { title: 'X映像', description: 'あらゆる AI モデルで映像を監督・編集・自動作成・リメイク。' },
  ko: { title: 'X영상', description: '모든 AI 모델로 영상을 연출하고 편집하고 자동으로 만들고 리메이크하세요.' },
}

export function xfilmMetadata(lang: Lang): Metadata {
  return { ...XFILM_META[lang] }
}
