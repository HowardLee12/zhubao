export const WORK_ORDER_STATUSES = [
  'draft',
  'scheduled',
  'dispatched',
  'en_route',
  'on_site',
  'paused',
  'completed',
  'cancelled',
] as const

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number]

export const WORK_ORDER_ACTIONS = [
  'schedule',
  'dispatch',
  'enRoute',
  'arrive',
  'pause',
  'resume',
  'complete',
  'cancel',
  'reopen',
] as const

export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number]

export type WorkOrderActorRole =
  | 'owner'
  | 'admin'
  | 'dispatcher'
  | 'technician'
  | 'accountant'
  | 'viewer'

export interface WorkOrderTransitionFacts {
  activeAssignmentCount: number
  scheduledStartAt?: string
  scheduledEndAt?: string
  requiredChecklistComplete?: boolean
  requiredEvidenceComplete?: boolean
  hasBeforePhoto?: boolean
  hasAfterPhoto?: boolean
  completionSummary?: string
  reason?: string
  overrideReason?: string
  completedAt?: string
}

export interface DecideWorkOrderTransitionInput {
  status: WorkOrderStatus
  action: WorkOrderAction
  actor: {
    role: WorkOrderActorRole
    isAssigned: boolean
  }
  now: string
  occurredAt: string
  facts: WorkOrderTransitionFacts
}

type WorkOrderMissingRequirement =
  | 'activeAssignment'
  | 'scheduledStartAt'
  | 'scheduledEndAt'
  | 'requiredChecklist'
  | 'requiredEvidence'
  | 'beforePhoto'
  | 'afterPhoto'
  | 'completionSummary'
  | 'reason'
  | 'overrideReason'
  | 'completedAt'

export type WorkOrderTransitionResult =
  | { allowed: true; nextStatus: WorkOrderStatus }
  | {
      allowed: false
      code:
        | 'FORBIDDEN'
        | 'NOT_ASSIGNED'
        | 'INVALID_STATE_TRANSITION'
        | 'WORK_ORDER_PRECONDITION_FAILED'
        | 'INVALID_SCHEDULE_WINDOW'
        | 'OCCURRED_AT_OUT_OF_RANGE'
        | 'REOPEN_WINDOW_EXPIRED'
      missing?: WorkOrderMissingRequirement[]
      from?: WorkOrderStatus
      action?: WorkOrderAction
    }

const managerRoles: ReadonlySet<WorkOrderActorRole> = new Set([
  'owner',
  'admin',
  'dispatcher',
])

const ownerRoles: ReadonlySet<WorkOrderActorRole> = new Set(['owner', 'admin'])

const fieldActions: ReadonlySet<WorkOrderAction> = new Set([
  'enRoute',
  'arrive',
  'pause',
  'resume',
  'complete',
])

const managerActions: ReadonlySet<WorkOrderAction> = new Set([
  'schedule',
  'dispatch',
  'cancel',
])

const targetStatusByTransition: Partial<
  Record<WorkOrderStatus, Partial<Record<WorkOrderAction, WorkOrderStatus>>>
> = {
  draft: { schedule: 'scheduled', cancel: 'cancelled' },
  scheduled: { dispatch: 'dispatched', cancel: 'cancelled' },
  dispatched: { enRoute: 'en_route', cancel: 'cancelled' },
  en_route: { arrive: 'on_site', cancel: 'cancelled' },
  on_site: { pause: 'paused', complete: 'completed', cancel: 'cancelled' },
  paused: { resume: 'on_site', complete: 'completed', cancel: 'cancelled' },
  completed: { reopen: 'on_site' },
  cancelled: {},
}

function authorizeTransition(
  input: DecideWorkOrderTransitionInput,
): WorkOrderTransitionResult | null {
  const { action, actor } = input

  if (action === 'reopen') {
    return ownerRoles.has(actor.role) ? null : { allowed: false, code: 'FORBIDDEN' }
  }

  if (managerActions.has(action)) {
    return managerRoles.has(actor.role) ? null : { allowed: false, code: 'FORBIDDEN' }
  }

  if (fieldActions.has(action)) {
    if (managerRoles.has(actor.role)) {
      return null
    }
    if (actor.role !== 'technician') {
      return { allowed: false, code: 'FORBIDDEN' }
    }

    return actor.isAssigned ? null : { allowed: false, code: 'NOT_ASSIGNED' }
  }

  return { allowed: false, code: 'FORBIDDEN' }
}

function invalidTransition(
  status: WorkOrderStatus,
  action: WorkOrderAction,
): WorkOrderTransitionResult {
  return {
    allowed: false,
    code: 'INVALID_STATE_TRANSITION',
    from: status,
    action,
  }
}

