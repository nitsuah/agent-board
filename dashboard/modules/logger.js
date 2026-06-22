export function logStructured(level, eventType, data = {}) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    eventType,
    ...data,
  });
  if (level === 'error') { console.error(payload); return; }
  if (level === 'warn') { console.warn(payload); return; }
  console.log(payload);
}
