// Formato de competición de HYROX (categoría Open) y DEKA FIT, verificado por el propietario
// (septiembre de 2026) salvo lo marcado con «verificar».
//
// Las plantillas (scripts/plan-templates.ts) toman de aquí TODOS los datos de competición;
// si cambias algo, ejecuta `npm run seed:sql`: regenera la migración de plantillas vigente
// (0022_…) y el JSON de semilla. Los pesos van por sexo (profiles.sex) en `standard`.
//
// Sin imports con alias: este archivo lo usa también el script de semillas (Node).

// Estándar de competición por sexo (texto listo para mostrar).
export type SexStandard = { men: string; women: string }

// ── HYROX (Open) ─────────────────────────────────────────────
// 8 × (1 km de carrera + 1 estación), en este orden.
export const HYROX_RUN_M = 1000

export type HyroxStation = {
  exercise_id: string
  label: string
  // Distancia (m) o repeticiones de la estación en competición (reps: las de hombre; las
  // plantillas escalan a partir de ellas).
  distance_m?: number
  reps?: number
  standard?: SexStandard
}

export const HYROX_STATIONS: HyroxStation[] = [
  { exercise_id: 'skierg', label: 'SkiErg', distance_m: 1000 },
  {
    exercise_id: 'sled_push',
    label: 'Sled push',
    distance_m: 50,
    standard: { men: '152 kg (con el trineo)', women: '102 kg (con el trineo)' },
  },
  {
    exercise_id: 'sled_pull',
    label: 'Sled pull',
    distance_m: 50,
    standard: { men: '103 kg (con el trineo)', women: '78 kg (con el trineo)' },
  },
  { exercise_id: 'burpee_broad_jump', label: 'Burpee broad jumps', distance_m: 80 },
  { exercise_id: 'row_erg', label: 'Remo', distance_m: 1000 },
  {
    exercise_id: 'farmers_carry',
    label: 'Farmers carry',
    distance_m: 200,
    standard: { men: '2 × 24 kg', women: '2 × 16 kg' },
  },
  {
    exercise_id: 'sandbag_lunge',
    label: 'Sandbag lunges',
    distance_m: 100,
    standard: { men: '20 kg', women: '10 kg' },
  },
  {
    exercise_id: 'wall_ball',
    label: 'Wall balls',
    reps: 100,
    // 75 reps de mujer: verificar en hyrox.com, cambio de la temporada 2025/26.
    standard: { men: '100 × 6 kg a 3,0 m', women: '75 × 4 kg a 2,7 m' },
  },
]

// ── DEKA FIT ─────────────────────────────────────────────────
// 10 zonas con 500 m de carrera antes de cada una.
export const DEKA_RUN_M = 500

export type DekaZone = {
  exercise_id: string
  label: string
  distance_m?: number
  reps?: number
  calories?: number
  standard?: SexStandard
  // Material igual para todos (p. ej. la altura del cajón).
  note?: string
}

export const DEKA_ZONES: DekaZone[] = [
  {
    exercise_id: 'ram_reverse_lunge',
    label: 'Zancadas inversas con RAM',
    reps: 30,
    standard: { men: '25 kg', women: '15 kg' },
  },
  { exercise_id: 'row_erg', label: 'Remo', distance_m: 500 },
  {
    exercise_id: 'box_jump_over',
    label: 'Box jump / step over',
    reps: 20,
    note: 'Cajón de 24″ (61 cm)',
  },
  {
    exercise_id: 'med_ball_situp_throw',
    label: 'Med ball sit-up throws',
    reps: 25,
    standard: { men: '9 kg', women: '6,5 kg' },
  },
  { exercise_id: 'skierg', label: 'SkiErg', distance_m: 500 },
  {
    exercise_id: 'farmers_carry',
    label: 'Farmers carry',
    distance_m: 100,
    standard: { men: '27 kg por mano', women: '18 kg por mano' },
  },
  { exercise_id: 'air_bike', label: 'Air bike', calories: 25 },
  {
    exercise_id: 'dead_ball_over',
    label: 'Dead ball overs',
    reps: 20,
    standard: { men: '27,5 kg', women: '17,5 kg' },
  },
  {
    exercise_id: 'tank_push_pull',
    label: 'Tank push/pull',
    distance_m: 100,
    standard: { men: 'resistencia 8 (Xebex)', women: 'resistencia 7 (Xebex)' },
  },
  {
    exercise_id: 'ram_burpee',
    label: 'Burpees con RAM',
    reps: 20,
    standard: { men: '20 kg', women: '10 kg' },
  },
]
