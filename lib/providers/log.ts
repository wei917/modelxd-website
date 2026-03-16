// lib/providers/log.ts
// Strip image/video bytes from API responses before logging

type AnyObj = Record<string, any>

function stripBytes(val: any, depth = 0): any {
  if (depth > 10) return val
  if (val === null || val === undefined) return val
  if (typeof val === 'string') {
    // base64 blobs: long strings of alphanumeric+/= chars
    if (val.length > 200 && /^[A-Za-z0-9+/=]+$/.test(val.substring(0, 100))) {
      return `[base64 ~${Math.round(val.length * 3 / 4 / 1024)}KB]`
    }
    // data URIs
    if (val.startsWith('data:')) {
      const semi = val.indexOf(';')
      return `[dataURI ${val.substring(0, semi > 0 ? semi : 30)}...]`
    }
    return val
  }
  if (Array.isArray(val)) {
    return val.map(item => stripBytes(item, depth + 1))
  }
  if (typeof val === 'object') {
    const out: AnyObj = {}
    for (const [k, v] of Object.entries(val)) {
      // common byte fields
      if (['b64_json', 'imageBytes', 'videoBytes', 'data', 'uri'].includes(k) && typeof v === 'string' && v.length > 200) {
        out[k] = `[stripped ~${Math.round(v.length * 3 / 4 / 1024)}KB]`
      } else if (k === 'uri' && typeof v === 'string' && v.startsWith('http')) {
        out[k] = v // keep URLs
      } else {
        out[k] = stripBytes(v, depth + 1)
      }
    }
    return out
  }
  return val
}

export function logResponse(prefix: string, label: string, obj: any) {
  try {
    const cleaned = stripBytes(obj)
    console.log(`${prefix} ${label}:`, JSON.stringify(cleaned, null, 2))
  } catch {
    console.log(`${prefix} ${label}: [could not serialize]`)
  }
}
