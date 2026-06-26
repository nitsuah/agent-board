import React, { useState, useCallback, useEffect, useRef } from 'react';

let _addToast = null;

export function toast(message, type = 'info', durationMs = 4000) {
  if (_addToast) _addToast({ message, type, durationMs });
  else console.warn('[toast] container not mounted:', message);
}
toast.error = (msg, dur) => toast(msg, 'error', dur ?? 6000);
toast.success = (msg, dur) => toast(msg, 'success', dur ?? 3000);
toast.info = (msg, dur) => toast(msg, 'info', dur ?? 4000);

let _idCounter = 0;

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const remove = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback(({ message, type, durationMs }) => {
    const id = ++_idCounter;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5
    timersRef.current[id] = setTimeout(() => remove(id), durationMs);
  }, [remove]);

  useEffect(() => {
    _addToast = add;
    return () => { _addToast = null; };
  }, [add]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)}>
          <span className="toast-icon">
            {t.type === 'error' ? '✗' : t.type === 'success' ? '✓' : 'ℹ'}
          </span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
