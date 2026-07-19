export type ServiceRequestStatus =
  | 'new'
  | 'triaged'
  | 'quoting'
  | 'quoted'
  | 'converted'
  | 'declined'
  | 'cancelled'

export type CaseQuoteStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'

export type CaseWorkOrderStatus =
  | 'draft'
  | 'scheduled'
  | 'dispatched'
  | 'en_route'
  | 'on_site'
  | 'paused'
  | 'completed'
  | 'cancelled'

export type CasePaymentStatus =
  | 'pending'
  | 'invoiced'
  | 'overdue'
  | 'paid'
  | 'waived'
  | 'cancelled'

export type CaseStage =
  | 'intake'
  | 'needs_quote'
  | 'awaiting_customer'
  | 'awaiting_schedule'
  | 'scheduled'
  | 'in_progress'
  | 'awaiting_payment'
  | 'completed'
  | 'closed'

export interface CaseStageSnapshot {
  serviceRequestStatus: ServiceRequestStatus
  quoteStatuses: readonly CaseQuoteStatus[]
  workOrderStatuses: readonly CaseWorkOrderStatus[]
  paymentStatuses: readonly CasePaymentStatus[]
}

const inProgressWorkOrderStatuses: ReadonlySet<CaseWorkOrderStatus> = new Set([
  'on_site',
  'paused',
])

const scheduledWorkOrderStatuses: ReadonlySet<CaseWorkOrderStatus> = new Set([
  'scheduled',
  'dispatched',
  'en_route',
])

const openPaymentStatuses: ReadonlySet<CasePaymentStatus> = new Set([
  'pending',
  'invoiced',
  'overdue',
])

const settledPaymentStatuses: ReadonlySet<CasePaymentStatus> = new Set([
  'paid',
  'waived',
  'cancelled',
])

export function deriveCaseStage(snapshot: CaseStageSnapshot): CaseStage {
  if (snapshot.workOrderStatuses.some((status) => inProgressWorkOrderStatuses.has(status))) {
    return 'in_progress'
  }

  if (snapshot.workOrderStatuses.some((status) => scheduledWorkOrderStatuses.has(status))) {
    return 'scheduled'
  }

  const completedWorkExists = snapshot.workOrderStatuses.includes('completed')
  const unfinishedWorkExists = snapshot.workOrderStatuses.some(
    (status) => status !== 'completed' && status !== 'cancelled',
  )

  if (completedWorkExists && !unfinishedWorkExists) {
    const hasOpenOrUnknownPayment = snapshot.paymentStatuses.some(
      (status) =>
        openPaymentStatuses.has(status) || !settledPaymentStatuses.has(status),
    )

    return hasOpenOrUnknownPayment ? 'awaiting_payment' : 'completed'
  }

  if (snapshot.workOrderStatuses.includes('draft')) {
    return 'awaiting_schedule'
  }

  if (snapshot.quoteStatuses.includes('accepted')) {
    return 'awaiting_schedule'
  }

  if (
    snapshot.quoteStatuses.includes('sent') ||
    snapshot.quoteStatuses.includes('viewed')
  ) {
    return 'awaiting_customer'
  }

  if (
    snapshot.serviceRequestStatus === 'declined' ||
    snapshot.serviceRequestStatus === 'cancelled'
  ) {
    return 'closed'
  }

  if (snapshot.serviceRequestStatus === 'new') {
    return 'intake'
  }

  if (snapshot.serviceRequestStatus === 'converted') {
    return 'awaiting_schedule'
  }

  return 'needs_quote'
}
