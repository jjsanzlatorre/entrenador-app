# CLAUDE.md — App Entrenador Personal

## 0. Cómo trabajar con este documento

- Construye **fase a fase** (sección 12). No empieces una fase sin cerrar la anterior.
- Al terminar cada fase: actualiza la sección **13. Estado**, lista lo pendiente y los atajos tomados.
- Si algo de esta especificación es ambiguo o choca con una limitación técnica, **pregunta antes de improvisar**.
- Idioma de la UI: **español (España)**. Código, nombres de tablas y commits: inglés.
- Unidades: kg, cm, metros, km, min/km, min/100 m.

---

## Entorno de trabajo (restricciones del propietario)

- **Sin terminal local ni instalaciones.** Se trabaja solo con Claude Code en la nube, GitHub, Supabase (web) y Vercel (web). Todo lo que requiera ejecutar comandos lo hace Claude Code en su contenedor antes de hacer push.
- **Sin CLI de Supabase.** Migraciones en `supabase/migrations/` con nombres numerados (`0001_…`, `0002_…`). Se aplican pegándolas en el **SQL Editor** de Supabase, en orden.
  - Al final de cada tarea: indicar **exactamente qué archivos SQL pegar y en qué orden**.
  - Migraciones y semillas **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `ON CONFLICT DO NOTHING`). Deben poder ejecutarse dos veces sin error.
  - SQL de un solo uso que no es migración (p. ej. nombrar admin) va en `supabase/snippets/`.
- **Tipos de Supabase escritos a mano** en `src/types/database.ts` (mismo formato que `supabase gen types`). Mantenerlos sincronizados con cada migración en el mismo commit.
- **Solo planes gratuitos**: Supabase Free y Vercel Hobby. Nada que requiera pago (ni cron de pago, ni Edge Config, ni add-ons).
- **Variables de entorno** (nombres exactos en `.env.example`):
  - Públicas, con prefijo `VITE_`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  - Solo servidor, sin prefijo: `SUPABASE_SERVICE_ROLE_KEY` y, desde la Fase 6, las de IA: `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_DAILY_LIMIT` (todas opcionales: sin clave la app funciona sin IA). Desde la Fase 7B, las de push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `CRON_SECRET` (opcionales: sin claves no hay notificaciones).
  - Al añadir una variable nueva: actualizar `.env.example` y decir cuáles configurar en Vercel.
- **Vercel sin configuración extra**: el build (`npm run build`) usa Nitro, que detecta Vercel y genera `.vercel/output` (Build Output API). Preset «TanStack Start» (o «Other»), comando de build por defecto, sin directorio de salida personalizado.
- Antes de cada push: `npm run typecheck`, `npm run lint`, `npm test` y `npm run build` deben pasar.

---

## 1. Visión

App web móvil (PWA) de entrenamiento personal para un grupo privado (inicialmente 2 usuarios: el admin y su pareja; ampliable por invitación).

Funciones núcleo:
1. Registrar entrenos rápido desde el móvil en el gimnasio (fuerza, functional, carrera, natación, spinning, yoga, deportes libres).
2. Temporizadores integrados según el tipo de bloque.
3. Ver qué músculos se trabajan en un **mapa corporal**.
4. Seguir el progreso: marcas personales, gráficas, peso, medidas y fotos.
5. **Entrenador con IA**: onboarding, planes de 4 semanas a partir de plantillas, ajuste diario y revisión semanal.
6. **Cumplimiento**: barras semanales y mensuales de lo hecho frente a lo que el usuario se comprometió, visibles también para la pareja o amigos vinculados.
7. **Acumulados y equivalencias motivadoras**: «has nadado la distancia de Barcelona a Mallorca», «has levantado un tractor».

### Principios de producto
- **Sencillo pero útil.** Registrar una serie debe costar ≤ 2 toques.
- **Mobile-first.** Botones grandes, uso con una mano, texto legible con sudor y prisa.
- **La IA propone, el usuario decide.** Nada se aplica sin confirmación.
- **Privado por defecto.** Cada usuario solo ve sus datos salvo que comparta explícitamente.

---

## 2. Stack

| Capa | Elección |
|---|---|
| Framework | TanStack Start (React + TypeScript strict) |
| UI | Tailwind CSS + shadcn/ui, iconos lucide-react |
| Gráficas | Recharts |
| Estado servidor | TanStack Query |
| Validación | Zod (formularios, API y respuestas de IA) |
| Backend | Supabase: Postgres, Auth, Storage, RLS |
| IA | Proveedor configurable desde servidor con `AI_PROVIDER` = `gemini` (por defecto, plan gratuito: `GEMINI_API_KEY`, modelo en `GEMINI_MODEL`, por defecto `gemini-2.5-flash`, y modelo de reserva opcional en `GEMINI_FALLBACK_MODEL` para 429 / cuota agotada) o `anthropic` (`ANTHROPIC_API_KEY`, modelo en `AI_MODEL`, por defecto `claude-sonnet-5`). Una interfaz interna única (`generateStructured`) con un adaptador por proveedor |
| Deploy | Vercel |
| PWA | manifest + service worker (instalable, icono, pantalla completa) |

### Reglas técnicas
- Migraciones SQL versionadas en `supabase/migrations`. Nunca cambios manuales en producción.
- Tipos de Supabase escritos a mano en `src/types/database.ts` (ver «Entorno de trabajo»).
- **RLS activado en todas las tablas.** Sin excepción.
- Ninguna clave secreta en el cliente. Las llamadas a IA pasan siempre por funciones de servidor.
- Datos semilla (músculos, ejercicios, plantillas) en `supabase/seed/*.json` y cargados con un script idempotente.
- Tests: Vitest para la lógica de cálculo (1RM, volumen, carga, progresión); Playwright para el flujo de registrar una sesión.

---

## 3. Autenticación y acceso

- **Registro público desactivado** en Supabase.
- Acceso solo por invitación: el admin invita por email desde `/admin/invitaciones` (`auth.admin.inviteUserByEmail`, en servidor).
- Login con magic link y, opcionalmente, contraseña.
- `profiles.role`: `admin` | `member`. Solo `admin` ve el panel de invitaciones.
- Revocar acceso: el admin puede desactivar a un usuario (`profiles.active = false` + bloqueo en middleware).

---

## 4. Modelo de datos

Todas las tablas de usuario llevan `user_id uuid references auth.users` y una política RLS `user_id = auth.uid()`. Las tablas globales (músculos, ejercicios globales, plantillas) son de solo lectura para los usuarios autenticados.

### Perfil
- **profiles**: `id` (= auth uid), `display_name`, `role`, `active`, `sex` (opcional), `birth_year`, `height_cm`, `home_city`, `home_lat`, `home_lng` (ciudad de referencia para las equivalencias de distancia; la elige el usuario, no se usa la geolocalización), `show_equivalence_popups` bool (por defecto `true`), `created_at`
- **commitments**: `id`, `user_id`, `valid_from` date, `valid_to` date nullable, `sessions_per_week` int, `minutes_per_week` int nullable, `by_type` jsonb nullable (p. ej. `{"strength": 2, "swimming": 1}`), `counts_free_activities` bool (si surf, frontón o yoga cuentan para el objetivo; por defecto `true`). Guarda el **historial**: cambiar el compromiso cierra el anterior (`valid_to`) y crea uno nuevo, para que las semanas pasadas se midan con lo que se prometió entonces.
- **training_profiles**: `user_id` (pk), `goals` jsonb, `level` (`beginner|intermediate|advanced`), `availability` jsonb (días/semana, minutos por sesión, días preferidos), `equipment` text[], `limitations` text (lesiones o molestias, texto libre), `fixed_activities` jsonb (p. ej. surf o frontón con su frecuencia), `benchmarks` jsonb (1RM aproximados, ritmo 5K, 100 m nado…), `updated_at`

### Catálogo
- **muscles**: `id` text pk, `name`, `view` (`front|back|both`), `group` (`upper|core|lower`)
- **exercises**: `id`, `name`, `aliases` text[], `category` (`strength|functional|cardio|mobility|sport`), `tracking_type` (`weight_reps|reps|time|distance_time|calories|duration_only`), `equipment` text[], `is_unilateral` bool, `is_compound` bool, `default_rest_s`, `technique_notes` (resumen libre), `technique_steps` text[] y `technique_mistakes` text[] (fase 6C: pasos clave y errores típicos), `owner_id` (null = global; si no, ejercicio propio del usuario)
- **exercise_muscles**: `exercise_id`, `muscle_id`, `role` (`primary|secondary`)

### Planes
- **plan_templates**: `id`, `family` (`running|swimming|strength|hyrox|deka|hybrid`), `name`, `level`, `weeks` (4), `days_per_week`, `description`, `structure` jsonb (ver sección 9)
- **user_plans**: `id`, `user_id`, `template_id` (nullable), `name`, `start_date`, `status` (`active|completed|archived`), `source` (`template|ai`), `notes`
- **planned_sessions**: `id`, `user_plan_id`, `user_id`, `date`, `session_type`, `title`, `blocks` jsonb (mismo formato que los bloques reales), `status` (`planned|done|skipped|moved`), `workout_session_id` (nullable)

### Registro
- **workout_sessions**: `id`, `user_id`, `planned_session_id` (nullable), `session_type` (`strength|functional|running|swimming|cycling|spinning|yoga|padel_fronton|surf|other`), `title`, `started_at`, `ended_at`, `duration_min`, `rpe` (1–10, se pide al terminar), `distance_m`, `avg_hr`, `max_hr`, `calories` (los tres últimos, manuales y opcionales: «datos del reloj»), `location` (`gym|outdoor|pool|home|other`), `notes`, `pair_group_id` (uuid nullable, enlaza sesiones hechas en pareja)
- **session_blocks**: `id`, `session_id`, `order`, `block_type` (`straight|superset|circuit|emom|amrap|tabata|for_time|intervals|free`), `config` jsonb (p. ej. minutos del EMOM, rondas, trabajo/descanso, cap de tiempo), `result` jsonb (rondas completadas en AMRAP, tiempo final en For Time…)
- **exercise_sets**: `id`, `session_id`, `block_id`, `exercise_id`, `set_index`, `is_warmup`, `weight_kg`, `reps`, `rir` (0–5, opcional), `duration_s`, `distance_m`, `calories`, `completed` bool, `completed_at`

### Progreso
- **body_metrics**: `id`, `user_id`, `date`, `weight_kg`, `body_fat_pct`, `waist_cm`, `hip_cm`, `chest_cm`, `arm_cm`, `thigh_cm`, `notes`
- **progress_photos**: `id`, `user_id`, `date`, `pose` (`front|side|back`), `storage_path` (bucket **privado** `progress-photos`, ruta `{user_id}/...`, URLs firmadas)
- **personal_records**: `id`, `user_id`, `exercise_id`, `pr_type` (`est_1rm|max_weight|max_reps_at_weight|best_time|longest_distance|best_pace`), `value`, `unit`, `set_id` / `session_id`, `achieved_at`
- **daily_checkins**: `user_id`, `date` (pk compuesta), `sleep` 1–5, `energy` 1–5, `soreness` 1–5, `stress` 1–5, `notes`

### IA y social
- **ai_interactions**: `id`, `user_id`, `kind` (`plan_generation|daily_adjust|weekly_review|chat|exercise_swap`), `input_summary` jsonb, `output` jsonb, `accepted` bool nullable, `tokens_in`, `tokens_out`, `created_at`
- **partner_links**: `id`, `user_id` (quien comparte), `partner_id` (quien ve), `status` (`pending|accepted|revoked`) y un permiso por dirección y persona (se pueden tener varias personas vinculadas: pareja o amigos):
  - `can_view_adherence` (por defecto `true` al aceptar): cumplimiento y compromisos.
  - `can_view_sessions` (por defecto `false`): **Entrenos**: historial y detalle de sesiones (con notas), bloques, series con pesos, récords, gráficas por ejercicio y sus ejercicios propios.
  - `can_view_muscles` (por defecto `false`): **mapa muscular y carga**: series efectivas por sesión y ejercicio y RPE × minutos, sin pesos (RPC `partner_session_log` / `partner_exercise_sets`).
  - `can_view_achievements` (por defecto `false`): **logros**: distancias, tonelaje, reps y horas acumulados, equivalencias, su ciudad de referencia (`partner_home`) e historial de hitos (`milestones_shown`).
  - `can_view_metrics` (por defecto `false`): peso y perímetros (`body_metrics`).
  - Las **fotos de progreso son siempre privadas**: no existe permiso ni política para compartirlas.
  - El vínculo es **mutuo**: se crea por invitación y la otra persona acepta. Cada usuario solo cambia su fila (lo que él comparte); revocar o quitar un permiso tiene efecto inmediato (la RLS lo comprueba en cada consulta y la app no guarda en el móvil datos de otra persona). Todo pasa por `shares_with_me(owner, perm)`.
