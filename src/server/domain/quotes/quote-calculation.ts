const BIGINT_ZERO = BigInt(0)
const BIGINT_TWO = BigInt(2)
const BIGINT_TEN = BigInt(10)
const QUANTITY_SCALE = BigInt(1_000)
const TAX_RATE_SCALE = BigInt(10_000)
const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807')

export type QuoteCalculationErrorCode =
  | 'INVALID_QUANTITY'
  | 'INVALID_MONEY'
  | 'INVALID_TAX_RATE'
  | 'DISCOUNT_EXCEEDS_SUBTOTAL'
  | 'MONEY_OVERFLOW'

export class QuoteCalculationError extends Error {
  readonly code: QuoteCalculationErrorCode

  constructor(code: QuoteCalculationErrorCode) {
    super(code)
    this.name = 'QuoteCalculationError'
    this.code = code
  }
}

export interface QuoteCalculationItem {
  quantity: string
  unitPriceMinor: string
  discountMinor: string
  taxRate: string
  unitCostMinor?: string
}

export interface CalculatedQuoteLine {
  subtotalMinor: string
  discountMinor: string
  taxMinor: string
  totalMinor: string
}

export interface CalculatedQuoteTotals {
  lines: CalculatedQuoteLine[]
  subtotalMinor: string
  discountMinor: string
  taxMinor: string
  totalMinor: string
}

function parseUnsignedInteger(value: string, code: QuoteCalculationErrorCode): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new QuoteCalculationError(code)
  }

  return BigInt(value)
}

function parseScaledDecimal(
  value: string,
  decimalPlaces: number,
  code: QuoteCalculationErrorCode,
): bigint {
  if (typeof value !== 'string') {
    throw new QuoteCalculationError(code)
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match || (match[2]?.length ?? 0) > decimalPlaces) {
    throw new QuoteCalculationError(code)
  }

  const whole = BigInt(match[1])
  const fraction = (match[2] ?? '').padEnd(decimalPlaces, '0')
  const scale = BIGINT_TEN ** BigInt(decimalPlaces)

  return whole * scale + BigInt(fraction || '0')
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BIGINT_TWO) / denominator
}

function ensureMoneyFits(value: bigint): bigint {
  if (value < BIGINT_ZERO || value > POSTGRES_BIGINT_MAX) {
    throw new QuoteCalculationError('MONEY_OVERFLOW')
  }

  return value
}

function calculateLine(item: QuoteCalculationItem): CalculatedQuoteLine {
  const quantity = parseScaledDecimal(item.quantity, 3, 'INVALID_QUANTITY')
  if (quantity <= BIGINT_ZERO) {
    throw new QuoteCalculationError('INVALID_QUANTITY')
  }

  const unitPrice = parseUnsignedInteger(item.unitPriceMinor, 'INVALID_MONEY')
  const discount = parseUnsignedInteger(item.discountMinor, 'INVALID_MONEY')
  const taxRate = parseScaledDecimal(item.taxRate, 4, 'INVALID_TAX_RATE')

  if (item.unitCostMinor !== undefined) {
    parseUnsignedInteger(item.unitCostMinor, 'INVALID_MONEY')
  }

  if (taxRate > TAX_RATE_SCALE) {
    throw new QuoteCalculationError('INVALID_TAX_RATE')
  }

  const subtotal = ensureMoneyFits(roundHalfUp(quantity * unitPrice, QUANTITY_SCALE))
  if (discount > subtotal) {
    throw new QuoteCalculationError('DISCOUNT_EXCEEDS_SUBTOTAL')
  }

  const taxableAmount = subtotal - discount
  const tax = ensureMoneyFits(roundHalfUp(taxableAmount * taxRate, TAX_RATE_SCALE))
  const total = ensureMoneyFits(taxableAmount + tax)

  return {
    subtotalMinor: subtotal.toString(),
    discountMinor: discount.toString(),
    taxMinor: tax.toString(),
    totalMinor: total.toString(),
  }
}

export function calculateQuoteTotals(
  items: readonly QuoteCalculationItem[],
): CalculatedQuoteTotals {
  const lines = items.map(calculateLine)

  let subtotal = BIGINT_ZERO
  let discount = BIGINT_ZERO
  let tax = BIGINT_ZERO
  let total = BIGINT_ZERO

  for (const line of lines) {
    subtotal = ensureMoneyFits(subtotal + BigInt(line.subtotalMinor))
    discount = ensureMoneyFits(discount + BigInt(line.discountMinor))
    tax = ensureMoneyFits(tax + BigInt(line.taxMinor))
    total = ensureMoneyFits(total + BigInt(line.totalMinor))
  }

  return {
    lines,
    subtotalMinor: subtotal.toString(),
    discountMinor: discount.toString(),
    taxMinor: tax.toString(),
    totalMinor: total.toString(),
  }
}
