// Plantillas de planes (CLAUDE.md §9): 6 familias × 2 niveles, 4 semanas (la 4.ª de descarga).
// `npm run seed:sql` escribe supabase/seed/plan_templates.json y las migraciones 0019, 0020 y
// 0022 (HYROX y DEKA; 0021 es la versión anterior, congelada).
// Los datos de competición de HYROX y DEKA salen de src/lib/plan/competition.ts.
import {
  DEKA_RUN_M,
  DEKA_ZONES,
  HYROX_RUN_M,
  HYROX_STATIONS,
  type DekaZone,
  type HyroxStation,
} from '../src/lib/plan/competition.ts'
import type {
  Intensity,
  PlanBlock,
  PlanExercise,
  PlanFamily,
  PlanLevel,
  PlanSession,
  PlanSessionType,
  PlanTemplate,
} from '../src/lib/plan/types.ts'

const WEEKS = [1, 2, 3, 4] as const
type Week = (typeof WEEKS)[number]
const isDeload = (w: Week) => w === 4

// Semana de descarga: ≈ −40 % de volumen (series o distancia), misma intensidad o algo menos.
const deloadSets = (sets: number) => Math.max(1, Math.round(sets * 0.6))
const pick = <T>(w: Week, values: readonly [T, T, T, T]): T => values[w - 1]!

// ── Constructores ───────────────────────────────────────────

type Lift = [id: string, sets: number, reps: string, rest: number]

function lifts(w: Week, list: Lift[], rir = 2): PlanBlock[] {
  return list.map(([id, sets, reps, rest]) => ({
    block_type: 'straight',
    exercises: [
      {
        exercise_id: id,
        sets: isDeload(w) ? deloadSets(sets) : sets,
        reps,
        // Semana 3: un poco más cerca del fallo; descarga: más lejos.
        rir: isDeload(w) ? rir + 1 : w === 3 ? Math.max(1, rir - 1) : rir,
        rest_s: rest,
      },
    ],
  }))
}

function holds(w: Week, id: string, sets: number, seconds: number, rest = 60): PlanBlock {
  return {
    block_type: 'straight',
    exercises: [
      {
        exercise_id: id,
        sets: isDeload(w) ? deloadSets(sets) : sets,
        duration_s: seconds,
        rest_s: rest,
      },
    ],
  }
}

function steady(
  id: string,
  opts: { minutes?: number; distance_m?: number; note: string },
): PlanBlock {
  return {
    block_type: 'free',
    note: opts.note,
    exercises: [
      {
        exercise_id: id,
        ...(opts.minutes ? { duration_s: opts.minutes * 60 } : {}),
        ...(opts.distance_m ? { distance_m: opts.distance_m } : {}),
      },
    ],
  }
}

function intervals(
  id: string,
  sets: number,
  work: { distance_m?: number; duration_s?: number },
  rest_s: number,
  note: string,
): PlanBlock {
  return { block_type: 'intervals', note, exercises: [{ exercise_id: id, sets, ...work, rest_s }] }
}

// Duración estimada (min) de una sesión de fuerza: series × (≈ 45 s de trabajo + descanso).
function strengthMinutes(blocks: PlanBlock[]) {
  const s = blocks
    .flatMap((b) => b.exercises)
    .reduce((acc, e) => acc + (e.sets ?? 1) * (45 + (e.rest_s ?? 90)), 0)
  return Math.max(20, Math.round((s / 60 + 10) / 5) * 5)
}

function session(
  w: Week,
  day_hint: number,
  session_type: PlanSessionType,
  title: string,
  intensity: Intensity,
  blocks: PlanBlock[],
  opts: { heavy_legs?: boolean; duration_min?: number; notes?: string } = {},
): PlanSession {
  return {
    day_hint,
    session_type,
    title,
    // En la descarga no hay sesiones «duras».
    intensity: isDeload(w) && intensity === 'hard' ? 'moderate' : intensity,
    heavy_legs: Boolean(opts.heavy_legs) && !isDeload(w),
    duration_min: opts.duration_min ?? strengthMinutes(blocks),
    ...(opts.notes ? { notes: opts.notes } : {}),
    blocks,
  }
}

