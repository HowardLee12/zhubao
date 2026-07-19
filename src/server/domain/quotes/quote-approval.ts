import type { QuoteApprovalStatus, QuoteVersionStatus } from './quote-version'

export type QuoteApprovalAction =
  | 'submitForApproval'
  | 'approve'
  | 'requestChanges'
  | 'send'

export type QuoteApprovalActorRole = 'owner' | 'admin' | 'dispatcher' | 'technician'

const quoteApprovalActions: readonly QuoteApprovalAction[] = [
  'submitForApproval',
  'approve',
  'requestChanges',
  'send',
]

const quoteApprovalActorRoles: readonly QuoteApprovalActorRole[] = [
  'owner',
  'admin',
  'dispatcher',
  'technician',
]

export interface DecideQuoteApprovalActionInput {
  action: QuoteApprovalAction
  actorRole: QuoteApprovalActorRole
  versionStatus: QuoteVersionStatus
  approvalStatus: QuoteApprovalStatus
  reason?: string
  facts: {
    hasItems: boolean
    totalsVerified: boolean
  }
}

export type QuoteApprovalResult =
  | {
      allowed: true
      nextVersionStatus: 'draft' | 'sent'
      nextApprovalStatus: QuoteApprovalStatus
    }
  | {
      allowed: false
      code:
        | 'FORBIDDEN'
        | 'QUOTE_VERSION_IMMUTABLE'
        | 'QUOTE_PRECONDITION_FAILED'
        | 'QUOTE_APPROVAL_REQUIRED'
        | 'INVALID_APPROVAL_TRANSITION'
      missing?: Array<'items' | 'verifiedTotals' | 'reason'>
    }

function isAuthorizedForAction(
  role: QuoteApprovalActorRole,
  action: QuoteApprovalAction,
): boolean {
  if (action === 'submitForApproval') {
    return role === 'owner' || role === 'admin' || role === 'dispatcher'
  }

  return role === 'owner' || role === 'admin'
}

function missingQuoteFacts(
  facts: DecideQuoteApprovalActionInput['facts'],
): Array<'items' | 'verifiedTotals'> {
  const missing: Array<'items' | 'verifiedTotals'> = []

  if (!facts.hasItems) {
    missing.push('items')
  }
  if (!facts.totalsVerified) {
    missing.push('verifiedTotals')
  }

  return missing
}

export function decideQuoteApprovalAction(
  input: DecideQuoteApprovalActionInput,
): QuoteApprovalResult {
  if (!quoteApprovalActorRoles.includes(input.actorRole)) {
    return { allowed: false, code: 'FORBIDDEN' }
  }

  if (!quoteApprovalActions.includes(input.action)) {
    return { allowed: false, code: 'INVALID_APPROVAL_TRANSITION' }
  }

  if (!isAuthorizedForAction(input.actorRole, input.action)) {
    return { allowed: false, code: 'FORBIDDEN' }
  }

  if (input.versionStatus !== 'draft') {
    return { allowed: false, code: 'QUOTE_VERSION_IMMUTABLE' }
  }

  if (input.action === 'submitForApproval') {
    const missing = missingQuoteFacts(input.facts)
    if (missing.length > 0) {
      return { allowed: false, code: 'QUOTE_PRECONDITION_FAILED', missing }
    }

    if (
      input.approvalStatus !== 'not_submitted' &&
      input.approvalStatus !== 'changes_requested'
    ) {
      return { allowed: false, code: 'INVALID_APPROVAL_TRANSITION' }
    }

    return {
      allowed: true,
      nextVersionStatus: 'draft',
      nextApprovalStatus: 'pending',
    }
  }

  if (input.action === 'approve') {
    if (input.approvalStatus !== 'pending') {
      return { allowed: false, code: 'INVALID_APPROVAL_TRANSITION' }
    }

    const missing = missingQuoteFacts(input.facts)
    if (missing.length > 0) {
      return { allowed: false, code: 'QUOTE_PRECONDITION_FAILED', missing }
    }

    return {
      allowed: true,
      nextVersionStatus: 'draft',
      nextApprovalStatus: 'approved',
    }
  }

  if (input.action === 'requestChanges') {
    if (input.approvalStatus !== 'pending') {
      return { allowed: false, code: 'INVALID_APPROVAL_TRANSITION' }
    }

    if (!input.reason?.trim()) {
      return {
        allowed: false,
        code: 'QUOTE_PRECONDITION_FAILED',
        missing: ['reason'],
      }
    }

    return {
      allowed: true,
      nextVersionStatus: 'draft',
      nextApprovalStatus: 'changes_requested',
    }
  }

  if (input.approvalStatus !== 'approved') {
    return { allowed: false, code: 'QUOTE_APPROVAL_REQUIRED' }
  }

  const missing = missingQuoteFacts(input.facts)
  if (missing.length > 0) {
    return { allowed: false, code: 'QUOTE_PRECONDITION_FAILED', missing }
  }

  return {
    allowed: true,
    nextVersionStatus: 'sent',
    nextApprovalStatus: 'approved',
  }
}