- **pair_invites**: `id`, `pair_group_id`, `from_user`, `to_user`, `payload` jsonb (estructura de la sesión: bloques, ejercicios globales, series con reps/tiempo/distancia objetivo; sin pesos ni notas), `status` (`pending|accepted|declined|cancelled`). Solo por RPC y con el vínculo aceptado en las dos direcciones.
- **reactions**: `id`, `from_user`, `to_user`, `target_kind` (`week|session`), `target_key` (lunes de la semana o id de sesión), `emoji` (`clap|fire|muscle`), `seen_at`. Una por emoji, persona y objetivo; a la semana si me comparte el cumplimiento y a una sesión si me comparte sus entrenos. Solo por RPC (`toggle_reaction`, `mark_reactions_seen`).
- **equivalence_objects** (global, semilla): `id`, `kind` (`weight|distance_route|time`), `label`, `emoji`, `value` (kg, metros o minutos), `phrase_template` (p. ej. «Has levantado el peso de {n} {label}»), `min_value` (a partir de cuánto se puede mostrar)
- **destinations** (global, semilla): `id`, `name`, `lat`, `lng`, `type` (`city|island|landmark`), `water_route` bool (válido para equivalencias de natación)
- **milestones_shown**: `user_id`, `milestone_key` (p. ej. `swim_total_route_mallorca`, `tonnage_month_2026-10_tractor`), `shown_at`. Evita repetir el mismo pop-up.

---

## 5. Músculos (catálogo semilla)

| id | Nombre | Vista |
|---|---|---|
| chest | Pectoral | front |
| lats | Dorsal | back |
| upper_back | Trapecio / espalda alta | back |
| lower_back | Lumbar | back |
| delt_front | Deltoides anterior | front |
| delt_side | Deltoides lateral | both |
| delt_rear | Deltoides posterior | back |
| biceps | Bíceps | front |
| triceps | Tríceps | back |
| forearms | Antebrazo | both |
| core | Core (abdomen y oblicuos) | front |
| glutes | Glúteo | back |
| quads | Cuádriceps | front |
| hamstrings | Isquiotibiales | back |
| adductors | Aductores | front |
| calves | Gemelos | back |

Regla de volumen: una serie efectiva cuenta **1** para cada músculo primario y **0,5** para cada secundario. Las series de calentamiento no cuentan.

---

## 6. Biblioteca de ejercicios semilla (mínimo)

Formato: nombre → primarios / secundarios. Crea el JSON completo con `tracking_type`, `equipment` y `default_rest_s` (compuestos 120–180 s, accesorios 60–90 s).

**Fuerza**
- Sentadilla con barra → quads, glutes / adductors, core, lower_back
- Sentadilla goblet → quads, glutes / core
- Prensa → quads, glutes / adductors
- Peso muerto → hamstrings, glutes, lower_back / upper_back, forearms, core
- Peso muerto rumano → hamstrings, glutes / lower_back
- Hip thrust → glutes / hamstrings
- Zancadas → quads, glutes / adductors, core
- Búlgara → quads, glutes / adductors
- Curl femoral → hamstrings
- Extensión de cuádriceps → quads
- Elevación de gemelos → calves
- Press banca → chest / triceps, delt_front
- Press inclinado mancuernas → chest, delt_front / triceps
- Fondos → chest, triceps / delt_front
- Flexiones → chest / triceps, delt_front, core
- Press militar → delt_front, delt_side / triceps, core
- Elevaciones laterales → delt_side
- Face pull → delt_rear, upper_back
- Dominadas → lats / biceps, upper_back, forearms
- Jalón al pecho → lats / biceps, upper_back
- Remo con barra → upper_back, lats / delt_rear, biceps, lower_back
- Remo con mancuerna → lats, upper_back / biceps, delt_rear
- Curl de bíceps → biceps / forearms
- Extensión de tríceps en polea → triceps
- Plancha → core
- Rueda abdominal → core
- Pallof press → core

**Functional / Hyrox / Deka**
- Kettlebell swing → glutes, hamstrings / lower_back, core, forearms
- Thruster → quads, glutes, delt_front / triceps, core
- Wall ball → quads, glutes, delt_front / core, triceps
- Burpee → chest, quads / core, triceps, delt_front
- Burpee broad jump → quads, glutes, chest / core, calves
- Box jump / box jump over → quads, glutes / calves
- Sled push → quads, glutes / calves, core, chest
- Sled pull → upper_back, lats, hamstrings / biceps, forearms, glutes
- Farmers carry → forearms, upper_back / core, glutes
- Sandbag lunges → quads, glutes / core, upper_back
- Med ball sit-up throw → core / delt_front, chest
- Dead ball over → glutes, hamstrings, lower_back / upper_back, core
- SkiErg → lats, triceps / core, delt_front
- Remo ergómetro → lats, quads, upper_back / hamstrings, glutes, biceps
- Assault / air bike → quads / hamstrings, glutes, delt_front
- Double unders / comba → calves / delt_side, forearms

**Cardio y deportes** (se registran por duración, distancia y RPE; `tracking_type` `distance_time` o `duration_only`)
- Carrera, natación (crol, espalda, braza, técnica), bici o spinning, yoga, frontón, surf, otro.

**Aproximación muscular del cardio y los deportes** (para el mapa): cada 30 min cuentan como **2 series equivalentes** repartidas así; muéstralo en la UI como «aproximado».
- Carrera → quads, hamstrings, calves, glutes
- Natación → lats, delt_front, delt_side, triceps, core
- Bici / spinning → quads, glutes, calves
- Surf → lats, delt_front, core, triceps
- Frontón → delt_front, forearms, core, quads
- Yoga → core, glutes, hamstrings (0,5 por cada 30 min)

El usuario puede crear ejercicios propios asignando músculos.

---

## 7. Registro de sesión (UX clave)

Flujo:
1. **Hoy**: muestra la sesión planificada (si hay) + botones «Empezar planificada», «Entreno libre» y «Registrar actividad» (esta última para surf, frontón o yoga con duración, RPE y notas en una sola pantalla).
2. **Sesión en curso**:
   - Bloques con sus ejercicios. En cada serie, los valores de la **última vez** vienen precargados (peso y reps).
   - Tocar ✓ completa la serie y arranca automáticamente el temporizador de descanso.
   - Ajustes rápidos: ±2,5 kg, ±1 rep, y un teclado numérico al tocar el valor.
   - Añadir o reordenar ejercicios, añadir serie, marcar calentamiento.
   - **Sustituir ejercicio**: propone alternativas que trabajan los mismos músculos primarios y usan el material disponible (basado en reglas; la IA es opcional).
3. **Finalizar**: RPE de la sesión (1–10), duración (automática y editable), bloque desplegable **«Datos del reloj»** (FC media, FC máx, calorías) y notas.
4. **Resumen**: volumen total, músculos trabajados (mini mapa), PRs conseguidos 🏆 y comparación con la última vez.

### Tolerancia a mala cobertura (desde la Fase 1)
- Estado de la sesión en curso persistido localmente (IndexedDB) y cola de escritura con reintentos.
- La sesión nunca se pierde si se cierra la app o se va la conexión.

### Entreno en pareja (Fase 7A)
- «Entrenar con…» (en «Empezar entreno» o en una sesión planificada) elige una persona vinculada: mi sesión empieza con un `pair_group_id` nuevo y le llega una invitación en «Hoy» con la misma estructura (sin pesos). Al unirse, su móvil crea su propia sesión con esa estructura, el mismo `pair_group_id` y los pesos de **su** última vez; cada uno registra sus pesos.
- Mientras no se haya unido, quien invita puede reenviar la estructura actual (p. ej. tras añadir ejercicios a un entreno libre) o cancelar. Los ejercicios propios no se mandan.
- En el resumen, comparación lado a lado (duración, volumen, series y mejor serie por ejercicio) si los dos os compartís «Entrenos».

---

## 8. Temporizadores

Implementación: basados en **timestamps** (hora de inicio + duración), no en contadores acumulativos, para que no se desfasen al bloquear la pantalla. Usar la Wake Lock API para mantener la pantalla encendida, vibración, pitido en los últimos 3 s y al final, y controles grandes (pausa, +15 s, saltar).

| Tipo | Uso | Config |
|---|---|---|
| Descanso | Automático tras completar una serie | `default_rest_s` del ejercicio, editable al vuelo |
| EMOM | Cada minuto, en el minuto | minutos totales, ejercicios por minuto (rotación) |
| AMRAP | Máximas rondas en X min | duración; botón «+1 ronda» y reps sueltas |
| Tabata / intervalos HIIT | Trabajo/descanso × rondas | por defecto 20/10 × 8 |
| For Time | Cronómetro ascendente con cap | tiempo límite opcional |
| Intervalos cardio | Carrera, natación o bici | series × (distancia o tiempo) + recuperación; p. ej. 6×400 m rec. 90 s |
| Cronómetro libre | Cualquier cosa | — |

Nota: en iOS una PWA en segundo plano puede no sonar. Muestra un aviso y, al volver a la app, calcula el estado correcto a partir de los timestamps.

---

## 9. Plantillas de planes (semilla)

Cada plantilla dura 4 semanas: semanas 1–3 de progresión y semana 4 de **descarga** (≈ −40 % de volumen, misma intensidad o algo menos). Hay que crearlas para los niveles `beginner` e `intermediate`.

Formato de `structure`:
```json
{
  "weeks": [
    { "week": 1, "sessions": [
      { "day_hint": 1, "session_type": "strength", "title": "Full body A",
        "blocks": [ { "block_type": "straight", "exercises": [
          { "exercise_id": "back_squat", "sets": 3, "reps": "8-10", "rir": 2, "rest_s": 150 }
        ]}]}
    ]}
  ],
  "progression_rules": "texto breve"
}
```

Familias:

1. **Running (base / 10K)**: 3–4 días. Rodaje suave Z2, series (p. ej. 6×400 → 8×400 → 5×1000), tempo y tirada larga. Volumen semanal +≈10 %.
2. **Natación**: 3 días. Técnica + aeróbico, series (p. ej. 8×100 rec. 20 s) y resistencia continua. Todo en metros.
3. **Fuerza**: principiante con full body A/B 3 días; intermedio con torso/pierna 4 días. **Progresión doble**: al completar el techo del rango de reps en todas las series, subir peso (+2,5 kg en tren superior, +5 kg en tren inferior).
4. **Hyrox**: 4 días. Fuerza específica, *compromised running* (km + estación), técnica de estaciones y carrera. Estaciones: SkiErg, sled push, sled pull, burpee broad jumps, remo, farmers carry, sandbag lunges y wall balls, con 1 km de carrera entre estaciones. **Verificar distancias, repeticiones y pesos por categoría con el reglamento oficial vigente antes de sembrar los datos.**
5. **Deka (DEKA FIT)**: 4 días. 10 zonas funcionales con carrera entre zonas (lunges, remo, box jump overs, med ball sit-up throws, ski, farmers carry, air bike, dead ball overs, tank push/pull y burpees). **Verificar el formato oficial vigente antes de sembrar los datos.**
6. **Híbrido / variado**: 4–5 días. 2 de fuerza, 1 de functional (EMOM/AMRAP), 1 de carrera y 1 de natación o spinning.

Las actividades fijas del usuario (surf, frontón) se cuentan como carga y el plan las respeta: no poner una pierna pesada el día antes del frontón, por ejemplo.

---

## 10. Cálculos (lógica determinista, con tests)

- **1RM estimado (Epley)**: `peso × (1 + reps/30)`, solo si reps ≤ 10 y la serie no es de calentamiento.
- **PRs**: se evalúan al finalizar la sesión, por ejercicio y tipo (sección 4).
- **Volumen por músculo**: series efectivas semanales según la regla de la sección 5 + la aproximación de cardio de la sección 6.
- **Carga de sesión (sRPE)**: `RPE × duración_min`.
- **Ratio agudo:crónico**: carga de los últimos 7 días / media semanal de los últimos 28 días.
  - `> 1,5` → aviso de riesgo de sobrecarga
  - `< 0,8` → aviso de subcarga (solo si hay plan activo)
- **Sugerencia de peso** (sin IA): aplicar la progresión doble sobre la última sesión del mismo ejercicio. Si el RIR registrado fue ≥ 3, sugerir una subida; si no se completaron las reps, mantener; si falló dos sesiones seguidas, bajar un 10 %.

---

## 10A. Cumplimiento (lo prometido frente a lo hecho)

### Compromiso
- Se define en el onboarding y se puede editar en Perfil → «Mi compromiso»: sesiones por semana (obligatorio) y, opcionalmente, minutos por semana y reparto por tipo (p. ej. 2 de fuerza + 1 de natación).
- Si hay un plan activo, se ofrece usar como compromiso el número de sesiones del plan.

### Cálculo
- **Semanal** (lunes a domingo): `hechas / comprometidas`.
  - Cuenta una sesión por día y tipo como máximo, con una duración mínima de 15 min; las actividades libres cuentan si `counts_free_activities`.
  - Si hay reparto por tipo: % por tipo y % global = media ponderada por el nº de sesiones comprometidas de cada tipo.
  - Se puede superar el 100 %: la barra se llena y se muestra un «+1 extra».