function template(
  family: PlanFamily,
  level: PlanLevel,
  name: string,
  description: string,
  progression_rules: string,
  weekSessions: (w: Week) => PlanSession[],
): PlanTemplate {
  const weeks = WEEKS.map((w) => ({ week: w, deload: isDeload(w), sessions: weekSessions(w) }))
  return {
    id: `${family}_${level}`,
    family,
    name,
    level,
    weeks: 4,
    days_per_week: weeks[0]!.sessions.length,
    description,
    structure: { weeks, progression_rules },
  }
}

const STRENGTH_RULES =
  'Progresión doble: cuando completes el techo del rango de repeticiones en todas las series, sube el peso (+2,5 kg en tren superior, +5 kg en tren inferior) y vuelve al suelo del rango. Semana 4 de descarga: ≈ −40 % de series y RIR más alto.'
const DELOAD = 'Semana 4 de descarga: ≈ −40 % de volumen con la misma intensidad o algo menos.'

// ── Fuerza ──────────────────────────────────────────────────

const FULL_A: Lift[] = [
  ['back_squat', 3, '8-10', 150],
  ['bench_press', 3, '8-10', 150],
  ['barbell_row', 3, '8-10', 120],
]
const FULL_B: Lift[] = [
  ['romanian_deadlift', 3, '8-10', 150],
  ['overhead_press', 3, '8-10', 120],
  ['lat_pulldown', 3, '10-12', 90],
  ['goblet_squat', 2, '10-12', 90],
]

function fullBodyA(w: Week, day: number) {
  const blocks = [...lifts(w, FULL_A), holds(w, 'plank', 3, 30)]
  return session(w, day, 'strength', 'Full body A', 'moderate', blocks, { heavy_legs: true })
}
function fullBodyB(w: Week, day: number) {
  const blocks = [...lifts(w, FULL_B), ...lifts(w, [['pallof_press', 2, '10-12', 60]])]
  return session(w, day, 'strength', 'Full body B', 'moderate', blocks, { heavy_legs: true })
}

const strengthBeginner = template(
  'strength',
  'beginner',
  'Fuerza · Full body 3 días',
  'Full body A/B tres días por semana (A-B-A y B-A-B alternando). Básicos con barra y mancuernas para aprender técnica y ganar fuerza en todo el cuerpo.',
  STRENGTH_RULES,
  (w) =>
    w % 2 === 1
      ? [fullBodyA(w, 1), fullBodyB(w, 2), fullBodyA(w, 3)]
      : [fullBodyB(w, 1), fullBodyA(w, 2), fullBodyB(w, 3)],
)

