// Pitidos y vibración de los temporizadores.
// - El audio se desbloquea en un toque del usuario (los navegadores móviles no dejan sonar sin
//   interacción previa).
// - En iOS no hay vibración (navigator.vibrate no existe): solo suena.
// - El sonido se puede silenciar; la preferencia se guarda en el dispositivo.
import { useSyncExternalStore } from 'react'

const MUTE_KEY = 'entrenador:sound-muted'
let audioContext: AudioContext | null = null
let muted = readMuted()
const listeners = new Set<() => void>()

function readMuted() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function isSoundMuted() {
  return muted
}

export function setSoundMuted(value: boolean) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // sin almacenamiento: solo dura esta sesión
  }
  for (const l of listeners) l()
}

export function useSoundMuted() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => muted,
    () => false,
  )
}

export function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

export function unlockAudio() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audioContext ??= new Ctx()
    if (audioContext.state === 'suspended') void audioContext.resume()
  } catch {
    // sin audio
  }
}

export function beep(durationMs = 120, frequency = 880) {
  if (muted) return
  try {
    if (!audioContext || audioContext.state !== 'running') return
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.3, audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + durationMs / 1000)
    osc.connect(gain).connect(audioContext.destination)
    osc.start()
    osc.stop(audioContext.currentTime + durationMs / 1000)
  } catch {
    // sin audio
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    if (canVibrate()) navigator.vibrate(pattern)
  } catch {
    // sin vibración
  }
}

// Aviso de «quedan N segundos» (3, 2, 1) y de fin de fase.
export function countdownAlert(secondsLeft: number) {
  if (secondsLeft > 0) {
    beep(90, 880)
    vibrate(60)
  } else {
    beep(450, 1320)
    vibrate([200, 100, 200])
  }
}
