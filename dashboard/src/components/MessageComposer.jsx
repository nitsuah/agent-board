import React, { useRef, useEffect } from 'react';

function useAutoResize(value) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  return ref;
}

export default function MessageComposer({
  activeSession, loading, queueLengths, messageInput, setMessageInput,
  sendMessage, handleMessageInputKeyDown, forceSend, stopSession,
}) {
  const textareaRef = useAutoResize(messageInput);
  return (
    <form className="chat-input-form" onSubmit={sendMessage}>
      <textarea
        ref={textareaRef}
        className="chat-textarea"
        rows={1}
        value={messageInput}
        onChange={e => setMessageInput(e.target.value)}
        onKeyDown={handleMessageInputKeyDown}
        placeholder={loading ? 'Queue next message…' : 'Type a message…'}
        maxLength={4000}
      />
      <div className="chat-input-actions">
        {loading && queueLengths[activeSession] > 0 && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            title="Stop current response and send next queued message immediately"
            onClick={() => forceSend(activeSession)}
          >⚡ Force ({queueLengths[activeSession]})</button>
        )}
        {loading && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            title="Stop responding"
            onClick={() => stopSession(activeSession)}
          >■ Stop</button>
        )}
        <button type="submit" className="btn-send">
          {loading ? '+ Queue' : 'Send'}
        </button>
        <span
          className="input-counter"
          style={messageInput.length > 3200 ? { color: messageInput.length > 3800 ? 'var(--red)' : 'var(--yellow, orange)' } : undefined}
        >
          {messageInput.length}/4k
        </span>
      </div>
    </form>
  );
}
