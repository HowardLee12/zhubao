-- Renoly v2 M6 — LINE identity ordering watermark.
--
-- Bug fix: the out-of-order gate (decideWebhookApply) derived its watermark
-- (lastAppliedTimestamp) from max(followed_at, unfollowed_at). Those columns only
-- move on an APPLY, so a no_state_change ignore (e.g. a duplicate/newer follow
-- while already a friend) left the watermark stuck at the last applied change.
--
-- Failing sequence (LINE does not guarantee delivery order):
--   follow@100 apply    -> followed_at = 100, watermark = 100
--   follow@150 ignore   -> no_state_change, watermark STAYS 100 (bug)
--   unfollow@120 arrives -> 120 > 100 so it wrongly applies, flipping the
--                           identity friend -> unfollowed, even though the last
--                           real signal we saw was follow@150.
--
-- Fix: track the true last-SEEN follow/unfollow timestamp in a dedicated column
-- (last_event_at) that advances on EVERY terminally-processed follow/unfollow —
-- applied OR ignored-as-no_state_change — and derive the watermark from it.
--
-- This migration adds the column, backfills it from the existing apply columns,
-- and adds a security-definer RPC (public.apply_line_identity_event) that the
-- webhook-process worker calls for BOTH the apply path and the no_state_change
-- ignore path. The worker no longer writes customer_line_identities directly.

set search_path = pg_catalog, public, private, extensions;

------------------------------------------------------------------------------
-- 1. Ordering watermark column. The true last-SEEN follow/unfollow timestamp.
--    Nullable: an identity that has never received a follow/unfollow has none.
--    Backfilled from the existing apply columns so pre-existing rows (and the
--    shared seed's 'friend' identity) carry a correct starting watermark.
------------------------------------------------------------------------------
alter table public.customer_line_identities
  add column if not exists last_event_at timestamptz;

update public.customer_line_identities
set last_event_at = greatest(
  coalesce(followed_at, unfollowed_at),
  coalesce(unfollowed_at, followed_at)
)
where last_event_at is null
  and (followed_at is not null or unfollowed_at is not null);

------------------------------------------------------------------------------
-- 2. public.apply_line_identity_event — the single write path for a
--    terminally-processed follow/unfollow. security-definer, service_role only.
--
--    * p_next_friend_status non-null  -> APPLY: set friend_status + the matching
--      followed_at/unfollowed_at, and advance last_event_at.
--    * p_next_friend_status null       -> NO_STATE_CHANGE: advance last_event_at
--      ONLY (idempotent; friend_status unchanged).
--
--    last_event_at only ever moves FORWARD (greatest guard): the caller has
--    already gated staleness, but a concurrent claim must never regress it.
--    An unknown identity id is an inert no-op (returns applied=false) so the
--    webhook event is still processed terminally rather than failing forever.
------------------------------------------------------------------------------
create or replace function public.apply_line_identity_event(
  p_identity_id uuid,
  p_event_timestamp timestamptz,
  p_next_friend_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.customer_line_identities%rowtype;
begin
  if p_next_friend_status is not null
     and p_next_friend_status not in ('unknown', 'friend', 'blocked', 'unfollowed') then
    raise exception using errcode = 'P0001', message = 'INVALID_FRIEND_STATUS';
  end if;

  select * into v_row
  from public.customer_line_identities
  where id = p_identity_id
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'identity_not_found');
  end if;

  update public.customer_line_identities
  set
    friend_status = coalesce(p_next_friend_status, friend_status),
    followed_at = case
      when p_next_friend_status = 'friend' then p_event_timestamp
      else followed_at
    end,
    unfollowed_at = case
      when p_next_friend_status = 'unfollowed' then p_event_timestamp
      else unfollowed_at
    end,
    -- Advance the ordering watermark, never regress it.
    last_event_at = greatest(coalesce(last_event_at, p_event_timestamp), p_event_timestamp)
  where id = p_identity_id;

  return jsonb_build_object(
    'applied', p_next_friend_status is not null,
    'id', p_identity_id
  );
end;
$$;

alter function public.apply_line_identity_event(uuid, timestamptz, text)
  owner to renoly_rls_owner;
revoke all on function public.apply_line_identity_event(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_line_identity_event(uuid, timestamptz, text) to service_role;
