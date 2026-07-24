begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into public.assignments (
  id, organization_id, work_order_id, membership_id, duty, status,
  completed_at, assigned_by, created_by, updated_by
) values (
  '83900000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000004',
  'helper', 'completed', statement_timestamp(),
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select ok(public.is_active_member('20000000-0000-4000-8000-000000000001'), 'Alpha owner is active in Alpha');
select ok(not public.is_active_member('20000000-0000-4000-8000-000000000002'), 'Alpha owner is not active in Beta');
select ok(public.has_org_role('20000000-0000-4000-8000-000000000001', array['owner']), 'Alpha owner has owner role');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select ok(public.is_assigned_to_work_order(
  '20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
), 'technician A is assigned to the seeded work order');
select ok(not public.has_org_role(
  '20000000-0000-4000-8000-000000000001', array['owner', 'admin', 'dispatcher']
), 'technician A is not a manager');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select ok(not public.is_assigned_to_work_order(
  '20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
), 'completed historical assignment is not active mutation authority');
select ok(public.has_work_order_assignment_history(
  '20000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001'
), 'completed assignment remains available to a separate read-history decision');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select ok(not public.is_active_member('20000000-0000-4000-8000-000000000001'), 'Beta owner is isolated from Alpha');

select set_config('request.jwt.claim.sub', '', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select ok(
  public.is_active_member('20000000-0000-4000-8000-000000000001'),
  'actor helper supports the PostgREST JWT claims JSON setting'
);

reset role;
select * from finish();
rollback;