const strengthIntermediate = template(
  'strength',
  'intermediate',
  'Fuerza · Torso/pierna 4 días',
  'Rutina torso/pierna de cuatro días: dos días pesados (6-8 reps) y dos de volumen (8-12 reps).',
  STRENGTH_RULES,
  (w) => [
    session(
      w,
      1,
      'strength',
      'Pierna A (pesada)',
      'hard',
      [
        ...lifts(w, [
          ['back_squat', 4, '6-8', 180],
          ['romanian_deadlift', 3, '8-10', 150],
          ['leg_press', 3, '10-12', 120],
          ['calf_raise', 3, '12-15', 60],
        ]),
        holds(w, 'plank', 3, 40),
      ],
      { heavy_legs: true },
    ),
    session(
      w,
      2,
      'strength',
      'Torso A (pesado)',
      'hard',
      lifts(w, [
        ['bench_press', 4, '6-8', 180],
        ['barbell_row', 4, '6-8', 150],
        ['overhead_press', 3, '8-10', 120],
        ['lat_pulldown', 3, '10-12', 90],
        ['triceps_pushdown', 2, '12-15', 60],
      ]),
    ),
    session(
      w,
      3,
      'strength',
      'Pierna B (volumen)',
      'moderate',
      lifts(w, [
        ['deadlift', 3, '5-6', 180],
        ['bulgarian_split_squat', 3, '8-10', 90],
        ['hip_thrust', 3, '8-10', 120],
        ['leg_curl', 3, '10-12', 60],
        ['ab_wheel', 3, '8-12', 60],
      ]),
      { heavy_legs: true },
    ),
    session(
      w,
      4,
      'strength',
      'Torso B (volumen)',
      'moderate',
      lifts(w, [
        ['incline_db_press', 3, '8-10', 120],
        ['pull_up', 3, '6-10', 120],
        ['db_row', 3, '10-12', 90],
        ['lateral_raise', 3, '12-15', 60],
        ['face_pull', 2, '12-15', 60],
        ['biceps_curl', 2, '10-12', 60],
      ]),
    ),
  ],
)

// ── Carrera ─────────────────────────────────────────────────

const RUN_RULES =
  'Volumen semanal +≈10 % en las semanas 1–3. Rodajes y tirada larga en Z2 (puedes hablar); series a ritmo de 5K con la recuperación al trote. ' +
  DELOAD

const runningBeginner = template(
  'running',
  'beginner',
  'Carrera · Base hacia 10K (3 días)',
  'Tres días: rodaje suave, series cortas y tirada larga. Para construir base aeróbica y acercarte a correr 10K.',
  RUN_RULES,
  (w) => {
    const easy = pick(w, [30, 33, 36, 20])
    const reps = pick(w, [6, 7, 8, 4])
    const long = pick(w, [45, 50, 55, 35])
    return [
      session(
        w,
        1,
        'running',
        'Rodaje suave Z2',
        'easy',
        [steady('run', { minutes: easy, note: 'Ritmo cómodo, Z2' })],
        {
          duration_min: easy,
        },
      ),
      session(
        w,
        2,
        'running',
        `Series ${reps}×400 m`,
        'hard',
        [
          intervals(
            'run',
            reps,
            { distance_m: 400 },
            90,
            'Ritmo de 5K; 90 s de recuperación al trote',
          ),
        ],
        {
          duration_min: 20 + reps * 4,
          notes: 'Calienta 10 min suave antes y suelta 5–10 min al final.',
        },
      ),
      session(
        w,
        3,
        'running',
        'Tirada larga',
        'moderate',
        [steady('run', { minutes: long, note: 'Z2 constante' })],
        {
          duration_min: long,
        },
      ),
    ]
  },
)

const runningIntermediate = template(
  'running',
  'intermediate',
  'Carrera · 10K (4 días)',
  'Cuatro días: rodaje Z2, series (400 m → 1000 m), tempo y tirada larga.',
  RUN_RULES,
  (w) => {
    const easy = pick(w, [40, 44, 48, 30])
    const long = pick(w, [60, 66, 72, 45])
    const series = pick(w, [
      { reps: 6, dist: 400, rest: 90 },
      { reps: 8, dist: 400, rest: 90 },
      { reps: 5, dist: 1000, rest: 120 },
      { reps: 3, dist: 1000, rest: 120 },
    ] as const)
    const tempo = pick(w, [
      { reps: 2, min: 10 },
      { reps: 2, min: 12 },
      { reps: 3, min: 9 },
      { reps: 2, min: 8 },
    ] as const)
    return [
      session(
        w,
        1,
        'running',
        'Rodaje suave Z2',
        'easy',
        [steady('run', { minutes: easy, note: 'Z2' })],
        {
          duration_min: easy,
        },
      ),
      session(
        w,
        2,
        'running',
        `Series ${series.reps}×${series.dist} m`,
        'hard',
        [
          intervals(
            'run',
            series.reps,
            { distance_m: series.dist },
            series.rest,
            `Ritmo de 5K; ${series.rest} s de recuperación al trote`,
          ),
        ],
        {
          duration_min:
            20 +
            Math.round(series.reps * (series.dist / 1000) * 4.5 + (series.reps * series.rest) / 60),
          notes: 'Calienta 10 min suave antes y suelta 5–10 min al final.',
        },
      ),
      session(
        w,
        3,
        'running',
        `Tempo ${tempo.reps}×${tempo.min} min`,
        'hard',
        [
          intervals(
            'run',
            tempo.reps,
            { duration_s: tempo.min * 60 },
            120,
            'Ritmo de 10K a media maratón (Z3–Z4)',
          ),
        ],
        { duration_min: 20 + tempo.reps * (tempo.min + 2), notes: 'Calienta 10 min suave antes.' },
      ),
      session(
        w,
        4,
        'running',
        'Tirada larga',
        'moderate',
        [steady('run', { minutes: long, note: 'Z2 constante' })],
        {
          duration_min: long,
        },
      ),
    ]
  },
)

