'use strict';

const path = require('node:path');

const SAMPLE_ORIGIN = 'https://sample.stockridge.workers.dev';
const PRODUCTION_ORIGIN = 'https://stockridge.stockridge.workers.dev';

function stockridgeRoot({ envRoot, packaged, resourcesPath, dirname }) {
  if (envRoot) return path.resolve(envRoot);
  if (packaged) return path.join(resourcesPath, 'stockridge');
  return path.resolve(dirname, '..', '..', 'stockridge');
}

function workerOrigin({ envOrigin, bakedOrigin, savedOrigin }) {
  if (envOrigin) return envOrigin;
  // A client's own Worker is baked into that client's archive. The office
  // production host is the 16 October copy on Cloudflare D1. It is not the
  // Turso database behind the PWA, and it does not list water packing or bakery.
  if (bakedOrigin && bakedOrigin !== PRODUCTION_ORIGIN) return bakedOrigin;
  if (savedOrigin) return savedOrigin;
  return SAMPLE_ORIGIN;
}

module.exports = { stockridgeRoot, workerOrigin, SAMPLE_ORIGIN, PRODUCTION_ORIGIN };
