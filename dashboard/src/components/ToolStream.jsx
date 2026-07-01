/**
 * ToolStream — renders a streaming SSE tool invocation from a connector (e.g. bb-mcp).
 * Opens an EventSource to /api/mcp/:connectorId/stream?tool=<tool>&demo=1
 * and displays tokens incrementally with a typing indicator.
 */
import React, { useEffect, useRef, useState } from 'react';

export default function ToolStream({ connectorId = 'blackboard-learn', tool = 'list_courses', params = {}, demo = false, onDone }) {
  const [lines, setLines]     = useState([]);
  const [status, setStatus]   = useState('idle'); // idle | streaming | done | error
  const esRef                 = useRef(null);
  const bottomRef             = useRef(null);

  useEffect(() => {
    if (status !== 'idle') return;

    const qs = new URLSearchParams({ tool, ...params, ...(demo ? { demo: '1' } : {}) });
    const url = `/api/mcp/${connectorId}/stream?${qs}`;
    const es = new EventSource(url);
    esRef.current = es;
    setStatus('streaming');

    es.addEventListener('start', () => {
      setLines([]);
    });

    es.addEventListener('token', e => {
      try {
        const { text } = JSON.parse(e.data);
        setLines(prev => [...prev, text]);
      } catch { /* ignore */ }
    });

    es.addEventListener('done', () => {
      setStatus('done');
      es.close();
      onDone?.();
    });

    es.addEventListener('error', () => {
      setStatus('error');
      es.close();
    });

    return () => { es.close(); esRef.current = null; };
  }, [connectorId, tool, demo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="tool-stream">
      <div className="tool-stream-header">
        <span className="tool-stream-badge">{connectorId}</span>
        <span className="tool-stream-tool">{tool}</span>
        {status === 'streaming' && <span className="tool-stream-typing"><span /><span /><span /></span>}
        {status === 'done'      && <span className="tool-stream-done">✓ done</span>}
        {status === 'error'     && <span className="tool-stream-error">✗ error</span>}
      </div>
      <div className="tool-stream-output">
        {lines.map((line, i) => (
          <div key={i} className="tool-stream-line">{line}</div>
        ))}
        {status === 'streaming' && lines.length === 0 && (
          <div className="tool-stream-line tool-stream-line-faint">connecting…</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
