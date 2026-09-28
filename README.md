# Entrenador

PWA privada de entrenamiento personal. Especificación completa en [`CLAUDE.md`](./CLAUDE.md).

Stack: TanStack Start (React + TypeScript) · Tailwind + shadcn/ui · Supabase · Vercel.

## Puesta en marcha (solo con la web de Supabase y Vercel)

### 1. Supabase

1. Crea un proyecto (plan Free).
2. **SQL Editor** → pega y ejecuta, en este orden:
   1. `supabase/migrations/0001_profiles.sql`
   2. `supabase/migrations/0002_training_profiles.sql`
   3. `supabase/migrations/0003_catalog.sql`
   4. `supabase/migrations/0004_workouts.sql`
   5. `supabase/migrations/0005_seed_muscles.sql`
   6. `supabase/migrations/0006_seed_exercises_strength.sql`
   7. `supabase/migrations/0007_seed_exercises_functional_cardio.sql`

   Son idempotentes: si dudas, puedes volver a ejecutarlos.

3. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**. Deja activado el proveedor Email.
4. **Authentication → URL Configuration**:
   - Site URL: `https://TU-APP.vercel.app`
   - Redirect URLs: añade `https://TU-APP.vercel.app/auth/callback`
5. **Emails**: el servidor de correo por defecto de Supabase solo envía a los miembros del equipo del proyecto y con un límite bajo por hora. Para invitar a otra persona, configura un SMTP gratuito en **Authentication → Emails → SMTP Settings** (por ejemplo Gmail con contraseña de aplicación, o Brevo en plan gratuito).
6. (Opcional, recomendado) **Authentication → Emails → Magic Link**: añade `{{ .Token }}` a la plantilla para que el email incluya también el código de 6 dígitos. Sirve para entrar desde la app instalada en iOS.
7. **Primer admin**:
   1. **Authentication → Users → Add user → Create new user**: tu email y una contraseña, con **Auto Confirm User** marcado.
   2. **SQL Editor**: abre `supabase/snippets/make_admin.sql`, cambia el email por el tuyo y ejecútalo.

### 2. Vercel

1. **Add New → Project** → importa este repositorio.
2. Framework Preset: **TanStack Start** (si no aparece, **Other**). No hace falta tocar el comando de build ni el directorio de salida.
3. **Environment Variables** (Production y Preview):

   | Variable                    | Valor (Supabase → Project Settings → API Keys)                |
   | --------------------------- | ------------------------------------------------------------- |
   | `VITE_SUPABASE_URL`         | Project URL                                                   |
   | `VITE_SUPABASE_ANON_KEY`    | clave `anon` / publishable                                    |
   | `SUPABASE_SERVICE_ROLE_KEY` | clave `service_role` / secret (**nunca** con prefijo `VITE_`) |

4. Deploy. Tras cambiar variables, haz **Redeploy**.
5. Comprueba `https://TU-APP.vercel.app/api/health`: debe devolver `"ok": true`. Muestra qué variables existen (solo `true`/`false`, nunca los valores).

## Desarrollo (lo hace Claude Code en la nube)

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test           # Vitest: lógica, cola offline y SQL (migraciones en PGlite)
npm run build
npm run test:e2e   # Playwright contra un Supabase simulado (requiere build previo)
npm run seed:sql   # regenera 0005–0007 desde supabase/seed/*.json
```

En este contenedor Playwright usa el Chromium preinstalado:
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`.

## Estructura

```
src/
  routes/            rutas (TanStack Router, basado en archivos)
    _app/            zona autenticada con navegación inferior
  server/            funciones de servidor (*.functions.ts) y helpers solo servidor (*.server.ts)
  lib/workout/       dominio del registro (operaciones de sesión, cálculos, búsqueda, API)
  lib/offline/       IndexedDB, cola de escritura y motor de sincronización
  sw/sw.js           plantilla del service worker (el build genera /sw.js)
  lib/               utilidades de cliente
  components/ui/     componentes shadcn
  types/database.ts  tipos de Supabase escritos a mano
supabase/
  migrations/        SQL numerado e idempotente (pegar en el SQL Editor en orden)
  seed/              semillas en JSON (fuente de verdad de 0005–0007)
  snippets/          SQL de un solo uso (no son migraciones)
public/              manifest e iconos de la PWA
tests/db/            tests de migraciones, RLS y RPC con PGlite
tests/e2e/           Playwright + Supabase simulado
```
