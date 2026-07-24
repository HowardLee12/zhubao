begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

------------------------------------------------------------------------------
-- Execute-privilege surface: authenticated yes, anon/service_role no
------------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.list_pilot_members(uuid)', 'EXECUTE'),
  'authenticated can list all pilot members'
);
select ok(
  has_function_privilege('authenticated', 'public.invite_pilot_member(uuid,uuid,text,text,text,text)', 'EXECUTE'),
  'authenticated can invite a pilot member'
);
select ok(
  not has_function_privilege('anon', 'public.invite_pilot_member(uuid,uuid,text,text,text,text)', 'EXECUTE'),
  'anon cannot invite a pilot member'
);
select ok(
  not has_function_privilege('service_role', 'public.invite_pilot_member(uuid,uuid,text,text,text,text)', 'EXECUTE'),
  'service role cannot bypass the invite boundary'
);

------------------------------------------------------------------------------
-- Fixture: an extra, not-yet-member auth user the dispatcher can invite, plus a
-- suspended member so the roster projection can be exercised.
------------------------------------------------------------------------------

reset role;
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('10000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated',
   'alpha.invitee@example.test', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('10000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated',
   'alpha.suspended@example.test', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00')
on conflict (id) do nothing;

insert into public.memberships (
  id, organization_id, user_id, role, status, display_name,
  joined_at, suspended_at, created_by, updated_by
) values (
  '30000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-0000000000a2', 'technician', 'suspended', 'Alpha 停用技師',
  '2026-01-01 00:00:00+00', '2026-01-02 00:00:00+00',
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
);

------------------------------------------------------------------------------
-- Dispatcher (manager) invites a technician into their own org — succeeds
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.invite_pilot_member(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-0000000000a1',
    '  新進技師  ', 'technician', null, 'invite-key-tech-0001'
  ) ->> 'status',
  'active',
  'dispatcher invites a technician; new membership is active'
);

reset role;
select is(
  (select status from public.memberships
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and user_id = '10000000-0000-4000-8000-0000000000a1'),
  'active',
  'invited membership persisted as active'
);
select is(
  (select display_name from public.memberships
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and user_id = '10000000-0000-4000-8000-0000000000a1'),
  '新進技師',
  'display_name is trimmed before persistence'
);
select is(
  (select invited_by from public.memberships
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and user_id = '10000000-0000-4000-8000-0000000000a1'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'invited_by records the inviting manager'
);

-- Capture the original membership id while the base table is readable so the
-- replay assertion below (running as authenticated) needs no direct read.
select set_config(
  'renoly.test.invited_member_id',
  (select id::text from public.memberships
   where organization_id = '20000000-0000-4000-8000-000000000001'
     and user_id = '10000000-0000-4000-8000-0000000000a1'),
  true
);

------------------------------------------------------------------------------
-- Idempotent replay: same key + same body returns the first membership id
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.invite_pilot_member(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-0000000000a1',
    '  新進技師  ', 'technician', null, 'invite-key-tech-0001'
  ) ->> 'id',
  current_setting('renoly.test.invited_member_id'),
  'replaying the same idempotency key returns the original membership'
);

------------------------------------------------------------------------------
-- Duplicate invite of an existing member -> MEMBERSHIP_ALREADY_EXISTS
------------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.invite_pilot_member(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003',
      'Alpha 技師 A 重複', 'technician', null, 'invite-key-dup-0001'
    )$$,
  '23505', 'MEMBERSHIP_ALREADY_EXISTS',
  'inviting a user who already has a membership is rejected'
);

------------------------------------------------------------------------------
-- Role guard: 'owner' can never be created through the invite path
------------------------------------------------------------------------------

select throws_ok(
  $$select public.invite_pilot_member(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-0000000000a1',
      '想當老闆', 'owner', null, 'invite-key-owner-0001'
    )$$,
  '22023', 'PILOT_INVALID_ROLE',
  'owner role is rejected by the invite path'
);

------------------------------------------------------------------------------
-- Technician caller -> FORBIDDEN (not a manager)
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.invite_pilot_member(
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-0000000000a1',
      '技師想邀人', 'technician', null, 'invite-key-forbidden-0001'
    )$$,
  '42501', 'FORBIDDEN',
  'a technician cannot invite members'
);

------------------------------------------------------------------------------
-- Cross-tenant: Alpha dispatcher cannot invite into Beta's org
------------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.invite_pilot_member(
      '20000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-0000000000a1',
      '跨租戶', 'technician', null, 'invite-key-crosstenant-0001'
    )$$,
  '42501', 'FORBIDDEN',
  'a manager cannot invite into another organization'
);

------------------------------------------------------------------------------
-- list_pilot_members: manager gate, roster contents, technician-first ordering
------------------------------------------------------------------------------

select throws_ok(
  $$select public.list_pilot_members('20000000-0000-4000-8000-000000000002')$$,
  '42501', 'FORBIDDEN',
  'list_pilot_members is manager-gated per tenant'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- Roster includes the suspended member (excluded from the assignable picker).
select is(
  (select count(*)::int
   from jsonb_array_elements(
     public.list_pilot_members('20000000-0000-4000-8000-000000000001')
   ) e
   where e ->> 'status' = 'suspended'
     and e ->> 'id' = '30000000-0000-4000-8000-0000000000a2'),
  1,
  'roster includes a suspended member'
);

-- Roster excludes 'removed' members: none exist, so the assignable picker (active
-- only) and this fuller roster differ only by the suspended entry.
select is(
  (select count(*)::int
   from jsonb_array_elements(
     public.list_pilot_members('20000000-0000-4000-8000-000000000001')
   ) e
   where e ->> 'status' = 'removed'),
  0,
  'roster never surfaces removed members'
);

-- Technician-first ordering: the first roster entry is a technician.
select is(
  (public.list_pilot_members('20000000-0000-4000-8000-000000000001') -> 0 ->> 'role'),
  'technician',
  'roster orders technicians first'
);

------------------------------------------------------------------------------
-- guard_membership_owner still enforced: the sole active owner cannot be demoted.
-- The guard is a trigger on the base table, so we drive the write through
-- renoly_rls_owner (the only role with base-table write access) while the JWT sub
-- resolves to the owner — exactly how a membership-mutation RPC would run it.
------------------------------------------------------------------------------

reset role;
set local role renoly_rls_owner;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update public.memberships set role = 'admin'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', 'LAST_ACTIVE_OWNER_REQUIRED',
  'the single active owner cannot be demoted away'
);

reset role;
select * from finish();
rollback;
