'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sharedViews = path.join(__dirname, '..', '..', 'stockridge', 'public', 'js', 'views');

class FakeElement {
  constructor(tag, props, children) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.classList = { toggle() {} };
    Object.assign(this, props || {});
    this.appendChild(...(children || []));
  }

  appendChild(...nodes) {
    for (const node of nodes.flat(Infinity)) {
      if (node == null || node === false) continue;
      this.children.push(node);
      if (node && typeof node === 'object') node.parentElement = this;
    }
    return nodes[nodes.length - 1];
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.textContent = '';
    this.appendChild(...nodes);
  }

  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
}

function h(tag, props, ...children) {
  return new FakeElement(tag, props, children);
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function text(node) {
  if (node == null || node === false) return '';
  if (typeof node !== 'object') return String(node);
  return [node.textContent || '', ...(node.children || []).map(text)].join(' ').trim();
}

function findButton(root, label) {
  let found = null;
  walk(root, (node) => {
    if (!found && node.tagName === 'BUTTON' && text(node).includes(label)) found = node;
  });
  return found;
}

function makeUtil() {
  return {
    amount: (value) => String(Number(value) || 0),
    clamp: (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0)),
    date: (value) => String(value || ''),
    dateTime: (value) => String(value || ''),
    debounce: (fn) => fn,
    groupBy: (rows, key) => {
      const result = new Map();
      for (const row of rows || []) {
        const value = key(row);
        if (!result.has(value)) result.set(value, []);
        result.get(value).push(row);
      }
      return result;
    },
    humanise: (value) => String(value || '').replace(/_/g, ' '),
    money: (value) => String(Number(value) || 0),
    nowIso: () => '2026-11-06T12:00:00.000Z',
    numInput: (value) => String(value == null ? '' : value),
    pct: (value) => `${Number(value) || 0}%`,
    qty: (value) => String(Number(value) || 0),
    relTime: (value) => String(value || ''),
    round2: (value) => Math.round((Number(value) || 0) * 100) / 100,
    soldAt: (value) => String(value || ''),
    sum: (rows, pick) => (rows || []).reduce((total, row) => total + (Number(pick(row)) || 0), 0),
    todayWat: () => '2026-11-06',
    watClock: (value) => String(value || ''),
  };
}

function loadView(file, api) {
  const modals = [];
  const notices = [];
  const app = {
    renders: 0,
    navigations: [],
    async render() { this.renders += 1; },
    navigate(url) { this.navigations.push(url); },
  };
  const ui = {
    h,
    field(options) {
      const field = h('label', {}, options.label || options.name || '');
      field._field = options;
      return field;
    },
    readFormStrings(root) {
      const values = {};
      walk(root, (node) => {
        const field = node._field;
        if (field && field.name) values[field.name] = field.value == null ? '' : String(field.value);
      });
      return values;
    },
    openModal(options) {
      const modal = Object.assign({ closed: false, close() { this.closed = true; } }, options);
      modals.push(modal);
      return modal;
    },
    renderTable({ columns, rows }) {
      const table = h('table');
      for (const row of rows || []) {
        for (const column of columns || []) {
          if (column.render) table.appendChild(column.render(row));
        }
      }
      return table;
    },
    dataCard({ table, pager }) { return h('section', {}, table, pager); },
    kpi({ label, value }) { return h('div', {}, label, value); },
    kv(rows) { return h('dl', {}, rows || []); },
    pager() { return h('nav'); },
    badge(label) { return h('span', {}, label); },
    statusBadge(label) { return h('span', {}, label); },
    skeleton() { return h('div', {}, 'loading'); },
    loading(label) { return h('div', {}, label); },
    empty({ title }) { return h('div', {}, title); },
    errorBlock(err) { return h('div', {}, err && err.message); },
    sectionTabs({ head }) { return h('div', {}, head); },
    ok(message) { notices.push({ type: 'ok', message }); },
    warn(message) { notices.push({ type: 'warn', message }); },
    apiError(err) { throw err; },
  };
  const window = {
    SR: {
      api,
      ui,
      util: makeUtil(),
      app,
      state: {
        activeBranchId: 'branch-1',
        activeBranchName: () => 'Main',
        atLeast: () => true,
        moduleOn: () => false,
        query: (value) => value || {},
        usesSerialNumbers: () => false,
      },
      store: {},
      exporter: { buttons: () => h('div'), list: async () => ({}) },
      print: {},
      views: {},
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(sharedViews, file), 'utf8'), {
    window,
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  });
  return { SR: window.SR, app, modals, notices };
}

