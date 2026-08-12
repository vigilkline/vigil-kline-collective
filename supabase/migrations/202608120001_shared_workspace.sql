create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'member');
create type public.item_status as enum ('owned', 'ready', 'published', 'sold');
create type public.candidate_decision as enum ('bought', 'passed');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  brand text not null default '',
  description text not null default '',
  size text,
  condition text,
  category text,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  estimated_resale numeric(12,2) check (estimated_resale is null or estimated_resale >= 0),
  status public.item_status not null default 'owned',
  photo_path text,
  source_candidate_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.thrift_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  route_id uuid not null,
  created_by uuid not null references auth.users(id),
  store_name text not null check (char_length(store_name) between 1 and 160),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  budget numeric(12,2) not null default 0 check (budget >= 0),
  spend numeric(12,2) not null default 0 check (spend >= 0),
  projected_resale numeric(12,2) not null default 0 check (projected_resale >= 0),
  projected_profit numeric(12,2) not null default 0,
  driving_seconds integer not null default 0 check (driving_seconds >= 0),
  parking_seconds integer not null default 0 check (parking_seconds >= 0),
  store_seconds integer not null default 0 check (store_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.session_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.thrift_sessions(id) on delete cascade,
  brand text not null default '',
  description text not null default '',
  size text,
  condition text,
  category text,
  tag_price numeric(12,2) not null default 0 check (tag_price >= 0),
  estimated_resale numeric(12,2) check (estimated_resale is null or estimated_resale >= 0),
  decision public.candidate_decision not null,
  photo_path text,
  created_at timestamptz not null default now()
);

alter table public.inventory_items
  add constraint inventory_source_candidate_fk
  foreign key (source_candidate_id) references public.session_candidates(id) on delete set null;

create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(title) between 1 and 240),
  entry_date date not null,
  entry_time time,
  category text,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tax_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.tax_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid()
) $$;

create or replace function public.is_workspace_owner(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.workspace_members
  where workspace_id = target_workspace and user_id = auth.uid() and role = 'owner'
) $$;

create or replace function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_workspace_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(workspace_name)) not between 1 and 80 then raise exception 'Invalid workspace name'; end if;
  insert into public.workspaces (name, created_by)
  values (trim(workspace_name), auth.uid()) returning id into new_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, auth.uid(), 'owner');
  return new_workspace_id;
end $$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.inventory_items enable row level security;
alter table public.thrift_sessions enable row level security;
alter table public.session_candidates enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.tax_settings enable row level security;
alter table public.tax_payments enable row level security;

create policy "members read workspaces" on public.workspaces for select using (public.is_workspace_member(id));
create policy "owners update workspaces" on public.workspaces for update using (public.is_workspace_owner(id));
create policy "members read memberships" on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy "owners manage memberships" on public.workspace_members for all using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

create policy "members read inventory" on public.inventory_items for select using (public.is_workspace_member(workspace_id));
create policy "members insert inventory" on public.inventory_items for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members update inventory" on public.inventory_items for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members delete inventory" on public.inventory_items for delete using (public.is_workspace_member(workspace_id));
create policy "members read sessions" on public.thrift_sessions for select using (public.is_workspace_member(workspace_id));
create policy "members insert sessions" on public.thrift_sessions for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members update sessions" on public.thrift_sessions for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members delete sessions" on public.thrift_sessions for delete using (public.is_workspace_member(workspace_id));
create policy "members manage candidates" on public.session_candidates for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members read calendar" on public.calendar_entries for select using (public.is_workspace_member(workspace_id));
create policy "members insert calendar" on public.calendar_entries for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members update calendar" on public.calendar_entries for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members delete calendar" on public.calendar_entries for delete using (public.is_workspace_member(workspace_id));
create policy "members read tax settings" on public.tax_settings for select using (public.is_workspace_member(workspace_id));
create policy "members insert tax settings" on public.tax_settings for insert to authenticated with check (public.is_workspace_member(workspace_id) and updated_by = auth.uid());
create policy "members update tax settings" on public.tax_settings for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members read tax payments" on public.tax_payments for select using (public.is_workspace_member(workspace_id));
create policy "members insert tax payments" on public.tax_payments for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members update tax payments" on public.tax_payments for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members delete tax payments" on public.tax_payments for delete using (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-photos', 'workspace-photos', false, 7000000, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "members read workspace photos" on storage.objects for select
using (bucket_id = 'workspace-photos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "members upload workspace photos" on storage.objects for insert to authenticated
with check (bucket_id = 'workspace-photos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "members update workspace photos" on storage.objects for update to authenticated
using (bucket_id = 'workspace-photos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "members delete workspace photos" on storage.objects for delete to authenticated
using (bucket_id = 'workspace-photos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create index inventory_workspace_status_idx on public.inventory_items(workspace_id, status);
create index sessions_workspace_started_idx on public.thrift_sessions(workspace_id, started_at desc);
create index candidates_session_idx on public.session_candidates(session_id);
create index calendar_workspace_date_idx on public.calendar_entries(workspace_id, entry_date);
create index tax_payments_workspace_date_idx on public.tax_payments(workspace_id, payment_date desc);
