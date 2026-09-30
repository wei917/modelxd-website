// scripts/test-line-login.ts — LINE sign-in (Sep 29): which channel a visitor
// is offered, that an email-less LINE account still counts as verified, and
// that a LINE account shows its own name and photo.
// Run: npx tsx scripts/test-line-login.ts
import fs from 'node:fs'
import path from 'node:path'
import { lineChannelFor, LINE_CHANNELS } from '../lib/line-login'
import { isVerifiedAccount } from '../lib/verified-account'
import { userName, userPhoto } from '../lib/user-face'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

// ── Channel ────────────────────────────────────────────────────────────────
check('Japan by country', lineChannelFor({ country: 'JP', lang: 'en' }) === 'jp')
check('Japan by language when the country is elsewhere', lineChannelFor({ country: 'US', lang: 'ja' }) === 'jp')
check('no LINE for a US English visitor', lineChannelFor({ country: 'US', lang: 'en' }) === null)
check('a remembered channel wins over country and language', lineChannelFor({ remembered: 'jp', country: 'US', lang: 'ko' }) === 'jp')
check('country wins over language (a Japanese reader in Taiwan is not sent to Japan)', lineChannelFor({ country: 'TW', lang: 'ja' }) === (LINE_CHANNELS.tw.live ? 'tw' : null))
check('Taiwan stays off until its provider exists', LINE_CHANNELS.tw.live || lineChannelFor({ country: 'TW', lang: 'zh-Hant' }) === null)
check('a remembered channel that is not live falls back', lineChannelFor({ remembered: 'tw', country: 'JP' }) === (LINE_CHANNELS.tw.live ? 'tw' : 'jp'))
check('junk remembered value is ignored', lineChannelFor({ remembered: 'xx', country: 'JP' }) === 'jp')

// ── Verified ───────────────────────────────────────────────────────────────
check('a Google account with a confirmed email', isVerifiedAccount({ email_confirmed_at: '2026-09-29T00:00:00Z', app_metadata: { provider: 'google' } }))
check('a LINE account with no email', isVerifiedAccount({ email_confirmed_at: null, app_metadata: { provider: 'custom:line-jp', providers: ['custom:line-jp'] } }))
check('an anonymous session is not', !isVerifiedAccount({ is_anonymous: true, app_metadata: { provider: 'anonymous' } }))
check('an unconfirmed email sign-up is not', !isVerifiedAccount({ email_confirmed_at: null, app_metadata: { provider: 'email', providers: ['email'] } }))
check('no user is not', !isVerifiedAccount(null))

// ── Face ───────────────────────────────────────────────────────────────────
check('Google name and photo', userName({ email: 'a@b.c', user_metadata: { full_name: 'Ann Lee', avatar_url: 'https://x/y.jpg' } }) === 'Ann Lee' && userPhoto({ user_metadata: { avatar_url: 'https://x/y.jpg' } }) === 'https://x/y.jpg')
check('LINE name and picture (OIDC claims)', userName({ email: null, user_metadata: { name: '山田', picture: 'https://profile.line-scdn.net/abc' } }) === '山田' && userPhoto({ user_metadata: { picture: 'https://profile.line-scdn.net/abc' } }) === 'https://profile.line-scdn.net/abc')
check('no name, no email: null, not a crash', userName({ email: null, user_metadata: {} }) === null)
check('a non-https photo is not drawn', userPhoto({ user_metadata: { picture: 'javascript:alert(1)' } }) === null)

// ── Wiring ─────────────────────────────────────────────────────────────────
const S = STRINGS as any
check('the LINE label exists in all five languages', ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => typeof S['auth.line']?.[l] === 'string' && S['auth.line'][l].includes('LINE')))
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
for (const f of ['app/api/xcreate/route.ts', 'app/api/xduel/route.ts', 'app/api/xcreate/source/route.ts'])
  check(`${f} gates on isVerifiedAccount, not email_confirmed_at`, read(f).includes('isVerifiedAccount(user)') && !/if \(!user\.email_confirmed_at\)/.test(read(f)))
for (const f of ['app/components/AuthModal.tsx', 'app/login/LoginPage.tsx'])
  check(`${f} offers LINE through the channel's provider`, read(f).includes('LINE_CHANNELS[line].provider') && read(f).includes('rememberLineChannel(line)'))
check('the migration grants LINE sign-ups the welcome credit', /custom:line-jp/.test(read('supabase/112_line_welcome_credit.sql')))

console.log(fails ? `\n${fails} FAILED` : '\nall ok')
process.exit(fails ? 1 : 0)
