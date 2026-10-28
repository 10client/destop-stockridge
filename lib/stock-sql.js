'use strict';

// The shop moves stock with a guarded UPDATE, not with a second hold on top
// of a quantity it already cut. This is that statement, on the till's own
// SQLite file. The picker matches the shop: free stock only, soonest expiry,
// then the oldest receipt, then batch number. A hire or a lease does not
// leave the shelf. The statements are the ones in salesService.complete and
// the stock adjust route. Do not deduct in JavaScript and also hold the same
// units: that is how a product shows, then disappears.

const SALE_HELD = `UPDATE shelf_batches
   SET quantity = quantity - ?,
       quantity_reserved = quantity_reserved - ?,
       status = CASE WHEN quantity - ? <= 0 THEN 'DEPLETED' ELSE status END,
       updated_at = datetime('now')
 WHERE id = ?
   AND is_deleted = 0
   AND quantity_reserved >= ?
   AND quantity >= ?
   AND quantity - quantity_reserved + ? >= ?`;

const SALE_FREE = `UPDATE shelf_batches
   SET quantity = quantity - ?,
       status = CASE WHEN quantity - ? <= 0 THEN 'DEPLETED' ELSE status END,
       updated_at = datetime('now')
 WHERE id = ?
   AND is_deleted = 0
   AND quantity - quantity_reserved >= ?`;

const RELEASE_HOLD = `UPDATE shelf_batches
   SET quantity_reserved = quantity_reserved - ?,
       updated_at = datetime('now')
 WHERE id = ? AND is_deleted = 0 AND quantity_reserved >= ?`;

const ADJUST_DOWN = `UPDATE shelf_batches
   SET quantity = quantity - ?,
       updated_at = datetime('now')
 WHERE id = ? AND is_deleted = 0 AND quantity - quantity_reserved >= ?`;

const ADJUST_STATUS = `UPDATE shelf_batches
   SET status = CASE WHEN quantity <= 0 THEN 'DEPLETED' ELSE status END,
       updated_at = datetime('now')
 WHERE id = ?`;

const ADJUST_UP = `UPDATE shelf_batches
   SET quantity = quantity + ?,
       initial_quantity = COALESCE(initial_quantity, 0) + ?,
       status = CASE WHEN status = 'DEPLETED' THEN 'ACTIVE' ELSE status END,
       updated_at = datetime('now')
 WHERE id = ? AND is_deleted = 0`;

const SHELF_SQL = `
CREATE TABLE IF NOT EXISTS shelf_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  branch_id TEXT,
  business_id TEXT,
  batch_no TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  quantity_reserved REAL NOT NULL DEFAULT 0,
  initial_quantity REAL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expiry_date TEXT,
  received_at TEXT,
  created_at TEXT,
  cost_price_per_unit REAL,
  selling_price_per_unit REAL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  row_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shelf_product ON shelf_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_shelf_branch ON shelf_batches(branch_id);

CREATE TABLE IF NOT EXISTS shelf_applied (
  client_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  shortfall REAL NOT NULL DEFAULT 0,
  generation TEXT,
  applied_at TEXT NOT NULL
);
`;

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function factorFor(unitCode, units, fallback) {
  const code = String(unitCode || '').trim().toUpperCase();
  const rows = (units || []).filter((row) => row && !Number(row.is_deleted) && Number(row.quantity_in_base) > 0);
  if (code && rows.length) {
    const hit = rows.find((row) => String(row.code || '').toUpperCase() === code)
      || rows.find((row) => String(row.name || '').toUpperCase() === code);
    if (hit) return Number(hit.quantity_in_base);
  }
  const explicit = Number(fallback);
  return explicit > 0 ? explicit : 1;
}

function baseQuantity(line, units) {
  const qty = Number(line && (line.quantity != null ? line.quantity : line.qty));
  if (!(qty > 0)) return 0;
  const factor = factorFor(
    line.unitCode || line.unit_code,
    units,
    line.unitFactor != null ? line.unitFactor : line.unit_factor,
  );
  return roundTo(qty * factor, 4);
}

function holdsStock(line) {
  const channel = String((line && (line.channel || line.sale_type || line.saleType)) || 'RETAIL').toUpperCase();
  return channel === 'HIRE' || channel === 'LEASE';
}

