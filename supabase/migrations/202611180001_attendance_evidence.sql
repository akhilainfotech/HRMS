insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-evidence', 'attendance-evidence', false, 4194304, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
