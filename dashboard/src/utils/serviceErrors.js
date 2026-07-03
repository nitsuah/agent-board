export function getFriendlyServiceError(raw) {
  if (typeof raw !== 'string') return raw;
  if (raw.includes('ENOENT') || raw.includes('spawn') || raw.includes('docker-compose')) {
    return 'compose unavailable in this environment';
  }
  return raw;
}
