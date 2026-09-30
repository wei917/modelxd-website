// lib/xtell-cookie-fortunes.ts — the fortune-cookie slips (server only):
// content/cookie/fortunes.json, built by scripts/build-cookie-fortunes.mjs from
// reggi/fortune-cookie (MIT, Copyright (c) 2022 Thomas Reggi;
// content/cookie/LICENSE-fortune-cookie.txt), with ModelXD's translations.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Fortune = { id: number; en: string; 'zh-Hant': string; 'zh-Hans': string; ja: string; ko: string }
let list: Fortune[] | null = null
const all = (): Fortune[] => list ??= JSON.parse(readFileSync(join(process.cwd(), 'content', 'cookie', 'fortunes.json'), 'utf-8')).fortunes
/** Slips kept in the file but not drawn. 0: 「your credits are piling up」
 *  reads as the site's paid credits beside its English original (a test
 *  round, Sep 29). A cookie already cracked with it still reads. */
const NOT_DRAWN = new Set([0])
/** The slips a new cookie may hold. */
export const cookieFortunes = (): Fortune[] => all().filter(f => !NOT_DRAWN.has(f.id))
export const fortuneOf = (id: number) => all().find(f => f.id === id) ?? null
/** The slip in every language, so a saved cookie reads right after a switch. */
export const fortuneTexts = (f: Fortune) => ({ en: f.en, 'zh-Hant': f['zh-Hant'], 'zh-Hans': f['zh-Hans'], ja: f.ja, ko: f.ko })
