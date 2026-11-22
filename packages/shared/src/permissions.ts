import {
  TRANSITION_RULES,
  transitionTarget,
  type CardStatus,
  type Role,
  type TransitionAction,
} from './domain';

/**
 * Role-level capabilities. Object-level rules (warehouse scope, ownership,
 * holder) are enforced by the API on top of this matrix.
 */
export const CAPABILITIES = {
  'card.create': ['admin', 'warehouse'],
  'card.read': ['admin', 'manager', 'warehouse'],
  'audit.read': ['admin', 'manager', 'warehouse'],
  'dashboard.read': ['admin', 'manager', 'warehouse'],
  'warehouse.list': ['admin', 'manager', 'warehouse'],
  'user.list': ['admin', 'warehouse'],
  'user.manage': ['admin'],
  'system.read': ['admin'],
  'outbox.read': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

/**
 * Which actions a role may attempt at all. The object check is separate:
 * a manager may only return a card currently held by them.
 */
export const TRANSITION_ACTIONS_BY_ROLE: Record<Role, readonly TransitionAction[]> = {
  admin: ['issue', 'return', 'restock', 'write_off'],
  manager: ['return'],
  warehouse: ['issue', 'return', 'restock', 'write_off'],
};

export function canRolePerform(role: Role, action: TransitionAction): boolean {
  return TRANSITION_ACTIONS_BY_ROLE[role].includes(action);
}

export function availableTransitions(status: CardStatus, role: Role): readonly TransitionAction[] {
  return TRANSITION_ACTIONS_BY_ROLE[role].filter(
    (action) => transitionTarget(action, status) !== null,
  );
}

export function operationFor(action: TransitionAction) {
  return TRANSITION_RULES[action].operation;
}
