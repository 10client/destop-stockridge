'use strict';

// Copies the shop screens into build/ so the archive does not depend on a
// folder sitting next to the program on the shop computer. Also writes the
// Worker address the archive will use. npm start is unchanged.

const fs = require('node:fs');
const path = require('node:path');
const { PRODUCTION_ORIGIN } = require('../electron/paths');

const root = path.resolve(__dirname, '..');
const uiSource = path.resolve(process.env.STOCKRIDGE_ROOT || path.join(root, '..', 'stockridge'), 'public');
const stage = path.join(root, 'build', 'stockridge', 'public');
const iconSource = path.join(uiSource, 'icons', 'icon-512.png');
const origin = process.env.STOCKRIDGE_ORIGIN || PRODUCTION_ORIGIN;

if (!fs.existsSync(path.join(uiSource, 'index.html'))) {
  console.error(`No shop screens at ${uiSource}. Clone stockridge next to destop-stockridge, then run this again.`);
  process.exit(1);
}
if (!fs.existsSync(iconSource)) {
  console.error(`The existing icon is missing: ${iconSource}`);
  process.exit(1);
}

fs.rmSync(path.join(root, 'build', 'stockridge'), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(uiSource, stage, { recursive: true });
fs.copyFileSync(iconSource, path.join(root, 'build', 'icon.png'));
const config = { origin };
if (process.env.STOCKRIDGE_UPDATE_URL) config.updateUrl = process.env.STOCKRIDGE_UPDATE_URL;
fs.writeFileSync(path.join(root, 'build', 'desktop-config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`Staged shop screens from ${uiSource}`);
console.log(`This archive will sign in against ${origin}`);
