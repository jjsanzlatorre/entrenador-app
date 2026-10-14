// Preferencias del cronómetro a pantalla completa (en el dispositivo):
// - blocks: abrirlo solo al empezar un bloque con tiempo o la herramienta «Cronómetro» (sí por
//   defecto).
// - rest: abrirlo solo con cada descanso entre series (no por defecto: sale tras cada serie).
import { useSyncExternalStore } from 'react'

export type FullscreenPref = 'blocks' | 'rest'

const KEYS: Record<FullscreenPref, string> = {
  blocks: 'entrenador:timer-fullscreen-auto',
  rest: 'entrenador:rest-fullscreen-auto',
}
const DEFAULTS: Record<FullscreenPref, boolean> = { blocks: true, rest: false }
const listeners = new Set<() => void>()

function read(pref: FullscreenPref) {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEYS[pref])
    return value === null ? DEFAULTS[pref] : value === '1'
  } catch {
    return DEFAULTS[pref]
  }
}

export function getFullscreenAuto(pref: FullscreenPref) {
  return read(pref)
}

export function setFullscreenAuto(pref: FullscreenPref, value: boolean) {
  try {
    localStorage.setItem(KEYS[pref], value ? '1' : '0')
  } catch {
    // sin almacenamiento: no se recuerda
  }
  for (const l of listeners) l()
}

export function useFullscreenAuto(pref: FullscreenPref) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => read(pref),
    () => DEFAULTS[pref],
  )
}