async function click(button) {
  assert.ok(button, 'expected button exists');
  await button.onClick({ currentTarget: button, stopPropagation() {} });
  // Some board buttons deliberately start an async editor without returning
  // its promise. Let that fire-and-forget chain finish before inspecting it.
  await new Promise((resolve) => setImmediate(resolve));
}

test('customer detail Edit can use the shared class field', async () => {
  const paths = [];
  const api = {
    async get(url) {
      paths.push(url);
      if (url === '/api/customers/c1') return { customer: { id: 'c1', name: 'Ada', credit_balance: 0 }, sales: [] };
      if (url === '/api/customers/c1/ledger') return { entries: [] };
      if (url === '/api/customer-classes') return { data: [{ id: 'class-1', name: 'Trade', discount_pct: 2, credit_allowed: 1 }] };
      throw new Error(`Unexpected GET ${url}`);
    },
  };
  const { SR, modals } = loadView('customers.js', api);
  const screen = await SR.views.customers.render({ params: { id: 'c1' }, query: {}, setTitle() {} });
  await click(findButton(screen, 'Edit'));
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, 'Edit customer');
  assert.ok(paths.includes('/api/customer-classes'));
  let hasClass = false;
  walk(modals[0].body, (node) => { if (node._field && node._field.name === 'customer_class_id') hasClass = true; });
  assert.equal(hasClass, true);
});

test('delivery board Attach reaches the common load editor', async () => {
  const job = { id: 'd1', job_no: 'JOB-1', status: 'PENDING', item_count: 1 };
  const api = {
    async get(url) {
      if (url === '/api/deliveries') return { data: [job], paging: { total: 1, limit: 50 } };
      if (url === '/api/deliveries/d1') return { job, items: [{ id: 'line-1', product_name: 'Fan', quantity: 1 }] };
      if (url === '/api/dispatch') return { enabled: false, vehicles: [] };
      if (url === '/api/users?active=1&limit=200') return { data: [{ id: 'u1', full_name: 'Driver', role: 'STAFF', is_active: 1 }] };
      throw new Error(`Unexpected GET ${url}`);
    },
  };
  const { SR, modals } = loadView('deliveries.js', api);
  const screen = await SR.views.deliveries.render({ params: {}, query: {}, setTitle() {} });
  await click(findButton(screen, 'Attach'));
  assert.equal(modals.length, 1);
  assert.match(modals[0].title, /Attach the load/);
});

test('callback-free purchase-order receive rerenders the current route', async () => {
  let posted = null;
  const api = {
    async post(url, body) { posted = { url, body }; return { fullyReceived: true, prices: [], serials: [], warnings: [] }; },
  };
  const { SR, app, modals } = loadView('purchase-orders.js', api);
  SR.views['purchase-orders'].openReceive(
    { id: 'po1', po_number: 'PO-1', supplier_name: 'Supplier' },
    [{
      id: 'item-1', product_name: 'Fan', quantity: 2, quantity_in_base: 2,
      quantity_received: 0, expected_unit_cost: 10, selling_price: 12,
      base_unit_name: 'piece', requires_serial: 0,
    }],
    [],
  );
  assert.equal(modals.length, 1);
  await click(findButton({ children: modals[0].footer }, 'Record the delivery'));
  assert.equal(posted.url, '/api/purchase-orders/po1/receive');
  assert.equal(posted.body.receipts.length, 1);
  assert.equal(app.renders, 1);
  assert.equal(modals[0].closed, true);
});
