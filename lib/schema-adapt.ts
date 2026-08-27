// lib/schema-adapt.ts — make one JSON Schema acceptable to every provider.
//
// "native_schema" is not one thing. Each provider constrains a different
// subset, and the differences are hard errors, not warnings: Anthropic
// rejects `maximum` on an integer outright (400, caught live on the first
// Gauntlet-shaped request we ever sent), OpenAI's strict mode demands every
// property be required, Gemini wants its own dialect.
//
// Left alone that would make a caller's schema depend on which model the
// router happened to pick — and `models: [...]` fallback would silently
// change validation behaviour mid-chain. Unacceptable: the schema is the
// contract, and a contract that varies by provider is not one.
//
// So: strip what a provider cannot take, fold the stripped constraint into
// the field's `description` so the model still knows the rule, and let
// lib/json-schema.ts enforce the ORIGINAL schema on the way back. The
// official Anthropic SDKs do exactly this; anthropic.ts talks raw HTTP, so
// we do it ourselves. Net effect: the provider enforces what it can, we
// enforce the rest, and the caller sees one consistent contract.

type Json = Record<string, any>

/** Formats Anthropic accepts. Anything else is dropped. */
const ANTHROPIC_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid',
])

/** Human-readable note for a constraint we had to remove, so the model can
 *  still honour it even though the decoder is no longer forcing it. */
const NOTES: Record<string, (v: any) => string> = {
  minimum:          v => `at least ${v}`,
  maximum:          v => `at most ${v}`,
  exclusiveMinimum: v => `greater than ${v}`,
  exclusiveMaximum: v => `less than ${v}`,
  multipleOf:       v => `a multiple of ${v}`,
  minLength:        v => `at least ${v} characters`,
  maxLength:        v => `at most ${v} characters`,
  pattern:          v => `matching the pattern ${v}`,
  minItems:         v => `at least ${v} items`,
  maxItems:         v => `at most ${v} items`,
}

export function adaptSchema(schema: any, provider: string): any {
  if (!schema || typeof schema !== 'object') return schema
  if (provider === 'anthropic') return walk(schema, anthropicRules)
  if (provider === 'google')    return walk(schema, googleRules)
  return schema   // openai / xai take standard JSON Schema as-is
}

type Rules = {
  drop:  string[]
  /** Keywords kept only for certain values. Return true to keep. */
  keepIf?: Record<string, (v: any) => boolean>
  forceNoAdditional?: boolean
  formats?: Set<string>
  /** oneOf has no equivalent on some providers; anyOf is the near-miss. */
  oneOfToAnyOf?: boolean
}

const anthropicRules: Rules = {
  drop: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
         'minLength', 'maxLength', 'pattern', 'maxItems', 'not'],
  // minItems survives only at 0 or 1 — the documented exception.
  keepIf: { minItems: v => v === 0 || v === 1 },
  forceNoAdditional: true,
  formats: ANTHROPIC_FORMATS,
  oneOfToAnyOf: true,
}

// Gemini's responseJsonSchema is close to standard but rejects an
// `additionalProperties` key outright, and ignores the string/number
// constraints rather than erroring. Dropping them keeps the description
// note (which the model reads) and hands enforcement to our validator.
const googleRules: Rules = {
  drop: ['additionalProperties', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'not'],
  oneOfToAnyOf: true,
}

function walk(node: any, rules: Rules): any {
  if (Array.isArray(node)) return node.map(n => walk(n, rules))
  if (!node || typeof node !== 'object') return node

  const out: Json = {}
  const notes: string[] = []

  for (const [key, value] of Object.entries(node)) {
    if (rules.drop.includes(key)) {
      if (NOTES[key]) notes.push(NOTES[key](value))
      continue
    }
    if (rules.keepIf?.[key] && !rules.keepIf[key](value)) {
      if (NOTES[key]) notes.push(NOTES[key](value))
      continue
    }
    if (key === 'format' && rules.formats && !rules.formats.has(String(value))) {
      notes.push(`in ${value} format`)
      continue
    }
    if (key === 'oneOf' && rules.oneOfToAnyOf) {
      out.anyOf = walk(value, rules)
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Json).map(([k, v]) => [k, walk(v, rules)]),
      )
      continue
    }
    if (key === '$defs' || key === 'definitions') {
      out[key] = Object.fromEntries(
        Object.entries(value as Json).map(([k, v]) => [k, walk(v, rules)]),
      )
      continue
    }
    out[key] = walk(value, rules)
  }

  // The dropped rules become prose. The decoder no longer enforces them, but
  // the model can read them — and our validator still rejects a violation,
  // so the constraint is never merely advisory.
  if (notes.length) {
    const existing = typeof out.description === 'string' ? out.description.trim() : ''
    const sentence = `Must be ${notes.join(' and ')}.`
    out.description = existing ? `${existing} ${sentence}` : sentence
  }

  if (rules.forceNoAdditional && out.type === 'object' && out.properties) {
    out.additionalProperties = false
  }
  return out
}

/**
 * OpenAI honours `strict: true` only when EVERY property is required and
 * additionalProperties is false. Sending strict with an optional field is a
 * 400, so the flag is computed from the schema rather than taken on trust —
 * a caller asking for strict on a loose schema gets non-strict decoding plus
 * our own validation, which is the outcome they actually wanted.
 */
export function strictIsSafe(schema: any): boolean {
  if (!schema || typeof schema !== 'object') return false
  if (schema.type !== 'object' || !schema.properties) return false
  if (schema.additionalProperties !== false) return false
  const props = Object.keys(schema.properties)
  const required: string[] = Array.isArray(schema.required) ? schema.required : []
  if (props.some(p => !required.includes(p))) return false
  return props.every(p => {
    const sub = schema.properties[p]
    return !sub || sub.type !== 'object' || strictIsSafe(sub)
  })
}
