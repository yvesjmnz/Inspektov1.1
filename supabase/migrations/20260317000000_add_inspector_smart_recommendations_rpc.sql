-- Intelligent Inspector Assignment System (Smart Recommendations)
-- - Rule 1: Monthly rotation (block if >= 2 assignments this month to same Business OR same Barangay)
-- - Fair-Queue: rank eligible inspectors by (1) lowest active/pending MOs, (2) longest idle time since last completed inspection

create or replace function public.get_inspector_smart_recommendations(
  p_business_pk integer,
  p_brgy_no text
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
    date_trunc('month', now()) as month_start,
    (date_trunc('month', now()) + interval '1 month') as month_end
),
ins as (
  select p.id as inspector_id, p.full_name
  from public.profiles p
  where p.role = 'inspector'
),
-- Active / pending workload: count distinct mission orders assigned to the inspector that are not completed/cancelled.
active_workload as (
  select
    moa.inspector_id,
    count(distinct moa.mission_order_id)::int as active_pending_count
  from public.mission_order_assignments moa
  join public.mission_orders mo on mo.id = moa.mission_order_id
  where lower(coalesce(mo.status, '')) not in ('complete', 'completed', 'cancelled', 'canceled')
  group by moa.inspector_id
),
last_done as (
  select
    ir.inspector_id,
    max(ir.completed_at) as last_completed_at
  from public.inspection_reports ir
  where ir.completed_at is not null
  group by ir.inspector_id
),
-- Monthly rotation counts based on THIS calendar month.
month_rotation as (
  select
    moa.inspector_id,
    -- Count assignments in current month to the same business
    count(*) filter (
      where (params.business_pk is not null and c.business_pk = params.business_pk)
    )::int as month_business_count,
    -- Count assignments in current month to the same barangay
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
    -- If never completed, treat as very idle.
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
        'Rotation limit: already assigned ≥ 2 times this month for the same Business and Barangay.'
      when (s.month_business_count >= 2) then
        'Rotation limit: already assigned to this Business ≥ 2 times this month.'
      when (s.month_brgy_count >= 2) then
        'Rotation limit: already assigned in this Barangay ≥ 2 times this month.'
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
          e.active_pending_count asc,
          e.idle_days desc,
          e.full_name asc
      )::int
    end as recommended_rank
  from eligible e
)
select
  r.inspector_id,
  r.full_name,
  r.active_pending_count,
  r.last_completed_at,
  r.idle_days,
  r.rule1_blocked,
  r.rule1_reason,
  r.recommended_rank,
  (r.recommended_rank = 1) as is_top_recommended
from ranked r
order by
  -- eligible first by rank, then blocked sorted to bottom
  (r.rule1_blocked)::int asc,
  r.recommended_rank nulls last,
  r.full_name asc;
$$;

-- Allow authenticated users to call (adjust as needed for your RLS posture).
grant execute on function public.get_inspector_smart_recommendations(integer, text) to authenticated;

