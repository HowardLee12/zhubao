import { describe, expect, it } from 'vitest'

import { deriveCaseStage } from './case-stage'

describe('deriveCaseStage', () => {
  it.each(['new', 'triaged'] as const)(
    'projects an unquoted %s service request to the intake/quoting workflow',
    (serviceRequestStatus) => {
      const stage = deriveCaseStage({
        serviceRequestStatus,
        quoteStatuses: [],
        workOrderStatuses: [],
        paymentStatuses: [],
      })

      expect(stage).toBe(serviceRequestStatus === 'new' ? 'intake' : 'needs_quote')
    },
  )

  it.each(['quoting', 'quoted'] as const)(
    'projects %s to needs_quote when no customer-visible quote exists',
    (serviceRequestStatus) => {
      expect(
        deriveCaseStage({
          serviceRequestStatus,
          quoteStatuses: ['draft'],
          workOrderStatuses: [],
          paymentStatuses: [],
        }),
      ).toBe('needs_quote')
    },
  )

  it.each(['sent', 'viewed'] as const)(
    'projects a %s quote to awaiting_customer',
    (quoteStatus) => {
      expect(
        deriveCaseStage({
          serviceRequestStatus: 'quoted',
          quoteStatuses: [quoteStatus],
          workOrderStatuses: [],
          paymentStatuses: [],
        }),
      ).toBe('awaiting_customer')
    },
  )

  it('projects an accepted quote without a work order to awaiting_schedule', () => {
    expect(
      deriveCaseStage({
        serviceRequestStatus: 'quoted',
        quoteStatuses: ['accepted'],
        workOrderStatuses: [],
        paymentStatuses: [],
      }),
    ).toBe('awaiting_schedule')
  })

  it.each(['scheduled', 'dispatched', 'en_route'] as const)(
    'projects a %s work order to scheduled until the technician arrives',
    (workOrderStatus) => {
      expect(
        deriveCaseStage({
          serviceRequestStatus: 'converted',
          quoteStatuses: ['accepted'],
          workOrderStatuses: [workOrderStatus],
          paymentStatuses: [],
        }),
      ).toBe('scheduled')
    },
  )

  it.each(['on_site', 'paused'] as const)(
    'projects a %s work order to in_progress',
    (workOrderStatus) => {
      expect(
        deriveCaseStage({
          serviceRequestStatus: 'converted',
          quoteStatuses: ['accepted'],
          workOrderStatuses: [workOrderStatus],
          paymentStatuses: [],
        }),
      ).toBe('in_progress')
    },
  )

  it.each(['pending', 'invoiced', 'overdue'] as const)(
    'projects completed work with a %s receivable to awaiting_payment',
    (paymentStatus) => {
      expect(
        deriveCaseStage({
          serviceRequestStatus: 'converted',
          quoteStatuses: ['accepted'],
          workOrderStatuses: ['completed'],
          paymentStatuses: [paymentStatus],
        }),
      ).toBe('awaiting_payment')
    },
  )

  it.each([
    { label: 'no milestones', paymentStatuses: [] },
    { label: 'paid', paymentStatuses: ['paid'] },
    { label: 'waived', paymentStatuses: ['waived'] },
    { label: 'cancelled', paymentStatuses: ['cancelled'] },
    { label: 'paid and waived', paymentStatuses: ['paid', 'waived'] },
  ] as const)('projects completed work with $label receivables to completed', ({ paymentStatuses }) => {
    expect(
      deriveCaseStage({
        serviceRequestStatus: 'converted',
        quoteStatuses: ['accepted'],
        workOrderStatuses: ['completed'],
        paymentStatuses,
      }),
    ).toBe('completed')
  })

  it('uses the furthest active operational signal instead of blindly trusting one stale resource', () => {
    expect(
      deriveCaseStage({
        serviceRequestStatus: 'quoted',
        quoteStatuses: ['sent', 'accepted'],
        workOrderStatuses: ['scheduled', 'on_site'],
        paymentStatuses: [],
      }),
    ).toBe('in_progress')
  })

  it.each(['declined', 'cancelled'] as const)(
    'projects a terminal %s request with no downstream work to closed',
    (serviceRequestStatus) => {
      expect(
        deriveCaseStage({
          serviceRequestStatus,
          quoteStatuses: [],
          workOrderStatuses: [],
          paymentStatuses: [],
        }),
      ).toBe('closed')
    },
  )

  it('returns needs_quote after a rejected or expired quote so the team can revise instead of silently closing', () => {
    expect(
      deriveCaseStage({
        serviceRequestStatus: 'quoted',
        quoteStatuses: ['rejected', 'expired'],
        workOrderStatuses: [],
        paymentStatuses: [],
      }),
    ).toBe('needs_quote')
  })
})
