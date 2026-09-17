#!/usr/bin/env node
/**
 * SELLBRITE RETURN-TO-FIX RACE — regression suite (Investigación #5 fix).
 *
 * Loads the REAL app.js + multipack-fixes.js into a vm sandbox (same
 * technique as test-editor-snapshot.js) and drives the REAL
 * psCheckSellbrite(), psReturnAndFixExpDate(), _doAddBulk() — no
 * reimplementations. Only the network boundary (fetch) is mocked, to
 * simulate a real, delayed Sellbrite backend round trip.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else { failed++; failures.push({ name, actual, expected }); }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
  return ok;
}
function checkTrue(name, cond, detail) {
  if (cond) passed++;
  else { failed++; failures.push({ name, actual: detail, expected: 'true' }); }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n      detail: ${detail}`}`);
  return !!cond;
}
function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ── DOM STUB (same shape as test-editor-snapshot.js) ─────────────────────
const elements = {};
function makeEl(id) {
  const listeners = {};
  const el = {
    id, textContent: '', innerHTML: '', value: '', dataset: {},
    style: { cssText: '', display: '', background: '', color: '', borderColor: '' },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    children: [],
    appendChild(child) { el.children.push(child); el._lastAppended = child; },
    removeChild() {}, remove() { el._removed = true; },
    scrollIntoView(opts) { el._scrolledIntoView = opts || true; },
    focus() {}, blur() {},
    click() { (listeners.click || []).forEach(fn => fn({ preventDefault() {} })); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}, dispatchEvent() { return true; }
  };
  return el;
}
function getEl(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; }

// Controllable fake Sellbrite backend. Every call is recorded; each can be
// configured (per test) to resolve after a delay with a product list, or
// with no match at all.
const sbCalls = [];
let sbConfig = { delayMs: 600, matchSku: null };
function makeSandbox() {
  const docListeners = {};
  const documentStub = {
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    getElementById: (id) => getEl(id), querySelector: () => null, querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener() {}, createTextNode: () => ({}), cookie: ''
  };
  const storage = {
    _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; }, key() { return null; }, length: 0
  };
  const sandbox = {
    console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
    document: documentStub, localStorage: storage, sessionStorage: storage,
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, mediaDevices: {} },
    location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload() {} },
    fetch: async (url) => {
      sbCalls.push({ url: String(url), at: Date.now() });
      if (String(url).indexOf('/sb/search') >= 0) {
        const cfg = sbConfig;
        await new Promise(r => setTimeout(r, cfg.delayMs));
        if (cfg.matchSku) {
          return { ok: true, status: 200, json: async () => ({ status: 'found', products: [{ sku: cfg.matchSku, name: 'test product', inventory: {} }] }) };
        }
        return { ok: false, status: 404, json: async () => ({ status: 'not_found' }) };
      }
      return { ok: false, status: 0, json: async () => ({}), text: async () => '' };
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    alert() {}, confirm: () => true, prompt: () => null,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    scrollTo() {}, open() { return null; }, close() {},
    Image: function () { return { src: '', onload: null, onerror: null }; },
    FileReader: function () { return {}; },
    XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {} }; },
    URL, URLSearchParams, Blob: function () {}, FormData: function () {}, Headers,
    AbortController, TextEncoder, TextDecoder,
    Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error,
    Promise, Map, Set, WeakMap, WeakSet, Symbol, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Html5QrcodeSupportedFormats: { EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4, CODE_39: 5, ITF: 6, CODABAR: 7, QR_CODE: 8, DATA_MATRIX: 9 },
    Html5Qrcode: function () { return { start: async () => {}, stop: async () => {}, clear() {}, scanFile: async () => '' }; },
    Html5QrcodeScanner: function () { return { render() {}, clear: async () => {} }; },
    XLSX: { utils: { book_new: () => ({}), json_to_sheet: () => ({}), book_append_sheet() {} }, writeFile() {} },
    process: { env: {} }
  };
  sandbox.Html5Qrcode.getCameras = async () => [];
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fixesSrc = fs.readFileSync(path.join(__dirname, 'multipack-fixes.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  try { vm.runInContext(fixesSrc, sandbox, { filename: 'multipack-fixes.js' }); } catch (e) { console.log('fixes load note:', e.message); }
  try { vm.runInContext(appSrc, sandbox, { filename: 'app.js' }); } catch (e) { console.log('app.js load note:', e.message); }
  (docListeners.DOMContentLoaded || []).forEach(fn => { try { fn(); } catch (e) {} });
  vm.runInContext(`savvyToken = function(){ return 'fake-token'; };`, sandbox);
  return { sandbox, appSrc };
}

const { sandbox, appSrc } = makeSandbox();

function setBulk(arr) { sandbox.__fixtureBulk = arr; vm.runInContext('bulk = __fixtureBulk;', sandbox); return arr; }
function getBulk() { return vm.runInContext('bulk', sandbox); }
function setCur(obj) { sandbox.__fixtureCur = obj; vm.runInContext('cur = __fixtureCur;', sandbox); return obj; }
function getCur() { return vm.runInContext('cur', sandbox); }
function setReturnToFixUpc(v) { sandbox.__fixtureRTF = v; vm.runInContext('_psReturnToFixUpc = __fixtureRTF;', sandbox); }
function getReturnToFixUpc() { return vm.runInContext('_psReturnToFixUpc', sandbox); }
function getSplitActive() { return vm.runInContext('window._splitActive', sandbox); }
function setSplitActive(v) { sandbox.__fixtureSA = v; vm.runInContext('window._splitActive = __fixtureSA;', sandbox); }
function getSplitManual() { return vm.runInContext('window._splitManual', sandbox); }
function setSplitManual(v) { sandbox.__fixtureSM = v; vm.runInContext('window._splitManual = __fixtureSM;', sandbox); }
function getSbExisting() { return vm.runInContext('window._psSbExisting', sandbox); }

section('LOAD — real multipack-fixes.js + real app.js into sandbox');
const REQUIRED = ['psCheckSellbrite', 'psReturnAndFixExpDate', '_doAddBulk', 'renderResult', 'closeBulk'];
REQUIRED.forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', `typeof = ${typeof sandbox[fn]}`));

checkTrue('source: psCheckSellbrite() checks _psReturnToFixUpc before mutating _splitActive',
  /_inReturnToFixForThisUpc[\s\S]{0,50}_psReturnToFixUpc && String\(_psReturnToFixUpc\)\.replace/.test(appSrc),
  'expected the _psReturnToFixUpc guard inside psCheckSellbrite()');

(async () => {
  const SEROVITAL_TITLE = 'SeroVital Advanced 84 Capsules';
  const SEROVITAL_SKU_3PK = 'SER-681168301026-3pk';

  // ─────────────────────────────────────────────────────────────────────
  // 1-4 — RETURN-TO-FIX MODE: delayed Sellbrite response must NOT mutate
  // splitActive/splitManual at 150/500/1000/2000ms
  // ─────────────────────────────────────────────────────────────────────
  section('1-4 — return-to-fix mode: delayed Sellbrite response does not flip splitActive/splitManual');
  sbConfig = { delayMs: 700, matchSku: SEROVITAL_SKU_3PK };
  sandbox.psCaptureEditorSnapshot('681168301026', {
    splitTotalInput: '3', splitWeightLb: '0', splitWeightOz: '5',
    splitActive: { 3: true }, splitManual: { 3: 1 }
  });
  setBulk([{
    upc: '681168301026', sku: SEROVITAL_SKU_3PK, title: SEROVITAL_TITLE, expDate: '',
    category: '180959', price: 39.99, packs: 3, brand: 'SeroVital', location: 'Aisle 5',
    description: 'd', photo: 'https://cdn.example/sv.jpg', bundleImg: 'https://cdn.example/sv.jpg',
    _specifics: { Type: 'Capsule' }
  }]);
  // Seed a DIFFERENT state before the restore, so any "true"/1 we observe
  // later is provably the restore + protection, not accidental match.
  setSplitActive({ 1: true, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false });
  setSplitManual({});
  setCur({ upc: 'SOME-OTHER-PRODUCT-SCANNED-AFTER' });
  setReturnToFixUpc(null);

  sandbox.psReturnAndFixExpDate('681168301026');

  const checkpoints = [150, 500, 1000, 2000];
  let elapsed = 0;
  for (const t of checkpoints) {
    await wait(t - elapsed);
    elapsed = t;
    check(`t=${t}ms: splitActive[3] stays true (protected)`, getSplitActive() && getSplitActive()[3], true);
    check(`t=${t}ms: splitManual[3] stays 1 (protected)`, getSplitManual() && getSplitManual()[3], 1);
  }
  // By 2000ms, the 700ms-delayed Sellbrite response has long since arrived.
  checkTrue('Sellbrite response did arrive during the window (test is not vacuously true)',
    sbCalls.some(c => c.url.indexOf('/sb/search') >= 0), 'no /sb/search call recorded — mock never invoked');

  // ─────────────────────────────────────────────────────────────────────
  // 6 — informational _psSbExisting still updates during return-to-fix
  // ─────────────────────────────────────────────────────────────────────
  section('6 — informational window._psSbExisting still records the Sellbrite match');
  check('window._psSbExisting[3] is true (informational, preserved)', getSbExisting() && getSbExisting()[3], true);

  // ─────────────────────────────────────────────────────────────────────
  // 5 — NORMAL FRESH SCAN CONTROL: same UPC, NOT in return-to-fix mode —
  // auto-exclude must still fire exactly as before
  // ─────────────────────────────────────────────────────────────────────
  section('5 — normal fresh scan (not in return-to-fix): Sellbrite auto-exclude still fires (regression control)');
  setReturnToFixUpc(null); // NOT in return-to-fix mode for this UPC
  setSplitActive({ 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  setSplitManual({ 3: 1 });
  sbConfig = { delayMs: 50, matchSku: SEROVITAL_SKU_3PK };
  await sandbox.psCheckSellbrite('681168301026', 'SeroVital');
  await wait(150);
  check('fresh scan: splitActive[3] becomes false (unchanged existing behavior)', getSplitActive()[3], false);
  checkTrue('fresh scan: window._psSbExisting[3] still recorded', getSbExisting() && getSbExisting()[3], true);

  // ─────────────────────────────────────────────────────────────────────
  // 7/8 — protection clears after successful in-place update, and a
  // SUBSEQUENT normal scan (of a DIFFERENT UPC) gets normal behavior again
  // ─────────────────────────────────────────────────────────────────────
  section('7/8 — protection ends after in-place update; later scans are unaffected');
  setBulk([{
    upc: '681168301026', sku: SEROVITAL_SKU_3PK, title: SEROVITAL_TITLE, expDate: '',
    category: '180959', price: 39.99, packs: 3, brand: 'SeroVital', location: 'Aisle 5',
    description: 'd', photo: 'https://cdn.example/sv.jpg', bundleImg: 'https://cdn.example/sv.jpg',
    _specifics: { Type: 'Capsule' }
  }]);
  setCur({
    upc: '681168301026', title: SEROVITAL_TITLE, category: '180959', brand: 'SeroVital',
    _selectedTitle: SEROVITAL_TITLE, _selectedSKU: SEROVITAL_SKU_3PK, _selectedPrice: 39.99,
    _selectedPack: 3, _expDate: 'Aug 2027', _specifics: { Type: 'Capsule' }, _psRehydrated: false
  });
  setReturnToFixUpc('681168301026');
  await sandbox._doAddBulk(SEROVITAL_TITLE + ' Exp 08/27', SEROVITAL_SKU_3PK, 39.99, '', 'Aug 2027', 'Aisle 5', 3, 'https://cdn.example/sv.jpg');
  check('7: _psReturnToFixUpc cleared after successful in-place update', getReturnToFixUpc(), null);
  check('7: bulk still has exactly 1 row (updated, not duplicated)', getBulk().length, 1);

  // A later scan of a DIFFERENT UPC (protection must never leak across products).
  setReturnToFixUpc(null);
  setSplitActive({ 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  setSplitManual({});
  sbConfig = { delayMs: 50, matchSku: 'OTH-999888777-3pk' };
  await sandbox.psCheckSellbrite('999888777', 'OtherBrand');
  await wait(150);
  check('8: a later, unrelated scan still gets normal Sellbrite auto-exclude', getSplitActive()[3], false);

  // Re-confirm: scanning the SAME UPC again LATER (protection window over,
  // context cleared) also gets normal behavior — no permanent protection.
  setSplitActive({ 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  setSplitManual({});
  sbConfig = { delayMs: 50, matchSku: SEROVITAL_SKU_3PK };
  await sandbox.psCheckSellbrite('681168301026', 'SeroVital');
  await wait(150);
  check('8b: re-scanning the SAME upc after protection cleared gets normal auto-exclude again', getSplitActive()[3], false);

  // ── Final summary ──
  console.log('\n' + '═'.repeat(78));
  console.log('SUMMARY');
  console.log('═'.repeat(78));
  console.log('passed:', passed);
  console.log('failed:', failed);
  console.log('total: ', passed + failed);
  if (failed) {
    console.log('\nFAILED:');
    failures.forEach(f => console.log('  - ' + f.name));
  }
  console.log('═'.repeat(78));
  process.exit(failed ? 1 : 0);
})();
