'use strict';

const path = require('node:path');

const SAMPLE_ORIGIN = 'https://sample.stockridge.workers.dev';
const PRODUCTION_ORIGIN = 'https://stockridge.stockridge.workers.dev';

function stockridgeRoot({ envRoot, packaged, resourcesPath, dirname }) {
  if (envRoot) return path.resolve(envRoot);
  if (packaged) return path.join(resourcesPath, 'stockridge');
  return path.resolve(dirname, '..', '..', 'stockridge');
}

function workerOrigin({ envOrigin, packaged, bakedOrigin }) {
  if (envOrigin) return envOrigin;
  if (packaged) return bakedOrigin || PRODUCTION_ORIGIN;
  return SAMPLE_ORIGIN;
}

module.exports = { stockridgeRoot, workerOrigin, SAMPLE_ORIGIN, PRODUCTION_ORIGIN };
