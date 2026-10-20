'use strict';

// Download and Install belong on the browser PWA. The Electron window and the
// Android WebView remove the buttons. A stylesheet hide is not enough: the
// hosted screens can show them again after this file is served.

const INSTALL_IDS = ['install-btn', 'nav-install', 'login-install'];
const HIDE_INSTALL_CSS = '#install-btn,#nav-install,#login-install,.chip-install,.nav-install{display:none!important}';

function stripInstallMarkup(html) {
  let out = String(html || '');
  for (const id of INSTALL_IDS) {
    const re = new RegExp(`<button\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<\\/button>`, 'gi');
    out = out.replace(re, '');
  }
  return out;
}

function hideInstallChrome(html) {
  const stripped = stripInstallMarkup(html);
  if (stripped.includes('sr-native-install')) return stripped;
  const style = `<style id="sr-native-install">${HIDE_INSTALL_CSS}</style>`;
  if (stripped.includes('</head>')) return stripped.replace('</head>', `${style}\n</head>`);
  return `${style}\n${stripped}`;
}

module.exports = { INSTALL_IDS, HIDE_INSTALL_CSS, stripInstallMarkup, hideInstallChrome };
