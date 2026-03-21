-- Keep the smart inspector rotation rule aligned with the assignment UI:
-- cancelled mission orders must not count toward the current-month business/barangay cap.

create or replace function public.get_inspector_smart_recommendations(
  p_business_pk integer,
  p_brgy_no text,
  p_exclude_mission_order_id uuid default null
)
returns table (
  inspector_id uuid,
  full_name text,
  active_pending_count integer,
  last_completed_at timestamptz,
  idle_days integer,
  rule1_blocked boolean,
  rule1_reason text,
  recommended_rank integer,
  is_top_recommended boolean
)
language sql
stable
as $$
with
params as (
  select
    p_business_pk as business_pk,
    nullif(trim(p_brgy_no), '') as brgy_no,
    p_exclude_mission_order_id as exclude_mission_order_id,
    date_trunc('month', now()) as month_start,
    (date_trunc('month', now()) + interval '1 month') as month_end
),
ins as (
  select p.id as inspector_id, p.full_name
  from public.profiles p
  where p.role = 'inspector'
),
active_workload as (
  select
    t.inspector_id,
    count(distinct t.mission_order_id)::int as active_pending_count
  from (
    select ir.inspector_id, ir.mission_order_id
    from public.inspection_reports ir
    where lower(coalesce(ir.status, '')) in ('in_progress', 'in progress', 'pending_inspection', 'pending inspection')

    union

    select moa.inspector_id, moa.mission_order_id
    from public.mission_order_assignments moa
    left join public.mission_orders mo on mo.id = moa.mission_order_id
    where lower(coalesce(mo.status, '')) in ('in_progress', 'in progress', 'pending_inspection', 'pending inspection')
  ) t
  group by t.inspector_id
),
last_done as (
  select
    ir.inspector_id,
    max(ir.completed_at) as last_completed_at
  from public.inspection_reports ir
  where ir.completed_at is not null
  group by ir.inspector_id
),
month_rotation as (
  select
    moa.inspector_id,
    count(*) filter (
      where (params.business_pk is not null and c.business_pk = params.business_pk)
    )::int as month_business_count,
    count(*) filter (
      where (params.brgy_no is not null and b.brgy_no = params.brgy_no)
    )::int as month_brgy_count
  from public.mission_order_assignments moa
  join public.mission_orders mo on mo.id = moa.mission_order_id
  left join public.complaints c on c.id = mo.complaint_id
  left join public.businesses b on b.business_pk = c.business_pk
  cross join params
  where moa.assigned_at >= params.month_start
    and moa.assigned_at < params.month_end
    and lower(coalesce(mo.status, '')) not in ('cancelled', 'canceled')
    and (params.exclude_mission_order_id is null or moa.mission_order_id <> params.exclude_mission_order_id)
    and (
      (params.business_pk is not null and c.business_pk = params.business_pk)
      or
      (params.brgy_no is not null and b.brgy_no = params.brgy_no)
    )
  group by moa.inspector_id
),
scored as (
  select
    ins.inspector_id,
    ins.full_name,
    coalesce(aw.active_pending_count, 0) as active_pending_count,
    ld.last_completed_at,
    greatest(
      0,
      floor(extract(epoch from (now() - coalesce(ld.last_completed_at, (now() - interval '3650 days')))) / 86400)
    )::int as idle_days,
    coalesce(mr.month_business_count, 0) as month_business_count,
    coalesce(mr.month_brgy_count, 0) as month_brgy_count
  from ins
  left join active_workload aw on aw.inspector_id = ins.inspector_id
  left join last_done ld on ld.inspector_id = ins.inspector_id
  left join month_rotation mr on mr.inspector_id = ins.inspector_id
),
eligible as (
  select
    s.*,
    (s.month_business_count >= 2 or s.month_brgy_count >= 2) as rule1_blocked,
    case
      when (s.month_business_count >= 2 and s.month_brgy_count >= 2) then
        'Rotation limit: already assigned 2 or more times this month for the same business and barangay.'
      when (s.month_business_count >= 2) then
        'Rotation limit: already assigned to this business 2 or more times this month.'
      when (s.month_brgy_count >= 2) then
        'Rotation limit: already assigned in this barangay 2 or more times this month.'
      else null
    end as rule1_reason
  from scored s
),
ranked as (
  select
    e.*,
    case
      when e.rule1_blocked then null
      else row_number() over (
        order by
          coalesce(e.active_pending_count, 0) asc,
          e.idle_days desc,
          e.full_name asc
      )::int
    end as recommended_rank
  from eligible e
)
select
  r.inspector_id,
  r.full_name,
  coalesce(r.active_pending_count, 0) as active_pending_count,
  r.last_completed_at,
  r.idle_days,
  r.rule1_blocked,
  r.rule1_reason,
  r.recommended_rank,
  (r.recommended_rank = 1) as is_top_recommended
from ranked r
order by
  (r.rule1_blocked)::int asc,
  r.recommended_rank nulls last,
  r.full_name asc;
$$;

grant execute on function public.get_inspector_smart_recommendations(integer, text, uuid) to authenticated;