- **Mensual**: suma de hechas / suma de comprometidas en el mes, prorrateando las semanas partidas por días.
- **Minutos**: si hay objetivo de minutos, segunda barra con `minutos hechos / objetivo`.
- **Racha**: semanas consecutivas con ≥ 100 %. Se muestra también la mejor racha histórica.
- **Adherencia al plan** (si hay plan activo): sesiones planificadas hechas / planificadas; es un indicador separado del compromiso.
- Siempre se usa el compromiso vigente en cada semana (tabla `commitments`).
- La semana en curso se muestra como «en curso» con lo que queda por hacer («te faltan 2 sesiones, quedan 3 días»).

### UI
- **Hoy**: barra de la semana en curso, siempre visible arriba.
- **Progreso → Cumplimiento**: barras semanal y mensual, histórico de las últimas 12 semanas en barras, racha y % medio de los últimos 3 meses.
- Colores: < 50 % neutro, 50–99 % intermedio, ≥ 100 % logro. Sin mensajes de culpa: el tono es de ánimo («2 de 3, ¡una más y semana completa!»).

### Compartido con la pareja o amigos vinculados
- En **Hoy** y en **Cumplimiento** aparece la tarjeta «Nosotros»: la barra semanal y mensual de cada persona vinculada con `can_view_adherence`, junto a la tuya, con su racha. Su nombre lleva a «Evolución de {nombre}».
- La visibilidad del cumplimiento es recíproca por defecto al aceptar el vínculo; el resto de permisos (Entrenos, Mapa muscular y carga, Logros, Medidas) está desactivado hasta que cada uno lo active, persona a persona, en Perfil → «Pareja y amigos» → persona. Se puede dejar de compartir en cualquier momento, con efecto inmediato. Las fotos nunca.
- El cumplimiento solo comparte porcentajes, rachas y nº de sesiones por tipo; nunca pesos, notas ni métricas salvo los permisos correspondientes.
- **Evolución de {nombre}**: vista de solo lectura con una sección por permiso concedido (cumplimiento; historial, detalle, récords y gráficas; mapa muscular y carga; logros; medidas). Las secciones sin permiso no aparecen.
- Reacciones 👏 🔥 💪 (una por tipo y persona) sobre la semana de cumplimiento del otro y sobre sus sesiones compartidas; las recibidas salen en un aviso discreto en «Hoy».

---

## 10B. Acumulados y equivalencias motivadoras

### Acumulados (por semana, mes, año y total)
- **Natación**: metros nadados.
- **Carrera**: km corridos.
- **Bici / spinning**: km (si se registran) y horas.
- **Tonelaje**: Σ `weight_kg × reps` de las series completadas que no son de calentamiento. Los ejercicios con peso corporal no suman en la v1.
- **Repeticiones totales** y **horas totales** de entreno, además de las horas por deporte.
- **Nº de sesiones**.

### Equivalencias
- **Distancia desde casa** (carrera, bici y total): distancia en línea recta (haversine) desde `home_lat/lng` hasta cada `destination`. Se muestra el destino más lejano que ya se ha superado y el siguiente objetivo («Has corrido 312 km este año: como ir de {home_city} a Valencia. Siguiente: Madrid, a 48 km»). Indicar siempre «en línea recta». Si el usuario no tiene ciudad definida, se le pide la primera vez.
- **Natación**: solo destinos con `water_route = true` (travesías a islas, cruzar el Estrecho, etc.), también en línea recta desde la ciudad de referencia o como rutas fijas del catálogo.
- **Peso levantado**: objeto del catálogo con el mayor `value` ≤ tonelaje y, si procede, en múltiplos («Este mes has levantado 5.200 kg: más que un tractor 🚜» o «3,4 coches 🚗»).
- **Tiempo**: equivalencias de duración (p. ej. «X vuelos Madrid–Nueva York»).
- Se pueden mostrar como fracción de un objetivo grande («llevas el 12 % del peso de la Torre Eiffel»).

### Catálogo semilla (valores **aproximados**: Claude Code debe verificarlos y documentar la fuente en el JSON)
- Peso, de pequeño a enorme: lavadora, moto, piano de cola, coche, rinoceronte, tractor, elefante africano, autobús, camión, ballena azul, avión de pasajeros, Estatua de la Libertad, Torre Eiffel. Al menos 20 objetos.
- Destinos: 40–60 ciudades y lugares de España y Europa con coordenadas (incluidas las Baleares, las Canarias, el Estrecho de Gibraltar y capitales europeas) + algunos lejanos para los totales (Nueva York, Marrakech, Islandia…).

### Pop-up motivador
- Se muestra en el **resumen de fin de sesión** cuando esa sesión hace cruzar un umbral nuevo (un nuevo destino o un nuevo objeto) en la semana, el mes o el total.
- Máximo **1 pop-up por sesión**, eligiendo el hito más llamativo. No se repite gracias a `milestones_shown`.
- También un **resumen del mes** al abrir la app por primera vez en un mes nuevo: cumplimiento + la mejor equivalencia del mes.
- Formato: tarjeta a pantalla media con emoji grande, la frase, el dato real («312 km») y un botón para ver los acumulados. Animación breve y cierre con un toque.
- Se puede desactivar en Perfil (`show_equivalence_popups`).
- Opcional: botón «Compartir» que genera una imagen de la tarjeta.

### Pantalla «Mis logros» (dentro de Progreso)
- Selector semana / mes / año / total.
- Tarjetas por métrica (metros nadados, km corridos, tonelaje, horas…) con el valor, su equivalencia actual y una barra hacia la siguiente equivalencia.
- Mapa o lista de destinos «alcanzados» por distancia.
- Historial de hitos conseguidos con su fecha.

Las frases se generan con plantillas deterministas; el **dato y la equivalencia salen siempre del cálculo determinista**, nunca de la IA. No se usa IA para reescribirlas (decisión de la Fase 6B): no aportan datos nuevos y gastarían cuota diaria del plan gratuito en cada pop-up.

---

## 11. Entrenador IA

### Arquitectura
- Funciones de servidor en `src/server/ai.functions.ts` y lógica en `src/server/ai/*`. **Proveedor configurable** (`AI_PROVIDER`: `gemini` | `anthropic`) detrás de una interfaz única: `generateStructured({ schema, system, prompt, context })` pide JSON al proveedor, lo valida con Zod y reintenta una vez. Un adaptador por proveedor (`src/server/ai/providers/*`: Gemini por REST con `responseJsonSchema`, Anthropic con el SDK y `output_config.format`); el resto de la app no sabe cuál hay detrás. Modelo configurable por env (`GEMINI_MODEL` / `AI_MODEL`); con Gemini, `GEMINI_FALLBACK_MODEL` (opcional) se usa una vez si el principal devuelve 429 o cuota agotada.
- Sin clave del proveedor (o con la cuota del proveedor agotada) se muestra un mensaje claro en español y la app sigue funcionando sin IA.
- Un **context builder** que resume los datos del usuario en JSON compacto: perfil de entrenamiento, plan activo, últimas 2–4 semanas (sesiones, carga, volumen por músculo, PRs, check-ins). Nunca enviar fotos. Enviar solo los datos necesarios para cada caso.
- Toda salida estructurada en **JSON validado con Zod**; si no valida, un reintento; si vuelve a fallar, mostrar un error amable.
- Todo se guarda en `ai_interactions`. **Nada se aplica sin que el usuario pulse «Aceptar»**; se ofrece también «Editar» y «Descartar».
- Límite de uso: máximo N llamadas por usuario y día (`AI_DAILY_LIMIT`, por defecto 20), contado en `ai_interactions` en la zona horaria del usuario.
- System prompt con este marco: entrenador personal prudente, prioriza la técnica y la progresión gradual, respeta las limitaciones declaradas (ante una molestia, alternativa conservadora y recomendar consultar a un profesional si persiste), no da diagnósticos médicos ni pautas nutricionales cerradas, responde en español.

### Funciones
1. **Onboarding** (Fase 5, sin IA; la IA se usa en la Fase 6): asistente de 5–6 pantallas que rellena `training_profiles`:
   - objetivos (selección múltiple + objetivo principal: fuerza, perder grasa, carrera/evento, Hyrox/Deka, salud general)
   - nivel y marcas actuales (opcional: 1RM aprox., ritmo 5K, 100 m nado)
   - días/semana, minutos por sesión y días preferidos
   - material disponible y dónde entrena
   - limitaciones o molestias (texto libre)
   - actividades fijas (surf, frontón…) y su frecuencia
   - **compromiso**: sesiones por semana (y opcionalmente minutos y reparto por tipo) → crea el primer registro en `commitments`
   - ciudad de referencia para las equivalencias
   - Se reabre cada 4 semanas o cuando el usuario quiera.
2. **Generar plan** (`plan_generation`): entrada = perfil + plantilla elegida (o «recomiéndame»). Salida = un `user_plan` con sus `planned_sessions` para 4 semanas, usando solo `exercise_id` existentes en la biblioteca.
3. **Ajuste del día** (`daily_adjust`): entrada = check-in de hoy + carga de 7 días + sesión planificada. Salida = sesión mantenida, reducida, cambiada o descanso, con un motivo breve.
4. **Revisión semanal** (`weekly_review`): resumen de la semana (adherencia, carga, músculos descuidados o sobrecargados, PRs) + 3 recomendaciones concretas + cambios propuestos para la semana siguiente.
5. **Chat con el entrenador**: preguntas libres con el contexto del usuario. Puede proponer cambios, que llegan como tarjeta aceptable.
6. **Sustituir ejercicio con IA** (opcional): cuando las reglas no encuentran alternativa.

---

## 12. Fases

### Fase 0 — Cimientos
- Repo, TanStack Start, Tailwind, shadcn, ESLint/Prettier y Vitest.
- Proyecto Supabase, migraciones iniciales (`profiles`, `training_profiles`) y RLS.
- Auth con invitación, panel `/admin/invitaciones` y desactivar usuario.
- PWA instalable (manifest, iconos, service worker básico).
- Layout móvil con navegación inferior: **Hoy · Entrenar · Progreso · Plan · Perfil**.
- Deploy en Vercel con variables de entorno documentadas en `.env.example`.

**Aceptación**: el admin invita a un email, esa persona entra, instala la PWA y ve su perfil vacío; nadie más puede registrarse.

### Fase 1 — Biblioteca y registro de fuerza
- Tablas del catálogo y de registro, más el seed de músculos y ejercicios (secciones 5 y 6).
- Buscador de ejercicios (nombre y alias, filtro por músculo y material) y creación de ejercicios propios.
- Flujo de sesión completo de la sección 7 para bloques `straight` y `superset`.
- Temporizador de descanso automático.
- Valores precargados de la última vez.
- Persistencia local y cola offline de la sesión en curso.
- Historial de sesiones (lista + detalle) y editar o borrar una sesión.

**Aceptación**: registrar un entreno de 5 ejercicios × 3–4 series en modo avión y ver que se sincroniza al volver la conexión.

### Fase 2 — Temporizadores y todos los tipos de sesión
- Bloques `emom`, `amrap`, `tabata`, `for_time`, `intervals` y `circuit` con sus temporizadores (sección 8).
- Registro de carrera, natación y bici/spinning: distancia, tiempo, ritmo calculado, series de intervalos y RPE.
- «Registrar actividad» rápida para yoga, surf, frontón y otros.
- Bloque «Datos del reloj» (FC media, FC máx, calorías) en todas las sesiones.

**Aceptación**: completar un EMOM de 12 min y un 6×400 m con la pantalla bloqueada a ratos; los tiempos cuadran.

### Fase 3 — Progreso
- Detección de PRs y pantalla de récords por ejercicio.
- Gráficas por ejercicio: 1RM estimado, peso máximo y volumen; en cardio, ritmo y distancia.
- Peso y medidas: registro y gráficas.
- Fotos de progreso en el bucket privado con vista comparativa antes/después.
- Resumen semanal y mensual: sesiones, horas, carga y distancia por deporte.

- **Cumplimiento** (sección 10A): pantalla «Mi compromiso» (sin esperar al onboarding de la Fase 5), barras semanal y mensual, histórico, racha y barra en «Hoy».
- **Vínculos** (`partner_links`): invitar a una persona ya registrada, aceptar o revocar, permisos, y la tarjeta «Nosotros» con el cumplimiento mutuo.
- **Acumulados y equivalencias** (sección 10B): semillas de `equivalence_objects` y `destinations`, pantalla «Mis logros», pop-up de fin de sesión y resumen del mes.

**Aceptación**:
- Tras 3 sesiones del mismo ejercicio aparece la gráfica y se marca el PR.
- Con un compromiso de 3 sesiones/semana y 2 hechas, «Hoy» muestra 67 % y lo que falta; la pareja vinculada ve ese mismo 67 % en su tarjeta «Nosotros», pero no los pesos.
- Al superar el tonelaje de un objeto del catálogo aparece el pop-up una sola vez.

