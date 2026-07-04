import React, { useEffect } from 'react';

const SHORTCUTS = [
  { key: 'Ctrl+N', desc: 'New session (when not in a text input)' },
  { key: 'Ctrl+S', desc: 'Save file in workspace editor' },
  { key: 'Enter', desc: 'Send message (chat input)' },
  { key: 'Ctrl+Enter', desc: 'Send message (alternative)' },
  { key: 'Shift+Enter', desc: 'New line in chat input' },
  { key: '↑ / ↓', desc: 'Navigate terminal history' },
  { key: 'Ctrl+M', desc: 'Toggle metrics panel' },
  { key: '?', desc: 'Show this keyboard shortcuts reference' },
  { key: 'Esc', desc: 'Close this overlay' },
];

export default function KeyboardShortcutsModal({ onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="ks-overlay" onClick={onClose}>
      <div className="ks-modal" onClick={e => e.stopPropagation()}>
        <div className="ks-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="ks-list">
          {SHORTCUTS.map(({ key, desc }) => (
            <div key={key} className="ks-row">
              <kbd className="ks-key">{key}</kbd>
              <span className="ks-desc">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
