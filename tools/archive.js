'use strict';

// Builds the standalone program. Signing runs only when CSC_LINK is set to a
// real certificate. Without one, Windows cannot create the Mac shortcuts
// inside the signing tools, so signing stays off.
//
// Do not spawn the .cmd shim through cmd.exe. A user folder such as
// "Mohammed Hayatudeen" is split at the space, and the build never runs.

const { spawn } = require('node:child_process');
const path = require('node:path');

function archiveCommand({ root, execPath, sign = false } = {}) {
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  return {
    command: execPath,
    args: [cli, '--win', 'dir', sign ? '--config.win.signAndEditExecutable=true' : '--config.win.signAndEditExecutable=false'],
    shell: false,
  };
}

function runArchive() {
  const sign = Boolean(process.env.CSC_LINK);
  const spec = archiveCommand({
    root: path.resolve(__dirname, '..'),
    execPath: process.execPath,
    sign,
  });
  if (sign) console.log('Signing is on. The certificate path is not printed.');
  else console.log('No CSC_LINK certificate. This archive will not be code-signed.');
  const child = spawn(spec.command, spec.args, {
    stdio: 'inherit',
    shell: false,
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    windowsHide: true,
  });
  child.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
}

if (require.main === module) runArchive();

module.exports = { archiveCommand };