### Fase 4 — Mapa muscular y carga
- Mapa corporal en SVG, vista frontal y trasera, con un `path` por `muscle_id`. Usar un SVG propio o una librería con licencia MIT verificada.
- Color por series efectivas de la semana: 0 / 1–5 / 6–10 / 11–20 / >20 (escala accesible, también en modo oscuro).
- Tocar un músculo muestra las series de la semana y los ejercicios que las aportan.
- Selector de semana y comparación con la anterior.
- Carga sRPE, ratio agudo:crónico y avisos (sección 10).
- Mini mapa en el resumen de cada sesión.

**Aceptación**: una sesión de pierna colorea cuádriceps, glúteo e isquios, y una carrera de 30 min suma su parte aproximada.

### Fase 5 — Onboarding y planes plantilla
- Asistente de onboarding (sección 11.1).
- Seed de las 6 familias de plantillas (sección 9), revisando antes los datos oficiales de Hyrox y Deka.
- Elegir plantilla → crear `user_plan` y `planned_sessions` según los días disponibles.
- Calendario semanal: planificado frente a hecho, mover o saltar sesiones.
- «Hoy» muestra la sesión del día y la arranca prellenada.
- Sugerencia de peso determinista (sección 10).
- Check-in diario opcional (4 deslizadores, 10 segundos).

**Aceptación**: un usuario nuevo hace el onboarding, elige Híbrido y ve 4 semanas planificadas en sus días.

### Fase 6 — Entrenador IA
- Cliente de IA, context builder, esquemas Zod y registro en `ai_interactions`.
- Generar o adaptar plan, ajuste del día, revisión semanal y chat (sección 11).
- Tarjetas de propuesta con Aceptar / Editar / Descartar.
- Límite diario y manejo de errores.

**Aceptación**: con un check-in de energía 1 y agujetas 5, la IA propone reducir la sesión, y el cambio solo se aplica tras aceptarlo.

### Fase 6C — Técnica de ejercicios
- Pasos de técnica en texto para **todos** los ejercicios globales: 3–4 pasos clave y 2–3 errores típicos, en español, en la base de datos (migración idempotente).
- Imágenes de posición inicial y final desde bases de datos abiertas (free-exercise-db, wger), solo con licencia compatible y cumpliendo la atribución (pantalla «Créditos» en Perfil y fuente en el detalle). Mapeo revisable en un JSON del repo; mejor sin imagen que una dudosa. Imágenes dentro del proyecto (`public/exercises/`), WebP ≤ 50 KB, nunca enlazadas a webs externas.
- Botón «Ver técnica en vídeo» en todos los ejercicios (también los propios): búsqueda de YouTube «técnica {nombre}» en una pestaña nueva.
- Dónde: detalle del ejercicio en la biblioteca y, durante la sesión, hoja inferior al tocar el nombre (o ⓘ) sin salir ni perder el temporizador.
- Rendimiento: imágenes solo al abrir el detalle (no en listas), fuera de la precarga del service worker y en caché tras verlas una vez.

**Aceptación**: el detalle de Press banca muestra dos imágenes, pasos, errores, vídeo y fuente; en una sesión, abrir la técnica durante el descanso no lo para.

### Fase 7A — Compartir y entrenar en pareja
- Permisos por persona vinculada (cumplimiento, entrenos, mapa muscular y carga, logros, medidas; fotos nunca) con RLS exacta y tests de base de datos de cada permiso activado y desactivado.
- Perfil → «Pareja y amigos» → persona → interruptores.
- «Evolución de {nombre}» en solo lectura, reutilizando los componentes de Progreso.
- Entreno en pareja con `pair_group_id` y comparación lado a lado.
- Reacciones 👏 🔥 💪 sobre la semana y las sesiones compartidas, con aviso en «Hoy».

**Aceptación**: con dos usuarios, activar y desactivar cada permiso cambia al momento lo que ve el otro (y las fotos nunca se ven); un entreno en pareja deja dos sesiones enlazadas y el resumen las compara si los dos comparten Entrenos.

### Fase 7B — Extras
- Sustitución de ejercicios con reglas + IA (hecha en la Fase 6B).
- Recordatorios (notificaciones push de la PWA donde el sistema lo permita).
- Exportar los datos del usuario en CSV/JSON.
- Imagen compartible de las tarjetas de logros y de la semana completada.
- Pulido: modo oscuro, animación de PR y accesibilidad.

---

## 13. Estado

_(Claude Code: actualizar al cerrar cada fase.)_

- Fase actual: **plan de fases completado** (0 → 7B). La 7B (extras y pulido) está hecha: typecheck, lint, Vitest + PGlite (incluida la revisión de seguridad automática), build y E2E completa en verde. Falta validar en dos móviles reales (sobre todo iOS con la PWA instalada: push, Wake Lock, compartir imagen). Lo que queda son mejoras opcionales (ver «Posibles mejoras»).
- Hecho (Fase 0):
  - TanStack Start (React 19 + TS strict) + Vite 8 + Nitro (salida Vercel), Tailwind v4, componentes shadcn (button, input, label, card, badge, sheet, textarea), ESLint 10 + Prettier, Vitest.
  - Migraciones `0001_profiles.sql` y `0002_training_profiles.sql` con RLS.
  - Auth: magic link + código de 6 dígitos + contraseña opcional; `/admin/invitaciones`; bloqueo de inactivos (rutas, middleware y RLS).
  - PWA instalable y layout con navegación inferior.
- Hecho (Fase 1):
  - Migraciones `0003_catalog.sql` (muscles, exercises globales/propios con ids `u_…`, exercise_muscles), `0004_workouts.sql` (workout_sessions, session_blocks, exercise_sets; RPC `save_workout_session(payload)` transaccional con `client_rev`; RPC `last_exercise_sets(ids, exclude, before)`).
  - Semillas `supabase/seed/muscles.json` (16) y `exercises.json` (55: fuerza, functional/Hyrox/Deka, cardio y deportes) → SQL generado con `npm run seed:sql` en `0005`–`0007` (test que falla si el SQL no está sincronizado).
  - Biblioteca `/entrenar/ejercicios`: búsqueda por nombre y alias sin acentos, filtros por músculo y material, detalle, crear y borrar ejercicios propios.
  - Sesión en curso `/entrenar/sesion`: bloques `straight` y `superset`, valores de la última vez precargados, ✓ en 1 toque, ±2,5 kg / ±1 rep, teclado numérico al tocar el valor, cambios de peso/reps que arrastran a las series pendientes iguales, calentamiento, RIR, añadir/quitar serie, reordenar bloques, sustituir ejercicio por reglas (mismos primarios + material del perfil), Wake Lock.
  - Descanso automático basado en timestamps: arranca al completar serie (en superserie, al acabar la ronda), −15/+15 (ajusta el descanso de ese ejercicio), pausa, saltar, pitido en los últimos 3 s y al final, vibración.
  - Terminar: RPE 1–10, duración editable, «Datos del reloj» (FC media, FC máx, calorías) y notas. Resumen: duración, RPE, carga sRPE, volumen, series, reps, músculos (series efectivas 1/0,5) y comparación de tonelaje con la vez anterior.
  - Historial en `/entrenar` (servidor + copias locales pendientes) y detalle con editar (reusa la pantalla de sesión en modo edición) y borrar.
  - Offline: sesión en IndexedDB en cada cambio, cola de escritura por sesión (coalesce, backoff 2 s → 60 s, reintento al volver la conexión/foco), catálogo y «última vez» cacheados, estado de auth cacheado en `localStorage` para abrir sin red, service worker generado en build con precarga de assets y caché de páginas (`/`, `/entrenar`, `/entrenar/sesion`, `/entrenar/ejercicios`).
  - Tests: Vitest (operaciones de sesión, cálculos, búsqueda, sustitución, formato, cola con fake-indexeddb, persistencia de la sesión activa, plantilla del SW) + PGlite (migraciones ×2, RLS, RPC). Playwright E2E del criterio de aceptación contra un Supabase simulado (5 ejercicios × 3 series, modo avión, recarga sin conexión, terminar offline y sincronizar).
- Hecho (Fase 2):
  - Sin migraciones nuevas: los tipos de bloque, `config`, `result` y `distance_m` ya existían en `0004`.
  - Motor de temporizadores puro (`src/lib/workout/timer.ts`): el estado solo guarda instantes (inicio, pausa, fin) y duraciones ajustadas por fase; todo se deriva de `ahora − inicio − pausas`. Fases: preparación 10 s + trabajo/descanso según el tipo. Acciones: empezar (con o sin cuenta atrás), pausa, +15 s, saltar fase, terminar.
  - Bloques (`src/lib/workout/timed-blocks.ts`): EMOM (rotación de ejercicios por minuto), AMRAP (+1 ronda y reps sueltas), Tabata/HIIT (20/10 × 8 por defecto), For Time (cap opcional), intervalos de cardio por distancia («Serie hecha» guarda el parcial) o por tiempo, con recuperación, cronómetro libre y circuito (rondas × ejercicios, descanso al acabar la ronda). `result` por tipo; las series se completan al terminar el bloque.
  - El estado del temporizador se guarda en IndexedDB con la sesión en curso; al volver a la app (o recargar) se recalcula, y si el tiempo terminó con la app cerrada el bloque se cierra en el instante exacto en que acabó.
  - Avisos: pitido en los últimos 3 s y al final de cada fase, vibración donde exista (no en iOS), botón para silenciar (preferencia en el dispositivo). Wake Lock durante la sesión, con fallback silencioso.
  - Tipos de sesión: Fuerza, Functional, Carrera, Natación, Bici y Spinning (las de cardio empiezan con un bloque continuo: cronómetro + distancia). Ritmo: min/km (carrera), min/100 m (natación), km/h (bici/spinning). `distance_m` de la sesión = suma de series completadas.
  - «Registrar actividad» (`/entrenar/actividad`): surf, frontón, yoga u otro con duración, RPE, notas y datos del reloj en una pantalla.
  - «Datos del reloj» (FC media, FC máx, calorías) en todas las sesiones (hoja de terminar y registro rápido).
  - Historial y detalle muestran el tipo, distancia y ritmo, y el resultado de cada bloque (minutos de EMOM, rondas de AMRAP, tiempo de For Time, parciales de intervalos con ritmo).
  - Tests: Vitest para ritmos y para el estado de los temporizadores (incluido reanudar desde timestamps tras bloquear/recargar) y los bloques.
  - E2E de aceptación (`tests/e2e/timers.spec.ts`) con el reloj simulado de Playwright: EMOM de 12 min y 6×400 m rec. 90 s, con «pantalla bloqueada» (segundo plano + reloj adelantado sin ticks) y la app cerrada y reabierta a mitad; comprueba minuto/serie en pantalla, resultado y parciales guardados en el servidor.
- Hecho (Fase 3A):
  - Migraciones `0008_personal_records.sql` (tabla + `recompute_personal_records` + triggers de sentencia en `exercise_sets`), `0009_body_metrics_photos.sql`, `0010_storage_progress_photos.sql` (bucket privado `progress-photos`, 3 MB, JPEG/WebP, políticas por carpeta `{user_id}/`), `0011_commitments.sql` (+ RPC `set_commitment`), `0012_partner_links.sql` (tabla, `shares_with_me`, políticas de lectura de pareja y RPC `invite_partner`, `respond_partner_link`, `revoke_partner_link`, `list_partner_links`, `partner_adherence_days`).
  - Cabecera de sesión de carrera/natación/bici: distancia y ritmo (o velocidad) siempre, también antes de la primera serie.
  - PRs calculados en la base de datos (1RM Epley, peso máximo, reps con un peso, mejor tiempo, distancia más larga, mejor ritmo). Resumen de sesión con «🏆 Nuevo récord»; `/progreso/records` (lista con buscador) y `/progreso/ejercicio/$id` (récords vigentes, historial de récords y gráficas Recharts: 1RM, peso máx. y volumen; en cardio distancia y ritmo/velocidad).
  - `/progreso/medidas` (peso, % grasa y 5 perímetros, un registro por día, gráfica por medida) y `/progreso/fotos` (compresión a 1600 px JPEG 80 % en el cliente, URLs firmadas de 1 h, comparativa antes/después por postura).
  - `/progreso/resumen`: semana/mes con navegación, sesiones, horas, carga sRPE y distancia, por deporte y frente al periodo anterior.
  - Cumplimiento (§10A): `/perfil/compromiso` (sesiones, minutos, reparto por tipo, actividades libres; historial), barra de la semana en «Hoy» y en Progreso, `/progreso/cumplimiento` (semana, mes prorrateado, 12 semanas, racha actual y mejor, media de 3 meses), mensajes de ánimo y colores < 50 / 50–99 / ≥ 100 %. El compromiso se cachea en IndexedDB y la barra cuenta también las sesiones pendientes de subir (funciona sin conexión).
  - Vínculos: `/perfil/vinculos` (invitar por email a un usuario registrado, aceptar/rechazar, cancelar, deshacer, permisos por dirección) y tarjeta «Nosotros» en «Hoy» y «Cumplimiento».
  - Tests: Vitest de cumplimiento, resúmenes, series de gráficas, récords, compresión y cabecera; PGlite de PRs (mejoras, borrado, cardio), compromisos, medidas/fotos/storage y RLS de vínculos (sin permiso no se ven sesiones, series, pesos, récords, medidas ni fotos; con permiso sí, salvo fotos; ver no es editar; revocar corta el acceso). E2E `tests/e2e/adherence.spec.ts`: 2 de 3 → 67 % en «Hoy» y en «Nosotros».