// ── Natación ────────────────────────────────────────────────

const SWIM_RULES =
  'Todo en metros. Semanas 1–3: más repeticiones o metros continuos; nada las series a un ritmo que puedas mantener igual en todas. ' +
  DELOAD

function swimTechnique(w: Week, drills: number, continuous: number, rest = 20) {
  return session(
    w,
    1,
    'swimming',
    'Técnica + aeróbico',
    'moderate',
    [
      intervals(
        'swim_drills',
        drills,
        { distance_m: 50 },
        rest,
        'Ejercicios de técnica (brazada, patada, respiración)',
      ),
      steady('swim_freestyle', { distance_m: continuous, note: 'Crol continuo, ritmo cómodo' }),
    ],
    { duration_min: Math.round(10 + (drills * 50 + continuous) / 40) },
  )
}

function swimSeries(w: Week, reps: number, dist: number, rest: number) {
  return session(
    w,
    2,
    'swimming',
    `Series ${reps}×${dist} m`,
    'hard',
    [
      intervals(
        'swim_freestyle',
        reps,
        { distance_m: dist },
        rest,
        `Crol; ${rest} s de descanso entre series`,
      ),
    ],
    { duration_min: Math.round(15 + (reps * dist) / 45 + (reps * rest) / 60) },
  )
}

function swimEndurance(w: Week, distance: number) {
  return session(
    w,
    3,
    'swimming',
    'Resistencia continua',
    'moderate',
    [steady('swim_freestyle', { distance_m: distance, note: 'Sin parar, ritmo constante' })],
    { duration_min: Math.round(10 + distance / 40) },
  )
}

const swimmingBeginner = template(
  'swimming',
  'beginner',
  'Natación · Base 3 días',
  'Tres días en piscina: técnica y aeróbico, series de 100 m y resistencia continua.',
  SWIM_RULES,
  (w) => [
    swimTechnique(w, pick(w, [4, 6, 6, 4]), pick(w, [400, 450, 500, 300])),
    swimSeries(w, pick(w, [8, 9, 10, 5]), 100, 20),
    swimEndurance(w, pick(w, [800, 900, 1000, 600])),
  ],
)

const swimmingIntermediate = template(
  'swimming',
  'intermediate',
  'Natación · Resistencia 3 días',
  'Tres días con más metros: técnica, series de 100–200 m y un continuo largo.',
  SWIM_RULES,
  (w) => {
    const series = pick(w, [
      { reps: 10, dist: 100, rest: 15 },
      { reps: 12, dist: 100, rest: 15 },
      { reps: 6, dist: 200, rest: 20 },
      { reps: 6, dist: 100, rest: 20 },
    ] as const)
    return [
      swimTechnique(w, pick(w, [8, 8, 10, 5]), pick(w, [800, 900, 1000, 600]), 15),
      swimSeries(w, series.reps, series.dist, series.rest),
      swimEndurance(w, pick(w, [1500, 1650, 1800, 1000])),
    ]
  },
)

