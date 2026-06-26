import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: 'var(--red)', fontFamily: 'monospace' }}>
          <strong>Something went wrong.</strong>
          <pre style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.8, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button
            style={{ marginTop: '1rem', padding: '0.3rem 0.8rem', cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
