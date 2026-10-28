'use strict';

// The till does not talk to Turso. When a download has saved, the usable
// rows are written into these tables, with the same columns the shop uses
// for stock in hand. A later screen reads that SQL. It does not invent a
// second total from a JSON blob and a hold.
//
// Secrets are not columns. A missing parent row does not reject the save:
// there are no foreign keys on this copy.

const SECRET = new Set(['pin_hash', 'jwt_secret', 'password', 'password_hash', 'secret']);

const TABLES = {
  businesses: ['id', 'name', 'is_deleted', 'updated_at'],
  branches: ['id', 'business_id', 'name', 'branch_type', 'is_deleted', 'updated_at'],
  users: ['id', 'business_id', 'branch_id', 'full_name', 'username', 'role', 'is_active', 'updated_at'],
  customer_classes: ['id', 'business_id', 'name', 'is_deleted', 'updated_at'],
  customers: ['id', 'business_id', 'branch_id', 'name', 'phone', 'is_deleted', 'updated_at'],
  product_categories: ['id', 'business_id', 'code', 'name', 'parent_id', 'is_active', 'is_deleted', 'updated_at'],
  products: ['id', 'business_id', 'category_id', 'sku', 'name', 'brand', 'model_no', 'base_unit_name', 'cost_price', 'selling_price', 'reorder_level', 'barcode', 'requires_serial', 'tracks_variants', 'has_expiry', 'is_active', 'dispensing_class', 'is_controlled', 'nafdac_catalog_id', 'offers_sale', 'offers_hire', 'offers_lease', 'is_deleted', 'updated_at'],
  product_units: ['id', 'product_id', 'code', 'name', 'quantity_in_base', 'is_deleted', 'updated_at'],
  product_variants: ['id', 'product_id', 'name', 'sku', 'is_deleted', 'updated_at'],
  product_barcodes: ['id', 'product_id', 'barcode', 'is_deleted', 'updated_at'],
  price_lists: ['id', 'business_id', 'name', 'priority', 'is_deleted', 'updated_at'],
  price_list_items: ['id', 'price_list_id', 'product_id', 'selling_price', 'is_deleted', 'updated_at'],
  product_price_overrides: ['id', 'branch_id', 'product_id', 'variant_id', 'default_selling_price', 'is_deleted', 'updated_at'],
  suppliers: ['id', 'business_id', 'name', 'is_deleted', 'updated_at'],
  stock_batches: ['id', 'branch_id', 'business_id', 'product_id', 'variant_id', 'batch_no', 'supplier_id', 'purchase_order_id', 'cost_price_per_unit', 'selling_price_per_unit', 'selling_price_pack', 'selling_price_carton', 'quantity', 'quantity_reserved', 'initial_quantity', 'manufacture_date', 'expiry_date', 'received_at', 'received_by', 'status', 'warehouse_zone', 'notes', 'created_at', 'updated_at', 'is_deleted'],
  purchase_orders: ['id', 'branch_id', 'business_id', 'po_number', 'supplier_id', 'status', 'total', 'is_deleted', 'updated_at'],
  deposits: ['id', 'branch_id', 'business_id', 'product_id', 'status', 'is_deleted', 'updated_at'],
  instalment_plans: ['id', 'branch_id', 'business_id', 'status', 'is_deleted', 'updated_at'],
  delivery_jobs: ['id', 'branch_id', 'business_id', 'status', 'is_deleted', 'updated_at'],
  branch_safe_ledger: ['id', 'branch_id', 'business_id', 'entry_type', 'amount', 'balance_after', 'is_deleted', 'created_at', 'updated_at'],
  branch_compliance_records: ['id', 'branch_id', 'record_type', 'is_deleted', 'updated_at'],
  client_settings: ['id', 'business_name', 'updated_at'],
};

const SPECS = {};
for (const [table, names] of Object.entries(TABLES)) {
  const columns = names.map((name) => {
    const numeric = /quantity|price|cost|amount|balance|level|priority|rate|total|factor|reorder|nafdac_catalog_id|is_|has_|offers_|requires_|tracks_/.test(name);
    return [name, numeric ? 'REAL' : 'TEXT'];
  });
  SPECS[table] = { columns };
}

function quote(name) {
  if (!/^[a-z_]+$/.test(name)) throw new Error('That table is not part of the offline copy.');
  return name;
}

