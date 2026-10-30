(function () {
  var css = '#install-btn,#nav-install,#login-install,.chip-install,.nav-install{display:none!important}';
  css += 'body.sr-one-business #business-switch,body.sr-one-business #business-chip,body.sr-one-business #business-switch-hint{display:none!important}';

  function hideInstall() {
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

  function oneBusiness() {
    var SR = window.SR;
    if (!SR || !SR.state || !SR.state.user) return false;
    if (SR.state.canSwitchBusiness && !SR.state.canSwitchBusiness()) return true;
    var user = SR.state.user;
    var role = String(user.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'OWNER') return false;
    var scope = SR.state.scope || {};
    if (scope.allBusinesses) return false;
    if (user.branch && user.branch.id) return true;
    var ids = scope.businessIds || [];
    return ids.length <= 1;
  }

  function hideSwitch() {
    var locked = oneBusiness();
    if (document.body) document.body.classList.toggle('sr-one-business', locked);
    if (!locked) return;
    var ids = ['business-switch', 'business-chip', 'business-switch-hint'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (!el) continue;
      el.hidden = true;
      el.setAttribute('hidden', '');
      el.style.display = 'none';
    }
  }

  var kickedAt = 0;
  function sendWaiting() {
    var SR = window.SR;
    if (SR && SR._explicitSignOut) return;
    if (!SR || !SR.sync || !SR.api || !SR.store || !SR.store.outboxCount) return;
    var now = Date.now();
    if (now - kickedAt < 15000) return;
    SR.store.outboxCount().then(function (waiting) {
      if (!waiting) return;
      var probe = SR.api.probe ? SR.api.probe({ force: true }) : Promise.resolve(SR.api.isOnline && SR.api.isOnline());
      Promise.resolve(probe).then(function (up) {
        if (!up) return;
        if (now - kickedAt < 15000) return;
        kickedAt = Date.now();
        if (SR.api.hasToken && SR.api.hasToken()) {
          var run = SR.sync.resumeAfterLine || SR.sync.runOnce;
          if (run) run.call(SR.sync, { silent: true, catchUp: true }).catch(function () {});
          return;
        }
        if (!window.SR || !window.SR._pinUploadOwned) askPin();
      }).catch(function () {});
    }).catch(function () {});
  }

  function askPin() {
    if (window.SR && window.SR._explicitSignOut) return;
    if (document.getElementById('sr-native-pin')) return;
    var SR = window.SR;
    var user = SR && SR.state && SR.state.user;
    if (!user || !user.username || !SR.api || !SR.api.login) return;
    var box = document.createElement('form');
    box.id = 'sr-native-pin';
    box.setAttribute('autocomplete', 'off');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:80;background:#f7f4ee;color:#1c1915;border:1px solid #d9d1c3;border-radius:12px;padding:14px;font:14px/1.4 system-ui,sans-serif';
    box.innerHTML = '<strong>Send the offline sales</strong><p style="margin:8px 0">The line is back. Enter your PIN to send the sales saved on this phone. You do not sign out. The PIN is not stored. This account can be on one device, so this sign-in ends it on any other device.</p>';
    var input = document.createElement('input');
    input.type = 'password';
    input.inputMode = 'numeric';
    input.autocomplete = 'current-password';
    input.setAttribute('aria-label', 'PIN');
    input.style.cssText = 'width:100%;box-sizing:border-box;margin:0 0 8px;padding:8px';
    var err = document.createElement('p');
    err.style.cssText = 'color:#8c3b2a;min-height:1.2em;margin:0 0 8px';
    var send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Send the sales';
    var stay = document.createElement('button');
    stay.type = 'button';
    stay.textContent = 'Not now';
    stay.style.marginLeft = '8px';
    stay.addEventListener('click', function () { box.remove(); });
    box.appendChild(input);
    box.appendChild(err);
    box.appendChild(send);
    box.appendChild(stay);
    box.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var value = String(input.value || '').trim();
      input.value = '';
      if (!value) { err.textContent = 'Enter your PIN.'; return; }
      send.disabled = true;
      SR.api.login({ username: user.username, pin: value, remember: true }).then(function (result) {
        if (!result || result.offline || !result.token) {
          err.textContent = 'The shop did not accept that PIN. The sales are still on this phone.';
          send.disabled = false;
          return;
        }
        box.remove();
        var run = SR.sync.resumeAfterLine || SR.sync.runOnce;
        if (run) return run.call(SR.sync, { silent: true, catchUp: true });
      }).catch(function (e) {
        err.textContent = (e && e.message) || 'That PIN was not accepted.';
        send.disabled = false;
      });
    });
    (document.body || document.documentElement).appendChild(box);
  }

  window.stockridgeNative = window.stockridgeNative || {};
  if (!window.stockridgeNative.shell) window.stockridgeNative.shell = 'android';
  function keepLoginDoor() {
    var SR = window.SR;
    var signedOut = Boolean(SR && SR._explicitSignOut);
    var user = SR && SR.state && SR.state.user;
    var shell = document.getElementById('shell');
    var login = document.getElementById('login-screen');
    var shellUp = shell && !shell.hidden && shell.style.display !== 'none';
    if (!signedOut && (user || !shellUp)) return;
    if (document.body) document.body.classList.add('is-signed-out');
    if (shell) {
      shell.hidden = true;
      shell.style.setProperty('display', 'none', 'important');
    }
    if (login) {
      login.hidden = false;
      login.style.setProperty('display', 'grid', 'important');
    }
    var pin = document.getElementById('sr-native-pin');
    if (pin && pin.parentNode) pin.parentNode.removeChild(pin);
  }

  function paint() { hideInstall(); hideSwitch(); keepLoginDoor(); }
  paint();
  if (document.documentElement && window.MutationObserver && !window.__srInstallStrip) {
    window.__srInstallStrip = new MutationObserver(paint);
    window.__srInstallStrip.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener('online', function () { setTimeout(sendWaiting, 1600); });
  setInterval(function () { hideSwitch(); keepLoginDoor(); sendWaiting(); }, 20000);
})();
