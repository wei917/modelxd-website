// lib/poker-seal.ts — the poker table's state, sealed (Oct 19).
//
// SERVER-ONLY. xtalk_sessions has an owner-all RLS policy (supabase/57): the
// person who started a table can read and write their own row with the
// publishable key. Werewolf accepts that; poker cannot, because the row would
// hold the deck, and so every opponent's hole cards, readable by the one
// player at the table who must not see them. So the whole game state goes
// into `pending.sealed` encrypted with AES-256-GCM: unreadable to the owner,
// and any edit to it fails the authentication tag instead of becoming a game.
//
// The key is derived from SUPABASE_SECRET_KEY (server-only already) rather
// than a new env var. Rotating that key makes tables started before the
// rotation unreadable; they then end with an error, which is the honest
// outcome for a game whose state can no longer be proven.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const LABEL = 'modelxd:xgame-poker-seal:v1'

function key(): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is not set: the poker table cannot be sealed')
  return createHash('sha256').update(LABEL).update('\0').update(secret).digest()
}

/** JSON → deflate → AES-256-GCM. "v1.<iv>.<tag>.<data>", base64url. */
export function seal(value: unknown): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  c.setAAD(Buffer.from(LABEL))
  const data = Buffer.concat([c.update(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** Throws when the seal was made with another key or was edited. */
export function unseal<T>(sealed: string): T {
  const [v, iv, tag, data] = String(sealed ?? '').split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('not a sealed poker state')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAAD(Buffer.from(LABEL))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  const plain = Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()])
  return JSON.parse(inflateRawSync(plain).toString('utf8')) as T
}
