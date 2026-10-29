// Cronómetro de una serie isométrica (plancha, dead hang, L-sit), también «cada lado» (plancha
// lateral 45 s/lado): con tiempo objetivo, cuenta atrás del lado 1, aviso «Cambia de lado» y
// cuenta atrás del lado 2; sin objetivo, cronómetro (el primer toque cambia de lado y el segundo
// para). Todo se deriva de la hora de inicio, no de un contador. Lógica pura, con tests.

export type Hold = {
  startedAt: number
  // Segundos objetivo por lado (null: cronómetro).
  targetS: number | null
  perSide: boolean
  // Cambio de lado a mano (sin objetivo, o antes de tiempo): instante y segundos del lado 1.
  switchedAt: number | null
  firstS: number | null
}

export function startHold(now: number, targetS: number | null, perSide = false): Hold {
  return {
    startedAt: now,
    targetS: targetS && targetS > 0 ? targetS : null,
    perSide,
    switchedAt: null,
    firstS: null,
  }
}

export type HoldView = {
  // Lado en curso (null si no es «cada lado»).
  side: 1 | 2 | null
  // Lo que se enseña: cuenta atrás (con objetivo) o tiempo transcurrido del lado.
  clockS: number
  // Segundos que quedan del lado (null sin objetivo), para los pitidos de los 3 últimos.
  leftS: number | null
  // Ya ha terminado (con objetivo): resultado en resultS.
  done: boolean
  resultS: number | null
}

const secs = (ms: number) => Math.max(0, Math.floor(ms / 1000))

// Instante del cambio de lado: a mano o, con objetivo, al acabar el tiempo del lado 1.
function switchAt(hold: Hold): number | null {
  if (!hold.perSide) return null
  if (hold.switchedAt !== null) return hold.switchedAt
  return hold.targetS !== null ? hold.startedAt + hold.targetS * 1000 : null
}

function firstSide(hold: Hold) {
  return hold.switchedAt !== null ? (hold.firstS ?? 0) : (hold.targetS ?? 0)
}

export function holdView(hold: Hold, now: number): HoldView {
  const target = hold.targetS
  const sw = switchAt(hold)
  if (!hold.perSide || sw === null || now < sw) {
    const elapsed = secs(now - hold.startedAt)
    const side = hold.perSide ? 1 : null
    if (target === null) return { side, clockS: elapsed, leftS: null, done: false, resultS: null }
    const left = target - (now - hold.startedAt) / 1000
    const done = !hold.perSide && left <= 0
    return {
      side,
      clockS: Math.max(0, target - elapsed),
      leftS: Math.ceil(left),
      done,
      resultS: done ? target : null,
    }
  }
  // Lado 2.
  const elapsed = secs(now - sw)
  if (target === null) return { side: 2, clockS: elapsed, leftS: null, done: false, resultS: null }
  const left = target - (now - sw) / 1000
  const done = left <= 0
  return {
    side: 2,
    clockS: Math.max(0, target - elapsed),
    leftS: Math.ceil(left),
    done,
    resultS: done ? Math.min(firstSide(hold), target) : null,
  }
}

// Toque en ■: en «cada lado» durante el lado 1 cambia de lado; si no, para y devuelve el tiempo
// (por lado: el más corto de los dos, para no apuntar más de lo que aguantó un lado).
export function pressHold(hold: Hold, now: number): { hold: Hold | null; resultS: number | null } {
  const view = holdView(hold, now)
  const elapsed = Math.max(1, Math.round((now - hold.startedAt) / 1000))
  if (hold.perSide && view.side === 1) {
    const firstS = hold.targetS === null ? elapsed : Math.min(elapsed, hold.targetS)
    return { hold: { ...hold, switchedAt: now, firstS }, resultS: null }
  }
  if (hold.perSide && view.side === 2) {
    const sw = switchAt(hold) ?? hold.startedAt
    const second = Math.max(1, Math.round((now - sw) / 1000))
    const capped = hold.targetS === null ? second : Math.min(second, hold.targetS)
    return { hold: null, resultS: Math.min(firstSide(hold), capped) }
  }
  return { hold: null, resultS: hold.targetS === null ? elapsed : Math.min(elapsed, hold.targetS) }
}
