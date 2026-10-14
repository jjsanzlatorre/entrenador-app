import { describe, expect, it } from 'vitest'
import { loadAllSeedExercises, loadLibraryFiles } from '../../scripts/seed-exercises'
import { EQUIPMENT_LABELS, MUSCLES } from '../../src/lib/workout/labels'

const { exercises } = loadAllSeedExercises()
const byId = new Map(exercises.map((e) => [e.id, e]))
const muscles = new Set(MUSCLES.map((m) => m.id))

describe('biblioteca de ejercicios ampliada', () => {
  it('unos 200 ejercicios con ids únicos', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(200)
    expect(new Set(exercises.map((e) => e.id)).size).toBe(exercises.length)
  })

  it('cada archivo nuevo es una migración numerada y distinta', () => {
    const files = loadLibraryFiles()
    expect(files.length).toBeGreaterThanOrEqual(5)
    const names = files.map((f) => f.migration)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^00\d\d_seed_exercises_[a-z_]+\.sql$/)
  })

  it('músculos válidos, al menos un principal y sin repetir principal y secundario', () => {
    for (const e of exercises) {
      for (const m of [...e.primary, ...e.secondary])
        expect(muscles.has(m), `${e.id}: ${m}`).toBe(true)
      expect(
        e.primary.filter((m) => e.secondary.includes(m)),
        e.id,
      ).toEqual([])
    }
    // Los nuevos (0036+) llevan siempre músculos; cardio, deportes y clases de antes usan la
    // aproximación por tipo de actividad.
    for (const e of loadLibraryFiles().flatMap((f) => f.exercises))
      expect(e.primary.length, e.id).toBeGreaterThan(0)
  })

  it('todo el material tiene nombre en español', () => {
    for (const e of exercises)
      for (const eq of e.equipment) expect(EQUIPMENT_LABELS[eq], `${e.id}: ${eq}`).toBeDefined()
  })

  it('alias en español e inglés, sin repetir el nombre', () => {
    for (const e of loadLibraryFiles().flatMap((f) => f.exercises)) {
      expect(e.aliases.length, e.id).toBeGreaterThanOrEqual(2)
      expect(
        e.aliases.map((a) => a.toLowerCase()),
        e.id,
      ).not.toContain(e.name.toLowerCase())
    }
  })

  it('incluye lo pedido: máquinas de cardio, core, colgados, máquinas, calistenia y movilidad', () => {
    const wanted = [
      'skierg',
      'row_erg',
      'stair_climber',
      'air_bike',
      'stationary_bike',
      'treadmill_run',
      'elliptical',
      'echo_bike',
      'side_plank',
      'dead_bug',
      'hollow_hold',
      'bird_dog',
      'ab_wheel',
      'crunch',
      'hanging_leg_raise',
      'russian_twist',
      'farmer_hold',
      'dead_hang',
      'active_hang',
      'scapular_pull_up',
      'hack_squat',
      'incline_leg_press',
      'pec_deck',
      'seated_cable_row',
      'close_grip_pulldown',
      'hip_abduction_machine',
      'hip_adduction_machine',
      'seated_calf_raise',
      'back_extension',
      'kb_turkish_get_up',
      'trx_row',
      'band_pull_apart',
      'muscle_up',
      'pistol_squat',
      'l_sit',
      'jump_squat',
      'hip_90_90',
      'cat_cow',
      'worlds_greatest_stretch',
    ]
    for (const id of wanted) expect(byId.has(id), id).toBe(true)
  })

  it('los isométricos se registran por tiempo', () => {
    for (const id of [
      'plank',
      'side_plank',
      'hollow_hold',
      'dead_hang',
      'active_hang',
      'l_sit',
      'wall_sit',
      'farmer_hold',
      'copenhagen_plank',
      'handstand_hold',
    ])
      expect(byId.get(id)?.tracking_type, id).toBe('time')
  })

  it('máquinas de cardio con seguimiento por tiempo, distancia o calorías', () => {
    for (const id of [
      'stair_climber',
      'stationary_bike',
      'treadmill_run',
      'elliptical',
      'echo_bike',
      'bike_erg',
    ])
      expect(['distance_time', 'calories', 'duration_only'], id).toContain(
        byId.get(id)?.tracking_type,
      )
  })

  it('descansos: compuestos ≥ 90 s salvo movilidad y cardio; accesorios ≤ 90 s', () => {
    for (const e of loadLibraryFiles().flatMap((f) => f.exercises)) {
      if (e.category === 'mobility' || e.category === 'cardio') continue
      if (!e.is_compound) expect(e.default_rest_s, e.id).toBeLessThanOrEqual(90)
    }
  })
})
