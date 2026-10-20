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
  // The office host and the sample PWA are the same Turso books. A client's
  // own Worker, baked into that client's archive, still wins over either.
  if (bakedOrigin) return bakedOrigin;
  if (savedOrigin) return savedOrigin;
  return SAMPLE_ORIGIN;
}

module.exports = { stockridgeRoot, workerOrigin, SAMPLE_ORIGIN, PRODUCTION_ORIGIN };
