begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

------------------------------------------------------------------------------
-- M6 — LINE identity ordering watermark (public.apply_line_identity_event).
--
-- The out-of-order gate derives its watermark from customer_line_identities.
-- last_event_at, which must advance on EVERY terminally-processed follow/unfollow
-- (applied OR ignored-as-no_state_change), never regress, and be reachable only
-- by service_role. The shared seed provides Alpha identity a1de..0001 (friend,
-- followed_at 2026-01-03).
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. Grant boundary: service_role only.
------------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.apply_line_identity_event(uuid,timestamptz,text)', 'EXECUTE'),
  'service_role may apply a line identity event'
);
select ok(
  not has_function_privilege('authenticated', 'public.apply_line_identity_event(uuid,timestamptz,text)', 'EXECUTE'),
  'authenticated cannot apply a line identity event'
);
select ok(
  not has_function_privilege('anon', 'public.apply_line_identity_event(uuid,timestamptz,text)', 'EXECUTE'),
  'anon cannot apply a line identity event'
);

------------------------------------------------------------------------------
-- 2. Column exists (watermark).
------------------------------------------------------------------------------
select has_column('public', 'customer_line_identities', 'last_event_at', 'last_event_at column exists');

------------------------------------------------------------------------------
-- 3. The exact review sequence, driven through the RPC as the worker would:
--    follow@100 apply -> follow@150 no_state_change -> unfollow@120 stale-reject.
--    A fresh identity (Alpha customer ...0002, so the (org,customer,channel)
--    unique does not collide with the seed identity on customer ...0001).
------------------------------------------------------------------------------
reset role;
insert into public.customer_line_identities (
  id, organization_id, customer_id, line_channel_id, line_user_id, display_name, friend_status
) values (
  'a1de0000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002', 'a1c00000-0000-4000-8000-000000000001',
  'Uline-watermark-seq-0001', 'watermark seq', 'unknown'
);

set role service_role;

-- follow@100 -> apply friend. status=friend, watermark=100.
select is(
  (public.apply_line_identity_event(
    'a1de0000-0000-4000-8000-0000000000f2',
    '2026-07-20T10:00:00Z'::timestamptz,
    'friend'
  ) ->> 'applied')::boolean,
  true,
  'follow@100 applies (friend)'
);

reset role;
select is(
  (select friend_status from public.customer_line_identities where id = 'a1de0000-0000-4000-8000-0000000000f2'),
  'friend', 'status is friend after follow@100'
);
select is(
  (select last_event_at from public.customer_line_identities where id = 'a1de0000-0000-4000-8000-0000000000f2'),
  '2026-07-20T10:00:00Z'::timestamptz, 'watermark = 100 after follow@100'
);

-- follow@150 -> no_state_change (already friend): advance watermark ONLY.
-- The worker passes a null next status for a no_state_change ignore.
set role service_role;
select is(
  (public.apply_line_identity_event(
    'a1de0000-0000-4000-8000-0000000000f2',
    '2026-07-20T10:50:00Z'::timestamptz,
    null
  ) ->> 'applied')::boolean,
  false,
  'follow@150 no_state_change does not apply a status'
);

reset role;
select is(
  (select friend_status from public.customer_line_identities where id = 'a1de0000-0000-4000-8000-0000000000f2'),
  'friend', 'status still friend after no_state_change follow@150'
);
select is(
  (select last_event_at from public.customer_line_identities where id = 'a1de0000-0000-4000-8000-0000000000f2'),
  '2026-07-20T10:50:00Z'::timestamptz, 'watermark advanced to 150 on the no_state_change ignore (the fix)'
);
select is(
  (select unfollowed_at from public.customer_line_identities where id = 'a1de0000-0000-4000-8000-0000000000f2'),
  null, 'no_state_change did not touch unfollowed_at'
);

------------------------------------------------------------------------------
-- 4. Watermark never regresses: an out-of-order (older) apply must not move it
--    backward. This models the safety guard the TS gate also relies on.
------------------------------------------------------------------------------
set role service_role;
select is(
  (public.apply_line_identity_event(
    'a1de0000-0000-4000-8000-0000000000f2',
    '2026-07-20T10:20:00Z'::timestamptz,
    'unfollowed'
  ) ->> 'applied')::boolean,
  true,
  'an older apply (120) still executes at the RPC level (staleness gate is upstream)'
);

reset role;
select is(
  (select last_event_at from public.customer_line_identities where id = 'a1de0000-0000-4000-8000-0000000000f2'),
  '2026-07-20T10:50:00Z'::timestamptz, 'watermark stays at 150 (never regressed by the older event)'
);

------------------------------------------------------------------------------
-- 5. Unknown identity is an inert no-op (returns applied=false, no error).
------------------------------------------------------------------------------
set role service_role;
select is(
  (public.apply_line_identity_event(
    'a1de0000-0000-4000-8000-0000000000ff'::uuid,
    '2026-07-20T10:00:00Z'::timestamptz,
    'friend'
  ) ->> 'applied')::boolean,
  false,
  'unknown identity id is an inert no-op'
);

------------------------------------------------------------------------------
-- 6. Invalid friend_status is rejected.
------------------------------------------------------------------------------
select throws_ok(
  $$select public.apply_line_identity_event('a1de0000-0000-4000-8000-0000000000f2', now(), 'bogus')$$,
  'P0001', 'INVALID_FRIEND_STATUS', 'an invalid friend_status is rejected'
);

reset role;
select * from finish();
rollback;
