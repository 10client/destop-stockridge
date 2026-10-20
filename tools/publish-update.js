'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeManifest } = require('../lib/updates');

const dir = path.join(__dirname, '..', 'dist');
const version = require('../package.json').version;
const names = fs.readdirSync(dir).filter((name) => /\.(exe|AppImage|dmg|zip)$/.test(name) && !name.endsWith('.blockmap'));
const fileName = names.find((name) => name.endsWith('.exe')) || names[0];
if (!fileName) {
  console.error('No archive in dist/. Run npm run archive first.');
  process.exit(1);
}
const manifest = writeManifest({ dir, version, fileName });
console.log(`Wrote dist/latest.json for ${manifest.file}`);
console.log('Host that file and the archive at STOCKRIDGE_UPDATE_URL. The till checks the hash before it offers the file.');
