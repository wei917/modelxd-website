'use client'
// The type the XCreate studio is making (text, image, video, audio), shared
// between the studio (app/xcreate/client.tsx) and the door's top bar, which
// carries the four types as XTell's carries its temples (owner, Sep 28). The
// studio owns it: it publishes its current type while it is on screen (null
// when it is not, so the bar marks none), and the bar asks it to switch
// rather than setting it, because a switch may first need a fresh composer.

import { useSyncExternalStore } from 'react'

export type StudioType = 'text' | 'image' | 'video' | 'audio'

/** The top bar's order (owner, Sep 28: "Text, Image, Video, Audio"). */
export const STUDIO_TYPES: StudioType[] = ['text', 'image', 'video', 'audio']

export const isStudioType = (value: unknown): value is StudioType =>
  typeof value === 'string' && (STUDIO_TYPES as string[]).includes(value)

let current: StudioType | null = null
const listeners = new Set<() => void>()

export function publishStudioType(type: StudioType | null) {
  if (type === current) return
  current = type
  listeners.forEach(listener => listener())
}

export function useStudioType(): StudioType | null {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => current,
    () => null,
  )
}

const REQUEST = 'xcs-studio-type'

export function requestStudioType(type: StudioType) {
  window.dispatchEvent(new CustomEvent<StudioType>(REQUEST, { detail: type }))
}

export function onStudioTypeRequest(handle: (type: StudioType) => void) {
  const listener = (event: Event) => {
    const type = (event as CustomEvent).detail
    if (isStudioType(type)) handle(type)
  }
  window.addEventListener(REQUEST, listener)
  return () => window.removeEventListener(REQUEST, listener)
}
