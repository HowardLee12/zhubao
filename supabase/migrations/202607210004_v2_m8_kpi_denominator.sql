-- Renoly v2 M8 — KPI denominator fix.
--
-- revisitRate must be denominated in UNIQUE reminded customers (api-spec.md line
-- 756: "unique customer 比率"), not reminder rows. The original body counted
-- (select count(*) from reminders), so a customer with two in-window reminders
-- inflated the denominator and understated the rate. CREATE OR REPLACE reproduces
-- the current body verbatim except the revisit denominator now counts
-- (select count(distinct customer_id) from reminders) so both the numerator
-- (distinct revisited customers) and the denominator are per unique customer.
-- Everything else — the {numerator, denominator, window, timezone} shape, all
-- other metrics, and the owner/grants/search_path — is unchanged.

create or replace function public.compute_pilot_dashboard(
  target_org uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_tz text;
  v_from date;
  v_to date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  -- KPI 1
  v_frt_median numeric;
  v_frt_p90 numeric;
  v_frt_denom integer;
  -- KPI 2
  v_accept_num integer;
  v_accept_denom integer;
  -- KPI 3
  v_completed integer;
  v_completion_denom integer;
  -- KPI 4
  v_revisit_num integer;
  v_revisit_denom integer;
  v_window jsonb;
begin
  if not public.has_org_role(
    target_org, array['owner', 'admin', 'dispatcher', 'accountant', 'viewer']::text[]
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select timezone into v_tz from public.organizations where id = target_org;
  v_to := coalesce(p_to, (clock_timestamp() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 30);
  if v_to < v_from then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_INVALID';
  end if;
  if (v_to - v_from) > 366 then
    raise exception using errcode = '22023', message = 'DASHBOARD_RANGE_TOO_LARGE';
  end if;
  -- Convert org-local [from, to] inclusive to a UTC half-open interval.
  v_from_ts := (v_from::text || ' 00:00:00')::timestamp at time zone v_tz;
  v_to_ts := ((v_to + 1)::text || ' 00:00:00')::timestamp at time zone v_tz;
  v_window := jsonb_build_object('from', v_from, 'to', v_to, 'timezone', v_tz);

  -- KPI 1: first response time. Exclude archived/not-applicable intake (declined
  -- with no triage never counts a response; we only measure requests that got one).
  with first_response as (
    select sr.id,
      extract(epoch from (
        min(e.occurred_at) filter (
          where e.event_type in ('service_request.triaged', 'service_request.commented',
                                  'service_request.replied')
        ) - sr.created_at
      )) as seconds
    from public.service_requests sr
    left join public.events e
      on e.organization_id = sr.organization_id
      and e.aggregate_type = 'service_request' and e.aggregate_id = sr.id
    where sr.organization_id = target_org
      and sr.created_at >= v_from_ts and sr.created_at < v_to_ts
      and sr.status <> 'cancelled'
    group by sr.id, sr.created_at
  ),
  responded as (
    -- Fall back to triaged_at when no explicit event exists.
    select coalesce(fr.seconds,
      extract(epoch from (sr.triaged_at - sr.created_at))) as seconds
    from public.service_requests sr
    join first_response fr on fr.id = sr.id
    where coalesce(fr.seconds, extract(epoch from (sr.triaged_at - sr.created_at))) is not null
      and coalesce(fr.seconds, extract(epoch from (sr.triaged_at - sr.created_at))) >= 0
  )
  select
    percentile_cont(0.5) within group (order by seconds),
    percentile_cont(0.9) within group (order by seconds),
    count(*)
  into v_frt_median, v_frt_p90, v_frt_denom
  from responded;

  -- KPI 2: quote acceptance. Denominator = distinct requests with a first sent
  -- quote in window; numerator = those whose quote was accepted.
  with sent_quotes as (
    select q.service_request_id, min(qv.sent_at) as first_sent_at,
      bool_or(qv.status = 'accepted') as accepted
    from public.quotes q
    join public.quote_versions qv
      on qv.organization_id = q.organization_id and qv.quote_id = q.id
    where q.organization_id = target_org
      and qv.sent_at is not null
      and qv.sent_at >= v_from_ts and qv.sent_at < v_to_ts
    group by q.service_request_id
  )
  select count(*) filter (where accepted), count(*)
  into v_accept_num, v_accept_denom
  from sent_quotes;

  -- KPI 3: completion rate. Completed WO in window / (completed + cancelled +
  -- still-open work orders whose payment milestone is overdue).
  select
    count(*) filter (where wo.status = 'completed'
      and wo.completed_at >= v_from_ts and wo.completed_at < v_to_ts),
    count(*) filter (where
      (wo.status = 'completed' and wo.completed_at >= v_from_ts and wo.completed_at < v_to_ts)
      or (wo.status = 'cancelled' and wo.cancelled_at >= v_from_ts and wo.cancelled_at < v_to_ts)
    )
  into v_completed, v_completion_denom
  from public.work_orders wo
  where wo.organization_id = target_org;

  -- KPI 4: revisit rate (dedup by customer, counted once). Denominator = unique
  -- reminded customers whose reminder scheduled_at is in window; numerator = unique
  -- customers with a revisit-linked request created within 30 days after such a
  -- reminder. Both sides are per unique customer (api-spec.md: "unique customer 比率").
  with reminders as (
    select n.id, n.related_id as plan_id, n.scheduled_at,
      mp.customer_id
    from public.notifications n
    join public.maintenance_plans mp
      on mp.organization_id = n.organization_id and mp.id = n.related_id
    where n.organization_id = target_org
      and n.template_key = 'maintenance_reminder'
      and n.status in ('sent', 'delivered')
      and n.scheduled_at >= v_from_ts and n.scheduled_at < v_to_ts
      and n.related_type = 'maintenance_plan'
  ),
  matched as (
    select distinct r.customer_id
    from reminders r
    join public.service_requests sr
      on sr.organization_id = target_org
      and sr.origin_maintenance_plan_id = r.plan_id
      and sr.created_at >= r.scheduled_at
      and sr.created_at < r.scheduled_at + interval '30 days'
  )
  select
    (select count(*) from matched),
    (select count(distinct customer_id) from reminders)
  into v_revisit_num, v_revisit_denom;

  return jsonb_build_object(
    'window', v_window,
    'metrics', jsonb_build_object(
      'firstResponseTime', jsonb_build_object(
        'available', v_frt_denom > 0,
        'medianSeconds', v_frt_median, 'p90Seconds', v_frt_p90,
        'numerator', v_frt_denom, 'denominator', v_frt_denom,
        'window', v_window, 'timezone', v_tz
      ),
      'quoteAcceptanceRate', jsonb_build_object(
        'available', v_accept_denom > 0,
        'numerator', v_accept_num, 'denominator', v_accept_denom,
        'window', v_window, 'timezone', v_tz
      ),
      'completionRate', jsonb_build_object(
        'available', v_completion_denom > 0,
        'numerator', v_completed, 'denominator', v_completion_denom,
        'window', v_window, 'timezone', v_tz
      ),
      'revisitRate', jsonb_build_object(
        'available', v_revisit_denom > 0,
        'numerator', v_revisit_num, 'denominator', v_revisit_denom,
        'window', v_window, 'timezone', v_tz
      )
    )
  );
end;
$$;

alter function public.compute_pilot_dashboard(uuid, date, date) owner to renoly_rls_owner;
revoke all on function public.compute_pilot_dashboard(uuid, date, date) from public, anon, service_role;
grant execute on function public.compute_pilot_dashboard(uuid, date, date) to authenticated;
