import { describe, expect, it } from 'vitest'

import { decideQuoteResponse, isQuoteVersionEditable } from './quote-version'

const ACTIVE_VERSION_ID = 'd4ae5531-01fc-49a8-b0a8-337132bbbf69'
const OLD_VERSION_ID = '1f3c6765-8418-45b0-a27b-913d81206f30'

describe('quote version immutability', () => {
  it.each(['not_submitted', 'changes_requested'] as const)(
    'allows edits to a draft whose approval is %s',
    (approvalStatus) => {
      expect(isQuoteVersionEditable('draft', approvalStatus)).toBe(true)
    },
  )

  it.each(['pending', 'approved'] as const)(
    'freezes a draft while approval is %s',
    (approvalStatus) => {
      expect(isQuoteVersionEditable('draft', approvalStatus)).toBe(false)
    },
  )

  it('does not treat approval as permission to mutate the approved content', () => {
    expect(isQuoteVersionEditable('draft', 'approved')).toBe(false)
  })

  it.each(['sent', 'superseded', 'accepted', 'rejected', 'expired', 'cancelled'] as const)(
    'keeps a %s version immutable',
    (status) => {
      expect(isQuoteVersionEditable(status, 'approved')).toBe(false)
    },
  )
})

describe('decideQuoteResponse', () => {
  it.each(['accept', 'reject'] as const)(
    'allows a customer to %s the active sent version',
    (decision) => {
      const result = decideQuoteResponse({
        decision,
        quoteStatus: 'sent',
        activeVersionId: ACTIVE_VERSION_ID,
        version: {
          id: ACTIVE_VERSION_ID,
          status: 'sent',
          validUntil: '2026-07-25',
        },
        today: '2026-07-18',
      })

      expect(result).toEqual({
        allowed: true,
        nextQuoteStatus: decision === 'accept' ? 'accepted' : 'rejected',
        nextVersionStatus: decision === 'accept' ? 'accepted' : 'rejected',
      })
    },
  )

  it('accepts a sent version after the aggregate was marked viewed', () => {
    const result = decideQuoteResponse({
      decision: 'accept',
      quoteStatus: 'viewed',
      activeVersionId: ACTIVE_VERSION_ID,
      version: {
        id: ACTIVE_VERSION_ID,
        status: 'sent',
        validUntil: '2026-07-25',
      },
      today: '2026-07-18',
    })

    expect(result).toMatchObject({ allowed: true, nextQuoteStatus: 'accepted' })
  })

  it('rejects an old or superseded version with ACTIVE_VERSION_CHANGED', () => {
    const result = decideQuoteResponse({
      decision: 'accept',
      quoteStatus: 'sent',
      activeVersionId: ACTIVE_VERSION_ID,
      version: {
        id: OLD_VERSION_ID,
        status: 'superseded',
        validUntil: '2026-07-25',
      },
      today: '2026-07-18',
    })

    expect(result).toEqual({ allowed: false, code: 'ACTIVE_VERSION_CHANGED' })
  })

  it('rejects an expired active version', () => {
    const result = decideQuoteResponse({
      decision: 'accept',
      quoteStatus: 'sent',
      activeVersionId: ACTIVE_VERSION_ID,
      version: {
        id: ACTIVE_VERSION_ID,
        status: 'sent',
        validUntil: '2026-07-17',
      },
      today: '2026-07-18',
    })

    expect(result).toEqual({ allowed: false, code: 'QUOTE_EXPIRED' })
  })

  it('treats validUntil as inclusive in the organization business timezone', () => {
    const result = decideQuoteResponse({
      decision: 'accept',
      quoteStatus: 'sent',
      activeVersionId: ACTIVE_VERSION_ID,
      version: {
        id: ACTIVE_VERSION_ID,
        status: 'sent',
        validUntil: '2026-07-18',
      },
      today: '2026-07-18',
    })

    expect(result).toMatchObject({ allowed: true, nextQuoteStatus: 'accepted' })
  })

  it.each(['accepted', 'rejected', 'expired', 'cancelled'] as const)(
    'does not overwrite an already resolved %s aggregate',
    (quoteStatus) => {
      const result = decideQuoteResponse({
        decision: 'accept',
        quoteStatus,
        activeVersionId: ACTIVE_VERSION_ID,
        version: {
          id: ACTIVE_VERSION_ID,
          status: 'sent',
          validUntil: '2026-07-25',
        },
        today: '2026-07-18',
      })

      expect(result).toEqual({ allowed: false, code: 'QUOTE_ALREADY_RESOLVED' })
    },
  )
})
