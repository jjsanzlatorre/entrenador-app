// Pitidos y vibración del temporizador. El audio se desbloquea en un toque del usuario
// (completar una serie), porque los navegadores móviles no dejan sonar sin interacción.
let audioContext: AudioContext | null = null

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
  try {
    if (!audioContext || audioContext.state !== 'running') return
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.25, audioContext.currentTime)
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
    navigator.vibrate?.(pattern)
  } catch {
    // sin vibración
  }
}
