'use strict';

// Builds the standalone program. Signing runs only when CSC_LINK is set to a
// real certificate. Without one, Windows cannot create the Mac shortcuts
// inside the signing tools, so signing stays off.

const { spawn } = require('node:child_process');
const path = require('node:path');

const sign = Boolean(process.env.CSC_LINK);
const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron-builder');
const args = [sign ? '--config.win.signAndEditExecutable=true' : '--config.win.signAndEditExecutable=false'];

if (sign) {
  console.log('Signing is on. The certificate path is not printed.');
} else {
  console.log('No CSC_LINK certificate. This archive will not be code-signed.');
}

const child = spawn(bin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
child.on('exit', (code) => process.exit(code == null ? 1 : code));
