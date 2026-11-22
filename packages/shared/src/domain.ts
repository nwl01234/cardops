import { z } from 'zod';

export const ROLES = ['admin', 'manager', 'warehouse'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

export const CARD_STATUSES = ['in_stock', 'issued', 'returned', 'written_off'] as const;
export const cardStatusSchema = z.enum(CARD_STATUSES);
export type CardStatus = (typeof CARD_STATUSES)[number];

export const TRANSITION_ACTIONS = ['issue', 'return', 'restock', 'write_off'] as const;
export const transitionActionSchema = z.enum(TRANSITION_ACTIONS);
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

export const OPERATION_ACTIONS = [
  'card.created',
  'card.issued',
  'card.returned',
  'card.restocked',
  'card.written_off',
] as const;
export const operationActionSchema = z.enum(OPERATION_ACTIONS);
export type OperationAction = (typeof OPERATION_ACTIONS)[number];

interface TransitionRule {
  readonly from: readonly CardStatus[];
  readonly to: CardStatus;
  readonly operation: OperationAction;
}

/**
 * The only place where a card's lifecycle is described.
 * Both the API (authoritative) and the UI (affordances) read this table.
 */
export const TRANSITION_RULES: Record<TransitionAction, TransitionRule> = {
  issue: {
    from: ['in_stock'],
    to: 'issued',
    operation: 'card.issued',
  },
  return: {
    from: ['issued'],
    to: 'returned',
    operation: 'card.returned',
  },
  restock: {
    from: ['returned'],
    to: 'in_stock',
    operation: 'card.restocked',
  },
  write_off: {
    from: ['in_stock', 'returned'],
    to: 'written_off',
    operation: 'card.written_off',
  },
};

export function transitionTarget(action: TransitionAction, from: CardStatus): CardStatus | null {
  return TRANSITION_RULES[action].from.includes(from) ? TRANSITION_RULES[action].to : null;
}

export function isTransitionAllowed(action: TransitionAction, from: CardStatus): boolean {
  return transitionTarget(action, from) !== null;
}

export const TERMINAL_STATUSES: readonly CardStatus[] = ['written_off'];

export function isTerminal(status: CardStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
