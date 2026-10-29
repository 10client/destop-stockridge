'use strict';

// A catch-up copies only what changed. A row the till already holds at the
// same updated_at is not written again, and a book copied a few minutes ago
// is not read again. The first copy is the full one. After that, the cursor
// is the last successful copy.

function sameStamp(prev, next) {
  if (next == null || next === '') return false;
  return String(prev == null ? '' : prev) === String(next);
}

function changedRows(rows, stamps) {
  const map = stamps instanceof Map ? stamps : new Map();
  return (rows || []).filter((row) => {
    if (!row || row.id == null) return false;
    const next = row.updated_at == null || row.updated_at === '' ? null : String(row.updated_at);
    if (next == null) return true;
    return !sameStamp(map.get(String(row.id)), next);
  });
}

function copyDue(lastAt, now, minMs) {
  if (!lastAt) return true;
  const text = String(lastAt).replace(' ', 'T');
  const then = Date.parse(text);
  if (!Number.isFinite(then)) return true;
  return (Number(now) || 0) - then >= Number(minMs);
}

module.exports = { sameStamp, changedRows, copyDue };
