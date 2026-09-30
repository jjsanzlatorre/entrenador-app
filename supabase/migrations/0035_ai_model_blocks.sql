-- 0035_ai_model_blocks.sql
-- Modelos de IA bloqueados por cuota (CLAUDE.md §11, cadena de modelos). La cuota del plan
-- gratuito de Gemini es de la clave (del proyecto), no de cada usuario: si un modelo devuelve
-- 429 por la cuota diaria, no se vuelve a intentar hasta que se renueva (medianoche del
-- Pacífico) y la consulta va directa al siguiente modelo de la cadena. Un 429 por minuto
-- bloquea unos segundos.
-- 1. ai_model_blocks: un registro por modelo (sin políticas: solo por RPC).
-- 2. ai_blocked_models(p_models): los que siguen bloqueados ahora.
-- 3. block_ai_model(...): bloquear (como mucho 36 h; si ya lo estaba, gana el plazo más largo).
-- Solo usuarios activos. Requiere 0001. Idempotente.

create table if not exists public.ai_model_blocks (
  model text primary key check (char_length(model) between 1 and 100),
  blocked_until timestamptz not null,
  scope text check (scope in ('daily', 'minute')),
  reason text check (char_length(reason) <= 300),
  updated_at timestamptz not null default now()
);

alter table public.ai_model_blocks enable row level security;
revoke all on public.ai_model_blocks from anon, authenticated;

create or replace function public.ai_blocked_models(p_models text[])
returns table (model text, blocked_until timestamptz, scope text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  return query
    select b.model, b.blocked_until, b.scope
    from public.ai_model_blocks b
    where b.model = any(p_models) and b.blocked_until > now();
end;
$$;

revoke all on function public.ai_blocked_models(text[]) from public, anon;
grant execute on function public.ai_blocked_models(text[]) to authenticated;

create or replace function public.block_ai_model(
  p_model text,
  p_until timestamptz,
  p_scope text default null,
  p_reason text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  until timestamptz;
begin
  if auth.uid() is null or not public.is_active() then
    raise exception 'not authenticated';
  end if;
  if p_model is null or char_length(p_model) not between 1 and 100 then
    raise exception 'modelo no válido';
  end if;
  if p_until is null or p_until <= now() then
    raise exception 'plazo no válido';
  end if;
  if p_scope is not null and p_scope not in ('daily', 'minute') then
    raise exception 'alcance no válido';
  end if;
  until := least(p_until, now() + interval '36 hours');

  insert into public.ai_model_blocks as b (model, blocked_until, scope, reason, updated_at)
  values (p_model, until, p_scope, left(p_reason, 300), now())
  on conflict (model) do update
    set blocked_until = case
          when b.blocked_until > now() then greatest(b.blocked_until, excluded.blocked_until)
          else excluded.blocked_until
        end,
        scope = case
          when b.blocked_until > excluded.blocked_until and b.blocked_until > now() then b.scope
          else excluded.scope
        end,
        reason = excluded.reason,
        updated_at = now()
  returning b.blocked_until into until;
  return until;
end;
$$;

revoke all on function public.block_ai_model(text, timestamptz, text, text) from public, anon;
grant execute on function public.block_ai_model(text, timestamptz, text, text) to authenticated;
