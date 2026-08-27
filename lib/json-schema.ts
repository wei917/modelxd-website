// lib/json-schema.ts — a small JSON Schema validator, hand-rolled.
//
// Same reasoning as the Agent Skills frontmatter parser: the subset we
// actually need is tiny, and owning it beats a dependency. It exists to
// answer one question — "can the game trust this object, or do we ask the
// model again?" — not to be a conformant draft-2020-12 implementation.
//
// SUPPORTED: type (string/number/integer/boolean/array/object/null),
// properties, required, additionalProperties, enum, items, minimum,
// maximum, minLength, maxLength, minItems, maxItems, anyOf/oneOf, const.
//
// NOT supported: $ref, allOf, patternProperties, format, dependencies.
// An unsupported keyword is IGNORED, never failed — a schema we can't fully
// check must not reject an object the provider already enforced natively.
// Callers that need a hard guarantee should use a native_schema provider.

export type SchemaError = { path: string; message: string }

const typeOf = (v: any): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

const matchesType = (v: any, t: string): boolean => {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v)
  if (t === 'number')  return typeof v === 'number' && Number.isFinite(v)
  return typeOf(v) === t
}

export function validate(value: any, schema: any, path = ''): SchemaError[] {
  if (!schema || typeof schema !== 'object') return []
  const errs: SchemaError[] = []
  const at = path || '(root)'

  // const / enum
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errs.push({ path: at, message: `must equal ${JSON.stringify(schema.const)}` })
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e: any) => JSON.stringify(e) === JSON.stringify(value))) {
    errs.push({ path: at, message: `must be one of ${schema.enum.map((e: any) => JSON.stringify(e)).join(', ')}` })
    return errs   // a wrong enum makes every other complaint here noise
  }

  // type — accepts the array form (`type: ['string','null']`)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t: string) => matchesType(value, t))) {
      errs.push({ path: at, message: `expected ${types.join(' or ')}, got ${typeOf(value)}` })
      return errs   // nothing below can be meaningfully checked
    }
  }

  // anyOf / oneOf — pass if ANY branch validates. Branch errors are dropped:
  // reporting "failed all 4 branches" is worse than useless to a model
  // rewriting its answer.
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[key])) {
      const ok = schema[key].some((sub: any) => validate(value, sub, path).length === 0)
      if (!ok) errs.push({ path: at, message: `does not match any allowed ${key} variant` })
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errs.push({ path: at, message: `must be >= ${schema.minimum}` })
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errs.push({ path: at, message: `must be <= ${schema.maximum}` })
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errs.push({ path: at, message: `must be at least ${schema.minLength} characters` })
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errs.push({ path: at, message: `must be at most ${schema.maxLength} characters` })
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errs.push({ path: at, message: `must have at least ${schema.minItems} items` })
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errs.push({ path: at, message: `must have at most ${schema.maxItems} items` })
    }
    if (schema.items) {
      value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)))
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of (schema.required ?? [])) {
      if (!(key in value)) errs.push({ path: path ? `${path}.${key}` : key, message: 'is required' })
    }
    const props = schema.properties ?? {}
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) errs.push(...validate(value[key], sub, path ? `${path}.${key}` : key))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) {
          errs.push({ path: path ? `${path}.${key}` : key, message: 'is not an allowed property' })
        }
      }
    }
  }

  return errs
}

/**
 * Pull a JSON object out of a model reply that may be wrapped in prose or a
 * ```json fence. Deliberately tolerant in the same way Werewolf's salvager
 * is: models routinely fence their JSON or add a sentence before it, and
 * failing a good answer over a code fence would be a bug, not rigour.
 */
export function extractJson(text: string): any | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return null

  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  // ```json … ``` or ``` … ```
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fence) {
    const fenced = tryParse(fence[1].trim())
    if (fenced !== undefined) return fenced
  }

  // First balanced {...} or [...] in the text. Scanning for the matching
  // brace beats a greedy regex, which swallows trailing prose.
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = trimmed.indexOf(open)
    if (start === -1) continue
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (esc) { esc = false; continue }
      if (ch === '\\' && inStr) { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) {
          const slice = tryParse(trimmed.slice(start, i + 1))
          if (slice !== undefined) return slice
          break
        }
      }
    }
  }
  return null
}

function tryParse(s: string): any | undefined {
  try { return JSON.parse(s) } catch { return undefined }
}
