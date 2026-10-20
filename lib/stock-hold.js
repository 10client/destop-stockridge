'use strict';

// A LAN hold is not a second stock ledger. It reduces what this till
// offers to sell until the Worker has accepted the other till's sale,
// or the hold expires. The mirror row on disk is not rewritten.

function applyHolds(batches, holdsByProduct) {
  const left = Object.assign({}, holdsByProduct || {});
  return (batches || []).map((row) => {
    if (!row) return row;
    const id = String(row.product_id || '');
    const hold = Number(left[id] || 0);
    if (!(hold > 0)) return row;
    const qty = Number(row.quantity) || 0;
    const reserved = Number(row.quantity_reserved || 0);
    const room = Math.max(0, qty - reserved);
    const take = Math.min(room, hold);
    left[id] = hold - take;
    if (!(take > 0)) return row;
    return Object.assign({}, row, { quantity_reserved: reserved + take, hub_hold: take });
  });
}

function linesFromSale(payload) {
  const lines = payload && Array.isArray(payload.lines) ? payload.lines : [];
  return lines
    .map((line) => ({
      product_id: line && line.product_id ? String(line.product_id) : '',
      qty: Number(line && line.quantity),
    }))
    .filter((line) => line.product_id && line.qty > 0);
}

module.exports = { applyHolds, linesFromSale };
