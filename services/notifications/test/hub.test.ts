import { describe, expect, it } from 'vitest';
import type { WSContext } from 'hono/ws';
import { NotificationHub } from '../src/hub';
import type { RealtimePrincipal } from '../src/visibility';

const admin: RealtimePrincipal = {
  id: 'user-1',
  login: 'admin',
  name: 'Admin',
  role: 'admin',
  warehouseId: null,
};

const manager: RealtimePrincipal = {
  id: 'user-2',
  login: 'manager',
  name: 'Manager',
  role: 'manager',
  warehouseId: null,
};

function socket(): { socket: WSContext; closed: number[] } {
  const closed: number[] = [];
  const value = {
    send() {},
    close(code: number) {
      closed.push(code);
    },
  } as unknown as WSContext;
  return { socket: value, closed };
}

describe('notification hub session lifecycle', () => {
  it('closes only the revoked session, not the whole user', () => {
    const hub = new NotificationHub(() => {});
    const first = socket();
    const second = socket();
    const other = socket();

    hub.attach(first.socket, admin, 'sid-1');
    hub.attach(second.socket, admin, 'sid-2');
    hub.attach(other.socket, manager, 'sid-3');
    expect(hub.size).toBe(3);
    expect(hub.sessionIds().sort()).toEqual(['sid-1', 'sid-2', 'sid-3']);

    hub.closeSession('sid-1');
    expect(first.closed).toEqual([4401]);
    expect(second.closed).toEqual([]);
    expect(hub.size).toBe(2);
  });

  it('closes every socket of a deactivated user', () => {
    const hub = new NotificationHub(() => {});
    const first = socket();
    const second = socket();
    const other = socket();

    hub.attach(first.socket, admin, 'sid-1');
    hub.attach(second.socket, admin, 'sid-2');
    hub.attach(other.socket, manager, 'sid-3');

    hub.closeUser(admin.id);
    expect(first.closed).toEqual([4401]);
    expect(second.closed).toEqual([4401]);
    expect(other.closed).toEqual([]);
    expect(hub.size).toBe(1);
  });
});