function occurrenceDecision(
  input: DecideWorkOrderTransitionInput,
): WorkOrderTransitionResult | null {
  const now = Date.parse(input.now)
  const occurredAt = Date.parse(input.occurredAt)

  if (!Number.isFinite(now) || !Number.isFinite(occurredAt)) {
    return { allowed: false, code: 'OCCURRED_AT_OUT_OF_RANGE' }
  }

  const fiveMinutesMs = 5 * 60 * 1_000
  const twentyFourHoursMs = 24 * 60 * 60 * 1_000
  const thirtyDaysMs = 30 * twentyFourHoursMs

  if (occurredAt > now + fiveMinutesMs || now - occurredAt > thirtyDaysMs) {
    return { allowed: false, code: 'OCCURRED_AT_OUT_OF_RANGE' }
  }

  const outsideCorrectionWindow = now - occurredAt > twentyFourHoursMs

  if (!outsideCorrectionWindow) return null

  if (ownerRoles.has(input.actor.role) && input.facts.overrideReason?.trim()) {
    return null
  }

  return {
    allowed: false,
    code: 'OCCURRED_AT_OUT_OF_RANGE',
    ...(ownerRoles.has(input.actor.role) ? { missing: ['overrideReason'] } : {}),
  }
}

function scheduleDecision(
  facts: WorkOrderTransitionFacts,
): WorkOrderTransitionResult | null {
  const missing: WorkOrderMissingRequirement[] = []

  if (!hasActiveAssignment(facts)) missing.push('activeAssignment')
  if (!facts.scheduledStartAt) missing.push('scheduledStartAt')
  if (!facts.scheduledEndAt) missing.push('scheduledEndAt')

  if (missing.length > 0) {
    return { allowed: false, code: 'WORK_ORDER_PRECONDITION_FAILED', missing }
  }

  const start = Date.parse(facts.scheduledStartAt as string)
  const end = Date.parse(facts.scheduledEndAt as string)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { allowed: false, code: 'INVALID_SCHEDULE_WINDOW' }
  }

  return null
}

function hasActiveAssignment(facts: WorkOrderTransitionFacts): boolean {
  return Number.isInteger(facts.activeAssignmentCount) && facts.activeAssignmentCount > 0
}

function completionDecision(
  facts: WorkOrderTransitionFacts,
): WorkOrderTransitionResult | null {
  const missing: WorkOrderMissingRequirement[] = []

  if (!facts.requiredChecklistComplete) missing.push('requiredChecklist')
  if (!facts.requiredEvidenceComplete) missing.push('requiredEvidence')
  if (!facts.hasBeforePhoto) missing.push('beforePhoto')
  if (!facts.hasAfterPhoto) missing.push('afterPhoto')
  if (!facts.completionSummary?.trim()) missing.push('completionSummary')

  return missing.length > 0
    ? { allowed: false, code: 'WORK_ORDER_PRECONDITION_FAILED', missing }
    : null
}

function reopenDecision(
  input: DecideWorkOrderTransitionInput,
): WorkOrderTransitionResult | null {
  const missing: WorkOrderMissingRequirement[] = []
  if (!input.facts.reason?.trim()) missing.push('reason')
  if (!input.facts.completedAt) missing.push('completedAt')

  if (missing.length > 0) {
    return { allowed: false, code: 'WORK_ORDER_PRECONDITION_FAILED', missing }
  }

  const now = Date.parse(input.now)
  const completedAt = Date.parse(input.facts.completedAt as string)
  const correctionWindowMs = 24 * 60 * 60 * 1_000

  if (
    !Number.isFinite(now) ||
    !Number.isFinite(completedAt) ||
    completedAt > now ||
    now - completedAt > correctionWindowMs
  ) {
    return { allowed: false, code: 'REOPEN_WINDOW_EXPIRED' }
  }

  return null
}

export function decideWorkOrderTransition(
  input: DecideWorkOrderTransitionInput,
): WorkOrderTransitionResult {
  const authorizationFailure = authorizeTransition(input)
  if (authorizationFailure) return authorizationFailure

  const occurrenceFailure = occurrenceDecision(input)
  if (occurrenceFailure) return occurrenceFailure

  const nextStatus = targetStatusByTransition[input.status]?.[input.action]
  if (!nextStatus) return invalidTransition(input.status, input.action)

  if (input.action === 'schedule') {
    const failure = scheduleDecision(input.facts)
    if (failure) return failure
  }

  if (
    (input.action === 'dispatch' || input.action === 'enRoute') &&
    !hasActiveAssignment(input.facts)
  ) {
    return {
      allowed: false,
      code: 'WORK_ORDER_PRECONDITION_FAILED',
      missing: ['activeAssignment'],
    }
  }

  if (input.action === 'complete') {
    const failure = completionDecision(input.facts)
    if (failure) return failure
  }

  if (input.action === 'cancel' && !input.facts.reason?.trim()) {
    return {
      allowed: false,
      code: 'WORK_ORDER_PRECONDITION_FAILED',
      missing: ['reason'],
    }
  }

  if (input.action === 'reopen') {
    const failure = reopenDecision(input)
    if (failure) return failure
  }

  return { allowed: true, nextStatus }
}
