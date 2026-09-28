import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migrationsDir = join(import.meta.dirname, '../../supabase/migrations')

// Stub mínimo del entorno de Supabase (roles, esquema auth y auth.uid()).
const SUPABASE_STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`

export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export async function createDb({ runs = 1 } = {}) {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (let i = 0; i < runs; i++) {
    for (const file of migrationFiles()) {
      await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    }
  }
  return db
}

export async function createUser(db: PGlite, id: string, email: string) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
}

// Ejecuta una consulta como un usuario autenticado (RLS activa).
export async function asUser<T>(db: PGlite, uid: string, sql: string, params: unknown[] = []) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`,
  )
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
