'use client'
// app/components/xtell/usePins.ts — the visitor's pinned temples (lib/xtell-
// pins.ts) as React state, shared by the top bar and each room's pin button:
// a change saves, then tells every reader in this tab (PINS_EVENT) and other
// tabs hear it through the storage event. Null until mounted: pins live in
// this browser, not on the server, so the first render is the market order.

import { useCallback, useEffect, useState } from 'react'
import { TEMPLES } from './TempleStreet'
import { loadPins, savePins, deviceStore, pinTemple, unpinTemple, PINS_EVENT, PINS_KEY } from '../../../lib/xtell-pins'
import type { TempleKey } from './TempleArtwork'

// The list for this visit when storage is blocked (kept outside React so the
// bar and the button agree).
let memory: TempleKey[] | null = null

export function usePins(): { pins: TempleKey[] | null; toggle: (key: TempleKey) => void } {
  const [pins, setPins] = useState<TempleKey[] | null>(null)
  useEffect(() => {
    const read = () => { const { list, ok } = loadPins(deviceStore(), TEMPLES); setPins(ok ? list : (memory ?? list)) }
    read()
    const onStorage = (e: StorageEvent) => { if (e.key === PINS_KEY) read() }
    window.addEventListener(PINS_EVENT, read)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(PINS_EVENT, read); window.removeEventListener('storage', onStorage) }
  }, [])
  const toggle = useCallback((key: TempleKey) => {
    const { list, ok } = loadPins(deviceStore(), TEMPLES)
    const now = ok ? list : (memory ?? [])
    const next = now.includes(key) ? unpinTemple(now, key) : pinTemple(now, key)
    if (!savePins(deviceStore(), next)) memory = next
    window.dispatchEvent(new Event(PINS_EVENT))
  }, [])
  return { pins, toggle }
}
