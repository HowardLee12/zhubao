-- Renoly v2 M5: relax the over-strict completion snapshot gate.
--
-- BUG being fixed: private.require_completion_snapshot() (added by
-- 202607160004_v2_phase1_hardening.sql) fired a BEFORE UPDATE trigger on
-- public.work_orders that raised CHECKLIST_SNAPSHOT_REQUIRED whenever a work
-- order transitioned to 'completed' AND had NO work_order_checklists row. That
-- blocked completing a legitimately checklist-free work order -- e.g. a simple
-- job whose service catalog item carries no checklist template -- even when it
-- already had a before photo, an after photo and a completion summary.
--
-- USER DECISION: do not force a checklist when there is no template. A work
-- order with NO checklist may complete on photos + summary alone.
--
-- WHY THIS IS SAFE: the authoritative completion-evidence gate lives inside
-- public.transition_work_order (defined in 202607160003_v2_security_and_rpcs.sql,
-- last re-created VERBATIM by the M5 gate 202607190006_v2_m5_photo_checklist_gate.sql).
-- That gate still requires, for a 'completed' transition:
--   * a non-empty completion_summary                    -> COMPLETION_SUMMARY_REQUIRED
--   * every REQUIRED checklist item answered
--     (via private.checklist_item_answered)              -> REQUIRED_CHECKLIST_INCOMPLETE
--   * every evidence_required item with a ready photo    -> REQUIRED_EVIDENCE_MISSING
--   * >= 1 ready 'before' photo AND >= 1 ready 'after'   -> BEFORE_AFTER_PHOTOS_REQUIRED
--   * customer sign-off when required                    -> CUSTOMER_SIGNOFF_REQUIRED
-- force_complete_work_order (owner-only, reason-required) remains the sole
-- documented escape. Dropping require_completion_snapshot does NOT weaken any of
-- those: a work order WITH required checklist items still cannot complete until
-- they are answered; only a work order with NO checklist at all is unblocked, and
-- it still needs its before + after photos and a summary. This is the intended
-- behavior.
--
-- This migration ONLY drops the superseded trigger and its function. It changes
-- no other gate, message, event, lock or predicate.

set search_path = pg_catalog, public, private;

drop trigger if exists c_require_completion_snapshot on public.work_orders;
drop function if exists private.require_completion_snapshot();
