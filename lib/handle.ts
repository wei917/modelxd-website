// lib/handle.ts — the @ID every account has (Oct 13; owner: "we need user to
// pick an id right? not just for chatroom?"), beside the website name
// (lib/face.ts). Lowercase a-z, 0-9, _ and . (3-20), unique on the site,
// shown after the name as a small @ID (owner: "A seems better").
//
// We assign it (supabase/132: the X username, an English website name the
// person chose, or two words and digits; never the email or the sign-in
// name) and the person may change it once every 30 days (owner: "at most
// once per month"); an ID someone left stays theirs for 30 days.
//
// Client-safe: the account page and the room's panel apply the same rules
// before anything is sent. Keep RESERVED in step with handle_is_reserved()
// in supabase/132.

export const HANDLE_MIN = 3
export const HANDLE_MAX = 20
export const HANDLE_CHANGE_DAYS = 30

export type HandleError = 'handle_short' | 'handle_long' | 'handle_chars' | 'handle_reserved'
export type HandleCheck = { ok: true; handle: string } | { ok: false; error: HandleError }

/** What a person typed, as an ID: full-width letters made plain (a
 *  Japanese or Chinese keyboard types ＲＡＹＳ), no leading "@", lowercase. */
export function cleanHandle(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/^@+/, '').toLowerCase()
}

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'sysadmin', 'support', 'help', 'helpdesk', 'official', 'staff',
  'team', 'mod', 'mods', 'moderator', 'security', 'safety', 'info', 'contact', 'billing', 'payment', 'payments',
  'api', 'www', 'web', 'app', 'mail', 'email', 'null', 'undefined', 'anonymous', 'anon', 'guest', 'user', 'users',
  'me', 'you', 'everyone', 'all', 'here', 'ai', 'bot', 'xd', 'owner', 'founder', 'ceo', 'legal', 'privacy', 'terms',
  'abuse', 'report', 'verify', 'verified', 'login', 'logout', 'signin', 'signup', 'register', 'account',
  'accounts', 'settings', 'profile', 'home', 'news', 'blog', 'press', 'jobs', 'status',
  'xtell', 'xcreate', 'xsports', 'xduel', 'xtalk', 'xgame', 'xpersona', 'xvote', 'xboard', 'xdirect', 'xcut',
  'xworld', 'xarch', 'xdev', 'xeval', 'xchat', 'xkit', 'xoracle', 'xfilm',
  'gemini', 'grok', 'qwen', 'kimi', 'luna', 'sol', 'terra', 'astra', 'fable', 'opus', 'sonnet', 'haiku', 'deepseek',
  'minimax', 'hailuo', 'seedance', 'happyhorse', 'wan', 'veo', 'runway', 'midjourney', 'llama', 'mistral', 'sora',
  'nanobanana', 'commentator',
])
const MAKERS = /^(gpt|chatgpt|openai|claude|anthropic)/
const AT_EDGE = ['admin', 'official', 'moderator']

// Digits that pass for letters, and "rn" for "m": m0delxd, adm1n, rnodelxd.
const LOOKS: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't' }
const looksLike = (s: string, one: 'l' | 'i') => s.replace(/rn/g, 'm').replace(/[013457]/g, d => (d === '1' ? one : LOOKS[d]))

/** Kept for ModelXD, its surfaces and the AI models: the words above
 *  exactly (separators and trailing digits ignored), a model maker's name at
 *  the start, admin / official / moderator at either end, modelxd anywhere. */
export function isReservedHandle(handle: string): boolean {
  const s = handle.toLowerCase().replace(/[._]/g, '')
  return [s, looksLike(s, 'l'), looksLike(s, 'i')].some(f => {
    const bare = f.replace(/\d+$/, '')
    return RESERVED.has(f) || RESERVED.has(bare) || MAKERS.test(f)
      || AT_EDGE.some(w => f.startsWith(w) || bare.endsWith(w)) || f.includes('modelxd')
  })
}

export function checkHandle(raw: string, opts: { admin?: boolean } = {}): HandleCheck {
  const handle = cleanHandle(raw)
  if (handle.length < HANDLE_MIN) return { ok: false, error: 'handle_short' }
  if (handle.length > HANDLE_MAX) return { ok: false, error: 'handle_long' }
  if (!/^[a-z0-9_.]+$/.test(handle) || /^\.|\.$|\.\./.test(handle)) return { ok: false, error: 'handle_chars' }
  if (!opts.admin && isReservedHandle(handle)) return { ok: false, error: 'handle_reserved' }
  return { ok: true, handle }
}

/** "@rays_prince" in a message: an ID being mentioned. */
export const MENTION = /[@＠][A-Za-z0-9_.]{3,20}/g
