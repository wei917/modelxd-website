'use client'

// Lightweight i18n for the Taiwan launch. English is the default; a toggle
// (in the TopBar) switches to Traditional Chinese. Choice persists in
// localStorage and sets <html lang>. Use the `useT()` hook: `const t = useT()`
// then `t('nav.xduel')`. Add strings to STRINGS below.

import { createContext, useContext, useEffect, useState } from 'react'

export type Lang = 'en' | 'zh'

// key → { en, zh(Traditional/Taiwan) }
export const STRINGS: Record<string, { en: string; zh: string }> = {
  // ── Brand + nav ──
  'brand':            { en: 'ModelXD',      zh: '模型大對決' },
  'nav.xduel':        { en: 'XDuel',        zh: '對決' },
  'nav.xcreate':      { en: 'XCreate',      zh: '創作' },
  'nav.xvote':        { en: 'XVote',        zh: '投票' },
  'nav.xboard':       { en: 'XBoard',       zh: 'X排行榜' },
  'xcreate.recent':   { en: 'Recent',       zh: '最近作品' },
  'nav.profile':      { en: 'Profile',      zh: '個人檔案' },
  'auth.signin':      { en: 'Sign In',      zh: '登入' },
  'auth.signout':     { en: 'Sign Out',     zh: '登出' },

  // ── XVote / XBoard (title bar) ──
  'xvote.eyebrow':    { en: 'XVote',         zh: '投票' },
  'xvote.title':      { en: 'Vote on Duels', zh: '為對決投票' },
  'xboard.eyebrow':   { en: 'XBoard',        zh: '排行榜' },
  'xboard.title':     { en: 'XBoard',        zh: 'X排行榜' },

  // ── XCreate ──
  'xcreate.eyebrow':  { en: 'XCreate',              zh: '創作' },
  'xcreate.title':    { en: 'Your Private Studio',  zh: '你的私人工作室' },
  'xcreate.output':   { en: 'Output',               zh: '產出類型' },
  'mode.text':        { en: 'Text',   zh: '文字' },
  'mode.image':       { en: 'Image',  zh: '圖片' },
  'mode.video':       { en: 'Video',  zh: '影片' },
  'xcreate.template': { en: 'Or start from a template', zh: '或從範本開始' },
  'xcreate.provide':  { en: 'You provide:',  zh: '你需提供：' },
  'xcreate.popular':       { en: 'Popular', zh: '熱門' },
  'xcreate.submode':       { en: 'What you start from',       zh: '從什麼開始' },
  'xcreate.creationmode':  { en: 'Creation Mode:',            zh: '創作模式：' },
  'xcreate.createfrom':    { en: 'Create from',               zh: '創作來源' },
  'xcreate.generate':      { en: 'Generate:',                 zh: '生成：' },
  'xcreate.from':          { en: 'From:',                     zh: '來源：' },
  'xcreate.selectmodels':  { en: 'Select Models:',            zh: '選擇模型：' },
  'xcreate.to':            { en: 'to',                        zh: '轉' },
  'xcreate.alltools':      { en: 'Tools',     zh: '工具' },
  'xcreate.alltemplates':  { en: 'Templates', zh: '範本' },

  // Sub-mode labels — full input→output names, shown in the dropdown menu.
  'recipe.text_to_text':     { en: 'Text to Text',      zh: '文字轉文字' },
  'recipe.image_to_text':    { en: 'Image to Text',     zh: '圖片轉文字' },
  'recipe.pdf_to_text':      { en: 'PDF to Text',       zh: 'PDF 轉文字' },
  'recipe.video_to_text':    { en: 'Video to Text',     zh: '影片轉文字' },
  'recipe.text_to_image':    { en: 'Text to Image',     zh: '文字轉圖片' },
  'recipe.image_edit':       { en: 'Image to Image',    zh: '圖片轉圖片' },
  'recipe.text_to_video':    { en: 'Text to Video',     zh: '文字轉影片' },
  'recipe.image_to_video':   { en: 'Image to Video',    zh: '圖片轉影片' },
  'recipe.video_to_video':   { en: 'Video to Video',    zh: '影片轉影片' },
  'recipe.start_end_frames': { en: 'Frames to Video',   zh: '頭尾幀轉影片' },
  'recipe.reference_frames': { en: 'Reference to Video', zh: '參考圖轉影片' },

  // "From: ___" button values — plain input nouns. Every sub-mode also
  // takes a text prompt; that's understood, so we don't spell it out.
  'recipefrom.text_to_text':     { en: 'Text',       zh: '文字' },
  'recipefrom.image_to_text':    { en: 'Image',      zh: '圖片' },
  'recipefrom.pdf_to_text':      { en: 'PDF',        zh: 'PDF' },
  'recipefrom.video_to_text':    { en: 'Video',      zh: '影片' },
  'recipefrom.text_to_image':    { en: 'Text',       zh: '文字' },
  'recipefrom.image_edit':       { en: 'Image',      zh: '圖片' },
  'recipefrom.text_to_video':    { en: 'Text',       zh: '文字' },
  'recipefrom.image_to_video':   { en: 'Image',      zh: '圖片' },
  'recipefrom.video_to_video':   { en: 'Video',      zh: '影片' },
  'recipefrom.start_end_frames': { en: 'Start + End Frames', zh: '頭尾幀' },
  'recipefrom.reference_frames': { en: 'Reference Images',   zh: '參考圖片' },

  // ── XDuel ──
  'xduel.eyebrow':    { en: 'XDuel',            zh: '對決' },
  'xduel.start':      { en: 'Create Your Task', zh: '建立你的任務' },
  'xduel.reveal':     { en: 'The Reveal',       zh: '揭曉' },
  'xduel.voteblind':  { en: 'Vote Blind',       zh: '盲測投票' },
  'xduel.voteagain':  { en: 'Vote Again',       zh: '再次投票' },
  'xduel.cta':        { en: 'Start XDuel',      zh: '開始對決' },

  // ── Home (hero + CTAs) ──
  'home.hero':        { en: 'Overpaying for AI?!', zh: '為 AI 付太多了嗎？' },
  'home.sub':         { en: 'XDuel or XCreate side-by-side to find your best value models.', zh: '用對決或創作並排比較，找出最超值的模型。' },
  'home.cta':         { en: 'Start XDuel →', zh: '開始對決 →' },
  'home.cta2':        { en: 'Try XCreate →', zh: '試試創作 →' },
}

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string }
const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => {}, t: (k) => k })

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && window.localStorage.getItem('modelxd:lang')) as Lang | null
    if (saved === 'en' || saved === 'zh') setLangState(saved)
  }, [])

  const setLang = (l: Lang) => {
    setLangState(l)
    try { window.localStorage.setItem('modelxd:lang', l) } catch {}
    if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en'
  }

  const t = (k: string) => {
    const entry = STRINGS[k]
    if (!entry) return k
    return lang === 'zh' ? entry.zh : entry.en
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t
