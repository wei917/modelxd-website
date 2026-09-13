// app/api/xarch/_photo.ts — the room photo edit shared by the photo route and
// the agent (route files may only export handlers, so it lives here).

import { service, editPhoto, assertBalance, bill, download } from '@/lib/xarch-ai'
import type { Media } from '@/lib/xarch'

export async function runPhotoEdit(req: Request, row: any, userId: string, mediaId: string, prompt: string, mask?: { bucket: string; storagePath: string } | null) {
  const src: Media | undefined = (row.media ?? []).find((m: Media) => m.id === mediaId)
  if (!src || !src.mediaType.startsWith('image/')) throw new Error('Pick a photo to edit.')
  await assertBalance(userId, 25)
  const input = src.public_url
    ? await fetch(new URL(src.public_url, req.url)).then(async r => ({ buffer: Buffer.from(await r.arrayBuffer()), mediaType: r.headers.get('content-type') ?? 'image/jpeg' }))
    : await download(src.bucket!, src.path!)
  const maskBuf = mask && mask.storagePath.startsWith(`${userId}/`) ? (await download(mask.bucket, mask.storagePath)).buffer : null
  const out = await editPhoto(userId, input, prompt, maskBuf)
  const ext = out.mediaType.includes('png') ? 'png' : out.mediaType.includes('webp') ? 'webp' : 'jpg'
  const path = `${userId}/xarch/${crypto.randomUUID()}.${ext}`
  const svc = service()
  const { error } = await svc.storage.from('xcreate-ai-images').upload(path, out.buffer, { contentType: out.mediaType })
  if (error) throw new Error(error.message)
  const cents = await bill(userId, out.cost, row.id, 'photo edit (GPT Image 2)', { kind: 'photo', source: mediaId })
  const item: Media = { id: crypto.randomUUID(), room_id: src.room_id, kind: 'edit', mediaType: out.mediaType, bucket: 'xcreate-ai-images', path, prompt, source_id: src.id, created_at: new Date().toISOString() }
  return { item, cents }
}

