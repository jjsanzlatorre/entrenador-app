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
  - Solo servidor, sin prefijo: `SUPABASE_SERVICE_ROLE_KEY` (y en la Fase 6 `ANTHROPIC_API_KEY`, `AI_MODEL`).
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
| IA | Anthropic API desde servidor (`ANTHROPIC_API_KEY`, modelo en `AI_MODEL`, por defecto `claude-sonnet-5`) |
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
- **exercises**: `id`, `name`, `aliases` text[], `category` (`strength|functional|cardio|mobility|sport`), `tracking_type` (`weight_reps|reps|time|distance_time|calories|duration_only`), `equipment` text[], `is_unilateral` bool, `is_compound` bool, `default_rest_s`, `technique_notes`, `owner_id` (null = global; si no, ejercicio propio del usuario)
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
- **partner_links**: `id`, `user_id`, `partner_id`, `status` (`pending|accepted|revoked`), `can_view_adherence` bool (por defecto `true` al aceptar), `can_view_sessions` bool (por defecto `false`), `can_view_metrics` bool (por defecto `false`). El vínculo es **mutuo**: se crea por invitación y la otra persona acepta. Cada usuario controla qué comparte con un permiso por dirección. Políticas RLS de lectura adicionales basadas en esta tabla: cumplimiento y compromisos si `can_view_adherence`, sesiones y sets si `can_view_sessions` y métricas corporales si `can_view_metrics` (las fotos **nunca** se comparten).
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

### Entreno en pareja (Fase 7)
- «Entrenar con…» crea dos sesiones enlazadas por `pair_group_id` con la misma estructura; cada uno registra sus propios pesos desde su móvil.

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
- En **Hoy** y en **Cumplimiento** aparece la tarjeta «Nosotros»: la barra semanal y mensual de cada persona vinculada con `can_view_adherence`, junto a la tuya, con su racha.
- La visibilidad es recíproca por defecto al aceptar el vínculo, pero cada uno puede dejar de compartir la suya en cualquier momento.
- Solo se comparten los porcentajes, las rachas y el nº de sesiones por tipo; nunca pesos, notas ni métricas salvo los permisos correspondientes.
- Opcional: reacción rápida (👏 🔥 💪) sobre la semana del otro.

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

Las frases pueden generarse con plantillas (v1). En la Fase 6, la IA puede reescribirlas con más variedad, pero el **dato y la equivalencia salen siempre del cálculo determinista**, nunca de la IA.

---

## 11. Entrenador IA

### Arquitectura
- Funciones de servidor en `src/server/ai/*`. Cliente de Anthropic único, modelo configurable por env.
- Un **context builder** que resume los datos del usuario en JSON compacto: perfil de entrenamiento, plan activo, últimas 2–4 semanas (sesiones, carga, volumen por músculo, PRs, check-ins). Nunca enviar fotos. Enviar solo los datos necesarios para cada caso.
- Toda salida estructurada en **JSON validado con Zod**; si no valida, un reintento; si vuelve a fallar, mostrar un error amable.
- Todo se guarda en `ai_interactions`. **Nada se aplica sin que el usuario pulse «Aceptar»**; se ofrece también «Editar» y «Descartar».
- Límite de uso: máximo N llamadas por usuario y día (configurable).
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

### Fase 7 — Pareja y extras
- Vista de las sesiones de la pareja en solo lectura (si `can_view_sessions`) y reacciones a su semana.
- Entreno en pareja con `pair_group_id`.
- Sustitución de ejercicios con reglas + IA.
- Recordatorios (notificaciones push de la PWA donde el sistema lo permita).
- Exportar los datos del usuario en CSV/JSON.
- Imagen compartible de las tarjetas de logros y de la semana completada.
- Pulido: modo oscuro, animación de PR y accesibilidad.

---

## 13. Estado

_(Claude Code: actualizar al cerrar cada fase.)_

- Fase actual: **0 cerrada en código** (pendiente de validar la aceptación en Supabase/Vercel reales). Siguiente: Fase 1.
- Hecho (Fase 0):
  - TanStack Start (React 19 + TS strict) + Vite 8 + Nitro (salida Vercel), Tailwind v4, componentes shadcn (button, input, label, card, badge), ESLint 10 + Prettier, Vitest.
  - Migraciones `0001_profiles.sql` (profiles, `is_admin()`, `is_active()`, trigger de alta, RLS y grants por columna) y `0002_training_profiles.sql` (RLS `user_id = auth.uid()` + usuario activo). Probadas dos veces seguidas en PGlite con un stub de `auth`.
  - Auth: magic link + código de 6 dígitos + contraseña opcional; `/auth/callback` procesa PKCE, `token_hash` e invitaciones (tokens en `#`).
  - `/admin/invitaciones`: invitar (`inviteUserByEmail`), listar usuarios, desactivar/reactivar (`profiles.active` + ban en Supabase Auth).
  - Bloqueo de inactivos: guardas de ruta (`/_app` → `/bloqueado`), middleware de funciones de servidor (`authMiddleware`, `adminMiddleware`) y RLS (`is_active()`).
  - PWA: `manifest.webmanifest`, iconos (192, 512, maskable, apple-touch), `sw.js` básico (assets cache-first, navegación con pantalla offline).
  - Layout móvil con navegación inferior Hoy · Entrenar · Progreso · Plan · Perfil; Perfil con nombre, contraseña y cierre de sesión.
- Pendiente / deuda técnica:
  - Playwright aún no está en el repo (se añadirá en la Fase 1 con el flujo de registrar sesión).
  - El `sw.js` no cachea páginas ni datos; la persistencia offline real (IndexedDB + cola) es de la Fase 1.
  - Warnings de build `MODULE_LEVEL_DIRECTIVE` ("use client" de lucide-react): inofensivos.
  - Componentes shadcn copiados a mano (el registro de shadcn no es accesible desde el entorno); añadir nuevos igual.
- Decisiones tomadas:
  - Sesión de Supabase en cookies (`@supabase/ssr`) para que SSR y funciones de servidor conozcan al usuario; `getUser()` valida el JWT en cada comprobación de servidor.
  - `role` y `active` no son editables por el usuario (GRANT de UPDATE solo en columnas personales); solo se cambian con service role desde servidor.
  - Desactivar = `profiles.active = false` + ban largo en Auth (invalida el refresh token); reactivar quita el ban.
  - El primer admin se crea a mano: usuario en Supabase Auth + `supabase/snippets/make_admin.sql`.
  - Login con código de 6 dígitos además del enlace, porque en iOS la PWA instalada no comparte sesión con Safari.
  - Enums como `text` + `CHECK` (más fáciles de hacer idempotentes que `CREATE TYPE`).

---

## 14. Fuera de alcance (por ahora)
- Integración directa con Garmin, Strava o Apple Health (los datos del reloj se introducen a mano).
- Nutrición y planes de dieta.
- Funciones sociales abiertas, rankings públicos o app nativa.
