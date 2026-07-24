import { describe, expect, it } from 'vitest'

import { calculateQuoteTotals } from './quote-calculation'

/**
 * Contract assumption: line subtotal and tax are rounded half-up to the minor
 * currency unit, then quote totals are sums of the rounded lines. The specs
 * require an explicit rule but do not currently name one.
 */
describe('calculateQuoteTotals', () => {
  it('calculates decimal quantities, per-line discounts and tax using integer-safe arithmetic', () => {
    const result = calculateQuoteTotals([
      {
        quantity: '2.000',
        unitPriceMinor: '1800',
        discountMinor: '100',
        taxRate: '0.0500',
      },
      {
        quantity: '1.500',
        unitPriceMinor: '1999',
        discountMinor: '0',
        taxRate: '0.0000',
      },
    ])

    expect(result).toEqual({
      lines: [
        {
          subtotalMinor: '3600',
          discountMinor: '100',
          taxMinor: '175',
          totalMinor: '3675',
        },
        {
          subtotalMinor: '2999',
          discountMinor: '0',
          taxMinor: '0',
          totalMinor: '2999',
        },
      ],
      subtotalMinor: '6599',
      discountMinor: '100',
      taxMinor: '175',
      totalMinor: '6674',
    })
  })

  it('rounds exact half-minor values away from zero', () => {
    const result = calculateQuoteTotals([
      {
        quantity: '1.000',
        unitPriceMinor: '10',
        discountMinor: '0',
        taxRate: '0.0500',
      },
    ])

    expect(result.lines[0]).toEqual({
      subtotalMinor: '10',
      discountMinor: '0',
      taxMinor: '1',
      totalMinor: '11',
    })
  })

  it('stays exact above Number.MAX_SAFE_INTEGER', () => {
    const result = calculateQuoteTotals([
      {
        quantity: '1000.000',
        unitPriceMinor: '9007199254740993',
        discountMinor: '0',
        taxRate: '0.0000',
      },
    ])

    expect(result.totalMinor).toBe('9007199254740993000')
    expect(result.lines[0]?.subtotalMinor).toBe('9007199254740993000')
  })

  it('does not let internal cost alter the customer total', () => {
    const result = calculateQuoteTotals([
      {
        quantity: '2.000',
        unitCostMinor: '999999',
        unitPriceMinor: '1800',
        discountMinor: '0',
        taxRate: '0.0000',
      },
    ])

    expect(result.totalMinor).toBe('3600')
  })

  it.each([
    {
      name: 'zero quantity',
      item: { quantity: '0.000', unitPriceMinor: '1', discountMinor: '0', taxRate: '0' },
      code: 'INVALID_QUANTITY',
    },
    {
      name: 'more than three quantity decimals',
      item: { quantity: '1.0001', unitPriceMinor: '1', discountMinor: '0', taxRate: '0' },
      code: 'INVALID_QUANTITY',
    },
    {
      name: 'fractional minor-unit price',
      item: { quantity: '1', unitPriceMinor: '1.5', discountMinor: '0', taxRate: '0' },
      code: 'INVALID_MONEY',
    },
    {
      name: 'negative discount',
      item: { quantity: '1', unitPriceMinor: '10', discountMinor: '-1', taxRate: '0' },
      code: 'INVALID_MONEY',
    },
    {
      name: 'tax above one hundred percent',
      item: { quantity: '1', unitPriceMinor: '10', discountMinor: '0', taxRate: '1.0001' },
      code: 'INVALID_TAX_RATE',
    },
  ])('rejects $name', ({ item, code }) => {
    expect.assertions(1)

    try {
      calculateQuoteTotals([item])
    } catch (error) {
      expect(error).toMatchObject({ code })
    }
  })

  it('rejects a line discount greater than its subtotal', () => {
    expect.assertions(1)

    try {
      calculateQuoteTotals([
        {
          quantity: '1.000',
          unitPriceMinor: '100',
          discountMinor: '101',
          taxRate: '0.0000',
        },
      ])
    } catch (error) {
      expect(error).toMatchObject({ code: 'DISCOUNT_EXCEEDS_SUBTOTAL' })
    }
  })

  it('returns zero totals for an empty draft while leaving send validation to the application service', () => {
    expect(calculateQuoteTotals([])).toEqual({
      lines: [],
      subtotalMinor: '0',
      discountMinor: '0',
      taxMinor: '0',
      totalMinor: '0',
    })
  })
})
