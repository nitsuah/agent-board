import { useState, useRef, useEffect } from 'react';

/**
 * Manages a WebSocket connection to /ws/events with auto-reconnect.
 * onEvent is called for each valid event payload — store it in a ref on the
 * call-site so the effect never needs to re-run when the handler changes.
 */
export function useWebSocket({ onEvent }) {
  const [wsConnected, setWsConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    let destroyed = false;
    const connect = () => {
      if (destroyed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/ws/events`);
      wsRef.current = socket;
      socket.onopen = () => setWsConnected(true);
      socket.onclose = () => {
        setWsConnected(false);
        if (!destroyed) reconnectTimerRef.current = setTimeout(connect, 3000);
      };
      socket.onerror = () => setWsConnected(false);
      socket.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data);
          if (payload.type !== 'event' || !payload.event) return;
          onEventRef.current?.(payload.event);
        } catch { /* ignore malformed payloads */ }
      };
    };
    connect();
    return () => {
      destroyed = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { wsConnected };
}
