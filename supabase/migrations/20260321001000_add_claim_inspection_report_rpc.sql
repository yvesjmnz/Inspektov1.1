create or replace function public.claim_mission_order_inspection_report(
  p_mission_order_id uuid
)
returns public.inspection_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_report public.inspection_reports%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated. Please login again.';
  end if;

  if not exists (
    select 1
    from public.mission_order_assignments moa
    where moa.mission_order_id = p_mission_order_id
      and moa.inspector_id = v_user_id
  ) then
    raise exception 'You are not assigned to this mission order.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_mission_order_id::text));

  select ir.*
  into v_report
  from public.inspection_reports ir
  where ir.mission_order_id = p_mission_order_id
  order by
    case
      when lower(coalesce(ir.status, '')) in ('completed', 'complete') then 3
      when lower(coalesce(ir.status, '')) in ('in progress', 'in_progress') then 2
      when lower(coalesce(ir.status, '')) in ('pending inspection', 'pending_inspection', 'pending') then 1
      else 0
    end desc,
    coalesce(ir.completed_at, ir.updated_at, ir.created_at) desc
  limit 1;

  if found then
    if v_report.inspector_id <> v_user_id then
      raise exception 'This mission order already has an inspection slip owned by another assigned inspector.';
    end if;

    if lower(coalesce(v_report.status, '')) not in ('completed', 'complete', 'in progress', 'in_progress') then
      update public.inspection_reports
      set
        status = 'in progress',
        started_at = coalesce(v_report.started_at, now()),
        updated_at = now()
      where id = v_report.id
      returning * into v_report;
    end if;

    return v_report;
  end if;

  insert into public.inspection_reports (
    mission_order_id,
    inspector_id,
    status,
    started_at
  )
  values (
    p_mission_order_id,
    v_user_id,
    'in progress',
    now()
  )
  returning * into v_report;

  return v_report;
end;
$$;

grant execute on function public.claim_mission_order_inspection_report(uuid) to authenticated;
