'use strict';

// A 502 from the desktop proxy is the shop being unreachable, not a wrong PIN.
// The till must open from the saved verifier instead of stopping on that sentence.

function shopUnreachable(err) {
  if (!err) return false;
  const payload = err.payload && typeof err.payload === 'object' ? err.payload : null;
  const code = String(err.code || (payload && payload.code) || '');
  if (code === 'UPSTREAM_UNREACHABLE' || code === 'OFFLINE') return true;
  const message = String(err.message || (payload && payload.error) || '');
  if (/shop server could not be reached/i.test(message)) return true;
  if (err.isOffline || err.retryable) return true;
  const status = Number(err.status);
  return status === 0 || status >= 500;
}

module.exports = { shopUnreachable };