- Hecho (Fase 3B):
  - Migraciones `0013_achievements.sql` (`equivalence_objects` y `destinations` globales de solo lectura, `milestones_shown` con RLS propia, RPC `session_totals()` con tonelaje y reps por sesión) y `0014_seed_equivalences.sql` (generada con `npm run seed:sql` desde `supabase/seed/equivalences.json` y `destinations.json`; cada objeto lleva su fuente como comentario en el SQL).
  - Semillas: 22 objetos de peso (saco de cemento → Torre Eiffel), 7 rutas a nado (Banyoles, Bósforo, 10 km olímpicos, Estrecho, Sella, Canal de la Mancha, Barcelona–Mallorca), 7 de tiempo y 57 destinos (España, Baleares, Canarias, Estrecho, Portugal, Andorra, capitales, islas del Mediterráneo y lejanos). Valores aproximados con la fuente anotada (conocimiento de referencia; no se verificaron en vivo).
  - Acumulados (`src/lib/progress/accumulated.ts`) por semana/mes/año/total: metros nadados, km de carrera, km y horas de bici+spinning, distancia total, tonelaje, reps, horas totales y por deporte, nº de sesiones. Las sesiones pendientes de subir cuentan (tonelaje calculado en el cliente).
  - Equivalencias (`src/lib/progress/equivalences.ts`): haversine, escalera de destinos desde casa (se ignoran los < 5 km), destino superado y siguiente, objeto con múltiplos («3,4 coches»), fracción de un objetivo grande (desde su `min_value`), frases con «en línea recta».
  - Ciudad de referencia: `/perfil/ciudad` (buscador sobre `destinations` + coordenadas a mano; sin geolocalización). Se pide en «Mis logros» y en el resumen de una sesión de cardio si falta. Perfil: acceso a la ciudad e interruptor de pop-ups (`show_equivalence_popups`).
  - Pop-up de fin de sesión en el resumen (`?nueva=1`): máximo 1, el hito más llamativo (total > mes > semana; carrera/natación > bici > tonelaje > distancia total > tiempo); todos los hitos cruzados en esa sesión se marcan en `milestones_shown` para no repetirse. Resumen del mes anterior en «Hoy» la primera vez que se abre en un mes nuevo (clave `month_summary_YYYY-MM`).
  - `/progreso/logros` («Mis logros»): selector semana/mes/año/total, tarjetas con valor, equivalencia, barra al siguiente y fracción de objetivo grande, destinos alcanzados y historial de hitos.
  - Cumplimiento mensual corregido: objetivo del mes = prorrateo redondeado (mínimo 1), barra hasta 100 % y lo que sobra como «+N extra»; si el prorrateo es < 1 sesión, «Mes parcial» sin porcentaje (también en «Nosotros»).
  - Tests: Vitest de acumulados, equivalencias, hitos y claves, semillas, cumplimiento mensual y almacén offline de hitos; PGlite de catálogos (solo lectura), RLS de `milestones_shown` y `session_totals`; E2E `tests/e2e/achievements.spec.ts` (pop-up de tonelaje y de distancia una sola vez, resumen del mes, «Mis logros»).
- Hecho (correcciones antes de la Fase 4, probando en móvil con Supabase real):
  - Ciudad de referencia y pop-ups de logros «no se guardaban»: sí se guardaban, pero el root lee el estado de sesión con `ensureQueryData`, que devuelve la copia en caché aunque esté invalidada; al llegar a Perfil navegando dentro de la app se veía el valor viejo. `resetAuthState` fuerza ahora el refetch (`refetchType: 'all'`). Test unitario y E2E (`tests/e2e/profile-settings.spec.ts`) que fallan sin el arreglo.
  - Migración `0015_profile_settings_commitment_end.sql`: rehace los permisos de columna de `profiles` (preferencias editables, nunca `role`/`active`), la política de UPDATE y añade el trigger `profiles_protect_admin_fields` como segunda barrera; RPC `end_commitment(p_today)`. Tests PGlite en `tests/db/profile-commitment.test.ts`.
  - Los UPDATE del perfil y de permisos de vínculos piden la fila de vuelta: si la RLS no deja cambiar nada (0 filas, sin error) se trata como fallo.
  - «Quitar compromiso» (valid_to = hoy, historial intacto) y borrar entradas del historial con confirmación. Sin compromiso vigente, «Hoy», Cumplimiento y «Nosotros» muestran un aviso en vez de porcentajes.
  - Toasts (`sonner`, `src/lib/notify.ts`): todo guardado de Perfil (nombre, contraseña, ciudad, pop-ups, compromiso, vínculos) avisa del éxito o del error en español.
- Hecho (Fase 4):
  - Migración `0016_muscle_volume.sql`: RPC `session_exercise_sets(p_from, p_to)` (series efectivas por sesión y ejercicio de las sesiones terminadas empezadas en el rango; security invoker).
  - Volumen por músculo (`src/lib/progress/muscle-volume.ts`): 1 principal / 0,5 secundario, sin calentamiento ni series sin completar; aproximación de cardio y deportes (§6) proporcional a la duración; detalle de aportaciones por ejercicio y por tipo de sesión; comparación semanal; músculos descuidados. Las sesiones pendientes de subir cuentan (series calculadas en el móvil) y los datos del servidor se cachean en IndexedDB por rango.
  - Mapa corporal SVG propio (`src/lib/progress/body-map.ts` + `src/components/progress/body-map.tsx`), sin librerías: frente y espalda, un `path` por músculo y vista (16 músculos; `delt_side` y `forearms` en las dos), silueta de fondo. Escala 0 / 1–5 / 6–10 / 11–20 / >20 con tokens `--mv-*` (rampa de un solo tono; en oscuro, más series = más claro), leyenda, `aria-label` y `<title>` con el número en cada músculo, accesible con teclado.
  - `/progreso/musculos`: selector de semana, mapa, toque → hoja de detalle (series, ± frente a la semana anterior, ejercicios y sesiones que las aportan, lo aproximado marcado), tabla de los 16 músculos con ± semana anterior y «≈ aprox.», músculos descuidados (contorno discontinuo + lista).
  - `/progreso/carga`: ratio agudo:crónico con aviso > 1,5, «datos insuficientes» con < 4 semanas de datos o sin carga crónica, carga aguda y crónica, sesiones sin RPE, gráfica de 12 semanas y sRPE por sesión de la semana. Aviso compacto en «Hoy» y Progreso solo si hay riesgo.
  - Mini mapa en el resumen de sesión y en el detalle del historial (misma pantalla), con la aproximación de cardio y deportes.
  - Toasts de éxito/error también en medidas, fotos, ejercicios propios, registrar actividad, borrar/editar sesión e invitaciones de admin.
  - Tests: Vitest de volumen por músculo, aproximación de cardio, semanas, escala, descuidados, geometría del mapa (16 paths) y ACWR; PGlite de `session_exercise_sets` (calentamiento, sin completar, sin terminar, rango, RLS entre usuarios, anon); E2E `tests/e2e/muscle-map.spec.ts` (pierna + carrera de 30 min colorean el mapa, detalle, mini mapa y «datos insuficientes»; `E2E_SCREENSHOTS=<dir>` guarda capturas a 375 px).
- Hecho (Fase 5A):
  - Migraciones `0017_plans.sql` (`plan_templates` global de solo lectura; `user_plans` con un solo plan activo por usuario; `planned_sessions`; FK `workout_sessions.planned_session_id`; trigger `link_planned_session`; RPC `create_user_plan` y `set_planned_session_done`), `0018_seed_exercises_phase5.sql` (zonas de DEKA: `ram_reverse_lunge`, `tank_push_pull`, `ram_burpee`, con músculos) y `0019`–`0021` (plantillas: carrera y natación; fuerza e híbrido; HYROX y DEKA).
  - Plantillas (§9): 6 familias × principiante/intermedio, 4 semanas con la 4.ª de descarga (≈ −40 % de volumen, sin sesiones intensas ni pierna pesada). Se escriben en TypeScript (`scripts/plan-templates.ts`) y `npm run seed:sql` genera `supabase/seed/plan_templates.json` y las migraciones (tests que fallan si no están sincronizados). Solo usan `exercise_id` de la biblioteca (test).
  - HYROX y DEKA: formato comúnmente conocido; **todas** las distancias, reps y pesos de competición están en `src/lib/plan/competition.ts` (verificados en la 5B).
  - Onboarding `/onboarding` (6 pasos, barra de progreso, «Saltar paso» y «Saltar todo», sin navegación inferior): objetivos + principal, nivel y marcas (1RM, 5K, 100 m) + año de nacimiento y altura, días/semana, minutos y días preferidos, lugar, material y molestias, actividades fijas (frontón, surf, yoga, otra: días y minutos), compromiso y ciudad. Reutiliza `commitments` (precargado; solo crea uno si no hay o si se marca «cambiar») y la ciudad de referencia (`CitySearch`, compartido con `/perfil/ciudad`). Sale desde «Hoy» si no hay fila en `training_profiles`; se reabre desde Perfil → «Perfil de entrenamiento». Al terminar lleva a elegir plan.
  - `/plan/elegir`: plantilla recomendada por reglas (familia por objetivo principal, nivel por experiencia, variante con menos días si no le caben), filtros por familia y nivel, detalle con la semana 1 ya repartida en sus días, avisos y elección del lunes de inicio. Crear sustituye el plan activo (con confirmación).
  - Programador (`src/lib/plan/schedule.ts`): prueba todas las combinaciones de días de cada semana y elige la de menor coste (días preferidos, días de actividad fija, pierna pesada el día antes o el mismo día de frontón/surf, dos intensas seguidas incluso domingo→lunes, días seguidos y orden de la plantilla). Determinista; si algo no se puede evitar, avisa.
  - Pestaña Plan (`/plan`): semana a semana (`?semana=`), planificado frente a hecho (incluidas sesiones hechas fuera del plan y las pendientes de subir), actividades fijas en su día, «N de M hechas», semana del plan. Por sesión: detalle de la prescripción, «Empezar ahora» (crea la sesión en curso prellenada con series, reps del suelo del rango, pesos de la última vez, intervalos, EMOM/AMRAP y circuitos, enlazada con `plannedSessionId`), «Hecha» (enlazando una sesión registrada ese día o sin registrar), «Mover» (a otro día; guarda el original) y «Saltar», con deshacer. Terminar o cambiar el plan.
  - Enlace: `save_workout_session` ya guardaba `planned_session_id`; el trigger marca la planificada como hecha al guardar la sesión terminada, la libera si se cambia el enlace y la devuelve a pendiente si se borra la sesión.
  - Service worker: se cachean también `/progreso/musculos`, `/progreso/carga`, `/plan`, `/plan/elegir` y `/onboarding` (abren sin conexión en frío); el plan activo, las plantillas y el perfil de entrenamiento se copian en IndexedDB.
  - Tests: Vitest de plantillas (12, formato, descarga, días, ejercicios existentes, sin ejercicios repetidos por bloque, +10 % de la tirada larga), programador, recomendación, conversión a sesión, calendario, perfil y textos; PGlite de plantillas (solo lectura), `create_user_plan`, RLS, permisos por columna, trigger de enlace y `set_planned_session_done`; E2E `tests/e2e/onboarding-plan.spec.ts` (usuario nuevo → onboarding → Híbrido → 16 sesiones en L/X/V/S sin pierna el día antes del frontón → sesión desde el plan queda «Hecha»).
