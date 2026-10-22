// scripts/hidden-apps-check.ts — checks the hide list (lib/hidden-apps.ts)
// and the admin-only gate in proxy.ts (owner, Oct 16: "two type of hidden,
// one is just hidden and people still can access it by going to the url
// directly. another hidden is admin only, others go there will get page not
// found"), without a network: proxy.ts runs transpiled with its imports
// faked (Next's responses, Supabase's sign-in, the site and language
// helpers).
//
//   npx tsx scripts/hidden-apps-check.ts       exit code 1 on any failure

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { hiddenApp, isHiddenHref, withoutHidden, HIDDEN_APPS } from '../lib/hidden-apps'

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }

// ── The list ────────────────────────────────────────────────────────────
ok(hiddenApp('/xsports')?.key === 'xsports' && hiddenApp('/xsports?league=mlb&game=1')?.level === 'admin' && hiddenApp('/api/xsports/room/vote')?.key === 'xsports', 'hiddenApp: XSports is admin only, its pages and APIs')
ok(hiddenApp('/xsportsfan') === null && hiddenApp('/xtell') === null && hiddenApp('/api/xoracle/x') === null && !isHiddenHref('/xboard') && isHiddenHref('/xsports'), 'hiddenApp: nothing else (not even a path that only starts the same)')
const guide = 'intro\n<!-- app:xsports -->\n### XSports\nscores\n<!-- /app:xsports -->\n## Accounts\n'
ok(withoutHidden(guide) === 'intro\n## Accounts\n', "withoutHidden: the site guide loses the hidden app's part")
ok(HIDDEN_APPS.every(a => a.level === 'admin' || a.level === 'unlisted'), 'every entry has a level')

