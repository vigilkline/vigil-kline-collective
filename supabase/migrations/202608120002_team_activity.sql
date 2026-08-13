-- Team membership and an auditable, member-visible activity feed.
create table public.workspace_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

alter table public.workspace_activity enable row level security;
create policy "members read activity" on public.workspace_activity
  for select using (public.is_workspace_member(workspace_id));

create or replace function public.workspace_team(target_workspace uuid)
returns table(user_id uuid, email text, role public.workspace_role, joined_at timestamptz)
language sql stable security definer set search_path = public, auth
as $$
  select m.user_id, u.email, m.role, m.joined_at
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = target_workspace
    and public.is_workspace_member(target_workspace)
  order by case when m.role = 'owner' then 0 else 1 end, u.email;
$$;

create or replace function public.invite_workspace_member(target_workspace uuid, member_email text)
returns void language plpgsql security definer set search_path = public, auth
as $$
declare invited_id uuid;
begin
  if not public.is_workspace_owner(target_workspace) then raise exception 'Only the workspace owner can add members'; end if;
  select id into invited_id from auth.users where lower(email) = lower(trim(member_email));
  if invited_id is null then raise exception 'That person needs to sign in to VIGILKLINE once before they can be added.'; end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (target_workspace, invited_id, 'member')
  on conflict (workspace_id, user_id) do nothing;
end $$;

create or replace function public.log_workspace_activity()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare target_workspace uuid; label text; actor text; row_data jsonb;
begin
  if tg_op = 'DELETE' then row_data := to_jsonb(old); else row_data := to_jsonb(new); end if;
  target_workspace := (row_data->>'workspace_id')::uuid;
  select email into actor from auth.users where id = auth.uid();
  label := coalesce(nullif(row_data->>'brand', '') || case when coalesce(row_data->>'description', '') <> '' then ' · ' || row_data->>'description' else '' end,
                    row_data->>'title', row_data->>'store_name', 'record');
  insert into public.workspace_activity (workspace_id, actor_id, actor_email, action, detail)
  values (target_workspace, auth.uid(), actor,
    case when tg_op = 'INSERT' then 'added' when tg_op = 'UPDATE' then 'updated' else 'removed' end,
    left(coalesce(label, 'record'), 180));
  return coalesce(new, old);
end $$;

create trigger inventory_activity after insert or update or delete on public.inventory_items
for each row execute function public.log_workspace_activity();
create trigger session_activity after insert or update or delete on public.thrift_sessions
for each row execute function public.log_workspace_activity();
create trigger calendar_activity after insert or update or delete on public.calendar_entries
for each row execute function public.log_workspace_activity();
create trigger tax_payment_activity after insert or update or delete on public.tax_payments
for each row execute function public.log_workspace_activity();

create index workspace_activity_recent_idx on public.workspace_activity(workspace_id, created_at desc);
grant execute on function public.workspace_team(uuid) to authenticated;
grant execute on function public.invite_workspace_member(uuid, text) to authenticated;