- Hecho (Fase 5B):
  - Datos de competición verificados por el propietario en `src/lib/plan/competition.ts` (HYROX Open y DEKA FIT), sin «pendiente de verificar» salvo las 75 wall balls de mujer (comentario: verificar en hyrox.com, cambio 2025/26). Se quitan las categorías Pro (no verificadas). Pesos por sexo en `standard: { men, women }` de cada ejercicio de plantilla; se muestran según `profiles.sex` (sin definir u «otro»: los dos). Pregunta opcional de sexo en el onboarding (paso 2).
  - Migraciones `0022_seed_plan_templates_hyrox_deka_verified.sql` (generada; actualiza las 4 plantillas con `on conflict do update`; `0021` queda congelada y fuera del generador) y `0023_phase5b.sql` (`planned_sessions.heavy_legs` + relleno desde la plantilla, `create_user_plan` que lo guarda, refresco de los bloques pendientes de planes HYROX/DEKA ya creados, `daily_checkins` con RLS, RPC `recent_exercise_sets`).
  - «Hoy»: sesión planificada del día con «Empezar planificada» (+ «Ver qué toca»), «Entreno libre» y «Actividad»; pendientes de días anteriores de la semana con «Hacer ahora» / «Saltar»; sin plan, enlace para elegir uno.
  - Sugerencia de peso (`src/lib/workout/suggestion.ts`, §10): sobre las 2 últimas sesiones del ejercicio (series de trabajo con el peso más alto). Techo del rango en todas → +2,5 kg (tren superior) / +5 kg (tren inferior: principal en quads, glutes, hamstrings, adductors o calves); reps por debajo del suelo → mantener, y si también falló la anterior → −10 % (redondeo a 0,5 kg); RIR ≥ 3 en todas las series con RIR → subir; si no, mantener. Se precarga en las series pendientes al empezar una sesión del plan (rango prescrito) y al añadir un ejercicio en un entreno libre (rango por defecto 6–10 compuestos, 8–12 accesorios), con el motivo bajo el ejercicio y «Usar X kg» para volver al de la última vez. Historial en IndexedDB (`hist:`) para funcionar sin conexión.
  - Check-in diario (`src/lib/checkin.ts`, tarjeta en «Hoy»): 4 filas 1–5, se guarda solo al tocar la cuarta; local-first en IndexedDB y subida al momento o al volver la conexión; «Ahora no» lo oculta hasta mañana; «Cambiar» lo edita.
  - Adherencia al plan (hechas / las que ya tocaban: anteriores a hoy o ya hechas) en Plan y en Cumplimiento, aparte del compromiso. «Mi compromiso» ofrece «Usar las de mi plan» (sesiones de la semana con más sesiones).
  - Aviso de carga baja (ACWR < 0,8) activo solo con plan activo y datos suficientes (`useHasActivePlan`).
  - Mover una sesión comprueba las reglas (pierna pesada el día antes o el mismo día de frontón/surf, dos intensas seguidas, otra sesión ese día): ⚠ en los días del selector y aviso (toast) al mover; no bloquea.
  - Tests: Vitest de sugerencia (reglas, rangos, incrementos, aplicar/deshacer), reglas al mover, adherencia al plan, atrasadas, sesión desde el plan con sugerencia, textos por sexo, datos de competición y check-in offline (fake-indexeddb); PGlite de 0022/0023 (plantillas tras dos pasadas, heavy_legs, relleno y refresco, RLS y rangos de `daily_checkins`, `recent_exercise_sets`); E2E `tests/e2e/today-plan.spec.ts`. El mock E2E respeta ahora el filtro `ended_at not null` del historial.
- Hecho (Fase 6A):
  - Migración `0024_ai_coach.sql`: `ai_interactions` (RLS: solo lectura propia y `accepted` editable; sin insert/delete directos), `begin_ai_interaction` (límite diario atómico con bloqueo por usuario, en su zona horaria; los fallos del proveedor no cuentan), `finish_ai_interaction`, `ai_calls_today`, `create_user_plan` con `p_source` (`template` | `ai`) y `p_notes` (se borra la versión de 4 argumentos; las llamadas antiguas siguen valiendo), `planned_sessions.adjusted_from` y RPC `apply_daily_adjust` / `revert_daily_adjust`.
  - Proveedor configurable (`src/server/ai/config.ts`): `AI_PROVIDER` gemini (por defecto) | anthropic, `GEMINI_API_KEY`, `GEMINI_MODEL` (por defecto `gemini-2.5-flash`), `ANTHROPIC_API_KEY`, `AI_MODEL` (por defecto `claude-sonnet-5`; en la 6A ponía `claude-sonnet-5-5` por error), `AI_DAILY_LIMIT` (20). Adaptadores en `src/server/ai/providers/` (Gemini por REST con `responseJsonSchema`; Anthropic con `@anthropic-ai/sdk` y `output_config.format`). El JSON Schema se genera desde Zod y se reduce al subconjunto común (`json-schema.ts`). `/api/health` informa de la IA (solo booleanos).
  - `generateStructured` (`src/server/ai/structured.ts`): JSON → Zod → comprobaciones propias (exercise_id existentes, sesiones por semana); si falla, un reintento con los errores; si vuelve a fallar, se descartan los ejercicios inventados (y bloques/sesiones vacíos) o error amable. Todo queda en `ai_interactions` (entrada resumida, salida, tokens, estado).
  - Context builder puro (`src/lib/ai/context.ts`) + carga en servidor con RLS (`load-context.ts`): perfil de entrenamiento (sin nombre ni email; sexo y edad), compromiso vigente, plan activo (semana, sesiones de la semana, adherencia), 4 semanas de carga, ACWR, sesiones de 14 días, series por músculo de 7 días, descuidados, PRs de 28 días y check-ins de 7 días; lista de ejercicios y plantilla base solo cuando hacen falta. Sin fotos, notas ni medidas.
  - System prompt (§11) en `src/server/ai/prompts.ts`.
  - «Elegir plan»: tarjeta «Personalizar con IA» → «Recomiéndame un plan» (parte de la plantilla recomendada por reglas) y «Personalizar con IA» en cada plantilla. Vista previa con resumen, semanas 1–4, lunes de inicio y avisos del programador; «Editar» (nombre, quitar sesiones o ejercicios, series y reps), «Descartar» y «Aceptar» (crea el plan con `source = 'ai'`, repartido en sus días con el programador de la fase 5; recupera de la plantilla base los estándares HYROX/DEKA).
  - «Hoy»: botón «¿Ajusto el entreno de hoy?» en la sesión planificada pendiente (destacado si el check-in indica cansancio: energía o sueño ≤ 2, agujetas ≥ 4 o estrés 5). Tarjeta con decisión (mantener, reducir, cambiar, descansar), motivo y sesión propuesta; Aceptar aplica en la base de datos la propuesta guardada (no la del cliente), Descartar la marca como no aceptada. «Deshacer» devuelve la prescripción original.
  - Sin clave, sin conexión, con la cuota del proveedor agotada o al llegar al límite diario: mensaje en español y la app sigue igual. Consultas restantes del día visibles.
  - `vercel.functions.maxDuration = 60` (Nitro) para que generar un plan no se corte.
  - Tests (sin llamar a la API real): Vitest de esquemas, JSON Schema, validación y descarte de exercise_id, context builder, edición de la propuesta, servicio con proveedor simulado (reintento, descarte, límite diario, errores del proveedor, keep/rest sin sesión) y adaptadores con fetch/cliente simulados; PGlite de 0024 (límite, RLS, finish, create_user_plan con origen, aplicar/deshacer/descanso, propuestas ajenas); E2E `tests/e2e/ai-coach.spec.ts` contra un simulador de Gemini en el mock (`GEMINI_BASE_URL`): check-in energía 1 + agujetas 5 → reducir, solo al aceptar, deshacer, descartar y cuota agotada; «Recomiéndame un plan» → editar → aceptar.
- Hecho (Fase 6B):
  - Correcciones: modelo por defecto de Anthropic `claude-sonnet-5`. `GEMINI_FALLBACK_MODEL` (opcional): si el modelo principal devuelve 429 o `RESOURCE_EXHAUSTED`, se reintenta una vez con el de reserva antes del aviso; el resto de la consulta (reintento por salida no válida) va ya a la reserva (`src/server/ai/providers/fallback.ts`). `ai_interactions.model` guarda el modelo que respondió. Si el reintento por salida no válida falla por el proveedor, vale la primera respuesta quitando lo inválido.
  - E2E del 6×400 m estable: la causa era que el reloj simulado seguía el tiempo real entre pasos y, tras cada recuperación, la serie siguiente empezaba 1 s antes de desbloquear: solo quedaba 1 s de margen para la deriva (con la máquina cargada se leía 1:31 o el parcial salía de 91 s). Ahora el reloj está parado mientras corre el temporizador (`page.clock.pauseAt`, solo avanza con `fastForward`) y los tiempos se comprueban exactos (EMOM «0:30»; parciales 88/89/89/88/89/89 s). 10 pasadas completas seguidas en verde.
  - Migración `0025_ai_coach_review_chat.sql`: `ai_interactions.period` (semana revisada) y `responses` (índice → accepted/discarded), `begin_ai_interaction` con `p_period` (error `ai_in_progress` si ya hay una revisión de esa semana en curso), `finish_ai_interaction` con `p_model`, `ai_chat_messages` (RLS: leer y borrar lo propio; se escribe solo con `save_chat_turn`, que copia la respuesta guardada de la consulta), `respond_ai_change` (aceptar o descartar un cambio de la revisión o del chat: `modify`, `move`, `skip`, `add`; aplica la propuesta guardada; `modify`/`skip` guardan `adjusted_from` y se deshacen con `revert_daily_adjust`).
  - Revisión semanal (`/plan/revision` + tarjeta en «Hoy»): revisa la semana anterior (lunes a domingo). Se genera sola la primera vez que se abre «Hoy» (o la pantalla) esa semana, una vez por dispositivo; queda guardada en `ai_interactions` y volver a abrirla no llama a la IA. Datos calculados por la app (`src/lib/ai/review.ts`): sesiones por tipo, compromiso, adherencia al plan, carga sRPE frente a la semana anterior, ACWR al acabar la semana, músculos descuidados (0 series esa semana y la anterior), con > 20 series y récords. La IA añade titular, resumen, 3 recomendaciones y hasta 4 cambios para las sesiones pendientes de esta semana, como tarjetas Aceptar / Descartar. «Regenerar» con confirmación (gasta 1 consulta). Sin sesiones ni plan esa semana no se pide nada.
  - Chat (`/entrenador`, desde «Hoy» y Plan): context builder + los últimos 10 mensajes (recortados a 800 caracteres) + el mensaje nuevo (máx. 1000). Si la IA responde bien se guardan pregunta y respuesta; si falla, no se guarda nada y el texto vuelve a la caja. Cambios del plan (hasta 3, sesiones pendientes de los próximos 14 días) como tarjetas aceptables, nunca aplicados directamente. Consultas restantes visibles; «Borrar conversación».
  - Validación de cambios (`src/lib/ai/validate.ts`): sesión pendiente del rango, un cambio por sesión, fechas en rango, ejercicios existentes y sin plan activo ningún cambio; primero reintento con los errores, después se quitan los inválidos.
  - Sustituir con IA (§11.6): botón «Pedir una alternativa a la IA» en «Sustituir» solo cuando las reglas no encuentran alternativa; el servidor vuelve a comprobar las reglas (si hay alternativa, no llama a la IA: `rules_available`). Devuelve 1–3 `exercise_id` existentes y distintos del original (reintento y descarte); elegir una la marca como aceptada.
  - Frases de equivalencias: siguen siendo plantillas deterministas; se quita la reescritura con IA de §10B (ahorra cuota; la IA no aporta datos).
  - Tests: Vitest con proveedor simulado (`src/server/ai/coach-6b.test.ts`: caché de la revisión, regenerar, sin datos, en curso, datos deterministas, modelo de reserva y config, validación de cambios del chat, reparación tras 429 en el reintento, ids de la sustitución y reglas primero); PGlite `tests/db/ai-6b.test.ts` (periodo, modelo, en curso, `save_chat_turn`, RLS del chat, `respond_ai_change` en sus 4 acciones, doble respuesta, propuestas y sesiones ajenas, fechas al pasado); E2E `tests/e2e/ai-coach-6b.spec.ts` (revisión generada una vez, aceptar/descartar, reabrir sin gastar, regenerar; chat con 429 → reserva, tarjeta aceptada, historial tras recargar, cuota agotada). El simulador de Gemini acepta `{ __status: 429 }` en la cola.
