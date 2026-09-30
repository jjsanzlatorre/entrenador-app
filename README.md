# Entrenador

PWA privada de entrenamiento personal para un grupo pequeño (por invitación). Especificación
completa en [`CLAUDE.md`](./CLAUDE.md).

Stack: TanStack Start (React + TypeScript) · Tailwind + shadcn/ui · Supabase · Vercel. Todo en
planes gratuitos (Supabase Free, Vercel Hobby, Gemini gratis).

---

## Manual de uso

### Instalar la app en el móvil

- **iPhone / iPad (Safari)**: abre la web → botón **Compartir** → **Añadir a pantalla de inicio**.
  Ábrela siempre desde ese icono (las notificaciones solo funcionan así, con iOS 16.4 o posterior).
- **Android (Chrome)**: menú ⋮ → **Instalar aplicación** (o «Añadir a pantalla de inicio»).
- Para entrar: tu email → te llega un enlace y un código de 6 dígitos. En la app instalada de
  iPhone usa el **código** (el enlace se abre en Safari, que no comparte sesión con la app).
  También puedes poner una contraseña en **Perfil → Contraseña**.

### Invitar a alguien con un enlace (sin email)

1. **Perfil → Pareja y amigos → Invitar con enlace**. Se crea un código (p. ej.
   `K7P4-QX2M-AB3C`) y se abre el menú de compartir del móvil; también hay **Compartir por
   WhatsApp** y **Copiar enlace**.
2. La otra persona abre `…/unirse/CÓDIGO`, pone nombre, email y contraseña y entra directamente
   (sin correo de confirmación). Quedáis vinculados (solo el cumplimiento) y pasa al onboarding y
   a las instrucciones para instalar la app.
3. Cada enlace sirve para **una persona** y caduca a los **7 días**. En la misma pantalla ves su
   estado (pendiente, usada por…, caducada, anulada) y puedes **Anular**.
4. Si su email ya tenía cuenta, le pide iniciar sesión y, al entrar, os vincula igualmente.

Por defecto solo invita el admin. En **Perfil → Invitaciones y usuarios** puede activar
**Permitir que los usuarios inviten** y el máximo de invitaciones activas por persona (3).
Nadie puede registrarse sin un código válido.

### Invitar por email, desactivar y contraseña temporal (solo admin)

**Perfil → Invitaciones y usuarios**: invitar por email (requiere SMTP), desactivar/reactivar un
usuario y **Generar contraseña temporal** (si alguien la olvida y no hay email): se muestra una
sola vez para copiarla o mandarla por WhatsApp, y al entrar le obliga a cambiarla.

### Vincularse con la pareja o amigos

1. **Perfil → Pareja y amigos** → escribe el email de la otra persona (tiene que tener cuenta).
2. La otra persona acepta en la misma pantalla.
3. Al aceptar, los dos veis el **cumplimiento** del otro (tarjeta «Nosotros» en Hoy). El resto
   está desactivado hasta que cada uno lo active, persona a persona: **Entrenos**, **Mapa
   muscular y carga**, **Logros** y **Medidas**. Las fotos nunca se comparten.
4. Tocando su nombre en «Nosotros» ves **Evolución de {nombre}** con lo que te comparte.
5. **Entrenar juntos**: «Entrenar con…» en Hoy o en una sesión del plan. Le llega la misma sesión
   (sin tus pesos) y cada uno apunta los suyos. En un entreno libre, si añades, quitas o
   reordenas ejercicios antes de que se una, le llegan solos.
6. Reacciones 👏 🔥 💪 a su semana y a sus sesiones compartidas.

### Notificaciones

**Perfil → Notificaciones** → activa «Recibir notificaciones aquí» en cada móvil y pulsa
**Enviar una prueba**. Eliges qué recibir: invitaciones a entrenar, reacciones, recordatorio de
la sesión del día (a la hora que elijas) y un aviso suave si la semana va por detrás del
compromiso (como mucho uno al día). Todo se puede desactivar.

### Compartir un logro

En **Mis logros**, en el resumen de una sesión con récord, en **Cumplimiento** (semana
completada) o en el pop-up de un logro, pulsa **Compartir**: se genera una imagen vertical que
se comparte con la hoja nativa del móvil (Instagram, WhatsApp…) o se descarga. No lleva medidas,
fotos ni notas.

### Exportar mis datos (copia de seguridad)

**Perfil → Exportar mis datos**:

