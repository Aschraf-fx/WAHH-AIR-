-- Admin-only access to private Rider profile photos for identity cross-check.
-- Does not alter account, stock, sales, invoice or accounting logic.

drop policy if exists "admin read rider profile photos" on storage.objects;
create policy "admin read rider profile photos"
on storage.objects for select to authenticated
using (bucket_id='rider-profiles' and public.is_admin());
