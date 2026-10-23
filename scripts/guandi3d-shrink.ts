// scripts/guandi3d-shrink.ts — make a Tripo GLB light enough for a phone:
// every embedded texture is resized (longest side at most <max> px) and
// re-encoded as JPEG; the geometry is left as Tripo made it. Tripo P2's
// "detailed" statue arrives at 17 MB (4K colour, 4K metal/rough, 4K PNG
// normal map); the 3D temple loads it on phones.
//
//   npx tsx scripts/guandi3d-shrink.ts <in.glb> <out.glb> [max=2048] [colourMax=max]
//
// colourMax lets the colour texture stay sharper than the rest (a building
// seen from its doorstep needs it; its metal/rough and normal maps do not).
//
// A GLB is a JSON chunk plus one BIN chunk; images point at bufferViews in
// the BIN. The BIN is rebuilt view by view (4-byte aligned) with the new
// image bytes, and every bufferView's offset and length is rewritten.

import fs from 'node:fs'
import sharp from 'sharp'

const [inFile, outFile, maxArg, colourArg] = process.argv.slice(2)
const MAX = Number(maxArg ?? 2048)
const COLOUR_MAX = Number(colourArg ?? MAX)
const pad4 = (n: number) => (n + 3) & ~3

async function main() {
  const glb = fs.readFileSync(inFile)
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  const jsonLen = glb.readUInt32LE(12)
  const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen))
  const binStart = 20 + jsonLen + 8
  const binLen = glb.readUInt32LE(20 + jsonLen)
  const bin = glb.subarray(binStart, binStart + binLen)

  // Which views hold images, and which texture slot each feeds (the normal
  // map keeps more JPEG quality: its artefacts show as dents).
  const imageViews = new Map<number, number>()   // bufferView → image index
  json.images?.forEach((im: any, i: number) => { if (typeof im.bufferView === 'number') imageViews.set(im.bufferView, i) })
  const normalImages = new Set<number>(), colourImages = new Set<number>()
  for (const m of json.materials ?? []) {
    const t = m.normalTexture?.index
    if (typeof t === 'number') normalImages.add(json.textures[t].source)
    const c = m.pbrMetallicRoughness?.baseColorTexture?.index
    if (typeof c === 'number') colourImages.add(json.textures[c].source)
  }

  const parts: Buffer[] = []
  let offset = 0
  for (let v = 0; v < json.bufferViews.length; v++) {
    const view = json.bufferViews[v]
    let bytes: Buffer = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    const img = imageViews.get(v)
    if (img !== undefined) {
      const before = bytes.length
      const meta = await sharp(bytes).metadata()
      bytes = await sharp(bytes)
        .resize({ width: colourImages.has(img) ? COLOUR_MAX : MAX, height: colourImages.has(img) ? COLOUR_MAX : MAX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: normalImages.has(img) ? 92 : 85, mozjpeg: true })
        .toBuffer()
      json.images[img].mimeType = 'image/jpeg'
      console.log(`image ${img}${normalImages.has(img) ? ' (normal)' : ''}: ${meta.width}x${meta.height} ${(before / 1e6).toFixed(2)} MB → ${(bytes.length / 1e6).toFixed(2)} MB`)
    }
    view.byteOffset = offset
    view.byteLength = bytes.length
    parts.push(bytes)
    const padded = pad4(bytes.length)
    if (padded > bytes.length) parts.push(Buffer.alloc(padded - bytes.length))
    offset += padded
  }
  json.buffers[0].byteLength = offset
  const newBin = Buffer.concat(parts)

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8)
  const jsonHead = Buffer.alloc(8); jsonHead.writeUInt32LE(jsonBuf.length, 0); jsonHead.writeUInt32LE(0x4e4f534a, 4)
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(newBin.length, 0); binHead.writeUInt32LE(0x004e4942, 4)
  fs.writeFileSync(outFile, Buffer.concat([header, jsonHead, jsonBuf, binHead, newBin]))
  console.log(`${inFile} ${(glb.length / 1e6).toFixed(2)} MB → ${outFile} ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB`)
}

main().catch(e => { console.error(e); process.exit(1) })
