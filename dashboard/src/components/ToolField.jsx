import React from 'react';

function ToolField({ name, schema, required, value, onChange }) {
  const label = (
    <span className="tool-field-label">
      {name}{required ? ' *' : ''}
      {schema.description && <span className="tool-field-desc"> — {schema.description}</span>}
    </span>
  );

  if (schema.type === 'boolean') {
    return (
      <label className="tool-field tool-field-checkbox">
        <input
          type="checkbox"
          checked={value ?? schema.default ?? false}
          onChange={e => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }

  if (Array.isArray(schema.enum)) {
    return (
      <label className="tool-field">
        {label}
        <select
          className="select"
          value={value ?? schema.default ?? schema.enum[0]}
          onChange={e => onChange(e.target.value)}
        >
          {schema.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </label>
    );
  }

  return (
    <label className="tool-field">
      {label}
      <input
        type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
        value={value ?? schema.default ?? ''}
        placeholder={schema.default !== undefined ? String(schema.default) : ''}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}

export default ToolField;
