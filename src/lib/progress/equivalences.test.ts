import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accumulate, periodFor } from './accumulated'
import {
  bigGoal,
  crossedMilestones,
  destinationSteps,
  equivalenceFor,
  formatFraction,
  formatQty,
  haversineM,
  ladderPosition,
  milestoneKey,
  monthSummaryKey,
  objectMultiple,
  objectPhrase,
  objectSteps,
  parseMilestoneKey,
  pickMilestone,
  withPeriod,
  type Destination,
  type EquivalenceContext,
  type EquivalenceObject,
  type Home,
} from './equivalences'
import type { SessionLogEntry } from './types'
import type { SessionType } from '@/types/database'

// Catálogo real de la semilla.
const root = join(import.meta.dirname, '../../..')
type SeedObject = {
  id: string
  kind: EquivalenceObject['kind']
  label: string
  label_plural: string
  article: string
  emoji: string
  value: number
  phrase_template: string
  min_value: number
  source: string
}
type SeedDestination = {
  id: string
  name: string
  lat: number
  lng: number
  type: Destination['type']
  water_route: boolean
}
const seedObjects = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/equivalences.json'), 'utf8')) as {
    objects: SeedObject[]
  }
).objects
const seedDestinations = (
  JSON.parse(readFileSync(join(root, 'supabase/seed/destinations.json'), 'utf8')) as {
    destinations: SeedDestination[]
  }
).destinations

const objects: EquivalenceObject[] = seedObjects.map((o) => ({
  id: o.id,
  kind: o.kind,
  label: o.label,
  labelPlural: o.label_plural,
  article: o.article,
  emoji: o.emoji,
  value: o.value,
  phraseTemplate: o.phrase_template,
  minValue: o.min_value,
}))
const destinations: Destination[] = seedDestinations.map((d) => ({
  id: d.id,
  name: d.name,
  lat: d.lat,
  lng: d.lng,
  type: d.type,
  waterRoute: d.water_route,
}))

const barcelona: Home = { city: 'Barcelona', lat: 41.3874, lng: 2.1686 }
const ctx: EquivalenceContext = { objects, destinations, home: barcelona }
const byId = (id: string) => objects.find((o) => o.id === id)!

let seq = 0
function session(
  type: SessionType,
  startedAt: string,
  extra: Partial<SessionLogEntry> = {},
): SessionLogEntry {
  seq++
  return {
    id: `s${seq}`,
    sessionType: type,
    startedAt,
    endedAt: startedAt,
    durationMin: 60,
    rpe: 7,
    distanceM: null,
    ...extra,
  }
}

describe('semillas de equivalencias', () => {
  it('≥ 20 objetos de peso, rutas a nado y tiempo, todos con fuente', () => {
    expect(seedObjects.filter((o) => o.kind === 'weight').length).toBeGreaterThanOrEqual(20)
    expect(seedObjects.some((o) => o.kind === 'distance_route')).toBe(true)
    expect(seedObjects.some((o) => o.kind === 'time')).toBe(true)
    for (const o of seedObjects) {
      expect(o.source.length, o.id).toBeGreaterThan(5)
      expect(o.phrase_template, o.id).toContain('{qty}')
      expect(o.min_value, o.id).toBeLessThanOrEqual(o.value)
    }
    expect(new Set(seedObjects.map((o) => o.id)).size).toBe(seedObjects.length)
  })

  it('40–60 destinos con Baleares, Canarias, el Estrecho y lugares lejanos', () => {
    expect(seedDestinations.length).toBeGreaterThanOrEqual(40)
    expect(seedDestinations.length).toBeLessThanOrEqual(60)
    const ids = new Set(seedDestinations.map((d) => d.id))
    expect(ids.size).toBe(seedDestinations.length)
    for (const id of [
      'palma',
      'ibiza',
      'las_palmas',
      'tarifa',
      'ceuta',
      'paris',
      'nueva_york',
      'reikiavik',
      'marrakech',
    ]) {
      expect(ids.has(id), id).toBe(true)
    }
    expect(seedDestinations.filter((d) => d.water_route).length).toBeGreaterThan(5)
  })
})

describe('haversine', () => {
  it('Madrid–Barcelona ≈ 505 km y Barcelona–Palma ≈ 206 km en línea recta', () => {
    const madrid = destinations.find((d) => d.id === 'madrid')!
    const palma = destinations.find((d) => d.id === 'palma')!
    expect(haversineM(madrid, barcelona) / 1000).toBeCloseTo(505, -1)
    expect(haversineM(barcelona, palma) / 1000).toBeCloseTo(206, -1)
    expect(haversineM(barcelona, barcelona)).toBe(0)
  })

  it('la ruta fija Barcelona–Mallorca coincide con el haversine de los destinos', () => {
    const palma = destinations.find((d) => d.id === 'palma')!
    expect(Math.abs(haversineM(barcelona, palma) - byId('barcelona_mallorca').value)).toBeLessThan(
      2000,
    )
  })
})

