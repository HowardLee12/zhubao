import { describe, expect, it } from 'vitest'

import { hasPermission } from './permissions'

const permissions = [
  'organization.manage',
  'membership.manage',
  'customer.read',
  'customer.manage',
  'customer.readAssigned',
  'serviceRequest.read',
  'serviceRequest.manage',
  'quote.read',
  'quote.manage',
  'quote.send',
  'quote.cost.read',
  'workOrder.readAll',
  'workOrder.manage',
  'workOrder.executeAssigned',
  'payment.read',
  'payment.manage',
  'lineChannel.manage',
] as const

const mvpRoles = ['owner', 'dispatcher', 'technician'] as const
const reservedRoles = ['admin', 'accountant', 'viewer'] as const
type TestedRole = (typeof mvpRoles)[number] | (typeof reservedRoles)[number]

const allowedByRole: Record<TestedRole, ReadonlySet<(typeof permissions)[number]>> = {
  owner: new Set(permissions),
  admin: new Set(permissions),
  dispatcher: new Set([
    'customer.read',
    'customer.manage',
    'serviceRequest.read',
    'serviceRequest.manage',
    'quote.read',
    'quote.manage',
    'quote.cost.read',
    'workOrder.readAll',
    'workOrder.manage',
    'payment.read',
  ]),
  technician: new Set([
    'customer.readAssigned',
    'workOrder.executeAssigned',
  ]),
  accountant: new Set([
    'customer.read',
    'quote.read',
    'quote.cost.read',
    'payment.read',
    'payment.manage',
  ]),
  viewer: new Set([
    'customer.read',
    'serviceRequest.read',
    'quote.read',
    'workOrder.readAll',
    'payment.read',
  ]),
}

describe('hasPermission role matrix', () => {
  it.each(mvpRoles)('matches the MVP assignable-role permission matrix for %s', (role) => {
    for (const permission of permissions) {
      expect(hasPermission(role, permission), `${role}: ${permission}`).toBe(
        allowedByRole[role].has(permission),
      )
    }
  })

  it.each(reservedRoles)('keeps the reserved %s role fail-closed to its documented permissions', (role) => {
    for (const permission of permissions) {
      expect(hasPermission(role, permission), `${role}: ${permission}`).toBe(
        allowedByRole[role].has(permission),
      )
    }
  })

  it('keeps assigned-only technician permissions separate from organization-wide read access', () => {
    expect(hasPermission('technician', 'workOrder.executeAssigned')).toBe(true)
    expect(hasPermission('technician', 'workOrder.readAll')).toBe(false)
    expect(hasPermission('technician', 'customer.readAssigned')).toBe(true)
    expect(hasPermission('technician', 'customer.read')).toBe(false)
  })

  it('does not let a dispatcher administer the organization or mark payments paid', () => {
    expect(hasPermission('dispatcher', 'organization.manage')).toBe(false)
    expect(hasPermission('dispatcher', 'membership.manage')).toBe(false)
    expect(hasPermission('dispatcher', 'lineChannel.manage')).toBe(false)
    expect(hasPermission('dispatcher', 'payment.manage')).toBe(false)
    expect(hasPermission('dispatcher', 'quote.send')).toBe(false)
  })

  it('does not expose internal cost to technician or viewer', () => {
    expect(hasPermission('technician', 'quote.cost.read')).toBe(false)
    expect(hasPermission('viewer', 'quote.cost.read')).toBe(false)
    expect(hasPermission('dispatcher', 'quote.cost.read')).toBe(true)
    expect(hasPermission('accountant', 'quote.cost.read')).toBe(true)
  })

  it('fails closed for an unrecognized role or permission at runtime', () => {
    expect(hasPermission('superuser' as never, 'customer.read')).toBe(false)
    expect(hasPermission('owner', 'database.drop' as never)).toBe(false)
  })
})
