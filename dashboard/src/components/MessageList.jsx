import React, { useState } from 'react';
import Markdown from './Markdown.jsx';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className="btn-feedback" onClick={copy} title="Copy to clipboard">
      {copied ? '✓' : '⎘'}
    </button>
  );
}

export default function MessageList({ messages, loading, streamingContent, onFeedback, chatBottomRef }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = query
    ? messages.map((msg, idx) => ({ msg, idx })).filter(({ msg }) => msg.content?.toLowerCase().includes(query))
    : messages.map((msg, idx) => ({ msg, idx }));

  return (
    <div className="chat-container">
      {messages.length > 2 && (
        <div className="msg-search-bar">
          <input
            className="msg-search-input"
            type="search"
            placeholder="Search messages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {query && <span className="msg-search-count">{visible.length}/{messages.length}</span>}
        </div>
      )}
      {visible.length > 0 ? (
        visible.map(({ msg, idx: index }) => (
          <div key={index} className={`message ${msg.role}`}>
            <div className="message-content">
              <span className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
              {msg.role === 'assistant'
                ? <Markdown content={msg.content} />
                : <span className="message-text">{msg.content}</span>
              }
              {msg.blocked && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--red)' }}>
                  [blocked by safety filter]
                </span>
              )}
            </div>
            {msg.role === 'assistant' && (
              <div className="message-feedback">
                <CopyButton text={msg.content} />
                {msg.feedback ? (
                  <span className="feedback-saved">
                    Feedback saved: {msg.feedback === 'up' ? '👍' : '👎'}
                  </span>
                ) : (
                  <>
                    <button
                      className="btn-feedback"
                      onClick={() => onFeedback(index, true)}
                      title="This was helpful"
                    >👍</button>
                    <button
                      className="btn-feedback"
                      onClick={() => onFeedback(index, false)}
                      title="This wasn't helpful"
                    >👎</button>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      ) : (
        <div className="messages-placeholder">
          <p>{query ? `No messages matching "${search}"` : 'No messages yet. Start a conversation!'}</p>
        </div>
      )}
      {loading && streamingContent && (
        <div className="message assistant streaming">
          <div className="message-content">
            <span className="message-role">AI</span>
            <Markdown content={streamingContent} />
            <span className="cursor-blink">▍</span>
          </div>
        </div>
      )}
      {loading && !streamingContent && (
        <div className="message assistant">
          <div className="message-content" style={{ opacity: 0.6, fontStyle: 'italic' }}>
            <span className="message-role">AI</span>
            <span> Thinking<span className="dot-pulse">...</span></span>
          </div>
        </div>
      )}
      <div ref={chatBottomRef} />
    </div>
  );
}
