'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('the Android build path is the Electron machine path, not a second till', () => {
  const script = read('tools/android-from-electron.ps1');
  const gradle = read('android/app/build.gradle');
  const settings = read('android/settings.gradle');
  const wrapper = read('android/gradle/wrapper/gradle-wrapper.properties');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const strings = read('android/app/src/main/res/values/strings.xml');
  const activity = read('android/app/src/main/java/com/stockridge/till/MainActivity.java');
  const hide = read('android/app/src/main/assets/hide-install.js');
  const readme = read('android/README.md');

  assert.match(script, /ANDROID_FLOW 2/);
  assert.match(script, /sdk install platforms\/android-35 build-tools\/35\.0\.0 platform-tools/);
  assert.doesNotMatch(script, /sdkmanager\.bat/);
  assert.match(script, /does not delete stockridge\.db/);
  assert.match(script, /does not pass --reset-pin/i);
  assert.match(script, /destop-stockridge/);
  assert.match(script, /Mohammed Hayatudeen\\StockRidge/);
  assert.match(script, /assembleDebug/);
  assert.match(script, /platforms\\android-35/);
  assert.match(script, /build-tools\\35\.0\.0/);
  assert.doesNotMatch(script, /ghp_[A-Za-z0-9]/);
  assert.doesNotMatch(script, /Remove-Item/);
  assert.match(script, /does not pass --reset-pin/);

  assert.match(settings, /com\.android\.application' version '8\.7\.3'/);
  assert.match(wrapper, /gradle-8\.9-bin\.zip/);
  assert.match(gradle, /namespace 'com\.stockridge\.till'/);
  assert.match(gradle, /compileSdk 35/);
  assert.match(gradle, /buildToolsVersion '35\.0\.0'/);
  assert.match(gradle, /minSdk 24/);
  assert.match(gradle, /JavaVersion\.VERSION_17/);
  assert.doesNotMatch(gradle, /better-sqlite3/);

  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(manifest, /allowBackup="false"/);
  assert.doesNotMatch(manifest, /turso/i);

  assert.match(strings, /https:\/\/sample\.stockridge\.workers\.dev/);
  assert.doesNotMatch(strings, /ghp_|eyJ/);
  assert.match(activity, /does not open stockridge\.db/);
  assert.match(activity, /does not cache\s*\/api\//);
  assert.match(activity, /shell\.html/);
  assert.match(manifest, /ACCESS_NETWORK_STATE/);
  assert.match(hide, /shell = 'android'/);
  assert.match(readme, /does not open Turso/);
  assert.match(readme, /android-from-the-electron-machine\.pdf/);

  assert.equal(fs.existsSync(path.join(root, 'android', 'gradlew.bat')), true);
  assert.equal(fs.existsSync(path.join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar')), true);
  const jar = fs.readFileSync(path.join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar'));
  assert.equal(jar.subarray(0, 2).toString('utf8'), 'PK');
});

test('the paper and the till rules agree the phone is not the till file', () => {
  const rules = read('docs/till-fixes.md');
  const audit = read('docs/production-audit.md');
  assert.match(rules, /The Android app is not the Windows till/);
  assert.match(rules, /android-from-electron\.ps1/);
  assert.match(audit, /The phone is not built by the Electron packager/);
  assert.match(audit, /Not deployed/);
  const pdf = path.join(root, 'docs', 'android-from-the-electron-machine.pdf');
  assert.equal(fs.existsSync(pdf), true);
  const head = fs.readFileSync(pdf).subarray(0, 5).toString('utf8');
  assert.equal(head, '%PDF-');
});