// ── proxy.ts with every import faked ───────────────────────────────────
class Res {
  cookieSets: { name: string; value: string }[] = []
  cookies = { set: (name: string, value: string) => { this.cookieSets.push({ name, value }) } }
  constructor(public kind: string, public status: number, public url?: string, public body?: unknown) {}
}
function proxyWith(o: { user?: { email: string } | null; admins?: string; refreshed?: boolean; throws?: boolean; door?: string; pw?: string } = {}) {
  const js = ts.transpileModule(readFileSync(join(__dirname, '..', 'proxy.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} as any }
  const real = { hiddenApp, isHiddenHref, withoutHidden, HIDDEN_APPS }
  const mocks: Record<string, unknown> = {
    'next/server': { NextResponse: {
      next: () => new Res('next', 200),
      redirect: (u: any, status?: number) => Object.assign(new Res('redirect', status ?? 307, String(u.pathname ?? u)), { href: String(u.href ?? u) }),
      rewrite: (u: URL) => new Res('rewrite', 200, u.pathname),
      json: (body: unknown, init?: { status?: number }) => new Res('json', init?.status ?? 200, undefined, body),
    } },
    '@supabase/ssr': { createServerClient: (_u: string, _k: string, opts: any) => ({ auth: { getUser: async () => {
      if (o.throws) throw new Error('fixture: auth down')
      if (o.refreshed) opts.cookies.setAll([{ name: 'sb-x-auth-token', value: 'rotated', options: {} }])
      return { data: { user: o.user === undefined ? null : o.user } }
    } } }) },
    '@/lib/hidden-apps': real,
    '@/lib/site-token': { verifySiteToken: async (_pw: string, c?: string) => c === 'ok' },
    '@/lib/site': { siteOfHost: () => o.door ?? 'modelxd', isSiteRoute: () => false, isXOraclePath: () => false, SITE_HEADER: 'x-site', SITE_COOKIE: 'site', XORACLE_HOSTS: ['xtell.modelxd.com'], XORACLE_PATH: '/xoracle', MAIN_ORIGIN: 'https://dev.modelxd.com' },
    '@/lib/lang': { resolveLang: () => 'en', acceptTags: () => [], LANG_COOKIE: 'lang', LANG_HEADER: 'x-lang' },
  }
  vm.runInNewContext(js, {
    module, exports: module.exports, Headers, URL, console,
    require: (id: string) => { if (id in mocks) return mocks[id]; throw Error('Unmocked import: ' + id) },
    process: { env: { ADMIN_EMAILS: o.admins ?? 'boss@fixture.test', SITE_PASSWORD: o.pw, NEXT_PUBLIC_SUPABASE_URL: 'https://sb.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk' } },
  })
  return module.exports.proxy as (req: any) => Promise<Res>
}
const req = (path: string, host = 'dev.modelxd.com', cookie?: string) => {
  const u = new URL(`https://${host}${path}`)
  return {
    url: u.toString(),
    headers: new Headers({ host }),
    cookies: { get: (n: string) => (n === 'modelxd_site_unlocked' && cookie ? { value: cookie } : undefined), getAll: () => [] },
    nextUrl: Object.assign(u, { clone: () => new URL(u.toString()) }),
  }
}

;(async () => {
  const fan = proxyWith({ user: { email: 'fan@fixture.test' } })
  const page = await fan(req('/xsports'))
  const api = await fan(req('/api/xsports/games'))
  ok(page.kind === 'rewrite' && page.url === '/_hidden-app' && api.status === 404 && (api.body as any)?.code === 'not_found', 'a signed-in fan gets page not found on its pages and 404 on its APIs')
  const nobody = await proxyWith({ user: null })(req('/xsports?league=mlb'))
  ok(nobody.kind === 'rewrite', 'so does someone signed out')
  const boss = proxyWith({ user: { email: 'Boss@Fixture.test' }, refreshed: true })
  const bp = await boss(req('/xsports'))
  ok(bp.kind === 'next' && bp.cookieSets.some(c => c.value === 'rotated'), 'an admin (ADMIN_EMAILS, any case) gets the app; a session refreshed on the way is kept')
  const rot = await proxyWith({ user: { email: 'fan@fixture.test' }, refreshed: true })(req('/xsports'))
  ok(rot.kind === 'rewrite' && rot.cookieSets.some(c => c.value === 'rotated'), "a refreshed session is kept on the not-found answer too (or the fan would be signed out)")
  const other = await fan(req('/xoracle'))
  ok(other.kind === 'next', 'every other app is untouched')
  const local = await proxyWith({ user: null })(req('/xsports', 'localhost:3090'))
  ok(local.kind === 'next', 'this machine (localhost) is not gated')
  const down = await proxyWith({ user: { email: 'boss@fixture.test' }, throws: true })(req('/xsports'))
  const noAdmins = await proxyWith({ user: { email: 'boss@fixture.test' }, admins: '' })(req('/xsports'))
  ok(down.kind === 'rewrite' && noAdmins.kind === 'rewrite', 'when the sign-in cannot be read, or no admin is set, it stays closed')
  const pw = await proxyWith({ user: { email: 'boss@fixture.test' }, pw: 'secret' })(req('/xsports', 'www.modelxd.com'))
  ok(pw.kind === 'redirect' && pw.url === '/coming-soon', "www's password page still comes first")
  const pwIn = await proxyWith({ user: { email: 'fan@fixture.test' }, pw: 'secret' })(req('/xsports', 'www.modelxd.com', 'ok'))
  ok(pwIn.kind === 'rewrite', 'past the password, a fan still gets page not found')

  // xtell.modelxd.com, the old door, forwards to the main site (Oct 22).
  const door = proxyWith({ user: null })
  const home = await door(req('/?t=guandi&ref=ABC123&utm_source=share', 'xtell.modelxd.com')) as any
  const prof = await door(req('/profile', 'xtell.modelxd.com')) as any
  ok(home.kind === 'redirect' && home.status === 307 && home.href === 'https://dev.modelxd.com/xoracle?t=guandi&ref=ABC123&utm_source=share' && prof.href === 'https://dev.modelxd.com/profile',
    'the old door forwards: / to dev.modelxd.com/xoracle with the query, other pages to the same page there')
  const oldApi = await door(req('/api/xoracle/chart', 'xtell.modelxd.com'))
  const devHome = await door(req('/?t=guandi'))
  ok(oldApi.kind === 'next' && devHome.kind === 'next', "its APIs still answer there (an open tab's calls), and no other host forwards")

  // An unlisted app: only out of the menus, its address works for anyone.
  const before = (HIDDEN_APPS as any).length
  ;(HIDDEN_APPS as any).push({ key: 'xtest', level: 'unlisted', why: 'fixture', paths: ['/xtest'] })
  const unl = await fan(req('/xtest'))
  ok(unl.kind === 'next' && isHiddenHref('/xtest'), "an 'unlisted' app leaves the menus but its address works for anyone")
  ;(HIDDEN_APPS as any).length = before

  console.log(fails ? `${fails} FAILED` : 'all passed')
  process.exitCode = fails ? 1 : 0
})().catch(e => { console.error(e); process.exitCode = 1 })
