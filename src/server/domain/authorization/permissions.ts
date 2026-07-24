export const ROLES = [
  'owner',
  'admin',
  'dispatcher',
  'technician',
  'accountant',
  'viewer',
] as const

export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
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

export type Permission = (typeof PERMISSIONS)[number]

const allPermissions = new Set<Permission>(PERMISSIONS)

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  owner: allPermissions,
  admin: allPermissions,
  dispatcher: new Set<Permission>([
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
  technician: new Set<Permission>([
    'customer.readAssigned',
    'workOrder.executeAssigned',
  ]),
  accountant: new Set<Permission>([
    'customer.read',
    'quote.read',
    'quote.cost.read',
    'payment.read',
    'payment.manage',
  ]),
  viewer: new Set<Permission>([
    'customer.read',
    'serviceRequest.read',
    'quote.read',
    'workOrder.readAll',
    'payment.read',
  ]),
}

/**
 * Checks static organization-role permissions. Resource ownership, assignment,
 * membership status and tenant boundaries must still be checked separately.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  if (!ROLES.includes(role) || !PERMISSIONS.includes(permission)) {
    return false
  }

  return rolePermissions[role].has(permission)
}
