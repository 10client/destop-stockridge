'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shopClone = require('../lib/shop-clone');

const REQUIRED = [
  'businesses', 'products', 'customers',
  'warranty_claims', 'product_registrations', 'product_recalls',
  'asset_agreements', 'asset_agreement_lines', 'asset_agreement_schedule',
  'delivery_vehicles', 'delivery_job_items', 'installation_jobs',
  'plant_assets', 'vehicle_duties', 'expenses',
  'controlled_substance_register', 'prescriptions',
  'stocktake_sessions', 'stock_transfers', 'debtor_ledger', 'creditor_ledger',
  'instalment_schedule', 'instalment_payments',
];

test('every vertical book has a table on the till', () => {
  for (const name of REQUIRED) assert.equal(shopClone.has(name), true, name);
});