- **CSV (ZIP)**: sesiones, series, medidas, récords y compromisos, para Excel/Numbers/Sheets.
- **JSON**: todo lo tuyo; guárdalo de vez en cuando como copia de seguridad.
- **Fotos (ZIP)**: opcional, aparte.

---

## Mantenimiento (para el admin)

### Aplicar migraciones

No hay CLI: se pegan en **Supabase → SQL Editor**, en orden numérico, de una en una
(`supabase/migrations/0001_…` → la última). Son **idempotentes**: si dudas de si una ya está
aplicada, vuelve a ejecutarla. Cuando una entrega trae migraciones nuevas, pega solo las nuevas,
en orden. `supabase/snippets/` contiene SQL de un solo uso (no son migraciones).

### Puesta en marcha desde cero

**Supabase**

1. Crea un proyecto (plan Free).
2. SQL Editor → pega **todas** las migraciones en orden (`0001` … `0032`).
   Comprueba en **Storage** que el bucket `progress-photos` es privado.
3. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**.
4. **Authentication → URL Configuration**: Site URL `https://TU-APP.vercel.app` y Redirect URL
   `https://TU-APP.vercel.app/auth/callback`.
5. **Emails**: el correo de Supabase solo envía a miembros del proyecto y con un límite bajo.
   Configura un SMTP gratuito en **Authentication → Emails → SMTP Settings** (Gmail con
   contraseña de aplicación o Brevo). Opcional: añade `{{ .Token }}` a la plantilla de Magic
   Link para que llegue también el código de 6 dígitos.
6. Primer admin: **Authentication → Users → Add user** (con Auto Confirm) y ejecuta
   `supabase/snippets/make_admin.sql` con tu email.

**Vercel**

1. **Add New → Project** → importa el repo. Preset **TanStack Start** (o **Other**); build y
   salida por defecto.
2. **Settings → Environment Variables** (Production y Preview), ver tabla abajo.
3. Deploy. Tras cambiar variables, **Redeploy**.
4. Comprueba `https://TU-APP.vercel.app/api/health` (solo muestra `true`/`false`, nunca valores).

### Variables de entorno

| Variable                    | Obligatoria | Dónde se obtiene                                               |
| --------------------------- | ----------- | -------------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | sí          | Supabase → Project Settings → API → Project URL                |
| `VITE_SUPABASE_ANON_KEY`    | sí          | clave `anon` / publishable                                     |
| `SUPABASE_SERVICE_ROLE_KEY` | sí          | clave `service_role` / secret (**nunca** con prefijo `VITE_`)  |
| `AI_PROVIDER`               | no          | `gemini` (por defecto) o `anthropic`                           |
| `GEMINI_API_KEY`            | no          | Google AI Studio → Get API key                                 |
| `GEMINI_MODEL`              | no          | por defecto `gemini-2.5-flash`                                 |
| `GEMINI_MODEL_HEAVY`        | no          | modelo para planes y revisión semanal (vacío = `GEMINI_MODEL`) |
| `GEMINI_FALLBACK_MODEL`     | no          | modelo de reserva si el principal devuelve 429                 |
| `ANTHROPIC_API_KEY`         | no          | console.anthropic.com (solo con `AI_PROVIDER=anthropic`)       |
| `AI_MODEL`                  | no          | por defecto `claude-sonnet-5`                                  |
| `AI_DAILY_LIMIT`            | no          | consultas por usuario y día (20)                               |
| `VAPID_PUBLIC_KEY`          | no          | Perfil → Notificaciones → «Generar claves nuevas» (admin)      |
| `VAPID_PRIVATE_KEY`         | no          | ídem (secreta)                                                 |
| `VAPID_SUBJECT`             | no          | `mailto:tu@email`                                              |
| `CRON_SECRET`               | no          | ídem; el mismo valor va en `supabase/snippets/push_cron.sql`   |

Solo las `VITE_*` llegan al navegador. El resto solo existen en el servidor.

### Activar las notificaciones push

1. Aplica `0028_push_notifications.sql` y `0029_security_hardening.sql`.
2. En la app, como admin: **Perfil → Notificaciones → Generar claves nuevas**. Las claves se
   generan en tu navegador; copia las tres.
