import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import { logStructured } from './logger.js';
import { persistEvent } from '../persistence.js';

const _eventStore = [];
const MAX_EVENTS = 10000;
const _eventSubscribers = new Set();

export const eventBus = {
  emit(type, data = {}) {
    const event = {
      event_id: randomUUID(),
      session_id: data.session_id || null,
      user_id: data.user_id || 'anonymous',
      timestamp: new Date().toISOString(),
      event_type: type,
      model: data.model || null,
      endpoint: data.endpoint || null,
      experience: data.experience || null,
      metadata: data.metadata || {},
    };
    _eventStore.push(event);
    if (_eventStore.length > MAX_EVENTS) _eventStore.shift();

    for (const listener of _eventSubscribers) {
      try {
        listener(event);
      } catch (error) {
        logStructured('warn', 'event_subscriber_failed', { error: error.message });
      }
    }

    persistEvent(event, logStructured);
    return event;
  },
  getAll() { return _eventStore; },
  getByType(type) { return _eventStore.filter(e => e.event_type === type); },
  getSince(iso) {
    const since = new Date(iso).getTime();
    return _eventStore.filter(e => new Date(e.timestamp).getTime() >= since);
  },
  subscribe(listener) {
    _eventSubscribers.add(listener);
    return () => _eventSubscribers.delete(listener);
  },
};

let wsEventServerAttached = false;

export function attachEventWebSocketServer(server) {
  if (!server || wsEventServerAttached) return;

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws/events')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (client) => {
    client.send(JSON.stringify({ type: 'hello', timestamp: new Date().toISOString() }));
  });

  const unsubscribe = eventBus.subscribe((event) => {
    const payload = JSON.stringify({ type: 'event', event });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload);
    });
  });

  server.on('close', () => {
    unsubscribe();
    wss.close();
    wsEventServerAttached = false;
  });

  wsEventServerAttached = true;
}
