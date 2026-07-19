import { describe, expect, it } from 'vitest'

import { decideWorkOrderTransition } from './work-order-state'

const NOW = '2026-07-18T04:30:00.000Z'

const completeFacts = {
  activeAssignmentCount: 1,
  requiredChecklistComplete: true,
  requiredEvidenceComplete: true,
  hasBeforePhoto: true,
  hasAfterPhoto: true,
  completionSummary: '完成清洗與排水測試，運轉正常',
}

describe('decideWorkOrderTransition', () => {
  describe('manager-controlled scheduling and dispatch', () => {
    it.each(['owner', 'admin', 'dispatcher'] as const)(
      'allows %s to schedule a draft work order with a valid window and assignment',
      (role) => {
        const decision = decideWorkOrderTransition({
          status: 'draft',
          action: 'schedule',
          actor: { role, isAssigned: false },
          now: NOW,
          occurredAt: NOW,
          facts: {
            activeAssignmentCount: 1,
            scheduledStartAt: '2026-07-19T01:00:00.000Z',
            scheduledEndAt: '2026-07-19T03:00:00.000Z',
          },
        })

        expect(decision).toEqual({ allowed: true, nextStatus: 'scheduled' })
      },
    )

    it('rejects scheduling when the time window or assignment is missing', () => {
      const decision = decideWorkOrderTransition({
        status: 'draft',
        action: 'schedule',
        actor: { role: 'dispatcher', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 0 },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'WORK_ORDER_PRECONDITION_FAILED',
        missing: ['activeAssignment', 'scheduledStartAt', 'scheduledEndAt'],
      })
    })

    it('rejects a schedule whose end is not after its start', () => {
      const decision = decideWorkOrderTransition({
        status: 'draft',
        action: 'schedule',
        actor: { role: 'dispatcher', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: {
          activeAssignmentCount: 1,
          scheduledStartAt: '2026-07-19T03:00:00.000Z',
          scheduledEndAt: '2026-07-19T03:00:00.000Z',
        },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'INVALID_SCHEDULE_WINDOW',
      })
    })

    it('does not let a technician schedule or dispatch even when assigned', () => {
      const schedule = decideWorkOrderTransition({
        status: 'draft',
        action: 'schedule',
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: NOW,
        facts: {
          activeAssignmentCount: 1,
          scheduledStartAt: '2026-07-19T01:00:00.000Z',
          scheduledEndAt: '2026-07-19T03:00:00.000Z',
        },
      })
      const dispatch = decideWorkOrderTransition({
        status: 'scheduled',
        action: 'dispatch',
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 1 },
      })

      expect(schedule).toMatchObject({ allowed: false, code: 'FORBIDDEN' })
      expect(dispatch).toMatchObject({ allowed: false, code: 'FORBIDDEN' })
    })
  })

  describe('assigned technician field flow', () => {
    it.each([
      ['dispatched', 'enRoute', 'en_route'],
      ['en_route', 'arrive', 'on_site'],
      ['on_site', 'pause', 'paused'],
      ['paused', 'resume', 'on_site'],
    ] as const)('allows %s --%s--> %s for the assigned technician', (status, action, nextStatus) => {
      const decision = decideWorkOrderTransition({
        status,
        action,
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 1 },
      })

      expect(decision).toEqual({ allowed: true, nextStatus })
    })

    it('fails closed for a technician who is not assigned', () => {
      const decision = decideWorkOrderTransition({
        status: 'dispatched',
        action: 'enRoute',
        actor: { role: 'technician', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 1 },
      })

      expect(decision).toEqual({ allowed: false, code: 'NOT_ASSIGNED' })
    })

    it('requires an active assignment before any actor can mark en route', () => {
      const decision = decideWorkOrderTransition({
        status: 'dispatched',
        action: 'enRoute',
        actor: { role: 'dispatcher', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 0 },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'WORK_ORDER_PRECONDITION_FAILED',
        missing: ['activeAssignment'],
      })
    })

    it('rejects skipping directly from scheduled to on-site', () => {
      const decision = decideWorkOrderTransition({
        status: 'scheduled',
        action: 'arrive',
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 1 },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'INVALID_STATE_TRANSITION',
        from: 'scheduled',
        action: 'arrive',
      })
    })

    it('rejects a field timestamp more than five minutes in the future', () => {
      const decision = decideWorkOrderTransition({
        status: 'dispatched',
        action: 'enRoute',
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: '2026-07-18T04:35:00.001Z',
        facts: { activeAssignmentCount: 1 },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'OCCURRED_AT_OUT_OF_RANGE',
      })
    })

    it('allows an owner to correct an older timestamp only with a reason', () => {
      const withoutReason = decideWorkOrderTransition({
        status: 'dispatched',
        action: 'enRoute',
        actor: { role: 'owner', isAssigned: false },
        now: NOW,
        occurredAt: '2026-07-17T04:29:59.999Z',
        facts: { activeAssignmentCount: 1 },
      })
      const corrected = decideWorkOrderTransition({
        status: 'dispatched',
        action: 'enRoute',
        actor: { role: 'owner', isAssigned: false },
        now: NOW,
        occurredAt: '2026-07-17T04:29:59.999Z',
        facts: { activeAssignmentCount: 1, overrideReason: '補登昨日紙本紀錄' },
      })

      expect(withoutReason).toEqual({
        allowed: false,
        code: 'OCCURRED_AT_OUT_OF_RANGE',
        missing: ['overrideReason'],
      })
      expect(corrected).toEqual({ allowed: true, nextStatus: 'en_route' })
    })

    it.each([
      '2026-07-18T04:35:00.001Z',
      '2026-06-18T04:29:59.999Z',
    ])('never allows a correction beyond the hard safety boundary: %s', (occurredAt) => {
      const decision = decideWorkOrderTransition({
        status: 'dispatched',
        action: 'enRoute',
        actor: { role: 'owner', isAssigned: false },
        now: NOW,
        occurredAt,
        facts: { activeAssignmentCount: 1, overrideReason: '要求強制校正' },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'OCCURRED_AT_OUT_OF_RANGE',
      })
    })
  })

  describe('completion gates', () => {
    it.each(['on_site', 'paused'] as const)(
      'allows an assigned technician to complete from %s when every requirement is met',
      (status) => {
        const decision = decideWorkOrderTransition({
          status,
          action: 'complete',
          actor: { role: 'technician', isAssigned: true },
          now: NOW,
          occurredAt: NOW,
          facts: completeFacts,
        })

        expect(decision).toEqual({ allowed: true, nextStatus: 'completed' })
      },
    )

    it('returns every missing completion prerequisite without changing state', () => {
      const decision = decideWorkOrderTransition({
        status: 'on_site',
        action: 'complete',
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: NOW,
        facts: {
          activeAssignmentCount: 1,
          requiredChecklistComplete: false,
          requiredEvidenceComplete: false,
          hasBeforePhoto: false,
          hasAfterPhoto: false,
          completionSummary: '   ',
        },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'WORK_ORDER_PRECONDITION_FAILED',
        missing: [
          'requiredChecklist',
          'requiredEvidence',
          'beforePhoto',
          'afterPhoto',
          'completionSummary',
        ],
      })
    })

    it('does not allow completion from en route even if evidence is complete', () => {
      const decision = decideWorkOrderTransition({
        status: 'en_route',
        action: 'complete',
        actor: { role: 'technician', isAssigned: true },
        now: NOW,
        occurredAt: NOW,
        facts: completeFacts,
      })

      expect(decision).toMatchObject({
        allowed: false,
        code: 'INVALID_STATE_TRANSITION',
      })
    })
  })

  describe('cancellation and reopening', () => {
    it('requires a cancellation reason', () => {
      const decision = decideWorkOrderTransition({
        status: 'scheduled',
        action: 'cancel',
        actor: { role: 'dispatcher', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: { activeAssignmentCount: 1, reason: ' ' },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'WORK_ORDER_PRECONDITION_FAILED',
        missing: ['reason'],
      })
    })

    it.each(['technician', 'accountant', 'viewer'] as const)(
      'does not allow %s to cancel a work order',
      (role) => {
        const decision = decideWorkOrderTransition({
          status: 'scheduled',
          action: 'cancel',
          actor: { role, isAssigned: role === 'technician' },
          now: NOW,
          occurredAt: NOW,
          facts: { activeAssignmentCount: 1, reason: '客戶要求取消' },
        })

        expect(decision).toMatchObject({ allowed: false, code: 'FORBIDDEN' })
      },
    )

    it.each(['owner', 'admin'] as const)(
      'allows %s to reopen a completed work order within 24 hours with a reason',
      (role) => {
        const decision = decideWorkOrderTransition({
          status: 'completed',
          action: 'reopen',
          actor: { role, isAssigned: false },
          now: NOW,
          occurredAt: NOW,
          facts: {
            activeAssignmentCount: 1,
            completedAt: '2026-07-17T05:00:00.000Z',
            reason: '客戶回報測試仍異常',
          },
        })

        expect(decision).toEqual({ allowed: true, nextStatus: 'on_site' })
      },
    )

    it('rejects reopening after the 24-hour correction window', () => {
      const decision = decideWorkOrderTransition({
        status: 'completed',
        action: 'reopen',
        actor: { role: 'owner', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: {
          activeAssignmentCount: 1,
          completedAt: '2026-07-17T04:29:59.000Z',
          reason: '補做檢查',
        },
      })

      expect(decision).toEqual({
        allowed: false,
        code: 'REOPEN_WINDOW_EXPIRED',
      })
    })

    it('keeps cancelled work orders terminal', () => {
      const decision = decideWorkOrderTransition({
        status: 'cancelled',
        action: 'schedule',
        actor: { role: 'owner', isAssigned: false },
        now: NOW,
        occurredAt: NOW,
        facts: {
          activeAssignmentCount: 1,
          scheduledStartAt: '2026-07-19T01:00:00.000Z',
          scheduledEndAt: '2026-07-19T03:00:00.000Z',
        },
      })

      expect(decision).toMatchObject({
        allowed: false,
        code: 'INVALID_STATE_TRANSITION',
      })
    })
  })
})
