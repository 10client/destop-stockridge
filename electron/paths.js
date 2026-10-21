'use strict';

const path = require('node:path');
const { PWA_ORIGIN, OFFICE_ORIGIN } = require('../lib/shared-books');

const SAMPLE_ORIGIN = PWA_ORIGIN;
const PRODUCTION_ORIGIN = OFFICE_ORIGIN;

function stockridgeRoot({ envRoot, packaged, resourcesPath, dirname }) {
  if (envRoot) return path.resolve(envRoot);
  if (packaged) return path.join(resourcesPath, 'stockridge');
  return path.resolve(dirname, '..', '..', 'stockridge');
}

function workerOrigin({ envOrigin, bakedOrigin, savedOrigin }) {
  if (envOrigin) return envOrigin;
  // The office host and the sample PWA are the same Turso books. A client's
  // own Worker, baked into that client's archive, still wins over either.
  if (bakedOrigin) return bakedOrigin;
  if (savedOrigin) return savedOrigin;
  return SAMPLE_ORIGIN;
}

// The sample host and the office host are the same books. If one path does
// not answer, the till may ask the other. A client's own baked host has no twin.
function siblingOrigin(origin) {
  const value = String(origin || '');
  if (value.includes('sample.stockridge.workers.dev')) return OFFICE_ORIGIN;
  if (value.includes('stockridge.stockridge.workers.dev')) return PWA_ORIGIN;
  return null;
}

module.exports = { stockridgeRoot, workerOrigin, siblingOrigin, SAMPLE_ORIGIN, PRODUCTION_ORIGIN };
