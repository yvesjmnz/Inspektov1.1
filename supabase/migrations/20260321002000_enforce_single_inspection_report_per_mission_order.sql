with ranked_reports as (
  select
    ir.id,
    row_number() over (
      partition by ir.mission_order_id
      order by
        case
          when lower(coalesce(ir.status, '')) in ('completed', 'complete') then 3
          when lower(coalesce(ir.status, '')) in ('in progress', 'in_progress') then 2
          when lower(coalesce(ir.status, '')) in ('pending inspection', 'pending_inspection', 'pending') then 1
          else 0
        end desc,
        coalesce(ir.completed_at, ir.updated_at, ir.created_at) desc,
        ir.created_at desc,
        ir.id desc
    ) as row_rank
  from public.inspection_reports ir
)
delete from public.inspection_reports ir
using ranked_reports rr
where ir.id = rr.id
  and rr.row_rank > 1;

create unique index if not exists idx_inspection_reports_one_per_mission_order
  on public.inspection_reports (mission_order_id);
