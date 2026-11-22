import type { RealtimeEvent } from '@cardops/shared';

export interface RealtimePrincipal {
  id: string;
  login: string;
  name: string;
  role: 'admin' | 'manager' | 'warehouse';
  warehouseId: string | null;
}

export function isVisible(event: RealtimeEvent, principal: RealtimePrincipal): boolean {
  switch (principal.role) {
    case 'admin':
      return true;
    case 'warehouse':
      return principal.warehouseId !== null && event.card.warehouseId === principal.warehouseId;
    case 'manager':
      return event.card.holderId === principal.id || event.card.ownerId === principal.id;
  }
}
