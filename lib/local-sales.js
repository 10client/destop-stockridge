'use strict';

// Sales the till has not uploaded yet. The dashboard uses the same rule when
// the shop did not answer, so a saved sale is visible and is not lost.

function localSales(items, today) {
  const day = String(today || '').slice(0, 10);
  let gross = 0;
  let count = 0;
  for (const item of items || []) {
    if (!item || String(item.type || '').toUpperCase() !== 'SALE') continue;
    if (item.status && !['PENDING', 'RETRY'].includes(String(item.status))) continue;
    const when = String(item.occurred_at || item.at || '');
    if (day && when && when.slice(0, 10) !== day) continue;
    const payload = item.payload || {};
    const payments = Array.isArray(payload.payments) ? payload.payments : [];
    const paid = payments.reduce((sum, payment) => sum + (payment && payment.method === 'CREDIT' ? 0 : Number(payment && payment.amount) || 0), 0);
    gross += paid;
    count += 1;
  }
  return { count, gross };
}

module.exports = { localSales };