// ── HYROX ───────────────────────────────────────────────────

const station = (id: string) => HYROX_STATIONS.find((s) => s.exercise_id === id)!

// Una fracción de la estación de competición (distancia o reps).
function hyroxPart(s: HyroxStation, fraction: number): PlanExercise {
  return {
    exercise_id: s.exercise_id,
    ...(s.distance_m ? { distance_m: Math.round((s.distance_m * fraction) / 5) * 5 } : {}),
    ...(s.reps ? { reps: String(Math.round(s.reps * fraction)) } : {}),
    ...(s.standard ? { standard: s.standard } : {}),
  }
}

const HYROX_PAIRS: [string, string][] = [
  ['skierg', 'sled_push'],
  ['row_erg', 'farmers_carry'],
  ['burpee_broad_jump', 'wall_ball'],
  ['sled_pull', 'sandbag_lunge'],
]

function hyrox(level: PlanLevel) {
  const beg = level === 'beginner'
  const race = `${HYROX_STATIONS.length} × (${HYROX_RUN_M / 1000} km de carrera + estación): ${HYROX_STATIONS.map((s) => s.label).join(', ')}`
  return template(
    'hyrox',
    level,
    beg ? 'HYROX · Iniciación 4 días' : 'HYROX · Rendimiento 4 días',
    `Cuatro días: fuerza específica, carrera, compromised running (carrera + estación) y técnica de estaciones. Formato de competición: ${race}. Pesos de la categoría Open según tu sexo (perfil).`,
    'Semanas 1–3: más rondas y series; la parte de carrera sube ≈10 %. Usa pesos de entreno que te dejen moverte con buena técnica y ve acercándote a los de tu categoría. ' +
      DELOAD,
    (w) => {
      const pair = HYROX_PAIRS[w - 1]!
      const rounds = beg ? pick(w, [3, 3, 4, 2]) : pick(w, [4, 5, 6, 3])
      const runM = beg ? HYROX_RUN_M / 2 : HYROX_RUN_M
      const runReps = beg ? pick(w, [4, 5, 6, 3]) : pick(w, [5, 6, 7, 4])
      const emom = beg ? pick(w, [12, 14, 16, 10]) : pick(w, [16, 18, 20, 12])
      return [
        session(
          w,
          1,
          'functional',
          'Fuerza específica',
          'hard',
          [
            ...lifts(w, [['back_squat', 3, beg ? '8-10' : '6-8', 150]]),
            {
              block_type: 'straight',
              exercises: [
                { ...hyroxPart(station('sled_push'), 0.5), sets: isDeload(w) ? 2 : 4, rest_s: 90 },
              ],
            },
            {
              block_type: 'straight',
              exercises: [
                { ...hyroxPart(station('sled_pull'), 0.5), sets: isDeload(w) ? 2 : 4, rest_s: 90 },
              ],
            },
            {
              block_type: 'straight',
              exercises: [
                {
                  ...hyroxPart(station('wall_ball'), beg ? 0.15 : 0.2),
                  sets: isDeload(w) ? 2 : 3,
                  rest_s: 60,
                },
              ],
            },
            {
              block_type: 'straight',
              exercises: [
                {
                  ...hyroxPart(station('sandbag_lunge'), 0.25),
                  sets: isDeload(w) ? 2 : 3,
                  rest_s: 90,
                },
              ],
            },
          ],
          { heavy_legs: true },
        ),
        session(
          w,
          2,
          'running',
          `Carrera ${runReps}×1 km`,
          'hard',
          [
            intervals(
              'run',
              runReps,
              { distance_m: 1000 },
              beg ? 120 : 90,
              'Ritmo objetivo de carrera en HYROX',
            ),
          ],
          { duration_min: 20 + runReps * 7, notes: 'Calienta 10 min suave antes.' },
        ),
        session(
          w,
          3,
          'functional',
          'Compromised running',
          'hard',
          [
            {
              block_type: 'circuit',
              rounds,
              rest_s: 120,
              note: 'Carrera + dos estaciones por ronda, sin pausa entre ellas',
              exercises: [
                { exercise_id: 'run', distance_m: runM },
                hyroxPart(station(pair[0]), 0.5),
                hyroxPart(station(pair[1]), 0.5),
              ],
            },
          ],
          { duration_min: 15 + rounds * (beg ? 8 : 11) },
        ),
        session(
          w,
          4,
          'functional',
          'Técnica de estaciones (EMOM)',
          'moderate',
          [
            {
              block_type: 'emom',
              minutes: emom,
              note: 'Rotación: un ejercicio por minuto; técnica limpia antes que velocidad',
              exercises: [
                { exercise_id: 'skierg', distance_m: 150 },
                { exercise_id: 'burpee_broad_jump', distance_m: 10 },
                {
                  exercise_id: 'farmers_carry',
                  distance_m: 50,
                  standard: station('farmers_carry').standard,
                },
                {
                  exercise_id: 'wall_ball',
                  reps: beg ? '10' : '15',
                  standard: station('wall_ball').standard,
                },
              ],
            },
          ],
          { duration_min: emom + 15 },
        ),
      ]
    },
  )
}

