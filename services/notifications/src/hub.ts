import type { RealtimeEvent } from '@cardops/shared';
import type { WSContext } from 'hono/ws';
import type { RealtimePrincipal } from './visibility';
import { isVisible } from './visibility';

interface Client {
  socket: WSContext;
  principal: RealtimePrincipal;
}

export class NotificationHub {
  private readonly clients = new Map<WSContext, Client>();

  constructor(private readonly onConnectionChange: (delta: number) => void) {}

  get size(): number {
    return this.clients.size;
  }

  attach(socket: WSContext, principal: RealtimePrincipal): void {
    this.clients.set(socket, { socket, principal });
    this.onConnectionChange(1);
    socket.send(JSON.stringify({ type: 'ready', at: new Date().toISOString() }));
  }

  detach(socket: WSContext): void {
    if (!this.clients.delete(socket)) return;
    this.onConnectionChange(-1);
  }

  broadcast(event: RealtimeEvent): void {
    for (const client of this.clients.values()) {
      if (!isVisible(event, client.principal)) continue;
      try {
        client.socket.send(JSON.stringify({ type: 'event', event }));
      } catch {
        this.detach(client.socket);
      }
    }
  }

  heartbeat(): void {
    for (const client of this.clients.values()) {
      try {
        client.socket.send(JSON.stringify({ type: 'ping', at: new Date().toISOString() }));
      } catch {
        this.detach(client.socket);
      }
    }
  }

  closeUser(userId: string): void {
    for (const client of this.clients.values()) {
      if (client.principal.id !== userId) continue;
      try {
        client.socket.close(4401, 'session revoked');
      } catch {
        // Already closed by the peer.
      }
      this.clients.delete(client.socket);
    }
  }

  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.socket.close(1001, 'server shutting down');
      } catch {
        // Ignore an already closed socket.
      }
    }
    this.clients.clear();
  }
}
