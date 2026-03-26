/**
 * OpenTelemetry tracing module for agent-board dashboard.
 * Instruments critical paths: EventBus, session lifecycle, LLM calls.
 * Gracefully degrades if OTEL backend is not available.
 */

import { trace, context, SpanStatusCode, diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { createRequire } from 'module';

// OTel packages ship as CommonJS — use createRequire for reliable interop
const _require = createRequire(import.meta.url);
const { NodeSDK } = _require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = _require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = _require('@opentelemetry/resources');
const { getNodeAutoInstrumentations } = _require('@opentelemetry/auto-instrumentations-node');

const OTEL_ENDPOINT = process.env.OTEL_ENDPOINT || 'http://localhost:4318';
const ENABLED = process.env.OTEL_ENABLED === 'true' || process.env.OTEL_ENABLED === '1';

let sdk = null;
let tracer = null;
let initialized = false;
let enabled = false;

/**
 * Initialize OpenTelemetry tracing.
 * Sets up automatic instrumentation and OTLP exporter.
 * Gracefully handles missing backend.
 */
async function initTracing(logStructured) {
  try {
    if (!ENABLED) {
      logStructured?.({
        timestamp: new Date().toISOString(),
        level: 'info',
        eventType: 'tracing_disabled',
        message: 'OpenTelemetry tracing disabled via OTEL_ENABLED env var'
      });
      initialized = true;
      enabled = false;
      return;
    }

    // Suppress noisy SDK logs in production
    if (process.env.NODE_ENV === 'production') {
      diag.setLogger(new DiagConsoleLogger(), { logLevel: DiagLogLevel.ERROR });
    }

    // Resource attributes using the new v2 API (resourceFromAttributes)
    const resource = resourceFromAttributes({
      'service.name': 'agent-board-dashboard',
      'service.version': '0.1.0',
      'deployment.environment': process.env.NODE_ENV || 'development'
    });

    // Create OTLP exporter (sends to Jaeger or compatible backend)
    const exporter = new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT}/v1/traces`
    });

    // Initialize SDK with auto-instrumentation and exporter
    sdk = new NodeSDK({
      resource,
      traceExporter: exporter,
      instrumentations: [getNodeAutoInstrumentations({
        // Reduce noise: disable fs auto-instrumentation
        '@opentelemetry/instrumentation-fs': { enabled: false }
      })]
    });

    // Start the SDK
    sdk.start();

    // Get tracer instance for manual instrumentation
    tracer = trace.getTracer('agent-board-dashboard', '0.1.0');

    enabled = true;
    initialized = true;

    logStructured?.({
      timestamp: new Date().toISOString(),
      level: 'info',
      eventType: 'tracing_ready',
      enabled: true,
      endpoint: OTEL_ENDPOINT
    });
  } catch (error) {
    // Graceful degradation: app continues without tracing
    initialized = true;
    enabled = false;

    logStructured?.({
      timestamp: new Date().toISOString(),
      level: 'warn',
      eventType: 'tracing_init_error',
      enabled: false,
      error: error.message
    });
  }
}

/**
 * Create and manage a span for a specific operation.
 * If tracing not enabled, callback is executed immediately without span overhead.
 *
 * @param {string} spanName - Name of the span (e.g., 'llm.call', 'session.create')
 * @param {object} attributes - Optional span attributes
 * @param {function} callback - Async function to execute within span
 * @returns {any} Result of callback
 */
async function withSpan(spanName, attributes, callback) {
  if (!enabled || !tracer) {
    // No overhead if tracing disabled
    if (typeof attributes === 'function') {
      return attributes();
    }
    return callback();
  }

  // Handle both (spanName, attributes, callback) and (spanName, callback) patterns
  const actualCallback = callback || attributes;
  const actualAttributes = callback ? attributes : {};

  const span = tracer.startSpan(spanName);
  try {
    // Add attributes if provided
    if (actualAttributes && typeof actualAttributes === 'object') {
      span.setAttributes(actualAttributes);
    }

    // Execute callback within span context
    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await actualCallback();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        span.recordException(error);
        throw error;
      }
    });
  } finally {
    span.end();
  }
}

/**
 * Record a log event as a span event (useful for EventBus integration).
 * @param {string} eventType - Type of event (e.g., 'session_start')
 * @param {object} attributes - Event attributes
 */
function recordEvent(eventType, attributes = {}) {
  if (!enabled || !tracer) return;

  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(eventType, attributes);
  }
}

/**
 * Get current status of tracing system.
 * @returns {object} Status object
 */
function getStatus() {
  return {
    initialized,
    enabled,
    endpoint: enabled ? OTEL_ENDPOINT : null
  };
}

/**
 * Gracefully shut down tracing (should be called on server shutdown).
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch (error) {
      // Ignore shutdown errors
    }
  }
}

export { initTracing, withSpan, recordEvent, getStatus, shutdown };