// ── DEKA FIT ────────────────────────────────────────────────

const zone = (id: string) => DEKA_ZONES.find((z) => z.exercise_id === id)!

function dekaPart(z: DekaZone, fraction: number): PlanExercise {
  return {
    exercise_id: z.exercise_id,
    ...(z.distance_m ? { distance_m: Math.round((z.distance_m * fraction) / 5) * 5 } : {}),
    ...(z.reps ? { reps: String(Math.max(1, Math.round(z.reps * fraction))) } : {}),
    ...(z.calories ? { calories: Math.max(1, Math.round(z.calories * fraction)) } : {}),
    ...(z.standard ? { standard: z.standard } : {}),
    ...(z.note ? { note: z.note } : {}),
  }
}

function deka(level: PlanLevel) {
  const beg = level === 'beginner'
  // Cada semana, un bloque de zonas distinto (las 10 zonas en 3 semanas + repaso en la descarga).
  const groups: string[][] = [
    DEKA_ZONES.slice(0, 4).map((z) => z.exercise_id),
    DEKA_ZONES.slice(4, 7).map((z) => z.exercise_id),
    DEKA_ZONES.slice(7, 10).map((z) => z.exercise_id),
    [DEKA_ZONES[1]!.exercise_id, DEKA_ZONES[6]!.exercise_id],
  ]
  return template(
    'deka',
    level,
    beg ? 'DEKA FIT · Iniciación 4 días' : 'DEKA FIT · Rendimiento 4 días',
    `Cuatro días: fuerza específica, carrera de 500 m, zonas encadenadas con carrera y técnica de zonas. Formato: ${DEKA_ZONES.length} zonas con ${DEKA_RUN_M} m de carrera entre ellas (${DEKA_ZONES.map((z) => z.label).join(', ')}). Pesos de competición según tu sexo (perfil).`,
    'Semanas 1–3: más rondas y series; acorta descansos cuando la técnica sea sólida. ' + DELOAD,
    (w) => {
      const rounds = beg ? pick(w, [3, 3, 4, 2]) : pick(w, [4, 5, 5, 3])
      const runReps = beg ? pick(w, [6, 7, 8, 4]) : pick(w, [8, 10, 12, 6])
      const amrap = beg ? pick(w, [12, 14, 16, 10]) : pick(w, [16, 18, 20, 12])
      const fraction = beg ? 0.4 : 0.5
      return [
        session(
          w,
          1,
          'functional',
          'Fuerza específica',
          'hard',
          [
            {
              block_type: 'straight',
              exercises: [
                {
                  ...dekaPart(zone('ram_reverse_lunge'), 0.4),
                  sets: isDeload(w) ? 2 : 3,
                  rest_s: 90,
                },
              ],
            },
            {
              block_type: 'straight',
              exercises: [
                {
                  ...dekaPart(zone('tank_push_pull'), 0.25),
                  sets: isDeload(w) ? 2 : 4,
                  rest_s: 90,
                },
              ],
            },
            {
              block_type: 'straight',
              exercises: [
                { ...dekaPart(zone('dead_ball_over'), 0.5), sets: isDeload(w) ? 2 : 3, rest_s: 90 },
              ],
            },
            {
              block_type: 'straight',
              exercises: [
                { ...dekaPart(zone('box_jump_over'), 0.5), sets: isDeload(w) ? 2 : 3, rest_s: 60 },
              ],
            },
            ...lifts(w, [['romanian_deadlift', 3, '8-10', 120]]),
          ],
          { heavy_legs: true },
        ),
        session(
          w,
          2,
          'running',
          `Carrera ${runReps}×500 m`,
          'hard',
          [
            intervals(
              'run',
              runReps,
              { distance_m: DEKA_RUN_M },
              beg ? 90 : 75,
              'Ritmo objetivo de carrera en DEKA',
            ),
          ],
          { duration_min: 20 + runReps * 4, notes: 'Calienta 10 min suave antes.' },
        ),
        session(
          w,
          3,
          'functional',
          'Zonas encadenadas',
          'hard',
          [
            {
              block_type: 'circuit',
              rounds,
              rest_s: 120,
              // Cada ejercicio aparece una vez por ronda: la carrera se reparte antes de cada zona.
              note: `Corre ${beg ? DEKA_RUN_M / 2 : DEKA_RUN_M} m antes de cada zona, sin pausa`,
              exercises: [
                {
                  exercise_id: 'run',
                  distance_m: (beg ? DEKA_RUN_M / 2 : DEKA_RUN_M) * groups[w - 1]!.length,
                  note: `En tramos de ${beg ? DEKA_RUN_M / 2 : DEKA_RUN_M} m, uno antes de cada zona`,
                },
                ...groups[w - 1]!.map((id) => dekaPart(zone(id), fraction)),
              ],
            },
          ],
          { duration_min: 15 + rounds * groups[w - 1]!.length * (beg ? 3 : 4) },
        ),
        session(
          w,
          4,
          'functional',
          'Técnica de zonas (AMRAP)',
          'moderate',
          [
            {
              block_type: 'amrap',
              minutes: amrap,
              note: 'Tantas rondas como puedas con buena técnica',
              exercises: [
                { exercise_id: 'med_ball_situp_throw', reps: beg ? '8' : '10' },
                { exercise_id: 'skierg', distance_m: 150 },
                { exercise_id: 'air_bike', calories: beg ? 6 : 8 },
                { exercise_id: 'ram_burpee', reps: beg ? '4' : '6' },
                { exercise_id: 'farmers_carry', distance_m: 40 },
              ],
            },
          ],
          { duration_min: amrap + 15 },
        ),
      ]
    },
  )
}

