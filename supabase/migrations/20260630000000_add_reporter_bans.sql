-- Director-managed reporter bans for repeated/spam complaint submissions.

create table if not exists public.reporter_bans (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  reason text not null,
  active boolean not null default true,
  banned_by uuid references public.profiles(id),
  banned_at timestamptz not null default now(),
  unbanned_by uuid references public.profiles(id),
  unbanned_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists reporter_bans_normalized_email_key
  on public.reporter_bans (lower(trim(email)));

alter table public.reporter_bans enable row level security;
grant select on public.reporter_bans to authenticated;

drop policy if exists "Directors can view reporter bans" on public.reporter_bans;
create policy "Directors can view reporter bans"
  on public.reporter_bans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role, '')) = 'director'
    )
  );

create or replace function public.get_reporter_ban_status(p_email text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'banned',
    exists (
      select 1
      from public.reporter_bans rb
      where lower(trim(rb.email)) = lower(trim(coalesce(p_email, '')))
        and rb.active
    )
  );
$$;

revoke all on function public.get_reporter_ban_status(text) from public;
grant execute on function public.get_reporter_ban_status(text) to anon, authenticated, service_role;

create or replace function public.set_reporter_ban(
  p_email text,
  p_reason text default null,
  p_active boolean default true
)
returns public.reporter_bans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_row public.reporter_bans;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'director'
  ) then
    raise exception 'Only a Director can manage reporter bans';
  end if;

  if v_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
    raise exception 'A valid reporter email is required';
  end if;

  if p_active and v_reason = '' then
    raise exception 'A reason is required to ban a reporter';
  end if;

  insert into public.reporter_bans (
    email,
    reason,
    active,
    banned_by,
    banned_at,
    unbanned_by,
    unbanned_at,
    updated_at
  )
  values (
    v_email,
    case when p_active then v_reason else coalesce(nullif(v_reason, ''), 'Ban removed by Director') end,
    p_active,
    case when p_active then auth.uid() else null end,
    case when p_active then now() else now() end,
    case when p_active then null else auth.uid() end,
    case when p_active then null else now() end,
    now()
  )
  on conflict (lower(trim(email)))
  do update set
    reason = case
      when excluded.active then excluded.reason
      else reporter_bans.reason
    end,
    active = excluded.active,
    banned_by = case when excluded.active then auth.uid() else reporter_bans.banned_by end,
    banned_at = case when excluded.active then now() else reporter_bans.banned_at end,
    unbanned_by = case when excluded.active then null else auth.uid() end,
    unbanned_at = case when excluded.active then null else now() end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_reporter_ban(text, text, boolean) from public;
grant execute on function public.set_reporter_ban(text, text, boolean) to authenticated;

create or replace function public.reject_banned_reporter_complaint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.reporter_bans rb
    where lower(trim(rb.email)) = lower(trim(new.reporter_email))
      and rb.active
  ) then
    raise exception 'This email address is not permitted to submit complaints';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_banned_reporter_complaint_trigger on public.complaints;
create trigger reject_banned_reporter_complaint_trigger
  before insert or update of reporter_email
  on public.complaints
  for each row
  execute function public.reject_banned_reporter_complaint();
