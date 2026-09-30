// scripts/test-line-login.ts — LINE sign-in (Sep 29): which channel a visitor
// is offered, that an email-less LINE account still counts as verified, and
// that a LINE account shows its own name and photo.
// Run: npx tsx scripts/test-line-login.ts
import fs from 'node:fs'
import path from 'node:path'
import { lineChannelFor, LINE_CHANNELS, otherLineChannel, lineChannelOfProvider, isNewUserRefusal, lineCookieAttrs, asLineChannel } from '../lib/line-login'
import { isVerifiedAccount } from '../lib/verified-account'
import { userName, userPhoto } from '../lib/user-face'
import { STRINGS } from '../lib/i18n'

let fails = 0
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

// ── Channel ────────────────────────────────────────────────────────────────
check('日本語 → Japan', lineChannelFor({ lang: 'ja' }) === 'jp')
check('繁體 → Taiwan', lineChannelFor({ lang: 'zh-Hant' }) === 'tw')
check('no LINE in English, 简体 or Korean', ['en', 'zh-Hans', 'ko'].every(lang => lineChannelFor({ lang }) === null))
check('a remembered channel wins over the language (one person, one account)', lineChannelFor({ remembered: 'tw', lang: 'ja' }) === 'tw' && lineChannelFor({ remembered: 'jp', lang: 'en' }) === 'jp')
check('both channels are live', LINE_CHANNELS.jp.live && LINE_CHANNELS.tw.live)
check('junk remembered value is ignored', lineChannelFor({ remembered: 'xx', lang: 'ja' }) === 'jp')
check('no geo: the layout no longer writes data-country', !read('app/layout.tsx').includes('data-country') && !read('lib/line-login.ts').includes('dataset.country'))

// ── One LINE person, one account (migration 113) ───────────────────────────
check('the other channel', otherLineChannel('jp') === 'tw' && otherLineChannel('tw') === 'jp')
check('provider → channel', lineChannelOfProvider('custom:line-jp') === 'jp' && lineChannelOfProvider('custom:line-tw') === 'tw' && lineChannelOfProvider('google') === null)
check('GoTrue\'s refusal is recognised, other errors are not', isNewUserRefusal('Database error saving new user') && !isNewUserRefusal('access_denied') && !isNewUserRefusal(null))
check('only jp/tw are channels', asLineChannel('jp') === 'jp' && asLineChannel('xx') === null && asLineChannel(undefined) === null)
check('the remembered channel is shared by every modelxd.com door, host-only on localhost', lineCookieAttrs('xtell.modelxd.com').includes('domain=.modelxd.com') && !lineCookieAttrs('localhost').includes('domain='))
const mig = read('supabase/113_line_one_account.sql')
check('113 refuses a twin and keeps 112 (welcome credit for both channels)', /raise exception 'line_twin/.test(mig) && /\?\| array\['google', 'custom:line-jp', 'custom:line-tw'\]/.test(mig))
check('113 fails open: a lookup error reads as no twin', /exception when others then\s+v_twin := false/.test(mig))
const cb = read('app/auth/callback/route.ts')
check('the callback retries once through the other channel on the refusal', cb.includes('isNewUserRefusal(oauthErrorDesc)') && cb.includes('!cookieStore.get(LINE_TWIN)') && cb.includes('otherLineChannel(triedLine)'))
check('the callback remembers the channel a LINE account lives on', cb.includes('lineChannelOfProvider(i.provider)'))
for (const f of ['app/components/AuthModal.tsx', 'app/login/LoginPage.tsx'])
  check(`${f} marks which channel a sign-in tries (none for Google)`, read(f).includes("markLineTry(via === 'line' && line ? line : null)"))

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
for (const f of ['app/api/xcreate/route.ts', 'app/api/xduel/route.ts', 'app/api/xcreate/source/route.ts'])
  check(`${f} gates on isVerifiedAccount, not email_confirmed_at`, read(f).includes('isVerifiedAccount(user)') && !/if \(!user\.email_confirmed_at\)/.test(read(f)))
for (const f of ['app/components/AuthModal.tsx', 'app/login/LoginPage.tsx'])
  check(`${f} offers LINE through the channel's provider`, read(f).includes('LINE_CHANNELS[line].provider') && read(f).includes('rememberLineChannel(line)'))
check('the migration grants LINE sign-ups the welcome credit', /custom:line-jp/.test(read('supabase/112_line_welcome_credit.sql')))

console.log(fails ? `\n${fails} FAILED` : '\nall ok')
process.exit(fails ? 1 : 0)
