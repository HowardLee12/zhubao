export const QUOTE_VERSION_STATUSES = [
  'draft',
  'sent',
  'superseded',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const

export type QuoteVersionStatus = (typeof QUOTE_VERSION_STATUSES)[number]

export const QUOTE_APPROVAL_STATUSES = [
  'not_submitted',
  'pending',
  'approved',
  'changes_requested',
] as const

export type QuoteApprovalStatus = (typeof QUOTE_APPROVAL_STATUSES)[number]

export type QuoteAggregateStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'

export type QuoteResponseDecision = 'accept' | 'reject'

interface QuoteResponseVersion {
  id: string
  status: QuoteVersionStatus
  validUntil: string | null
}

export interface DecideQuoteResponseInput {
  decision: QuoteResponseDecision
  quoteStatus: QuoteAggregateStatus
  activeVersionId: string | null
  version: QuoteResponseVersion
  today: string
}

export type QuoteResponseResult =
  | {
      allowed: true
      nextQuoteStatus: 'accepted' | 'rejected'
      nextVersionStatus: 'accepted' | 'rejected'
    }
  | {
      allowed: false
      code:
        | 'QUOTE_ALREADY_RESOLVED'
        | 'ACTIVE_VERSION_CHANGED'
        | 'QUOTE_EXPIRED'
        | 'QUOTE_NOT_RESPONDABLE'
    }

const resolvedQuoteStatuses: ReadonlySet<QuoteAggregateStatus> = new Set([
  'accepted',
  'rejected',
  'expired',
  'cancelled',
])

export function isQuoteVersionEditable(
  versionStatus: QuoteVersionStatus,
  approvalStatus: QuoteApprovalStatus,
): boolean {
  return (
    versionStatus === 'draft' &&
    (approvalStatus === 'not_submitted' || approvalStatus === 'changes_requested')
  )
}

export function decideQuoteResponse(input: DecideQuoteResponseInput): QuoteResponseResult {
  if (input.decision !== 'accept' && input.decision !== 'reject') {
    return { allowed: false, code: 'QUOTE_NOT_RESPONDABLE' }
  }

  if (resolvedQuoteStatuses.has(input.quoteStatus)) {
    return { allowed: false, code: 'QUOTE_ALREADY_RESOLVED' }
  }

  if (
    input.activeVersionId !== input.version.id ||
    input.version.status === 'superseded'
  ) {
    return { allowed: false, code: 'ACTIVE_VERSION_CHANGED' }
  }

  if (
    (input.quoteStatus !== 'sent' && input.quoteStatus !== 'viewed') ||
    input.version.status !== 'sent'
  ) {
    return { allowed: false, code: 'QUOTE_NOT_RESPONDABLE' }
  }

  if (
    !isBusinessDate(input.today) ||
    (input.version.validUntil !== null && !isBusinessDate(input.version.validUntil))
  ) {
    return { allowed: false, code: 'QUOTE_NOT_RESPONDABLE' }
  }

  if (input.version.validUntil !== null && input.today > input.version.validUntil) {
    return { allowed: false, code: 'QUOTE_EXPIRED' }
  }

  const nextStatus = input.decision === 'accept' ? 'accepted' : 'rejected'

  return {
    allowed: true,
    nextQuoteStatus: nextStatus,
    nextVersionStatus: nextStatus,
  }
}

function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}