function ensureShelf(db) {
  db.exec(SHELF_SQL);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function upsertRows(db, rows) {
  const write = db.prepare(`INSERT INTO shelf_batches (
      id, product_id, variant_id, branch_id, business_id, batch_no,
      quantity, quantity_reserved, initial_quantity, status, expiry_date,
      received_at, created_at, cost_price_per_unit, selling_price_per_unit,
      is_deleted, updated_at, row_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      product_id = excluded.product_id,
      variant_id = excluded.variant_id,
      branch_id = excluded.branch_id,
      business_id = excluded.business_id,
      batch_no = excluded.batch_no,
      quantity = excluded.quantity,
      quantity_reserved = excluded.quantity_reserved,
      initial_quantity = excluded.initial_quantity,
      status = excluded.status,
      expiry_date = excluded.expiry_date,
      received_at = excluded.received_at,
      created_at = excluded.created_at,
      cost_price_per_unit = excluded.cost_price_per_unit,
      selling_price_per_unit = excluded.selling_price_per_unit,
      is_deleted = excluded.is_deleted,
      updated_at = excluded.updated_at,
      row_json = excluded.row_json`);
  let n = 0;
  for (const raw of rows || []) {
    if (!raw || raw.id == null) continue;
    const row = Object.assign({}, raw);
    write.run(
      String(row.id),
      String(row.product_id || ''),
      row.variant_id == null ? null : String(row.variant_id),
      row.branch_id == null ? null : String(row.branch_id),
      row.business_id == null ? null : String(row.business_id),
      row.batch_no == null ? null : String(row.batch_no),
      num(row.quantity),
      num(row.quantity_reserved),
      row.initial_quantity == null ? null : num(row.initial_quantity),
      String(row.status || 'ACTIVE'),
      row.expiry_date == null ? null : String(row.expiry_date),
      row.received_at == null ? null : String(row.received_at),
      row.created_at == null ? null : String(row.created_at),
      row.cost_price_per_unit == null ? null : num(row.cost_price_per_unit),
      row.selling_price_per_unit == null ? null : num(row.selling_price_per_unit),
      Number(row.is_deleted) ? 1 : 0,
      row.updated_at == null ? null : String(row.updated_at),
      JSON.stringify(row),
    );
    n += 1;
  }
  return n;
}

function readRows(db) {
  const hits = db.prepare('SELECT row_json, quantity, quantity_reserved, status, is_deleted, updated_at FROM shelf_batches').all();
  return hits.map((hit) => {
    let row = {};
    try { row = JSON.parse(hit.row_json) || {}; } catch (err) { row = {}; }
    return Object.assign({}, row, {
      quantity: num(hit.quantity),
      quantity_reserved: num(hit.quantity_reserved),
      status: hit.status || row.status || 'ACTIVE',
      is_deleted: hit.is_deleted ? 1 : 0,
      updated_at: hit.updated_at || row.updated_at || null,
    });
  });
}

function freeOf(batch) {
  return Math.max(0, num(batch.quantity) - num(batch.quantity_reserved));
}

function sortBatches(batches, preferIds, asOf) {
  return (batches || []).filter((batch) => {
    if (!batch || Number(batch.is_deleted)) return false;
    if (String(batch.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return false;
    if (asOf && batch.expiry_date && String(batch.expiry_date).slice(0, 10) < asOf) return false;
    return freeOf(batch) > 0;
  }).sort((a, b) => {
    if (preferIds) {
      const pa = preferIds.has(String(a.id)) ? 0 : 1;
      const pb = preferIds.has(String(b.id)) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    const ea = a.expiry_date ? Date.parse(a.expiry_date) : Number.POSITIVE_INFINITY;
    const eb = b.expiry_date ? Date.parse(b.expiry_date) : Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea - eb;
    const ra = Date.parse(a.received_at || a.created_at || 0) || 0;
    const rb = Date.parse(b.received_at || b.created_at || 0) || 0;
    if (ra !== rb) return ra - rb;
    const ba = String(a.batch_no || '');
    const bb = String(b.batch_no || '');
    if (ba !== bb) return ba < bb ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

function holdMapOf(holds) {
  const map = new Map();
  for (const hold of holds || []) {
    const id = String((hold && (hold.batchId || hold.batch_id)) || '');
    const qty = Number(hold && (hold.quantityBase != null ? hold.quantityBase : hold.quantity_base));
    if (!id || !(qty > 0)) continue;
    map.set(id, roundTo((map.get(id) || 0) + qty, 4));
  }
  return map;
}

function saleLines(record) {
  if (!record) return [];
  if (Array.isArray(record.lines)) return record.lines;
  const payload = record.payload || {};
  return Array.isArray(payload.lines) ? payload.lines : [];
}

function saleHolds(record) {
  if (!record) return [];
  if (Array.isArray(record.holds)) return record.holds;
  const payload = record.payload || {};
  return payload.stock_holds || payload.stockHolds || record.stock_holds || record.stockHolds || [];
}

function saleAsOf(record) {
  const payload = (record && record.payload) || {};
  const raw = (record && (record.sold_at || record.occurred_at)) || payload.sold_at || '';
  const text = String(raw || '');
  return text ? text.slice(0, 10) : null;
}

function clientIdOf(record) {
  if (!record) return '';
  return String(record.client_id || record.clientId || '');
}

function appliedRow(db, clientId) {
  if (!clientId) return null;
  return db.prepare('SELECT client_id, kind, shortfall, generation FROM shelf_applied WHERE client_id = ?').get(clientId) || null;
}

function alreadyApplied(db, clientId) {
  return Boolean(appliedRow(db, clientId));
}

function markApplied(db, clientId, kind, shortfall, generation) {
  if (!clientId) return;
  db.prepare(`INSERT INTO shelf_applied (client_id, kind, shortfall, generation, applied_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_id) DO UPDATE SET
      kind = excluded.kind,
      shortfall = excluded.shortfall,
      generation = excluded.generation,
      applied_at = excluded.applied_at`).run(clientId, kind, num(shortfall), generation == null ? null : String(generation));
}

function clearApplied(db, clientId) {
  if (!clientId) return;
  db.prepare('DELETE FROM shelf_applied WHERE client_id = ?').run(clientId);
}

function writeBack(db, id) {
  const hit = db.prepare('SELECT * FROM shelf_batches WHERE id = ?').get(String(id));
  if (!hit) return null;
  let row = {};
  try { row = JSON.parse(hit.row_json) || {}; } catch (err) { row = {}; }
  row.id = hit.id;
  row.product_id = hit.product_id;
  row.quantity = num(hit.quantity);
  row.quantity_reserved = num(hit.quantity_reserved);
  row.status = hit.status;
  row.is_deleted = hit.is_deleted ? 1 : 0;
  row.updated_at = hit.updated_at;
  if (hit.initial_quantity != null) row.initial_quantity = num(hit.initial_quantity);
  const json = JSON.stringify(row);
  db.prepare('UPDATE shelf_batches SET row_json = ? WHERE id = ?').run(json, hit.id);
  const existing = db.prepare('SELECT 1 FROM mirror_rows WHERE table_name = ? AND id = ?').get('stock_batches', hit.id);
  if (existing) {
    db.prepare('UPDATE mirror_rows SET row_json = ?, updated_at = ? WHERE table_name = ? AND id = ?')
      .run(json, hit.updated_at, 'stock_batches', hit.id);
  }
  return row;
}

function applyTake(db, batchId, take, held) {
  const qty = roundTo(take, 4);
  const released = roundTo(Math.min(num(held), qty), 4);
  if (!(qty > 0)) return 0;
  if (released > 0.0001) {
    const result = db.prepare(SALE_HELD).run(qty, released, qty, String(batchId), released, qty, released, qty);
    return result.changes;
  }
  const result = db.prepare(SALE_FREE).run(qty, qty, String(batchId), qty);
  return result.changes;
}

function applyLines(db, record, unitsByProduct, generation) {
  const clientId = clientIdOf(record);
  if (clientId && alreadyApplied(db, clientId)) {
    return { ok: true, skipped: true, short: 0, taken: 0 };
  }
  const lines = saleLines(record);
  const holds = holdMapOf(saleHolds(record));
  const asOf = saleAsOf(record);
  const rows = readRows(db);
  let short = 0;
  let taken = 0;
  const touched = new Set();

  for (const line of lines) {
    if (!line || (holdsStock(line) && !line.buyout && !line.buy_out)) continue;
    const productId = String(line.productId || line.product_id || '');
    if (!productId) continue;
    const variantId = line.variantId || line.variant_id || '';
    const units = unitsByProduct && unitsByProduct.get ? unitsByProduct.get(productId) : null;
    let need = baseQuantity(line, units);
    if (!(need > 0)) continue;
    const pool = rows.filter((batch) => {
      if (String(batch.product_id) !== productId) return false;
      if (variantId && String(batch.variant_id || '') !== String(variantId)) return false;
      return true;
    }).map((batch) => {
      const asked = holds.get(String(batch.id)) || 0;
      const giveBack = Math.min(Math.max(0, num(batch.quantity_reserved)), asked);
      return Object.assign({}, batch, {
        quantity_reserved: roundTo(Math.max(0, num(batch.quantity_reserved) - giveBack), 4),
        _giveBack: giveBack,
      });
    });
    for (const row of sortBatches(pool, new Set(holds.keys()), asOf)) {
      if (!(need > 0)) break;
      const take = Math.min(roundTo(freeOf(row), 4), need);
      if (!(take > 0)) continue;
      const held = Math.min(row._giveBack || 0, take);
      const changes = applyTake(db, row.id, take, held);
      if (!changes) continue;
      taken = roundTo(taken + take, 4);
      need = roundTo(need - take, 4);
      touched.add(String(row.id));
      if (held > 0) holds.set(String(row.id), roundTo(Math.max(0, (holds.get(String(row.id)) || 0) - held), 4));
      const live = rows.find((batch) => String(batch.id) === String(row.id));
      if (live) {
        live.quantity = roundTo(Math.max(0, num(live.quantity) - take), 4);
        live.quantity_reserved = roundTo(Math.max(0, num(live.quantity_reserved) - held), 4);
        live.status = live.quantity <= 0 ? 'DEPLETED' : live.status;
      }
    }
    if (need > 0.0001) short = roundTo(short + need, 4);
  }

  for (const [batchId, qty] of holds) {
    if (!(qty > 0.0001)) continue;
    const result = db.prepare(RELEASE_HOLD).run(roundTo(qty, 4), String(batchId), roundTo(qty, 4));
    if (result.changes) touched.add(String(batchId));
  }
  for (const id of touched) writeBack(db, id);
  markApplied(db, clientId, 'SALE', short, generation);
  return { ok: true, skipped: false, short, taken };
}

function adjustBody(record) {
  if (!record) return {};
  return record.payload && record.payload.product_id ? record.payload : (record.payload || record);
}

function applyAdjust(db, record, unitsByProduct, generation) {
  const clientId = clientIdOf(record);
  if (clientId && alreadyApplied(db, clientId)) {
    return { ok: true, skipped: true, short: 0, taken: 0 };
  }
  const body = adjustBody(record);
  const productId = String(body.product_id || '');
  if (!productId) {
    markApplied(db, clientId, 'STOCK_ADJUST', 0, generation);
    return { ok: true, skipped: false, short: 0, taken: 0 };
  }
  const units = unitsByProduct && unitsByProduct.get ? unitsByProduct.get(productId) : null;
  const qty = Math.abs(baseQuantity({
    quantity: body.quantity,
    unitCode: body.unit_code || body.unitCode,
    unitFactor: body.unit_factor || body.unitFactor,
  }, units));
  if (!(qty > 0)) {
    markApplied(db, clientId, 'STOCK_ADJUST', 0, generation);
    return { ok: true, skipped: false, short: 0, taken: 0 };
  }
  const adds = String(body.adjustment_type || '').toUpperCase() === 'FOUND';
  const branchId = body.branch_id ? String(body.branch_id) : '';
  const rows = readRows(db).filter((batch) => batch && !Number(batch.is_deleted)
    && String(batch.product_id) === productId
    && (!branchId || String(batch.branch_id) === branchId));
  const named = body.batch_id ? rows.find((batch) => String(batch.id) === String(body.batch_id)) : null;
  if (adds) {
    const target = named || rows[0];
    if (!target) {
      markApplied(db, clientId, 'STOCK_ADJUST', qty, generation);
      return { ok: true, skipped: false, short: qty, taken: 0 };
    }
    db.prepare(ADJUST_UP).run(qty, qty, String(target.id));
    writeBack(db, target.id);
    markApplied(db, clientId, 'STOCK_ADJUST', 0, generation);
    return { ok: true, skipped: false, short: 0, taken: qty };
  }
  const ordered = named ? [named] : sortBatches(rows, null, null);
  let left = qty;
  let taken = 0;
  for (const batch of ordered) {
    if (!(left > 0)) break;
    const take = Math.min(roundTo(freeOf(batch), 4), left);
    if (!(take > 0)) continue;
    const result = db.prepare(ADJUST_DOWN).run(take, String(batch.id), take);
    if (!result.changes) continue;
    db.prepare(ADJUST_STATUS).run(String(batch.id));
    writeBack(db, batch.id);
    taken = roundTo(taken + take, 4);
    left = roundTo(left - take, 4);
    batch.quantity = roundTo(Math.max(0, num(batch.quantity) - take), 4);
  }
  markApplied(db, clientId, 'STOCK_ADJUST', left > 0.0001 ? left : 0, generation);
  return { ok: true, skipped: false, short: left > 0.0001 ? left : 0, taken };
}

module.exports = {
  SHELF_SQL,
  SALE_HELD,
  SALE_FREE,
  ensureShelf,
  upsertRows,
  readRows,
  applyLines,
  applyAdjust,
  clearApplied,
  markApplied,
  appliedRow,
  baseQuantity,
  clientIdOf,
  saleLines,
};