- Hecho (Fase 6C):
  - Migración `0026_exercise_technique.sql` (generada con `npm run seed:sql` desde `supabase/seed/exercise_technique.json`): columnas `exercises.technique_steps` y `technique_mistakes` (text[], por defecto vacías, máx. 8 elementos) y relleno de los 58 ejercicios globales (3–4 pasos y 2–3 errores cada uno). Solo actualiza filas con `owner_id is null`; los propios no se tocan. `technique_notes` se conserva como resumen (se muestra en los propios o si no hay pasos).
  - Imágenes: solo **free-exercise-db** (github.com/yuhonas/free-exercise-db, **Unlicense / dominio público**; no exige atribución, se da igualmente). **wger no se usó**: `wger.de` está bloqueado por la red del entorno (además sus imágenes son CC BY-SA, con atribución por imagen). Mapeo revisable en `src/data/exercise-images.json` (ejercicio → id de la fuente, índice de imagen → posición inicial/final, nota si la imagen es una variante; `unmatched` con el motivo de cada ejercicio sin imagen). Cada par se revisó mirando las imágenes; se descartaron los dudosos (p. ej. el «Air_Bike» de la fuente es un abdominal).
  - **30 ejercicios con imagen, 28 sin imagen** (HYROX/DEKA mayoritariamente, cardio, natación, deportes, gemelos, swing, thruster, box jump…). 59 WebP en `public/exercises/{id}-{start|end|hold}.webp` (máx. 480 px, ≤ 34 KB; 936 KB en total) generados con `scripts/exercise-images.ts` (`npm i --no-save sharp && node scripts/exercise-images.ts`; sharp no es dependencia).
  - Componente `src/components/workout/exercise-technique.tsx`: imágenes (`loading="lazy"`, aviso si no cargan sin conexión), pasos, errores, notas, «Ver técnica en vídeo» (`techniqueVideoUrl`: `youtube.com/results?search_query=técnica {nombre}`, pestaña nueva, también en ejercicios propios) y fuente con enlace al ejercicio original.
  - Biblioteca: detalle con la técnica. Sesión: el nombre del ejercicio (con ⓘ) abre la hoja de técnica; también «Ver técnica» en el menú ⋮ y en los nombres de los bloques con temporizador (EMOM, AMRAP…). La hoja es un portal: la sesión y el temporizador siguen montados.
  - Service worker: `/exercises/` fuera de la precarga (`isLazyPublicFile`); caché primero en `exercise-images-v1`, que sobrevive a los deploys. Se guardan al verlas una vez.
  - Perfil → «Créditos» (`/perfil/creditos`): fuente, autoría y licencia de las imágenes; nota sobre los vídeos de YouTube.
  - Copias del catálogo en IndexedDB anteriores a 6C se normalizan (pasos y errores vacíos hasta refrescar con conexión).
  - Tests: Vitest (`src/lib/workout/exercise-images.test.ts`: cobertura de técnica 3–4/2–3, todos los ejercicios mapeados o en `unmatched`, archivos WebP ≤ 50 KB sin sobrantes, rutas, URL de vídeo, exclusión de la precarga); PGlite `tests/db/technique.test.ts` (dos pasadas, lectura autenticada, propios intactos al reaplicar, límite de elementos); E2E `tests/e2e/technique.spec.ts` (biblioteca sin peticiones de imágenes en la lista, detalle con imágenes/pasos/vídeo/fuente, caché tras verlas, ejercicio sin imagen; en sesión, la hoja se abre con el descanso en marcha y este sigue corriendo al cerrar). `E2E_SCREENSHOTS=<dir>` guarda capturas a 375 px.
- Hecho (Fase 7A):
  - Migración `0027_partner_sharing.sql`: `partner_links.can_view_muscles` y `can_view_achievements` (se borra `can_view_photos` si existiera); `shares_with_me` con los 5 permisos (cualquier otro, p. ej. `photos`, es false) y `are_linked`; políticas de lectura de pareja en `personal_records` (entrenos), `exercises` propios (entrenos o músculos; `exercise_muscles` hereda) y `milestones_shown` (logros); se quitan posibles políticas de pareja en fotos. RPC security definer por permiso: `partner_session_log` (RPE solo con músculos; distancia, tonelaje y reps solo con logros), `partner_exercise_sets` (músculos), `partner_home` (logros). `invite_partner`/`respond_partner_link` dejan todo lo nuevo desactivado. `list_partners()` sustituye a `list_partner_links()` (otro nombre para que 0012 se pueda volver a ejecutar). Tablas `pair_invites` (RPC `create_pair_invite`, `update_pair_invite`, `respond_pair_invite`, `cancel_pair_invite`) y `reactions` (`toggle_reaction`, `mark_reactions_seen`).
  - Mi biblioteca filtra `owner_id is null or = yo` (con permisos la RLS también devuelve los propios de la otra persona).
  - Perfil → «Pareja y amigos»: lista de personas (lo que compartes y te comparte) → `/perfil/vinculos/$partnerId` con 5 interruptores (`role="switch"`), aviso de fotos siempre privadas, «Ver la evolución» y «Deshacer vínculo». Toast en cada cambio.
  - `/pareja/$partnerId` «Evolución de {nombre}»: pestañas solo de lo compartido (`?ver=`); cumplimiento (`AdherenceOverview` + reacción a su semana), entrenos (historial → `/pareja/$partnerId/sesion/$sessionId`, récords → `/pareja/$partnerId/ejercicio/$exerciseId`), músculos (`MuscleMapView` + `LoadView`), logros (`AchievementsView` con su ciudad y frases en tercera persona) y medidas (`MetricsChart` + lista). Componentes extraídos de las pantallas propias con un «owner» (`src/lib/partners/hooks.ts`): `SessionBody`, `RecordsList`, `ExerciseProgressView`, `MuscleMapView`, `LoadView`, `AchievementsView`, `MetricsChart`. Los datos de otra persona no se copian en IndexedDB.
  - Entreno en pareja (`src/lib/partners/pair.ts`, `src/components/partners/pair.tsx`): «Entrenar con…» en «Empezar entreno» (elige persona y tipo), en la planificada de «Hoy» y en Plan; invitación en «Hoy» (caduca a las 12 h) con «Unirme» / «Ahora no»; aviso en la sesión en curso («Esperando a que… se una», reenviar la estructura actual, cancelar; «Entrenando con…»); `LocalSession.pairGroupId` viaja en `save_workout_session`; comparación lado a lado en el resumen con reacción a su sesión.
  - Reacciones (`src/components/partners/reactions.tsx`): botones en «Nosotros», en su cumplimiento, en sus sesiones y en la comparación; recibidas bajo mi fila de «Nosotros» y en el detalle de mi sesión; aviso discreto en «Hoy» que se cierra con un toque.
  - Tests: PGlite `tests/db/partner-sharing.test.ts` (cada permiso activado y desactivado y sin fugas entre permisos, fotos nunca ni con todo activado, tercero sin acceso, solo la fila propia, efecto inmediato, invitaciones a entrenar, pair_group_id y reacciones, revocar y volver a vincular); Vitest `src/lib/partners/pair.test.ts`; E2E `tests/e2e/partners.spec.ts` (secciones según permisos, interruptores, unirse a un entreno en pareja). `E2E_SCREENSHOTS=<dir>` guarda capturas a 375 px.
- Hecho (Fase 7B):
  - Entreno en pareja: en un entreno libre, mientras la invitación está pendiente, la estructura se reenvía sola (1,5 s tras el último cambio) al añadir, quitar o reordenar ejercicios; comparación por firma estable (`pairTemplateSignature`, claves ordenadas porque jsonb las reordena). Si falla (sin red, error), aparece el botón «Enviarle la estructura actual» como respaldo y se reintenta al volver la conexión. Si la otra persona ya se ha unido no es error. Al pulsar «Unirme» se relee la invitación para usar la estructura más reciente.
  - Notificaciones push (Web Push + VAPID, `web-push` en servidor): migración `0028_push_notifications.sql` (`push_subscriptions` con RPC `save_push_subscription` —un endpoint es de un solo usuario—, `notification_settings` con hora en tramos de 15 min y zona horaria validada, `push_log` solo service role). Service worker con `push` y `notificationclick`. Perfil → «Notificaciones» (`/perfil/notificaciones`): activar en este dispositivo, prueba de envío, preferencias (invitaciones, reacciones, recordatorio del plan, aviso de semana por detrás) y, para el admin, generador de claves VAPID y `CRON_SECRET` en el navegador. En iPhone se avisa de que hay que instalar la PWA. Al cerrar sesión se borra la suscripción del dispositivo; al abrir la app se reasigna al usuario que ha entrado.
  - Avisos por evento: tras `create_pair_invite` y `toggle_reaction` (solo al poner) el cliente llama a `notifyPairInvite` / `notifyReaction`; el servidor comprueba con la sesión del usuario (RLS) que la invitación o reacción existe y es suya, respeta las preferencias del destinatario y no repite (`push_log`: una por invitación y una por persona y semana/sesión).
  - Recordatorios programados: **pg_cron + pg_net** (Supabase Free) llaman cada 15 min a `/api/push/cron` con `CRON_SECRET` (comparación en tiempo constante). Vercel Cron en Hobby solo permite 1 ejecución diaria con ±59 min: descartado. Por usuario activo, en su zona horaria, desde la hora elegida y durante 2 h: 1 notificación al día como máximo (`daily:YYYY-MM-DD`) que junta la sesión planificada pendiente de hoy y el aviso suave (faltan ≥ días que quedan, o menos de lo prorrateado; nunca si hoy ya entrenó). Configuración en `supabase/snippets/push_cron.sql` (URL y secreto en Vault).
  - Exportar (`/perfil/exportar`): CSV en ZIP (sesiones con carga sRPE, series con nombre del ejercicio, medidas, récords, compromisos; RFC 4180 con BOM y protección contra fórmulas), JSON completo de 21 tablas del usuario (filtradas por su id, paginadas de 1000 en 1000) y ZIP aparte de fotos (URLs firmadas). ZIP sin compresión escrito a mano (`src/lib/export/files.ts`), sin dependencias.
  - Imagen para compartir (`src/lib/share/`): PNG 1080 × 1920 en canvas (logro, semana completada, récord), vista previa en una hoja y Web Share API con archivos (o descarga). Botones en «Mis logros» (cada métrica), pop-up de logro, resumen de sesión (cada récord) y Cumplimiento (semana actual o pasada completada). Sin medidas, fotos, notas ni datos de otras personas.
  - Pulido: la variante `dark:` de Tailwind apuntaba a una clase `.dark` que nunca se ponía (ninguna clase `dark:` se aplicaba): ahora sigue a `prefers-color-scheme`. Tokens `--success`, `--warning`, `--trophy` en claro y oscuro en vez de colores fijos; `color-scheme` y `theme-color` por modo. Animación del récord (rebote, trofeo y destellos; nada con `prefers-reduced-motion`). Accesibilidad: botones ≥ 44 px (los compactos amplían el área táctil con un pseudo-elemento), `Switch` común con `role="switch"`, hojas con `aria-labelledby`, contraste de blanco sobre verde subido. Rendimiento: gráficas y mapa ya iban en chunks aparte (Recharts solo en Progreso); `preconnect` a Supabase para «Hoy».
  - Seguridad: migración `0029_security_hardening.sql` (sin EXECUTE en las funciones de trigger SECURITY DEFINER; `are_linked` solo responde si quien pregunta es una de las dos personas). Test `tests/db/security.test.ts` que falla si alguna tabla de public no tiene RLS, alguna SECURITY DEFINER no fija `search_path`, anon puede ejecutar alguna o leer tablas de usuario. Revisado: service role solo en `src/server` y `src/routes/api`; ninguna clave secreta en el bundle del cliente ni en el repo (solo `.env.example`).
  - README con manual de uso y mantenimiento (migraciones, variables, push, pausa de Supabase, proveedor de IA).
  - Tests: Vitest de recordatorios (zona horaria, ventana, semana por detrás, mensaje), envío push (caducadas, sin repetir, sin dispositivos), CSV/ZIP/exportación, tarjetas y `wrapText`, firma de la plantilla; PGlite de 0028 y seguridad; E2E `tests/e2e/phase7b.spec.ts` (exportar JSON/CSV, Notificaciones sin claves, modo oscuro) y en `partners.spec.ts` la sincronización automática.
- Pendiente / posibles mejoras (Fase 7B y plan completo):
  - Validar push en móviles reales: iOS solo con la PWA instalada (16.4+); Android/Chrome sin restricciones. Los recordatorios llegan con hasta 15 min de retraso.
  - No hay importación del JSON exportado (restaurar sería a mano con SQL).
  - Una carrera: si la otra persona se une justo mientras se envía un cambio, puede empezar con la estructura anterior.
  - Recordatorios solo de la sesión de hoy; sin avisos de check-in ni de revisión semanal.
  - Si el proyecto de Supabase se pausa, pg_cron se para con él (no hay recordatorios hasta restaurarlo).
  - Mejoras posibles: importar copia, «Mis logros» de periodos anteriores, imagen de la semana con reparto por tipo, notificación al aceptar un vínculo, integración con relojes (fuera de alcance §14).
- Pendiente / deuda técnica (Fase 7A):
  - Invitar a entrenar juntos, unirse y reaccionar necesitan conexión; la evolución de otra persona también (no se precachea ni se copia en el móvil, a propósito).
  - La estructura de un entreno libre no se sincroniza sola: quien invita pulsa «Enviarle la estructura actual» mientras la otra persona no se ha unido. Después, cada sesión va por su cuenta.
  - Con «Entrenos» la otra persona ve también las notas de la sesión (se avisa en el interruptor).
  - Nombres de las personas desvinculadas: sus reacciones antiguas dejan de mostrarse.
  - No hay notificación push de la invitación: aparece al abrir «Hoy» (se consulta cada minuto con la app abierta).
- Pendiente / deuda técnica (Fase 6C):
  - Imágenes de wger: si se quieren, permitir `wger.de` en la red del entorno y respetar CC BY-SA (atribución por imagen). Con free-exercise-db no hay más candidatos fiables para HYROX/DEKA.
  - Las imágenes solo se ven sin conexión si se han abierto antes con conexión.
  - Los ejercicios propios no tienen imágenes ni pasos estructurados (solo notas y vídeo); crear/editar pasos propios no está en la UI.
  - Los textos de técnica son generales: no sustituyen a un profesional.