describe('destino superado y siguiente', () => {
  const steps = destinationSteps(barcelona, destinations)

  it('ordena por distancia y excluye la propia ciudad', () => {
    expect(steps.some((s) => s.id === 'barcelona')).toBe(false)
    expect(steps[0]!.id).toBe('girona')
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.value).toBeGreaterThanOrEqual(steps[i - 1]!.value)
    }
  })

  it('sin distancia no hay destino superado; el siguiente es el más cercano', () => {
    const p = ladderPosition(steps, 0)
    expect(p.passed).toBeNull()
    expect(p.next?.id).toBe('girona')
    expect(p.fraction).toBe(0)
  })

  it('con 150 km: superado Girona, siguiente el próximo destino y lo que falta', () => {
    const p = ladderPosition(steps, 150_000)
    expect(p.passed?.value).toBeLessThanOrEqual(150_000)
    expect(p.next!.value).toBeGreaterThan(150_000)
    expect(p.remaining).toBeCloseTo(p.next!.value - 150_000)
    const eq = equivalenceFor('run', 150_000, ctx)
    expect(eq.phrase).toMatch(/^Has corrido la distancia de Barcelona a .+, en línea recta$/)
    expect(eq.next).toMatch(/^Siguiente: .+, a [\d,]+ km en línea recta$/)
  })

  it('natación: solo rutas fijas y destinos por mar', () => {
    const eq = equivalenceFor('swim', 15_000, ctx)
    expect(eq.position.passed?.id).toBe('gibraltar_strait')
    expect(eq.phrase).toBe('Has nadado una travesía del Estrecho de Gibraltar')
    const far = equivalenceFor('swim', 210_000, ctx)
    expect(far.position.passed?.destination?.waterRoute ?? true).toBe(true)
  })

  it('sin ciudad de referencia no hay destinos (pero sí rutas a nado)', () => {
    const noHome = { ...ctx, home: null }
    const run = equivalenceFor('run', 500_000, noHome)
    expect(run.position.passed).toBeNull()
    expect(run.needsHome).toBe(true)
    expect(equivalenceFor('swim', 15_000, noHome).position.passed?.id).toBe('gibraltar_strait')
  })
})

describe('objetos de peso', () => {
  it('el mayor objeto ≤ tonelaje y sus múltiplos', () => {
    const weights = objectSteps(objects, 'weight')
    expect(ladderPosition(weights, 5200).passed?.id).toBe('tractor')
    expect(objectMultiple(5200, byId('tractor'))).toBe(1)
    expect(formatQty(byId('tractor'), 1)).toBe('un tractor')
    expect(formatQty(byId('car'), objectMultiple(4080, byId('car')))).toBe('3,4 coches')
    expect(objectPhrase(byId('tractor'), 5200)).toBe('Has levantado el peso de un tractor')
    expect(withPeriod('month', objectPhrase(byId('tractor'), 5200))).toBe(
      'Este mes has levantado el peso de un tractor',
    )
  })

  it('por debajo del objeto más pequeño no hay equivalencia, pero sí barra al siguiente', () => {
    const eq = equivalenceFor('tonnage', 10, ctx)
    expect(eq.phrase).toBeNull()
    expect(eq.position.next?.id).toBe('cement_bag')
    expect(eq.next).toBe('Llevas el 40 % de un saco de cemento')
  })

  it('fracción de un objetivo grande (solo a partir de su min_value)', () => {
    expect(formatFraction(0.12)).toBe('12 %')
    expect(formatFraction(0.004)).toBe('0,4 %')
    // 120 t: la Torre Eiffel (min 100 t) ya se puede mostrar como fracción.
    const goal = bigGoal(objects, 'weight', 120_000)
    expect(goal?.object.id).toBe('eiffel_tower')
    expect(formatFraction(goal!.fraction)).toBe('1,6 %')
    // 5 t: la Torre Eiffel todavía no.
    expect(bigGoal(objects, 'weight', 5000)?.object.id).not.toBe('eiffel_tower')
    const eq = equivalenceFor('tonnage', 120_000, ctx)
    expect(eq.big?.text).toBe('Llevas el 1,6 % de la Torre Eiffel')
  })

  it('pasado el objeto más grande, en múltiplos', () => {
    const eq = equivalenceFor('tonnage', 14_600_000, ctx)
    expect(eq.position.passed?.id).toBe('eiffel_tower')
    expect(eq.phrase).toBe('Has levantado el peso de 2 Torres Eiffel')
    expect(eq.next).toBeNull()
  })
})

