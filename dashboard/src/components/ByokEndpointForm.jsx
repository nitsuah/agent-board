import React, { useState } from 'react';
import { toast } from './Toast.jsx';

const PROVIDER_PRESETS = [
  { label: 'Anthropic', key: 'anthropic', name: 'Anthropic (Claude)', url: 'https://api.anthropic.com', apiStyle: 'anthropic', defaultModel: 'claude-sonnet-4-6', keyHint: 'sk-ant-...' },
  { label: 'OpenAI', key: 'openai', name: 'OpenAI', url: 'https://api.openai.com', apiStyle: 'openai', defaultModel: 'gpt-4o', keyHint: 'sk-...' },
  { label: 'Gemini', key: 'gemini', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com', apiStyle: 'gemini', defaultModel: 'gemini-2.5-flash', keyHint: 'AIza...' },
  { label: 'Groq', key: 'groq', name: 'Groq', url: 'https://api.groq.com/openai', apiStyle: 'openai', defaultModel: 'llama-3.3-70b-versatile', keyHint: 'gsk_...' },
  { label: 'Mistral', key: 'mistral', name: 'Mistral AI', url: 'https://api.mistral.ai', apiStyle: 'openai', defaultModel: 'mistral-large-latest', keyHint: '' },
  { label: 'Together', key: 'together', name: 'Together AI', url: 'https://api.together.xyz', apiStyle: 'openai', defaultModel: 'meta-llama/Llama-3-70b-chat-hf', keyHint: '' },
  { label: 'Perplexity', key: 'perplexity', name: 'Perplexity', url: 'https://api.perplexity.ai', apiStyle: 'openai', defaultModel: 'llama-3.1-sonar-large-128k-online', keyHint: 'pplx-...' },
];

const EMPTY_FORM = { key: '', name: '', url: '', apiStyle: 'openai', defaultModel: '', apiKey: '' };

export default function ByokEndpointForm({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/config/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        toast.success?.(`Added endpoint: ${form.key}`);
        setForm(EMPTY_FORM);
        setOpen(false);
        onAdded?.();
      } else {
        toast.error(data.error || 'Failed to add endpoint');
      }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: open ? 'none' : 'none', paddingTop: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? '0.5rem' : 0 }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Add external model</span>
        <button className="btn-docker-action" style={{ fontSize: '0.68rem' }} onClick={() => setOpen(p => !p)}>
          {open ? 'Cancel' : '+ Add'}
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.1rem' }}>
            {PROVIDER_PRESETS.map(p => (
              <button
                key={p.key}
                className="btn-docker-action"
                style={{ fontSize: '0.63rem', padding: '0.1rem 0.4rem', opacity: form.key === p.key ? 1 : 0.75 }}
                onClick={() => setForm({ key: p.key, name: p.name, url: p.url, apiStyle: p.apiStyle, defaultModel: p.defaultModel, apiKey: '' })}
              >{p.label}</button>
            ))}
          </div>
          {[
            ['key', 'Endpoint key (e.g. claude)', form.key],
            ['name', 'Display name', form.name],
            ['url', 'API base URL', form.url],
            ['defaultModel', 'Default model (optional)', form.defaultModel],
            ['apiKey', 'API key (optional)', form.apiKey],
          ].map(([field, placeholder, value]) => (
            <input
              key={field}
              type={field === 'apiKey' ? 'password' : 'text'}
              placeholder={placeholder}
              value={value}
              className="select"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
              onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
            />
          ))}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Style:</label>
            <select
              value={form.apiStyle}
              className="select"
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem' }}
              onChange={e => setForm(p => ({ ...p, apiStyle: e.target.value }))}
            >
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <button
            className="btn-primary"
            style={{ fontSize: '0.75rem' }}
            disabled={busy || !form.key || !form.url}
            onClick={handleSubmit}
          >{busy ? 'Adding…' : 'Add Endpoint'}</button>
        </div>
      )}
    </div>
  );
}
