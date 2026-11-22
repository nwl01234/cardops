import { describe, expect, it } from 'vitest';
import type { RealtimeEvent } from '@cardops/shared';
import { isVisible } from '../src/visibility';

const event: RealtimeEvent = {
  id: '1',
  type: 'card.issued',
  occurredAt: new Date().toISOString(),
  card: {
    id: 'card-1',
    sku: 'CRD-DEMO-01',
    title: 'Test',
    status: 'issued',
    warehouseId: 'msk',
    ownerId: 'owner-1',
    holderId: 'holder-1',
  },
  actor: null,
};

describe('realtime visibility', () => {
  it('lets admin see every event', () => {
    expect(
      isVisible(event, {
        id: 'admin-1',
        login: 'admin',
        name: 'Admin',
        role: 'admin',
        warehouseId: null,
      }),
    ).toBe(true);
  });

  it('scopes warehouse staff to their warehouse', () => {
    expect(
      isVisible(event, {
        id: 'wh-1',
        login: 'warehouse',
        name: 'Warehouse',
        role: 'warehouse',
        warehouseId: 'msk',
      }),
    ).toBe(true);
    expect(
      isVisible(event, {
        id: 'wh-2',
        login: 'warehouse2',
        name: 'Warehouse 2',
        role: 'warehouse',
        warehouseId: 'spb',
      }),
    ).toBe(false);
  });

  it('scopes a manager to owner/holder cards', () => {
    expect(
      isVisible(event, {
        id: 'holder-1',
        login: 'manager',
        name: 'Holder',
        role: 'manager',
        warehouseId: null,
      }),
    ).toBe(true);
    expect(
      isVisible(event, {
        id: 'owner-1',
        login: 'owner',
        name: 'Owner',
        role: 'manager',
        warehouseId: null,
      }),
    ).toBe(true);
    expect(
      isVisible(event, {
        id: 'foreign',
        login: 'foreign',
        name: 'Foreign',
        role: 'manager',
        warehouseId: null,
      }),
    ).toBe(false);
  });
});
