import React, { useState } from 'react';
import Markdown from './Markdown.jsx';

function ToolCallBadge({ tool, args, result }) {
  const [open, setOpen] = useState(false);
  const hasError = result?.error;
  return (
    <div className={`tool-call-badge ${hasError ? 'tool-call-error' : ''}`}>
      <button className="tool-call-toggle" onClick={() => setOpen(o => !o)}>
        <span className="tool-call-icon">{hasError ? '✗' : '⚙'}</span>
        <span className="tool-call-name">{tool}</span>
        <span className="tool-call-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tool-call-detail">
          <div className="tool-call-section"><span className="tool-call-label">Args</span><pre>{JSON.stringify(args, null, 2)}</pre></div>
          <div className="tool-call-section"><span className="tool-call-label">Result</span><pre>{JSON.stringify(result, null, 2)}</pre></div>
        </div>
      )}
    </div>
  );
}

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

export default function MessageList({ messages, loading, streamingContent, onFeedback, onFork, chatBottomRef }) {
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
          msg.role === 'tool_call' ? (
            <div key={index} className="message-tool-call-row">
              <ToolCallBadge tool={msg.tool} args={msg.args} result={msg.result} />
            </div>
          ) : (
          <div key={index} className={`message ${msg.role}`}>
            <div className="message-content">
              <span className="message-role" title={msg.timestamp ? new Date(msg.timestamp).toLocaleString() : undefined}>{msg.role === 'user' ? 'You' : 'AI'}</span>
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
            {msg.role === 'assistant' && msg.toolLog?.length > 0 && (
              <div className="message-tool-log">
                {msg.toolLog.map((tc, ti) => (
                  <ToolCallBadge key={ti} tool={tc.name} args={tc.args} result={tc.result} />
                ))}
              </div>
            )}
            {msg.role === 'assistant' && (
              <div className="message-feedback">
                <CopyButton text={msg.content} />
                {onFork && (
                  <button
                    className="btn-feedback"
                    onClick={() => onFork(index)}
                    title="Fork conversation from this point"
                  >⑂</button>
                )}
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
          )
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