describe('acumulados', () => {
  it('suma por deporte y periodo (bici = bici + spinning)', () => {
    const sessions = [
      session('swimming', '2026-09-28T08:00:00', { distanceM: 2000 }),
      session('running', '2026-09-29T08:00:00', { distanceM: 10_000, durationMin: 50 }),
      session('spinning', '2026-09-30T08:00:00', { distanceM: 20_000, durationMin: 45 }),
      session('cycling', '2026-09-20T08:00:00', { distanceM: 40_000, durationMin: 90 }),
      session('strength', '2026-10-01T08:00:00', { tonnageKg: 4000, totalReps: 120 }),
    ]
    const week = accumulate(sessions, periodFor('week', '2026-09-30'))
    expect(week.sessions).toBe(4)
    expect(week.swimM).toBe(2000)
    expect(week.runM).toBe(10_000)
    expect(week.bikeM).toBe(20_000)
    expect(week.bikeMinutes).toBe(45)
    expect(week.distM).toBe(32_000)
    expect(week.tonnageKg).toBe(4000)
    expect(week.reps).toBe(120)
    const month = accumulate(sessions, periodFor('month', '2026-09-30'))
    expect(month.sessions).toBe(4)
    expect(month.bikeM).toBe(60_000)
    expect(month.tonnageKg).toBe(0)
    const total = accumulate(sessions)
    expect(total.sessions).toBe(5)
    expect(total.minutes).toBe(60 + 50 + 45 + 90 + 60)
    expect(total.minutesBySport.cycling).toBe(90)
    expect(accumulate(sessions, periodFor('year', '2026-01-01')).sessions).toBe(5)
  })
})

describe('hitos del pop-up', () => {
  it('la sesión que cruza el tonelaje de un tractor lo propone una sola vez', () => {
    const before = session('strength', '2026-08-10T08:00:00', { tonnageKg: 4900 })
    const now = session('strength', '2026-09-30T08:00:00', { tonnageKg: 300 })
    const candidates = crossedMilestones([before, now], now.id, '2026-09-30', ctx)
    const keys = candidates.map((c) => c.key)
    expect(keys).toContain('tonnage_total_tractor')
    expect(keys).toContain('tonnage_month_2026-09_brown_bear')
    const pick = pickMilestone(candidates, new Set())
    // El total es más llamativo que el mes.
    expect(pick.best?.key).toBe('tonnage_total_tractor')
    expect(pick.best?.phrase).toBe('En total has levantado el peso de un tractor')
    expect(pick.best?.valueLabel).toBe('5.200 kg')
    expect(pick.keys).toEqual(keys)
    // Ya enseñados: no se repite.
    expect(pickMilestone(candidates, new Set(keys)).best).toBeNull()
  })

  it('una carrera que supera un destino: prioriza la carrera sobre la distancia total', () => {
    const girona = destinationSteps(barcelona, destinations)[0]!
    const before = session('running', '2026-01-10T08:00:00', { distanceM: girona.value - 3000 })
    const now = session('running', '2026-09-30T08:00:00', { distanceM: 5000 })
    const pick = pickMilestone(
      crossedMilestones([before, now], now.id, '2026-09-30', ctx),
      new Set(),
    )
    expect(pick.best?.key).toBe('run_total_girona')
    expect(pick.best?.phrase).toBe(
      'En total has corrido la distancia de Barcelona a Girona, en línea recta',
    )
    expect(pick.keys).toContain('dist_total_girona')
  })

  it('una sesión que no cruza nada no propone hitos', () => {
    const before = session('strength', '2026-09-29T08:00:00', { tonnageKg: 5100 })
    const now = session('strength', '2026-09-30T08:00:00', { tonnageKg: 100 })
    const c = crossedMilestones([before, now], now.id, '2026-09-30', ctx).filter(
      (x) => x.metric === 'tonnage',
    )
    expect(c).toEqual([])
  })

  it('las claves se pueden leer para el historial', () => {
    const month = periodFor('month', '2026-10-05')
    expect(milestoneKey('tonnage', month, 'tractor')).toBe('tonnage_month_2026-10_tractor')
    expect(parseMilestoneKey('tonnage_month_2026-10_tractor')).toEqual({
      type: 'step',
      metric: 'tonnage',
      period: 'month',
      periodKey: '2026-10',
      stepId: 'tractor',
    })
    expect(parseMilestoneKey('run_week_2026-09-28_a_coruna')).toMatchObject({
      periodKey: '2026-09-28',
      stepId: 'a_coruna',
    })
    expect(parseMilestoneKey('swim_total_gibraltar_strait')).toMatchObject({
      period: 'total',
      stepId: 'gibraltar_strait',
    })
    expect(parseMilestoneKey(monthSummaryKey('2026-09-01'))).toEqual({
      type: 'month_summary',
      month: '2026-09',
    })
    expect(parseMilestoneKey('otra_cosa')).toBeNull()
  })
})
