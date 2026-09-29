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
grant usage on schema public, auth to anon, authenticated, service_role;
-- Como en Supabase: service role tiene todos los permisos sobre lo que se cree en public.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid default auth.uid()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`

export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

// `only`: aplica solo algunas migraciones (p. ej. las anteriores a una migración de datos).
export async function createDb({
  runs = 1,
  only,
}: { runs?: number; only?: (file: string) => boolean } = {}) {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (let i = 0; i < runs; i++) await applyMigrations(db, only)
  return db
}

export async function applyMigrations(db: PGlite, only?: (file: string) => boolean) {
  for (const file of migrationFiles().filter((f) => !only || only(f))) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
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
