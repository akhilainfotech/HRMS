create extension if not exists vector with schema extensions;

create type public.app_role as enum ('ADMIN', 'HR', 'EMPLOYEE');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'EMPLOYEE',
  employee_id text unique,
  full_name text not null,
  department text,
  created_at timestamptz not null default now(),
  constraint profiles_employee_identity check (
    (role = 'EMPLOYEE' and employee_id is not null) or role in ('ADMIN', 'HR')
  )
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  work_email text not null unique,
  department text not null,
  designation text not null,
  enrollment_photo_path text,
  face_enrolled_at timestamptz,
  face_model_id text,
  face_consent_at timestamptz,
  face_consent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint employee_id_format check (employee_id ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$')
);

-- Face vectors are biometric identifiers. This table is service-role-only;
-- clients read neither the vectors nor the matching threshold.
create table public.face_templates (
  employee_id text primary key references public.employees(employee_id) on delete cascade,
  embedding extensions.vector(128) not null,
  model_id text not null,
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid not null references auth.users(id) on delete restrict
);

create table public.office_geofences (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null check (radius_meters between 25 and 5000),
  anchor_accuracy_meters double precision check (anchor_accuracy_meters between 0 and 50),
  captured_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.hr_access_settings (
  singleton boolean primary key default true check (singleton),
  permissions jsonb not null default '{"hr_add_employee":true,"hr_geotag_monitor":true,"hr_od_approvals":true,"hr_monthly_download":true}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.duty_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(employee_id) on delete restrict,
  location_name text not null,
  reason text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters between 0 and 50),
  face_similarity double precision not null check (face_similarity between 0 and 1),
  face_model_id text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(employee_id) on delete restrict,
  attendance_date date not null,
  checked_in_at timestamptz not null default now(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters between 0 and 50),
  distance_from_office_meters double precision not null check (distance_from_office_meters >= 0),
  face_similarity double precision not null check (face_similarity between 0 and 1),
  face_model_id text not null,
  created_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

create or replace function public.upsert_employee_face_template(
  p_employee_id text,
  p_embedding extensions.vector(128),
  p_model_id text,
  p_enrolled_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.employees where employee_id = p_employee_id) then
    raise exception 'employee_id does not exist';
  end if;
  insert into public.face_templates(employee_id, embedding, model_id, enrolled_by)
  values (p_employee_id, p_embedding, p_model_id, p_enrolled_by)
  on conflict (employee_id) do update
  set embedding = excluded.embedding, model_id = excluded.model_id,
      enrolled_at = now(), enrolled_by = excluded.enrolled_by;
end;
$$;

create or replace function public.match_employee_face(
  p_employee_id text,
  p_embedding extensions.vector(128)
)
returns table(similarity double precision, model_id text)
language sql
security definer
set search_path = public, extensions
as $$
  select 1 - (f.embedding <=> p_embedding)::double precision, f.model_id
  from public.face_templates f
  where f.employee_id = p_employee_id
  limit 1
$$;

create index attendance_checked_in_at_idx on public.attendance (checked_in_at desc);
create index employees_auth_user_id_idx on public.employees (auth_user_id);

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;
revoke all on function public.upsert_employee_face_template(text, extensions.vector, text, uuid) from public, anon, authenticated;
grant execute on function public.upsert_employee_face_template(text, extensions.vector, text, uuid) to service_role;
revoke all on function public.match_employee_face(text, extensions.vector) from public, anon, authenticated;
grant execute on function public.match_employee_face(text, extensions.vector) to service_role;

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.face_templates enable row level security;
alter table public.office_geofences enable row level security;
alter table public.hr_access_settings enable row level security;
alter table public.duty_requests enable row level security;
alter table public.attendance enable row level security;

grant select on public.profiles, public.employees, public.office_geofences, public.hr_access_settings, public.duty_requests, public.attendance to authenticated;
grant insert, update on public.office_geofences, public.hr_access_settings to authenticated;
grant update on public.duty_requests to authenticated;

create policy profiles_read_self_or_hr on public.profiles for select to authenticated
using (user_id = auth.uid() or public.current_app_role() in ('ADMIN', 'HR'));

create policy employees_read_self_or_hr on public.employees for select to authenticated
using (auth_user_id = auth.uid() or public.current_app_role() in ('ADMIN', 'HR'));
create policy employees_insert_hr on public.employees for insert to authenticated
with check (public.current_app_role() in ('ADMIN', 'HR'));
create policy employees_update_hr on public.employees for update to authenticated
using (public.current_app_role() in ('ADMIN', 'HR'))
with check (public.current_app_role() in ('ADMIN', 'HR'));

create policy office_geofences_read_authenticated on public.office_geofences for select to authenticated
using (true);
create policy office_geofences_admin_write on public.office_geofences for all to authenticated
using (public.current_app_role() = 'ADMIN')
with check (public.current_app_role() = 'ADMIN');

create policy hr_access_settings_read_authenticated on public.hr_access_settings for select to authenticated using (true);
create policy hr_access_settings_admin_write on public.hr_access_settings for all to authenticated
using (public.current_app_role() = 'ADMIN') with check (public.current_app_role() = 'ADMIN');

create policy duty_requests_read_self_or_hr on public.duty_requests for select to authenticated
using (
  employee_id = (select employee_id from public.profiles where user_id = auth.uid())
  or public.current_app_role() in ('ADMIN', 'HR')
);
create policy duty_requests_hr_review on public.duty_requests for update to authenticated
using (public.current_app_role() in ('ADMIN', 'HR'))
with check (public.current_app_role() in ('ADMIN', 'HR'));

create policy attendance_read_self_or_hr on public.attendance for select to authenticated
using (
  employee_id = (select employee_id from public.profiles where user_id = auth.uid())
  or public.current_app_role() in ('ADMIN', 'HR')
);

-- No authenticated/anon policies are defined for face_templates or attendance
-- writes. Trusted server routes use the server-only Supabase service role.
revoke all on public.face_templates from anon, authenticated;
grant select, insert, update, delete on public.face_templates to service_role;
revoke insert, update, delete on public.attendance from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.face_templates from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-face-photos', 'employee-face-photos', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png'];

create policy employee_face_photos_hr_read on storage.objects for select to authenticated
using (bucket_id = 'employee-face-photos' and public.current_app_role() in ('ADMIN', 'HR'));

-- HR enrollment photo writes are performed by an authenticated Next.js route
-- after it verifies the employee record and role; no client upload policy is granted.
