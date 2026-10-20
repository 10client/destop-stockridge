'use strict';

// Download and Install belong on the website. Electron and an Android APK
// are already the app, so those shells hide the buttons. A browser PWA does not.

function runningInNativeShell(env) {
  const row = env || {};
  const ua = String(row.userAgent || '');
  if (/Electron/i.test(ua)) return true;
  const native = row.native;
  const shell = native && String(native.shell || native.platform || '');
  if (shell === 'electron' || shell === 'android') return true;
  if (native && native.store) return true;
  if (row.capacitorNative) return true;
  if (row.cordova) return true;
  if (/;\s*wv[;)]/i.test(ua)) return true;
  return false;
}

module.exports = { runningInNativeShell };