// ── Híbrido ─────────────────────────────────────────────────

const hybridBeginner = template(
  'hybrid',
  'beginner',
  'Híbrido · 4 días',
  'Dos días de fuerza, uno de functional (EMOM) y uno de carrera. Variado y equilibrado para ganar fuerza y forma a la vez.',
  STRENGTH_RULES + ' Carrera: +≈10 % de minutos por semana.',
  (w) => {
    const run = pick(w, [25, 28, 30, 20])
    const emom = pick(w, [12, 14, 16, 10])
    return [
      fullBodyA(w, 1),
      session(
        w,
        2,
        'running',
        'Rodaje suave',
        'easy',
        [steady('run', { minutes: run, note: 'Z2, ritmo cómodo' })],
        {
          duration_min: run,
        },
      ),
      session(
        w,
        3,
        'functional',
        `EMOM ${emom} min`,
        'hard',
        [
          {
            block_type: 'emom',
            minutes: emom,
            note: 'Un ejercicio por minuto, en rotación',
            exercises: [
              { exercise_id: 'kettlebell_swing', reps: '12' },
              { exercise_id: 'burpee', reps: '8' },
              { exercise_id: 'goblet_squat', reps: '10' },
              { exercise_id: 'row_erg', calories: 10 },
            ],
          },
        ],
        { duration_min: emom + 15 },
      ),
      fullBodyB(w, 4),
    ]
  },
)

