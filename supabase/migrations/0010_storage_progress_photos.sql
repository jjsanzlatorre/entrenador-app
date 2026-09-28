-- 0010_storage_progress_photos.sql
-- Bucket privado progress-photos y sus políticas: cada usuario solo lee, sube y borra
-- archivos dentro de su carpeta {user_id}/. Las fotos se ven con URLs firmadas.
-- Límite de 3 MB por archivo (el cliente comprime a ~1600 px JPEG antes de subir).
-- Idempotente.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 3145728, array['image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "progress_photos_storage_select" on storage.objects;
create policy "progress_photos_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  );

drop policy if exists "progress_photos_storage_insert" on storage.objects;
create policy "progress_photos_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  );

drop policy if exists "progress_photos_storage_delete" on storage.objects;
create policy "progress_photos_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active())
  );
