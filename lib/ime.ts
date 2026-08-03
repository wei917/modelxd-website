// lib/ime.ts
// Enter means two different things depending on who is typing.
//
// With a Chinese, Japanese or Korean IME, Enter CONFIRMS the candidate you
// picked — it is part of composing the word, not a command. An app that
// submits on keydown Enter therefore fires halfway through the first word
// and sends "ㄓㄨ" instead of the sentence. English typists never see it,
// which is why it survives so long in products built in English first.
//
// `isComposing` on the native event is the standard signal. keyCode 229 is
// the legacy one some IMEs and older WebKit still send instead, so check
// both — a false negative here silently truncates a user's sentence.

import type { KeyboardEvent } from 'react'

export function isComposing(e: KeyboardEvent): boolean {
  const ne = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number } | undefined
  return !!ne?.isComposing || ne?.keyCode === 229
}

/** Enter pressed as a command: not mid-composition, and not Shift+Enter. */
export function isSubmitEnter(e: KeyboardEvent, opts?: { requireModifier?: boolean }): boolean {
  if (e.key !== 'Enter' || isComposing(e)) return false
  if (opts?.requireModifier) return e.metaKey || e.ctrlKey
  return !e.shiftKey
}
