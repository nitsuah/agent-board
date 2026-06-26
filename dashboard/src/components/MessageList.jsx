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
  return (
    <div className="chat-container">
      {messages.length > 0 ? (
        messages.map((msg, index) => (
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
          <p>No messages yet. Start a conversation!</p>
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