const hybridIntermediate = template(
  'hybrid',
  'intermediate',
  'Híbrido · 5 días',
  'Dos días de fuerza, uno de functional (AMRAP), uno de carrera con series y uno de natación (o spinning si no tienes piscina).',
  STRENGTH_RULES + ' Carrera y natación: +≈10 % de volumen por semana.',
  (w) => {
    const series = pick(w, [5, 6, 7, 4])
    const amrap = pick(w, [16, 18, 20, 12])
    const swim = pick(w, [1000, 1200, 1400, 800])
    return [
      session(
        w,
        1,
        'strength',
        'Fuerza A',
        'hard',
        [
          ...lifts(w, [
            ['back_squat', 4, '6-8', 180],
            ['bench_press', 4, '6-8', 180],
            ['barbell_row', 3, '8-10', 120],
          ]),
          holds(w, 'plank', 3, 40),
        ],
        { heavy_legs: true },
      ),
      session(
        w,
        2,
        'running',
        `Series ${series}×800 m`,
        'hard',
        [intervals('run', series, { distance_m: 800 }, 90, 'Ritmo de 5–10K; 90 s al trote')],
        { duration_min: 20 + series * 5, notes: 'Calienta 10 min suave antes.' },
      ),
      session(
        w,
        3,
        'functional',
        `AMRAP ${amrap} min`,
        'hard',
        [
          {
            block_type: 'amrap',
            minutes: amrap,
            note: 'Tantas rondas como puedas',
            exercises: [
              { exercise_id: 'thruster', reps: '10' },
              { exercise_id: 'pull_up', reps: '6' },
              { exercise_id: 'box_jump', reps: '10' },
              { exercise_id: 'row_erg', distance_m: 250 },
            ],
          },
        ],
        { duration_min: amrap + 15 },
      ),
      session(
        w,
        4,
        'strength',
        'Fuerza B',
        'moderate',
        lifts(w, [
          ['deadlift', 3, '5-6', 180],
          ['overhead_press', 3, '6-8', 150],
          ['pull_up', 3, '6-10', 120],
          ['bulgarian_split_squat', 3, '8-10', 90],
        ]),
        { heavy_legs: true },
      ),
      session(
        w,
        5,
        'swimming',
        'Natación aeróbica',
        'easy',
        [
          intervals('swim_drills', 4, { distance_m: 50 }, 20, 'Técnica'),
          steady('swim_freestyle', { distance_m: swim, note: 'Crol continuo, ritmo cómodo' }),
        ],
        {
          duration_min: Math.round(15 + swim / 40),
          notes: 'Sin piscina: cámbiala por 40 min de spinning suave.',
        },
      ),
    ]
  },
)

export function buildPlanTemplates(): PlanTemplate[] {
  return [
    runningBeginner,
    runningIntermediate,
    swimmingBeginner,
    swimmingIntermediate,
    strengthBeginner,
    strengthIntermediate,
    hyrox('beginner'),
    hyrox('intermediate'),
    deka('beginner'),
    deka('intermediate'),
    hybridBeginner,
    hybridIntermediate,
  ]
}