- Pendiente / deuda técnica (Fase 6B):
  - La revisión se genera al abrir la app, no el lunes a una hora fija (sin cron en el plan gratuito). La generación automática se intenta una vez por dispositivo y semana; si falla, se reintenta a mano desde la pantalla.
  - Regenerar crea respuestas nuevas: lo aceptado en la revisión anterior sigue aplicado, pero sus tarjetas ya no se ven.
  - `move` y `add` no pasan por las reglas del programador (pierna pesada antes del frontón…): se confía en el prompt y el usuario decide. `move` no se puede deshacer desde la tarjeta (se puede mover otra vez desde Plan).
  - Chat, revisión y sustitución necesitan conexión; `/entrenador` y `/plan/revision` no se precachean en el service worker.
  - Solo se envían al chat los últimos 10 mensajes; en pantalla se ven los últimos 60.
- Pendiente / deuda técnica (Fase 6A):
  - Modelo de Gemini por defecto `gemini-2.5-flash` sin verificar en la documentación oficial (sin acceso desde el entorno): comprobar en ai.google.dev el nombre vigente del plan gratuito y cambiar `GEMINI_MODEL` si hace falta.
  - Generar un plan puede tardar 20–60 s (una llamada larga; si reintenta, más). Si el proveedor tarda más de ~55 s se muestra error.
  - La IA necesita conexión; sus propuestas no se guardan en el móvil (si se cierra la hoja, se pierde la propuesta, pero la consulta cuenta).
  - Solo se ajusta la sesión de hoy; el ajuste no mueve sesiones de otros días.
- Pendiente / deuda técnica (Fase 5):
  - Cambios del plan (crear, mover, saltar, marcar hecha) necesitan conexión; sin red se ve la última copia. Una sesión hecha desde el plan sin conexión se ve «Hecha» enseguida y se enlaza al sincronizar.
  - Nivel «avanzado» usa las plantillas de intermedio.
  - Las reps de la sesión desde el plan se precargan con el suelo del rango: para que la progresión doble funcione hay que anotar las reps hechas.
  - El check-in solo se ve y edita en «Hoy» (el del día); su uso llega con la IA (fase 6). Si se hace en dos móviles el mismo día, gana el último que sube.
  - Planes HYROX/DEKA creados antes de 0023: las sesiones ya hechas conservan su nota antigua.
- Pendiente / deuda técnica (fases anteriores):
  - El mapa muscular sin conexión usa la última copia del rango consultado; si no se había abierto ese rango, solo cuentan las sesiones guardadas en el móvil.
  - Validar en móvil real (sobre todo iOS: Wake Lock, sonido en segundo plano, PWA instalada y caché de páginas; cámara y compresión de fotos HEIC).
  - Botón «Compartir» de la tarjeta de logro (imagen): fase 7. (Reescritura de frases con IA: descartada en la 6B.)
  - «Mis logros» solo muestra el periodo en curso (sin navegar a semanas o meses anteriores).
  - Si no hay conexión ni copia local de `milestones_shown` (primer uso sin red), no se enseñan pop-ups para no repetir alguno.
  - Los valores de las semillas de equivalencias son aproximados: revisarlos si se quiere más precisión.
  - Los récords solo se ven con conexión y tras sincronizar (se calculan en el servidor); el resumen lo indica.
  - Medidas y fotos requieren conexión (sin cola offline).
  - Los E2E necesitan `npm run build` antes y, en este contenedor, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
  - Temporizadores: en iOS con la pantalla bloqueada no suenan (limitación de las PWA); el estado se corrige al volver. No hay notificaciones programadas.
  - El ritmo medio en el historial usa la duración total de la sesión (incluye recuperaciones); el detalle usa el tiempo en movimiento.
  - E2E contra Supabase real: el test usa un mock de PostgREST/Auth (`tests/e2e/mock-supabase.ts`); no cubre RLS reales (eso lo cubren los tests PGlite).
  - Filtro por material usa `training_profiles.equipment`, vacío hasta el onboarding (fase 5).
  - Si el usuario cierra sesión con sesiones sin sincronizar, se quedan en la cola del dispositivo y se suben cuando vuelva a entrar ese usuario.
  - Warnings de build `MODULE_LEVEL_DIRECTIVE` ("use client"): inofensivos.
  - Componentes shadcn copiados a mano (registro no accesible desde el entorno).
- Decisiones tomadas:
  - Sesión de Supabase en cookies (`@supabase/ssr`) para que SSR y funciones de servidor conozcan al usuario; `getUser()` valida el JWT en cada comprobación de servidor.
  - `role` y `active` no son editables por el usuario (GRANT de UPDATE solo en columnas personales); solo se cambian con service role desde servidor.
  - Desactivar = `profiles.active = false` + ban largo en Auth (invalida el refresh token); reactivar quita el ban.
  - El primer admin se crea a mano: usuario en Supabase Auth + `supabase/snippets/make_admin.sql`.
  - Login con código de 6 dígitos además del enlace, porque en iOS la PWA instalada no comparte sesión con Safari.
  - Enums como `text` + `CHECK` (más fáciles de hacer idempotentes que `CREATE TYPE`).
  - Variables `VITE_SUPABASE_*`: el servidor las lee en tiempo de ejecución (`process.env`) y las pasa al navegador con `window.__PUBLIC_ENV__`; el valor incrustado por Vite en el build queda como respaldo. Así un build sin esas variables no rompe la app (causa del 500 en el primer deploy).
  - Registro local-first: la sesión se edita en el dispositivo y se sube entera (snapshot) con `save_workout_session`; los ids (uuid) los genera el cliente, así los reintentos son idempotentes y `client_rev` evita que una copia antigua pise una nueva.
  - Cada ejercicio es un bloque `straight`; una superserie es un bloque con varios ejercicios. El orden y el descanso por ejercicio se guardan en `session_blocks.config.exercises`.
  - Bloques con temporizador: `config = { exercises: [{exercise_id, rest_s, target_reps}], settings: {kind, …} }` y `result = {kind, …}`, en snake_case. El estado del temporizador no se sube al servidor (solo el resultado); vive en IndexedDB.
  - AMRAP genera al terminar una serie por ejercicio y ronda completada (reps objetivo); las reps sueltas quedan en `result`.
  - `session_blocks` y `exercise_sets` llevan `user_id` (regla general de tablas de usuario) y su RLS exige además que la sesión sea propia.
  - Cardio y deportes no tienen músculos en la semilla: el mapa usará la aproximación por tipo de sesión (§6) en la fase 4.
  - Series de peso corporal (dominadas, fondos, flexiones) se registran solo con reps y no suman tonelaje (v1).
  - PRs en SQL (trigger de sentencia que rehace el historial del ejercicio afectado): así editar o borrar una sesión antigua deja los récords correctos. Cada fila es un evento de récord; `previous_value = null` es la primera marca (referencia, no se celebra). «Reps con un peso»: récord si ninguna serie anterior tiene ≥ peso y ≥ reps. «Mejor ritmo» solo con series de ≥ 1 km (≥ 100 m en natación); en bici se muestra como km/h.
  - Compromiso de una semana = el que la cubre entera (lunes a domingo). «Quitar» pone `valid_to` = hoy: la semana en que se quita a medias queda sin compromiso y desde ese día no hay compromiso vigente (`currentCommitment`). Borrar una entrada del historial es un DELETE directo (RLS propia); esas semanas quedan sin compromiso.
  - Compromiso: `valid_from` siempre es el lunes de la semana en que se guarda (la semana en curso ya se mide con el nuevo); cambiarlo dos veces en la misma semana sustituye el de esa semana. Con reparto por tipo, cada tipo solo llena sus huecos y lo que sobra llena los huecos libres (sesiones/semana − suma del reparto); el resto es «+N extra». El % semanal de la barra es hasta 100 % + extra; el mensual también: objetivo = comprometidas prorrateadas por días y redondeadas (mínimo 1), hasta 100 % + extra, y «Mes parcial» si el prorrateo es < 1. Minutos: suma de todas las sesiones de la semana (sin mínimo de 15 min). Media de 3 meses: 13 semanas terminadas, cada una hasta 100 %.
  - Fase 7A: permisos por persona en la fila de cada dirección; lo que no es tabla propia de la otra persona (mapa, carga, logros) llega por RPC security definer que devuelven solo las columnas de ese permiso, no por RLS sobre sus sesiones. Entreno en pareja por invitación con la estructura (la otra persona crea su propia sesión con su propio id), en vez de escribir en las tablas de otro usuario.
  - Vínculos: una fila por dirección (`user_id` = quien comparte, `partner_id` = quien ve). El estado solo cambia por RPC; el usuario solo puede actualizar los permisos de su propia fila (GRANT por columnas). El cumplimiento de la pareja llega por `partner_adherence_days` (solo días y tipos de sesión ≥ 15 min, en la zona horaria del que mira), nunca por lectura directa de sesiones. Los nombres de la otra persona salen de `list_partner_links` (security definer); `profiles` sigue siendo solo propio.
  - Todas las consultas de datos propios filtran por `user_id` (con permisos de pareja la RLS también devolvería filas ajenas).
  - Equivalencias: `equivalence_objects` añade `label_plural` y `article` (para «un tractor» / «3,4 tractores» / «la Torre Eiffel»); `phrase_template` usa `{qty}`. Las rutas a nado son objetos `distance_route`; la natación usa esas rutas + destinos `water_route` desde casa. Tonelaje: solo ejercicios `weight_reps`. Claves de hito `{métrica}_{periodo}[_{clave}]_{id}` (métricas `run|swim|bike|dist|tonnage|time`).
  - Aproximación de cardio (§6): cada músculo de la lista recibe 2 series por cada 30 min (yoga 0,5), proporcional a la duración (`sessionMinutes`); «otro», fuerza y functional no suman aproximación. Las series de ejercicios de cardio (sin músculos en la semilla) no suman nada: solo cuenta la aproximación por tipo de sesión.
  - Escala del mapa con decimales: 0 si 0; 1–5 si ≤ 5; 6–10 si ≤ 10; 11–20 si ≤ 20; >20 el resto (5,5 va a 6–10).
  - Descuidado = 0 series (incluida la aproximación) en la semana elegida y la anterior o más (se mira hasta 4 semanas; «4+»). Solo si la primera sesión es anterior a esas 2 semanas, para no marcar todo a un usuario nuevo.
  - ACWR «acoplado»: agudo = carga de los últimos 7 días (hoy incluido); crónico = carga de los últimos 28 días / 4. Datos insuficientes si la primera sesión es posterior a hoy − 27 días o la carga crónica es 0. Las sesiones sin RPE no suman carga (se avisa de cuántas hay).
  - Planes: `planned_sessions.blocks` guarda la **prescripción** en el formato de las plantillas (§9: series, rango de reps, RIR, distancias…), no el de `session_blocks`; se convierte en bloques reales al empezar la sesión (`src/lib/plan/to-session.ts`). Columnas añadidas a `planned_sessions`: `week`, `intensity`, `duration_min`, `notes` y `original_date`. `moved` = pendiente cambiada de día.
  - Cada sesión de plantilla lleva `intensity` (easy/moderate/hard) y `heavy_legs` para el programador; en los circuitos cada ejercicio aparece una vez por ronda (la carrera de DEKA va en un solo ejercicio «en tramos»).
  - `user_plans` y `planned_sessions` solo se crean por RPC (security definer con `auth.uid()` e `is_active()`); el usuario solo puede actualizar `date`, `original_date` y `status` de las planificadas (y `status`, `name`, `notes` del plan). El enlace con la sesión registrada solo lo escriben el trigger y `set_planned_session_done`. Crear un plan archiva el activo y borra sus pendientes desde la fecha de inicio del nuevo; lo hecho se conserva.
  - Onboarding hecho = existe la fila de `training_profiles` («Saltar todo» la crea con lo que haya). Formato jsonb: `goals {selected, main}`, `availability {days_per_week, minutes_per_session, preferred_days (1 = lunes), places}`, `fixed_activities [{type, days, minutes, label}]`, `benchmarks {squat_1rm_kg, bench_1rm_kg, deadlift_1rm_kg, run_5k_s, swim_100m_s}`; se valida con Zod al leer (`src/lib/plan/profile.ts`). Objetivo «Nadar mejor» añadido a los de §11.1 para poder recomendar natación.
  - IA: la propuesta aceptada la aplica la base de datos leyendo `ai_interactions.output` (el cliente solo manda ids). Plan de la IA = formato de plantilla (§9) con `day_hint`; el reparto en días lo hace el programador determinista. `ai_interactions.status`: pending | ok | invalid | error; el límite diario cuenta todo menos `error`.
  - Diagnóstico: `/api/health` (qué variables existen en runtime y en build, solo true/false), `errorComponent` raíz en español renderizado en servidor y logs `console.error` con stack (root `beforeLoad`, `onCatch`, middleware global en `src/start.ts`).

---

## 14. Fuera de alcance (por ahora)
- Integración directa con Garmin, Strava o Apple Health (los datos del reloj se introducen a mano).
- Nutrición y planes de dieta.
- Funciones sociales abiertas, rankings públicos o app nativa.