3. Vercel → Environment Variables: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` y
   `VAPID_SUBJECT` (`mailto:tu@email`) → **Redeploy**. `/api/health` debe mostrar
   `"push": { "configured": true, "CRON_SECRET": true }`.
4. Invitaciones y reacciones ya funcionan: cada persona activa las notificaciones en su móvil.
5. Recordatorios programados: Supabase → SQL Editor → abre
   `supabase/snippets/push_cron.sql`, cambia la URL de tu app y el `CRON_SECRET`, y ejecútalo.
   Activa `pg_cron` y `pg_net` (incluidas en el plan Free) y programa una llamada cada 15 min a
   `/api/push/cron`. Al final del archivo tienes consultas para comprobar que va (código 200) y
   para desactivarlo.

Por qué así: Vercel Cron en el plan Hobby solo permite un cron **diario** con ±59 min de
precisión, que no sirve para avisar a la hora que elige cada persona. pg_cron (Supabase Free)
permite ejecutar cada minuto y pg_net hace la llamada HTTP; el envío (cifrado Web Push) lo hace
Vercel. Son unas 3.000 llamadas al mes, muy por debajo de los límites gratuitos.

Si cambias las claves VAPID, cada persona tiene que volver a activar las notificaciones.

### Si Supabase pausa el proyecto

En el plan Free, Supabase pausa los proyectos tras ~1 semana sin actividad. Con los
recordatorios activos (pg_cron llama a Vercel y este consulta la base de datos cada 15 min)
normalmente no ocurre, pero si pasa:

1. Supabase → tu proyecto → **Restore project** (tarda unos minutos). Los datos no se pierden.
2. La app vuelve a funcionar sola; no hay que tocar Vercel.
3. Si el proyecto lleva pausado más de 90 días puede que ya no se pueda restaurar: por eso
   conviene descargar de vez en cuando la copia JSON desde **Exportar mis datos**.

### Cambiar el proveedor de IA

- Gemini (gratis): `AI_PROVIDER=gemini`, `GEMINI_API_KEY` y, opcional, `GEMINI_MODEL` /
  `GEMINI_MODEL_HEAVY` / `GEMINI_FALLBACK_MODEL`. Con `GEMINI_MODEL_HEAVY`, generar o
  personalizar un plan (también «Crear plan» desde el chat), la revisión semanal y los mensajes
  del chat que piden planificar varios días o sesiones («de hoy al domingo», «esta semana»,
  nombres de días…) usan ese modelo; el resto del chat, el ajuste del día y la sustitución usan
  `GEMINI_MODEL`. La reserva vale para los dos. `/api/health` muestra `heavyModel`. En el chat,
  `/entrenador?debug=1` enseña bajo cada respuesta el modelo usado y los descartes (en ese
  dispositivo; `?debug=0` lo quita).
- Anthropic: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` y, opcional, `AI_MODEL`.
- Cambia las variables en Vercel y haz **Redeploy**. Sin clave, la app funciona sin IA y lo dice.
- `AI_DAILY_LIMIT` limita las consultas por persona y día.

### Copias de seguridad

El plan Free no da copias descargables. Cada persona puede bajar su JSON en **Exportar mis
datos**. Para una copia de todo el proyecto, Supabase → Database → **Backups** (plan de pago) o
un `pg_dump` desde un ordenador con la cadena de conexión.

---

## Desarrollo (lo hace Claude Code en la nube)

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test           # Vitest: lógica, cola offline y SQL (migraciones en PGlite, RLS, seguridad)
npm run build
npm run test:e2e   # Playwright contra un Supabase simulado (requiere build previo)
npm run seed:sql   # regenera las migraciones de semillas desde supabase/seed/*.json
```

En este contenedor Playwright usa el Chromium preinstalado:
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.

## Estructura

```
src/
  routes/            rutas (TanStack Router, basado en archivos)
    _app/            zona autenticada con navegación inferior
    api/             endpoints (health, push/cron)
  server/            funciones de servidor (*.functions.ts) y lógica solo servidor (ai/, push/)
  lib/workout/       dominio del registro (operaciones de sesión, cálculos, búsqueda, API)
  lib/offline/       IndexedDB, cola de escritura y motor de sincronización
  lib/notifications/ push en el cliente y lógica de recordatorios
  lib/export/        exportar datos (CSV, ZIP, JSON)
  lib/share/         imagen para compartir
  sw/sw.js           plantilla del service worker (el build genera /sw.js)
  components/ui/     componentes shadcn
  types/database.ts  tipos de Supabase escritos a mano
supabase/
  migrations/        SQL numerado e idempotente (pegar en el SQL Editor en orden)
  seed/              semillas en JSON
  snippets/          SQL de un solo uso (admin, pg_cron)
public/              manifest, iconos e imágenes de ejercicios
tests/db/            migraciones, RLS, RPC y revisión de seguridad con PGlite
tests/e2e/           Playwright + Supabase simulado
```
