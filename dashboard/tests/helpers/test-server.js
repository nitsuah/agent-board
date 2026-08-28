/**
 * Shared test server.
 *
 * Several suites were written against a dashboard the developer had already
 * started by hand on :3000. In any clean environment — CI, a fresh container,
 * `npm run test:unit` — that server does not exist, so every one of those suites
 * failed with ECONNREFUSED and contributed no coverage.
 *
 * This helper starts the app in-process on an ephemeral port instead, so the
 * suites are self-contained. Setting TEST_BASE_URL still points them at an
 * external dashboard, preserving the original workflow.
 *
 * Usage:
 *   import { BASE, closeTestServer } from './helpers/test-server.js';
 *   ...
 *   closeTestServer();   // required, or the open handle keeps node alive
 */
let server = null;
let BASE;

if (process.env.TEST_BASE_URL) {
  BASE = process.env.TEST_BASE_URL.replace(/\/+$/, '');
} else {
  process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
  const { app } = await import('../../server.js');
  server = app.listen(0);
  BASE = `http://127.0.0.1:${server.address().port}`;
}

export { BASE };

/** Close the in-process server. No-op when running against TEST_BASE_URL. */
export function closeTestServer() {
  if (server) {
    server.close();
    server = null;
  }
}
