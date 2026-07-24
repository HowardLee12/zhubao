import { describe, expect, it } from 'vitest'

import { decideQuoteApprovalAction } from './quote-approval'

const readyFacts = {
  hasItems: true,
  totalsVerified: true,
}

describe('decideQuoteApprovalAction', () => {
  it.each(['owner', 'admin'] as const)(
    'allows %s to approve a valid pending version',
    (actorRole) => {
      expect(
        decideQuoteApprovalAction({
          action: 'approve',
          actorRole,
          versionStatus: 'draft',
          approvalStatus: 'pending',
          facts: { hasItems: true, totalsVerified: true },
        }),
      ).toEqual({
        allowed: true,
        nextVersionStatus: 'draft',
        nextApprovalStatus: 'approved',
      })
    },
  )
  it('allows a dispatcher to submit a valid draft for owner approval', () => {
    const decision = decideQuoteApprovalAction({
      action: 'submitForApproval',
      actorRole: 'dispatcher',
      versionStatus: 'draft',
      approvalStatus: 'not_submitted',
      facts: readyFacts,
    })

    expect(decision).toEqual({
      allowed: true,
      nextVersionStatus: 'draft',
      nextApprovalStatus: 'pending',
    })
  })

  it('does not submit an empty or unverified draft for approval', () => {
    const decision = decideQuoteApprovalAction({
      action: 'submitForApproval',
      actorRole: 'dispatcher',
      versionStatus: 'draft',
      approvalStatus: 'not_submitted',
      facts: { hasItems: false, totalsVerified: false },
    })

    expect(decision).toEqual({
      allowed: false,
      code: 'QUOTE_PRECONDITION_FAILED',
      missing: ['items', 'verifiedTotals'],
    })
  })

  it('allows only the owner to approve a pending version', () => {
    const ownerDecision = decideQuoteApprovalAction({
      action: 'approve',
      actorRole: 'owner',
      versionStatus: 'draft',
      approvalStatus: 'pending',
      facts: readyFacts,
    })
    const dispatcherDecision = decideQuoteApprovalAction({
      action: 'approve',
      actorRole: 'dispatcher',
      versionStatus: 'draft',
      approvalStatus: 'pending',
      facts: readyFacts,
    })

    expect(ownerDecision).toEqual({
      allowed: true,
      nextVersionStatus: 'draft',
      nextApprovalStatus: 'approved',
    })
    expect(dispatcherDecision).toEqual({ allowed: false, code: 'FORBIDDEN' })
  })

  it('allows the owner to request changes and makes the same draft editable again', () => {
    const decision = decideQuoteApprovalAction({
      action: 'requestChanges',
      actorRole: 'owner',
      versionStatus: 'draft',
      approvalStatus: 'pending',
      reason: '請補上保固範圍',
      facts: readyFacts,
    })

    expect(decision).toEqual({
      allowed: true,
      nextVersionStatus: 'draft',
      nextApprovalStatus: 'changes_requested',
    })
  })

  it('requires a reason when requesting changes', () => {
    const decision = decideQuoteApprovalAction({
      action: 'requestChanges',
      actorRole: 'owner',
      versionStatus: 'draft',
      approvalStatus: 'pending',
      reason: ' ',
      facts: readyFacts,
    })

    expect(decision).toEqual({
      allowed: false,
      code: 'QUOTE_PRECONDITION_FAILED',
      missing: ['reason'],
    })
  })

  it.each(['not_submitted', 'pending', 'changes_requested'] as const)(
    'blocks send while approval is %s',
    (approvalStatus) => {
      const decision = decideQuoteApprovalAction({
        action: 'send',
        actorRole: 'owner',
        versionStatus: 'draft',
        approvalStatus,
        facts: readyFacts,
      })

      expect(decision).toEqual({ allowed: false, code: 'QUOTE_APPROVAL_REQUIRED' })
    },
  )

  it('allows the owner to send the exact approved draft and makes it immutable', () => {
    const decision = decideQuoteApprovalAction({
      action: 'send',
      actorRole: 'owner',
      versionStatus: 'draft',
      approvalStatus: 'approved',
      facts: readyFacts,
    })

    expect(decision).toEqual({
      allowed: true,
      nextVersionStatus: 'sent',
      nextApprovalStatus: 'approved',
    })
  })

  it('does not let a dispatcher send even after the owner approved the draft', () => {
    const decision = decideQuoteApprovalAction({
      action: 'send',
      actorRole: 'dispatcher',
      versionStatus: 'draft',
      approvalStatus: 'approved',
      facts: readyFacts,
    })

    expect(decision).toEqual({ allowed: false, code: 'FORBIDDEN' })
  })

  it.each(['submitForApproval', 'approve', 'requestChanges', 'send'] as const)(
    'does not let a technician perform %s',
    (action) => {
      const decision = decideQuoteApprovalAction({
        action,
        actorRole: 'technician',
        versionStatus: 'draft',
        approvalStatus: action === 'submitForApproval' ? 'not_submitted' : 'pending',
        reason: '技師不應操作報價核准',
        facts: readyFacts,
      })

      expect(decision).toEqual({ allowed: false, code: 'FORBIDDEN' })
    },
  )

  it('cannot reuse an approval after the version has already been sent', () => {
    const decision = decideQuoteApprovalAction({
      action: 'send',
      actorRole: 'owner',
      versionStatus: 'sent',
      approvalStatus: 'approved',
      facts: readyFacts,
    })

    expect(decision).toEqual({
      allowed: false,
      code: 'QUOTE_VERSION_IMMUTABLE',
    })
  })
})
