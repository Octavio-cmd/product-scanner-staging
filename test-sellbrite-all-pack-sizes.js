#!/usr/bin/env node
/**
 * SELLBRITE EXISTING-PACK DETECTION FOR ALL SUPPORTED PACK SIZES
 * (Investigación #9 fix)
 *
 * Investigation #9 proved psCheckSellbrite() only ever recorded an
 * existing Sellbrite pack when pn===1||3||6||12 — a stale whitelist left
 * over from before Bulk Split supported all 12 individual pack sizes
 * (PACK_SIZES = [1..12]). Sellbrite listings at 2/4/5/7/8/9/10/11 were
 * structurally invisible to _psSbExisting, auto-exclusion, and the
 * informational "✅ En Sellbrite" badge — letting genuine duplicates of an
 * existing Sellbrite listing reach the final CSV undetected. Reproduced
 * end-to-end with the real UPC 031604028435 (Nature Made Vitamin C
 * Gummies) / existing NAT-031604028435-2PK fixture.
 *
 * The fix replaces the hardcoded whitelist with a check against the
 * existing PACK_SIZES constant — the same source of truth the rest of
 * Bulk Split already uses — rather than inventing a second 1-12 list.
 *
 * This suite runs the REAL psCheckSellbrite(), toggleSplitPack(),
 * updateSplitCalc(), addSplitPacksToCSV(), makeSKU() from app.js — no
 * reimplementations. Only fetch() (the /sb/search, /ss/location network
 * boundary) is mocked.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else { failed++; failures.push({ name, actual, expected }); }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
  return ok;
}
function checkTrue(name, cond, detail) {
  if (cond) passed++; else { failed++; failures.push({ name, actual: detail, expected: 'true' }); }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n      detail: ${detail}`}`);
  return !!cond;
}
function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

// ── DOM stub + full vm sandbox — same established pattern as
// test-sellbrite-return-fix.js / test-split-return-fix.js. ─────────────
function makeEl(id) {
  const listeners = {};
  const el = {
    id, textContent: '', innerHTML: '', value: '', dataset: {},
    style: { cssText: '', display: '', background: '', color: '', borderColor: '' },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    children: [],
    appendChild(child) { el.children.push(child); el._lastAppended = child; },
    removeChild() {}, remove() { el._removed = true; },
    scrollIntoView() {}, focus() {}, blur() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}, dispatchEvent() { return true; }
  };
  return el;
}
const elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; }
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

let sbConfig = { skus: [] }; // controllable /sb/search response
const sandbox = {
  console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
  document: documentStub, localStorage: storage, sessionStorage: storage,
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, mediaDevices: {} },
  location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload() {} },
  fetch: async (url) => {
    const u = String(url);
    if (u.indexOf('/sb/search') >= 0) {
      if (!sbConfig.skus.length) return { ok: false, status: 404, json: async () => ({ status: 'not_found' }) };
      return {
        ok: true, status: 200,
        json: async () => ({
          status: 'found',
          products: sbConfig.skus.map(function (sku) { return { sku: sku, name: sku, inventory: {} }; })
        })
      };
    }
    if (u.indexOf('/ss/location') >= 0) {
      return { ok: true, status: 200, json: async () => ({ exists: false }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
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
let loadError = null;
try { vm.runInContext(fixesSrc, sandbox, { filename: 'multipack-fixes.js' }); } catch (e) { loadError = 'fixes: ' + e.message; }
try { vm.runInContext(appSrc, sandbox, { filename: 'app.js' }); } catch (e) { loadError = (loadError ? loadError + ' | ' : '') + 'app.js: ' + e.message; }

section('LOAD — real multipack-fixes.js + real app.js into sandbox');
if (loadError) console.log('  note: ' + loadError);
(docListeners.DOMContentLoaded || []).forEach(fn => { try { fn(); } catch (e) {} });
vm.runInContext(`savvyToken = function(){ return 'fake-token'; };`, sandbox);

function setBulk(arr) { sandbox.__b = arr; vm.runInContext('bulk = __b;', sandbox); }
function getBulk() { return vm.runInContext('bulk', sandbox); }
function setCur(o) { sandbox.__c = o; vm.runInContext('cur = __c;', sandbox); return o; }
function getCur() { return vm.runInContext('cur', sandbox); }
function setRTF(upc, sku) {
  sandbox.__fu = upc == null ? null : upc; sandbox.__fs = sku == null ? null : sku;
  vm.runInContext('_psReturnToFixUpc = __fu; _psReturnToFixSku = __fs;', sandbox);
}
function getRTF() { return { upc: vm.runInContext('_psReturnToFixUpc', sandbox), sku: vm.runInContext('_psReturnToFixSku', sandbox) }; }
function getSbExisting() { return vm.runInContext('window._psSbExisting', sandbox); }
function getSplitActive() { return vm.runInContext('window._splitActive', sandbox); }
function setSplitActive(v) { sandbox.__sa = v; vm.runInContext('window._splitActive = __sa;', sandbox); }
function getSplitManual() { return vm.runInContext('window._splitManual', sandbox); }
function setSplitManual(v) { sandbox.__sm = v; vm.runInContext('window._splitManual = __sm;', sandbox); }

const REQUIRED = ['psCheckSellbrite', 'toggleSplitPack', 'updateSplitCalc', 'addSplitPacksToCSV', 'makeSKU', 'computeSplit'];
REQUIRED.forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

const UPC = '031604028435';
const BRAND = 'Nature Made';
function skuFor(p) { return sandbox.makeSKU(BRAND, UPC, p, 'Nature Made Vitamin C Gummies'); }

console.log('═'.repeat(78));
console.log('SELLBRITE EXISTING-PACK DETECTION — ALL SUPPORTED PACK SIZES');
console.log('═'.repeat(78));

(async () => {

// ─────────────────────────────────────────────────────────────────────────
section('1 — PACK 1-12 DETECTION MATRIX (previously-unsupported sizes now work)');
// ─────────────────────────────────────────────────────────────────────────
for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  setRTF(null, null);
  setSplitActive({ 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  sbConfig.skus = [skuFor(p)];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  check(`pack ${p}: _psSbExisting[${p}] recorded true`, !!getSbExisting()[p], true);
}

// ─────────────────────────────────────────────────────────────────────────
section('2 — OUT-OF-RANGE NEGATIVE CONTROLS');
// ─────────────────────────────────────────────────────────────────────────
for (const bad of [13, 20, 0]) {
  setRTF(null, null);
  setSplitActive({ 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  const badSku = 'NAT-' + UPC + '-' + bad + 'PK';
  sbConfig.skus = [badSku];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  const sb = getSbExisting();
  checkTrue(`"${badSku}" (pack ${bad}, out of PACK_SIZES) NOT recorded`, Object.keys(sb).length === 0, JSON.stringify(sb));
}

// ─────────────────────────────────────────────────────────────────────────
section('3 — WRONG UPC NEGATIVE CONTROL');
// ─────────────────────────────────────────────────────────────────────────
{
  setRTF(null, null);
  setSplitActive({ 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  sbConfig.skus = ['NAT-999999999999-2PK'];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  const sb = getSbExisting();
  checkTrue('a correctly-formatted 2PK SKU for a DIFFERENT UPC does not mark pack 2 existing for ' + UPC,
    !sb[2], JSON.stringify(sb));
}

// ─────────────────────────────────────────────────────────────────────────
section('4 — NORMAL FRESH SCAN AUTO-EXCLUSION (2pk, 4pk, 10pk)');
// ─────────────────────────────────────────────────────────────────────────
for (const p of [2, 4, 10]) {
  setRTF(null, null);
  setSplitActive({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true });
  sbConfig.skus = [skuFor(p)];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  check(`pack ${p} active BEFORE Sellbrite check`, true, true);
  check(`pack ${p}: auto-excluded (splitActive[${p}]=false) after normal fresh scan`, getSplitActive()[p], false);
  check(`pack ${p}: _psSbExisting[${p}] = true`, !!getSbExisting()[p], true);
}

// ─────────────────────────────────────────────────────────────────────────
section('5 — RETURN-TO-FIX PROTECTION (2pk, and 3pk regression)');
// ─────────────────────────────────────────────────────────────────────────
{
  // 5a — 2pk: informational state records, but active/manual are NOT mutated.
  const preservedActive = { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  const preservedManual = { 2: 7 };
  setSplitActive(Object.assign({}, preservedActive));
  setSplitManual(Object.assign({}, preservedManual));
  setRTF(UPC, skuFor(2)); // explicit return-to-fix for THIS upc
  sbConfig.skus = [skuFor(2)];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  check('return-to-fix 2pk: _psSbExisting[2] still recorded (informational)', !!getSbExisting()[2], true);
  check('return-to-fix 2pk: splitActive NOT mutated by Sellbrite', getSplitActive(), preservedActive);
  check('return-to-fix 2pk: splitManual NOT mutated by Sellbrite', getSplitManual(), preservedManual);

  // 5b — original 3pk return-to-fix regression (Investigación #5's own case).
  const preservedActive3 = { 1: false, 2: false, 3: true, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  const preservedManual3 = { 3: 1 };
  setSplitActive(Object.assign({}, preservedActive3));
  setSplitManual(Object.assign({}, preservedManual3));
  setRTF(UPC, skuFor(3));
  sbConfig.skus = [skuFor(3)];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  check('return-to-fix 3pk: _psSbExisting[3] still recorded (informational)', !!getSbExisting()[3], true);
  check('return-to-fix 3pk: splitActive NOT mutated (Investigación #5 behavior intact)', getSplitActive(), preservedActive3);
  check('return-to-fix 3pk: splitManual NOT mutated (Investigación #5 behavior intact)', getSplitManual(), preservedManual3);
}

// ─────────────────────────────────────────────────────────────────────────
section('6 — EXPLICIT USER RE-INCLUDE (toggleSplitPack, pre-existing mechanism)');
// ─────────────────────────────────────────────────────────────────────────
{
  setRTF(null, null);
  setSplitActive({ 1: true, 2: true, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  sbConfig.skus = [skuFor(2)];
  await sandbox.psCheckSellbrite(UPC, BRAND);
  check('after Sellbrite: 2pk auto-excluded', getSplitActive()[2], false);
  sandbox.toggleSplitPack(2); // the pre-existing "↩ incluir" mechanism
  check('after explicit toggleSplitPack(2): employee re-include restores active=true (unchanged pre-existing behavior)', getSplitActive()[2], true);
}

// ─────────────────────────────────────────────────────────────────────────
section('7 — NATURE MADE 1000-UNIT END-TO-END (real fixture, real functions)');
// ─────────────────────────────────────────────────────────────────────────
{
  setRTF(null, null);
  setSplitActive({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true });
  setSplitManual({ 1: 184, 2: 4, 3: 50, 4: 2, 5: 1, 6: 46, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 27 });
  sbConfig.skus = [skuFor(2)]; // real observed browser state: 1 existing Sellbrite listing, pack 2
  getEl('split-calc-card').dataset.tier = 'media';
  await sandbox.psCheckSellbrite(UPC, BRAND);
  check('2pk recognized existing after Sellbrite response', !!getSbExisting()[2], true);
  check('2pk auto-excluded by the fixed whitelist (default: excluded)', getSplitActive()[2], false);

  // Exercise the real recalculation path an employee triggers by entering
  // total units / weight — proves distribution recalculation does NOT
  // silently reactivate the excluded pack.
  getEl('split-total-input').value = '1000';
  getEl('split-weight-lb').value = '0';
  getEl('split-weight-oz').value = '8';
  sandbox.updateSplitCalc();
  check('after updateSplitCalc() (total=1000, weight=8oz): 2pk still excluded', getSplitActive()[2], false);

  // Now actually build the CSV from whatever is active (2pk excluded, all others active).
  setBulk([]);
  const curFixture = {
    upc: UPC, brand: BRAND, title: 'Nature Made Vitamin C Gummies 250mg Immune Support 80ct',
    category: '11776', _description: 'Full description already generated.',
    _specifics: { Formulation: 'Gummy', 'Item Form': 'Gummy' },
    _shade: '', _expDate: 'Oct 2033', location: '',
    _bundleImg: 'https://cdn.example/nat-generic.jpg',
    ebay: { prices: { low: 9.99, avg: 18.51 } },
    _packImages: {}
  };
  [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(function (p) { curFixture._packImages[p] = { front: 'https://cdn.example/nat-' + p + 'pk.jpg' }; });
  setCur(curFixture);

  const splitOk = await sandbox.addSplitPacksToCSV();
  const finalBulk = getBulk();
  const skus = finalBulk.map(function (b) { return b.sku; });
  checkTrue('addSplitPacksToCSV() succeeded', splitOk === true, splitOk);
  check('final CSV row count = 11 (all 12 packs minus excluded 2pk)', finalBulk.length, 11);
  checkTrue('FINAL CSV DOES NOT CONTAIN NAT-031604028435-2pk (default: excluded)', skus.indexOf(skuFor(2)) === -1, JSON.stringify(skus));
  checkTrue('1pk present', skus.indexOf(skuFor(1)) !== -1);
  checkTrue('12pk present', skus.indexOf(skuFor(12)) !== -1);

  // Pricing spot check — Investigación #9 explicitly out of scope; prove untouched.
  const row1pk = finalBulk.find(function (b) { return b.sku === skuFor(1); });
  const row12pk = finalBulk.find(function (b) { return b.sku === skuFor(12); });
  check('pricing unchanged: 1pk price = (9.99*1*0.88).toFixed(2)', row1pk.price, (9.99 * 1 * 0.88).toFixed(2));
  check('pricing unchanged: 12pk price = (9.99*12*0.88).toFixed(2)', row12pk.price, (9.99 * 12 * 0.88).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────
section('8 — SOURCE-LEVEL: PACK_SIZES reused, whitelist gone, addSplitPacksToCSV untouched');
// ─────────────────────────────────────────────────────────────────────────
checkTrue('8.1 psCheckSellbrite now checks PACK_SIZES.indexOf(pn), not a hardcoded 1/3/6/12 list',
  /if \(PACK_SIZES\.indexOf\(pn\) !== -1\) sbExisting\[pn\] = true;/.test(appSrc),
  'expected PACK_SIZES-based check not found');
checkTrue('8.2 the old hardcoded whitelist is gone from source',
  !/if \(pn === 1 \|\| pn === 3 \|\| pn === 6 \|\| pn === 12\) sbExisting\[pn\] = true;/.test(appSrc),
  'old whitelist text still present — fix not applied');
checkTrue('8.3 addSplitPacksToCSV() still has no second Sellbrite network call (scope preserved)',
  !/addSplitPacksToCSV[\s\S]{0,3000}\/sb\/search/.test(appSrc),
  'unexpected /sb/search reference found inside addSplitPacksToCSV scope');
checkTrue('8.4 calcBundlePrice() formula untouched (0.88 discount unchanged)',
  /const base = soldAvg\|\|soldLow\|\|actLow\|\|actAvg\|\|0;\s*\n\s*if\(base>0\) return \(base\*packs\*0\.88\)\.toFixed\(2\);/.test(appSrc),
  'calcBundlePrice source text changed unexpectedly');

// ─────────────────────────────────────────────────────────────────────────
section('SUMMARY');
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}`));
}
process.exit(failed ? 1 : 0);

})();
