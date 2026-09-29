// lib/xtell-cookie-fortunes.ts — the fortune-cookie slips (server only):
// content/cookie/fortunes.json, built by scripts/build-cookie-fortunes.mjs from
// reggi/fortune-cookie (MIT, Copyright (c) 2022 Thomas Reggi;
// content/cookie/LICENSE-fortune-cookie.txt), with ModelXD's translations.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Fortune = { id: number; en: string; 'zh-Hant': string; 'zh-Hans': string; ja: string; ko: string }
let list: Fortune[] | null = null
export const cookieFortunes = (): Fortune[] => list ??= JSON.parse(readFileSync(join(process.cwd(), 'content', 'cookie', 'fortunes.json'), 'utf-8')).fortunes
export const fortuneOf = (id: number) => cookieFortunes().find(f => f.id === id) ?? null
/** The slip in every language, so a saved cookie reads right after a switch. */
export const fortuneTexts = (f: Fortune) => ({ en: f.en, 'zh-Hant': f['zh-Hant'], 'zh-Hans': f['zh-Hans'], ja: f.ja, ko: f.ko })
