// lib/game-seal.ts — a game's hidden state, sealed (Oct 20; poker's
// lib/poker-seal.ts made general for bridge). SERVER-ONLY.
//
// xtalk_sessions has an owner-all RLS policy (supabase/57): the person who
// started a table can read and write their own row with the publishable key.
// A game with hidden cards (poker's deck, bridge's four hands) therefore
// keeps its whole state in `pending.sealed`, AES-256-GCM: unreadable to the
// owner, and any edit to it fails the authentication tag instead of becoming
// a game. Each game seals under its own label, so one game's state can never
// be opened as another's. The key is derived from SUPABASE_SECRET_KEY.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

function key(label: string): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is not set: the game cannot be sealed')
  return createHash('sha256').update(label).update('\0').update(secret).digest()
}

export function sealer(game: string) {
  const label = `modelxd:xgame-${game}-seal:v1`
  return {
    /** JSON → deflate → AES-256-GCM. "v1.<iv>.<tag>.<data>", base64url. */
    seal(value: unknown): string {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key(label), iv)
      c.setAAD(Buffer.from(label))
      const data = Buffer.concat([c.update(deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))), c.final()])
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
    },
    /** Throws when the seal was made with another key or label, or was edited. */
    unseal<T>(sealed: string): T {
      const [v, iv, tag, data] = String(sealed ?? '').split('.')
      if (v !== 'v1' || !iv || !tag || !data) throw new Error(`not a sealed ${game} state`)
      const d = createDecipheriv('aes-256-gcm', key(label), Buffer.from(iv, 'base64url'))
      d.setAAD(Buffer.from(label))
      d.setAuthTag(Buffer.from(tag, 'base64url'))
      const plain = Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()])
      return JSON.parse(inflateRawSync(plain).toString('utf8')) as T
    },
  }
}
