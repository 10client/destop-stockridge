(function () {
  var css = '#install-btn,#nav-install,#login-install,.chip-install,.nav-install{display:none!important}';
  function hide() {
    var style = document.getElementById('sr-native-install');
    if (!style && document.documentElement) {
      style = document.createElement('style');
      style.id = 'sr-native-install';
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
    var ids = ['install-btn', 'nav-install', 'login-install'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
  window.stockridgeNative = window.stockridgeNative || {};
  if (!window.stockridgeNative.shell) window.stockridgeNative.shell = 'android';
  hide();
  if (document.documentElement && window.MutationObserver && !window.__srInstallStrip) {
    window.__srInstallStrip = new MutationObserver(hide);
    window.__srInstallStrip.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