function ddl() {
  const parts = [];
  for (const [table, spec] of Object.entries(SPECS)) {
    const body = spec.columns.map(([name, type]) => `${name} ${type}`).join(', ');
    parts.push(`CREATE TABLE IF NOT EXISTS ${table} (id_key TEXT PRIMARY KEY, ${body}, row_json TEXT NOT NULL);`);
    if (spec.columns.some(([name]) => name === 'product_id')) {
      parts.push(`CREATE INDEX IF NOT EXISTS idx_clone_${table}_product ON ${table}(product_id);`);
    }
    if (spec.columns.some(([name]) => name === 'branch_id')) {
      parts.push(`CREATE INDEX IF NOT EXISTS idx_clone_${table}_branch ON ${table}(branch_id);`);
    }
  }
  return parts.join('\n');
}

function ensure(db) {
  db.exec(ddl());
}

function has(table) {
  return Object.prototype.hasOwnProperty.call(SPECS, String(table));
}

function names() {
  return Object.keys(SPECS);
}

function count(db, table) {
  if (!has(table)) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get();
  return row ? row.n : 0;
}

function clear(db, table) {
  if (!has(table)) return 0;
  return db.prepare(`DELETE FROM ${quote(table)}`).run().changes;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function columnValue(type, value) {
  if (value == null || value === '') return null;
  if (type === 'REAL') return num(value);
  return String(value);
}

function upsert(db, table, rows) {
  if (!has(table)) return 0;
  const spec = SPECS[table];
  const names = spec.columns.map(([name]) => name);
  const sql = `INSERT INTO ${quote(table)} (id_key, ${names.join(', ')}, row_json)
    VALUES (${['?'].concat(names.map(() => '?'), '?').join(', ')})
    ON CONFLICT(id_key) DO UPDATE SET
      ${names.map((name) => `${name} = excluded.${name}`).join(', ')},
      row_json = excluded.row_json`;
  const write = db.prepare(sql);
  let n = 0;
  for (const raw of rows || []) {
    if (!raw || raw.id == null) continue;
    const row = Object.assign({}, raw);
    for (const field of SECRET) delete row[field];
    if (row.is_deleted == null) row.is_deleted = 0;
    if (table === 'stock_batches') {
      if (row.status == null || row.status === '') row.status = 'ACTIVE';
      if (row.quantity == null) row.quantity = 0;
      if (row.quantity_reserved == null) row.quantity_reserved = 0;
    }
    const values = spec.columns.map(([name, type]) => columnValue(type, row[name]));
    write.run(String(row.id), ...values, JSON.stringify(row));
    n += 1;
  }
  return n;
}

function read(db, table) {
  if (!has(table) || !count(db, table)) return [];
  const spec = SPECS[table];
  return db.prepare(`SELECT * FROM ${quote(table)}`).all().map((hit) => {
    let row = {};
    try { row = JSON.parse(hit.row_json) || {}; } catch (err) { row = {}; }
    const merged = Object.assign({}, row);
    for (const [name, type] of spec.columns) {
      if (hit[name] == null) continue;
      merged[name] = type === 'REAL' ? Number(hit[name]) : hit[name];
    }
    if (merged.id == null) merged.id = hit.id_key;
    return merged;
  });
}

function syncJson(db, table, id) {
  if (!has(table)) return null;
  const hit = db.prepare(`SELECT * FROM ${quote(table)} WHERE id_key = ?`).get(String(id));
  if (!hit) return null;
  let row = {};
  try { row = JSON.parse(hit.row_json) || {}; } catch (err) { row = {}; }
  for (const [name, type] of SPECS[table].columns) {
    if (hit[name] == null) continue;
    row[name] = type === 'REAL' ? Number(hit[name]) : hit[name];
  }
  row.id = hit.id_key;
  db.prepare(`UPDATE ${quote(table)} SET row_json = ? WHERE id_key = ?`).run(JSON.stringify(row), hit.id_key);
  return row;
}

// The shop's on-hand query. Quantity is base units. Quarantine and expired
// batches are not in hand. A bill's reserved units stay in on_shelf and come
// out of available. This till's own queued sale is already in quantity.
const ON_HAND_SQL = `
  SELECT p.id AS product_id,
         sb.branch_id AS branch_id,
         p.sku AS sku,
         p.name AS name,
         p.base_unit_name AS base_unit_name,
         p.reorder_level AS reorder_level,
         p.selling_price AS selling_price,
         p.cost_price AS book_cost,
         p.requires_serial AS requires_serial,
         p.tracks_variants AS tracks_variants,
         p.has_expiry AS has_expiry,
         p.nafdac_catalog_id AS nafdac_catalog_id,
         c.name AS category_name,
         c.code AS category_code,
         (SELECT parent.code FROM product_categories parent
           WHERE parent.id_key = c.parent_id AND parent.is_deleted = 0) AS category_parent_code,
         COALESCE(SUM(sb.quantity), 0) AS on_shelf,
         COALESCE(SUM(sb.quantity_reserved), 0) AS reserved,
         COALESCE(SUM(sb.quantity - sb.quantity_reserved), 0) AS available,
         COALESCE(SUM(sb.quantity * COALESCE(sb.cost_price_per_unit, 0)), 0) AS stock_value,
         COUNT(sb.id_key) AS batch_count,
         MIN(sb.expiry_date) AS next_expiry
    FROM stock_batches sb
    JOIN products p ON p.id_key = sb.product_id AND p.is_deleted = 0
    LEFT JOIN product_categories c ON c.id_key = p.category_id
   WHERE sb.is_deleted = 0
     AND sb.status NOT IN ('QUARANTINED', 'EXPIRED')
     AND (? = '' OR sb.branch_id = ?)
   GROUP BY p.id_key
   ORDER BY p.name`;

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function stockOnHand(db, branchId) {
  ensure(db);
  if (!count(db, 'stock_batches') || !count(db, 'products')) return [];
  const asked = branchId == null || branchId === '' ? '' : String(branchId);
  let rows = db.prepare(ON_HAND_SQL).all(asked, asked);
  if (!rows.length && asked) {
    const present = db.prepare(`SELECT DISTINCT branch_id AS id FROM stock_batches WHERE is_deleted = 0 AND branch_id IS NOT NULL`).all();
    if (present.length === 1 && present[0].id) rows = db.prepare(ON_HAND_SQL).all(String(present[0].id), String(present[0].id));
  }
  return rows.map((row) => ({
    product_id: row.product_id,
    branch_id: row.branch_id,
    sku: row.sku,
    name: row.name,
    base_unit_name: row.base_unit_name,
    reorder_level: Number(row.reorder_level) || 0,
    selling_price: Number(row.selling_price) || 0,
    book_cost: Number(row.book_cost) || 0,
    requires_serial: row.requires_serial,
    tracks_variants: row.tracks_variants,
    has_expiry: row.has_expiry,
    nafdac_catalog_id: row.nafdac_catalog_id,
    category_name: row.category_name,
    category_code: row.category_code,
    category_parent_code: row.category_parent_code,
    on_shelf: round2(row.on_shelf),
    reserved: round2(row.reserved),
    available: round2(row.available),
    stock_value: round2(row.stock_value),
    batch_count: Number(row.batch_count) || 0,
    next_expiry: row.next_expiry || null,
  }));
}

// The sell screen's "on hand" is not every batch. The shop counts only stock
// that arrived on a received purchase order, still active, still free.
const RECEIVED_SQL = `
  SELECT p.id_key AS product_id,
         COALESCE(SUM(sb.quantity - sb.quantity_reserved), 0) AS on_hand
    FROM stock_batches sb
    JOIN products p ON p.id_key = sb.product_id AND p.is_deleted = 0
    JOIN purchase_orders po ON po.id_key = sb.purchase_order_id
     AND po.is_deleted = 0
     AND po.status IN ('PARTIALLY_RECEIVED', 'RECEIVED')
   WHERE sb.is_deleted = 0
     AND sb.status = 'ACTIVE'
     AND (? = '' OR sb.branch_id = ?)
   GROUP BY p.id_key`;

function receivedOnHand(db, branchId) {
  ensure(db);
  if (!count(db, 'purchase_orders') || !count(db, 'stock_batches')) return null;
  const asked = branchId == null || branchId === '' ? '' : String(branchId);
  let rows = db.prepare(RECEIVED_SQL).all(asked, asked);
  if (!rows.length && asked) {
    const present = db.prepare(`SELECT DISTINCT branch_id AS id FROM stock_batches WHERE is_deleted = 0 AND branch_id IS NOT NULL`).all();
    if (present.length === 1 && present[0].id) rows = db.prepare(RECEIVED_SQL).all(String(present[0].id), String(present[0].id));
  }
  return rows.map((row) => ({ product_id: row.product_id, on_hand: round2(row.on_hand) }));
}

module.exports = {
  ensure,
  has,
  names,
  count,
  clear,
  upsert,
  read,
  syncJson,
  stockOnHand,
  receivedOnHand,
  ddl,
};
