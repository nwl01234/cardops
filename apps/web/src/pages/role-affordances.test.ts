import { describe, expect, it } from 'vitest';
import { availableTransitions } from '@cardops/shared';

describe('role-aware transition affordances', () => {
  it('shows an admin the valid actions for the current status', () => {
    expect(availableTransitions('in_stock', 'admin')).toEqual(['issue', 'write_off']);
    expect(availableTransitions('returned', 'admin')).toEqual(['restock', 'write_off']);
    expect(availableTransitions('written_off', 'admin')).toEqual([]);
  });

  it('never offers a manager anything except returning an issued card', () => {
    expect(availableTransitions('issued', 'manager')).toEqual(['return']);
    expect(availableTransitions('in_stock', 'manager')).toEqual([]);
    expect(availableTransitions('returned', 'manager')).toEqual([]);
  });

  it('limits warehouse staff to the same state machine', () => {
    expect(availableTransitions('in_stock', 'warehouse')).toEqual(['issue', 'write_off']);
    expect(availableTransitions('issued', 'warehouse')).toEqual(['return']);
  });
});
