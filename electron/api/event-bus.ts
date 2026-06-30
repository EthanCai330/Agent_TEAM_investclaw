import type { ServerResponse } from 'http';

type EventPayload = unknown;

export class HostEventBus {
  private readonly clients = new Set<ServerResponse>();
  private readonly listeners = new Map<string, Set<(payload: EventPayload) => void>>();

  addSseClient(res: ServerResponse): void {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  emit(eventName: string, payload: EventPayload): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      try {
        listener(payload);
      } catch {
        // A renderer bridge listener must not break SSE delivery.
      }
    }
    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  on(eventName: string, listener: (payload: EventPayload) => void): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(eventName);
    };
  }

  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // Ignore individual client close failures.
      }
    }
    this.clients.clear();
    this.listeners.clear();
  }
}
