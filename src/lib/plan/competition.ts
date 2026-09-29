// ⚠️ PENDIENTE DE VERIFICAR con el reglamento oficial vigente (CLAUDE.md §9).
//
// Formato de competición de HYROX y DEKA FIT tal y como se conoce comúnmente (temporadas
// 2023–2025). No se ha podido consultar el reglamento oficial desde el entorno de desarrollo:
// revisar cada distancia, repetición y peso antes de usarlo como referencia de competición.
// Las plantillas (scripts/plan-templates.ts) toman de aquí TODOS los datos de competición;
// si cambias algo, ejecuta `npm run seed:sql` y aplica de nuevo las migraciones de plantillas.
//
// Sin imports con alias: este archivo lo usa también el script de semillas (Node).

// ── HYROX ────────────────────────────────────────────────────
// 8 × (1 km de carrera + 1 estación), en este orden.
export const HYROX_RUN_M = 1000 // PENDIENTE DE VERIFICAR

export type HyroxStation = {
  exercise_id: string
  label: string
  // Distancia (m), repeticiones o calorías de la estación en competición.
  distance_m?: number
  reps?: number
  // Pesos por categoría (kg). PENDIENTE DE VERIFICAR.
  weights?: {
    open_women: string
    open_men: string
    pro_women: string
    pro_men: string
  }
}

export const HYROX_STATIONS: HyroxStation[] = [
  { exercise_id: 'skierg', label: 'SkiErg', distance_m: 1000 }, // PENDIENTE DE VERIFICAR
  {
    exercise_id: 'sled_push',
    label: 'Sled push',
    distance_m: 50, // 4 × 12,5 m. PENDIENTE DE VERIFICAR
    // Peso total con el trineo. PENDIENTE DE VERIFICAR
    weights: { open_women: '102 kg', open_men: '152 kg', pro_women: '152 kg', pro_men: '202 kg' },
  },
  {
    exercise_id: 'sled_pull',
    label: 'Sled pull',
    distance_m: 50, // 4 × 12,5 m. PENDIENTE DE VERIFICAR
    weights: { open_women: '78 kg', open_men: '103 kg', pro_women: '103 kg', pro_men: '153 kg' },
  },
  { exercise_id: 'burpee_broad_jump', label: 'Burpee broad jumps', distance_m: 80 }, // PENDIENTE DE VERIFICAR
  { exercise_id: 'row_erg', label: 'Remo', distance_m: 1000 }, // PENDIENTE DE VERIFICAR
  {
    exercise_id: 'farmers_carry',
    label: 'Farmers carry',
    distance_m: 200, // PENDIENTE DE VERIFICAR
    weights: {
      open_women: '2 × 16 kg',
      open_men: '2 × 24 kg',
      pro_women: '2 × 24 kg',
      pro_men: '2 × 32 kg',
    },
  },
  {
    exercise_id: 'sandbag_lunge',
    label: 'Sandbag lunges',
    distance_m: 100, // PENDIENTE DE VERIFICAR
    weights: { open_women: '10 kg', open_men: '20 kg', pro_women: '20 kg', pro_men: '30 kg' },
  },
  {
    exercise_id: 'wall_ball',
    label: 'Wall balls',
    reps: 100, // PENDIENTE DE VERIFICAR
    // Balón; altura del objetivo: 2,70 m mujeres / 3 m hombres. PENDIENTE DE VERIFICAR
    weights: { open_women: '4 kg', open_men: '6 kg', pro_women: '6 kg', pro_men: '9 kg' },
  },
]

// ── DEKA FIT ─────────────────────────────────────────────────
// 10 zonas con 500 m de carrera antes de cada una. PENDIENTE DE VERIFICAR
export const DEKA_RUN_M = 500 // PENDIENTE DE VERIFICAR

export type DekaZone = {
  exercise_id: string
  label: string
  distance_m?: number
  reps?: number
  calories?: number
  // Pesos por categoría (kg). PENDIENTE DE VERIFICAR.
  weights?: { women: string; men: string }
}

export const DEKA_ZONES: DekaZone[] = [
  {
    exercise_id: 'ram_reverse_lunge',
    label: 'Zancadas inversas con RAM',
    reps: 30, // PENDIENTE DE VERIFICAR
    weights: { women: '10 kg', men: '15 kg' }, // PENDIENTE DE VERIFICAR
  },
  { exercise_id: 'row_erg', label: 'Remo', distance_m: 500 }, // PENDIENTE DE VERIFICAR
  { exercise_id: 'box_jump_over', label: 'Box jump overs', reps: 20 }, // PENDIENTE DE VERIFICAR
  {
    exercise_id: 'med_ball_situp_throw',
    label: 'Med ball sit-up throws',
    reps: 25, // PENDIENTE DE VERIFICAR
    weights: { women: '4 kg', men: '6 kg' }, // PENDIENTE DE VERIFICAR
  },
  { exercise_id: 'skierg', label: 'SkiErg', distance_m: 500 }, // PENDIENTE DE VERIFICAR
  {
    exercise_id: 'farmers_carry',
    label: 'Farmers carry',
    distance_m: 100, // PENDIENTE DE VERIFICAR
    weights: { women: '2 × 20 kg', men: '2 × 27 kg' }, // PENDIENTE DE VERIFICAR
  },
  { exercise_id: 'air_bike', label: 'Air bike', calories: 25 }, // PENDIENTE DE VERIFICAR
  {
    exercise_id: 'dead_ball_over',
    label: 'Dead ball overs',
    reps: 20, // PENDIENTE DE VERIFICAR
    weights: { women: '20 kg', men: '27 kg' }, // PENDIENTE DE VERIFICAR
  },
  {
    exercise_id: 'tank_push_pull',
    label: 'Tank push/pull',
    distance_m: 100, // 4 × 25 m alternando empuje y arrastre. PENDIENTE DE VERIFICAR
    weights: { women: '~70 kg', men: '~90 kg' }, // PENDIENTE DE VERIFICAR
  },
  {
    exercise_id: 'ram_burpee',
    label: 'Burpees con RAM',
    reps: 20, // PENDIENTE DE VERIFICAR
    weights: { women: '10 kg', men: '15 kg' }, // PENDIENTE DE VERIFICAR
  },
]

// Texto corto de pesos para las notas de las plantillas.
export function hyroxWeightNote(station: HyroxStation) {
  const w = station.weights
  if (!w) return undefined
  return `Competición (pendiente de verificar): Open M ${w.open_women} · Open H ${w.open_men} · Pro M ${w.pro_women} · Pro H ${w.pro_men}`
}

export function dekaWeightNote(zone: DekaZone) {
  const w = zone.weights
  if (!w) return undefined
  return `Competición (pendiente de verificar): M ${w.women} · H ${w.men}`
}
