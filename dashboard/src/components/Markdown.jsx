import React from 'react';

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function Markdown({ content }) {
  const [copied, setCopied] = React.useState(null);

  const copyCode = (code, idx) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(idx);
    setTimeout(() => setCopied(c => c === idx ? null : c), 1500);
  };

  const segments = React.useMemo(() => {
    if (!content) return [];
    const parts = [];
    let codeIdx = 0;
    const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    codeBlockRe.lastIndex = 0;
    while ((match = codeBlockRe.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', lang: match[1] || 'text', value: match[2].trim(), idx: codeIdx++ });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) parts.push({ type: 'text', value: content.slice(lastIndex) });
    return parts;
  }, [content]);

  const renderText = (text) => {
    let html = escHtml(text);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-code-inline">$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^[-*•] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?=\s*(?:<li>|$))/g, '$1');
    html = html.replace(/(<li>[\s\S]*<\/li>)/g, '<ul class="md-ul">$1</ul>');
    html = html.replace(/\n\n/g, '</p><p class="md-p">');
    html = html.replace(/\n/g, '<br>');
    html = `<p class="md-p">${html}</p>`;
    html = html.replace(/<p class="md-p"><\/p>/g, '');
    return html;
  };

  return (
    <div className="md-content">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <div key={i} className="md-code-block">
            <div className="md-code-header">
              <span className="md-code-lang">{seg.lang}</span>
              <button className="md-copy-btn" onClick={() => copyCode(seg.value, seg.idx)}>
                {copied === seg.idx ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre><code>{seg.value}</code></pre>
          </div>
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderText(seg.value) }} />
        )
      )}
    </div>
  );
}

export { escHtml };
export default Markdown;
