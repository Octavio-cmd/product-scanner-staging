#!/usr/bin/env node
/**
 * EXACT-SKU RETURN-TO-FIX FOR BULK SPLIT — regression suite (Investigación #6).
 *
 * Loads the REAL app.js + multipack-fixes.js into a vm sandbox (same harness
 * as test-return-and-fix.js / test-sellbrite-return-fix.js) and drives the
 * REAL addSplitPacksToCSV(), _doAddBulk(), psFindBulkIndexBySku(),
 * psReturnAndFixExpDate(), psShowExpBlockedModal() — no reimplementations.
 *
 * Covers: real SeroVital 3pk Bulk Split return-to-fix; exact-SKU capture
 * from the failing bulk row; in-place replacement inside
 * addSplitPacksToCSV(); multi-pack same-UPC isolation (byte-identical
 * siblings); context clearing gated on actual target replacement; the
 * window._psLastAddResult success signal; normal duplicate/new-pack
 * controls outside return-to-fix; single-item _doAddBulk regression;
 * Clear Session context reset.
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

// ── DOM STUB (same shape as test-return-and-fix.js) ────────────────────────
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

const docListeners = {};
const documentStub = {
  body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
  getElementById: (id) => getEl(id), querySelector: () => null, querySelectorAll: () => [],
  createElement: (tag) => makeEl(tag),
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener() {},
  createTextNode: () => ({}), cookie: ''
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
  fetch: async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  alert(msg) { sandbox.__lastAlert = msg; },
  confirm: () => true, prompt: () => null,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  scrollTo() {}, open() { return null; }, close() {},
  Image: function () { return { src: '', onload: null, onerror: null }; },
  FileReader: function () { return {}; },
  XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {} }; },
  URL, URLSearchParams, Blob: function () {}, FormData: function () {},
  AbortController, TextEncoder, TextDecoder,
  Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error,
  Promise, Map, Set, WeakMap, WeakSet, Symbol, parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  Html5QrcodeSupportedFormats: {
    EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4,
    CODE_39: 5, ITF: 6, CODABAR: 7, QR_CODE: 8, DATA_MATRIX: 9
  },
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

function setBulk(arr) { sandbox.__fixtureBulk = arr; vm.runInContext('bulk = __fixtureBulk;', sandbox); return arr; }
function getBulk() { return vm.runInContext('bulk', sandbox); }
function setCur(obj) { sandbox.__fixtureCur = obj; vm.runInContext('cur = __fixtureCur;', sandbox); return obj; }
function getCur() { return vm.runInContext('cur', sandbox); }
function setRTF(upc, sku) {
  sandbox.__fu = upc == null ? null : upc;
  sandbox.__fs = sku == null ? null : sku;
  vm.runInContext('_psReturnToFixUpc = __fu; _psReturnToFixSku = __fs;', sandbox);
}
function getRTF() {
  return {
    upc: vm.runInContext('_psReturnToFixUpc', sandbox),
    sku: vm.runInContext('_psReturnToFixSku', sandbox)
  };
}
function setSplitActive(v) { sandbox.__sa = v; vm.runInContext('window._splitActive = __sa;', sandbox); }
function setSplitManual(v) { sandbox.__sm = v; vm.runInContext('window._splitManual = __sm;', sandbox); }
function setLastResult(v) { sandbox.__lr = v === undefined ? null : v; vm.runInContext('window._psLastAddResult = __lr;', sandbox); }
function getLastResult() { return vm.runInContext('window._psLastAddResult', sandbox); }

const REQUIRED = [
  'addSplitPacksToCSV', '_doAddBulk', '_addBulkInternal',
  'psFindBulkIndexByUpc', 'psFindBulkIndexBySku',
  'psShowExpBlockedModal', 'psReturnAndFixExpDate', 'computeSplit', 'makeSKU'
];
REQUIRED.forEach(fn => {
  checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', `typeof = ${typeof sandbox[fn]}`);
});

// ── Fixture builders ────────────────────────────────────────────────────────
const SV_UPC = '681168301026';
const SV_BRAND = 'SeroVital';
const SV_TITLE = 'SeroVital Advanced Whole Body 84 Capsules';

function svBulkRow(pack, expDate, extra) {
  return Object.assign({
    upc: SV_UPC, sku: sandbox.makeSKU(SV_BRAND, SV_UPC, pack, SV_TITLE),
    title: SV_TITLE + ' ' + pack + 'pk', price: 39.99, packs: pack,
    brand: SV_BRAND, category: '180959', expDate: expDate,
    shade: '', location: '', description: 'd', photo: 'https://cdn.example/sv.jpg',
    bundleImg: 'https://cdn.example/sv.jpg', quantity: 1, mfgCode: '',
    _specifics: { Type: 'Capsule' }
  }, extra || {});
}

function svCur(extra) {
  return Object.assign({
    upc: SV_UPC, brand: SV_BRAND, title: SV_TITLE, category: '180959',
    _description: 'Full rich description.', _specifics: { Type: 'Capsule' },
    _shade: '', _expDate: '', location: '', _bundleImg: 'https://cdn.example/sv-generic.jpg',
    ebay: {}
  }, extra || {});
}

function packImages(packs) {
  var m = {};
  packs.forEach(function (p) { m[p] = { front: 'https://cdn.example/sv-' + p + 'pk-front.jpg' }; });
  return m;
}

(async () => {

// ─────────────────────────────────────────────────────────────────────────
section('1 — source-level wiring for exact-SKU return-to-fix');
// ─────────────────────────────────────────────────────────────────────────
checkTrue('1a _psReturnToFixSku declared alongside _psReturnToFixUpc',
  /let _psReturnToFixUpc = null;[\s\S]{0,600}let _psReturnToFixSku = null;/.test(appSrc),
  'declaration not found near _psReturnToFixUpc');
checkTrue('1b psFindBulkIndexBySku defined as exact-sku lookup',
  /function psFindBulkIndexBySku\(sku\) \{\s*return bulk\.findIndex\(function\(b\)\{\s*return b\.sku === sku;/.test(appSrc),
  'psFindBulkIndexBySku body not found');
checkTrue('1c psShowExpBlockedModal captures firstSku from noExpList[0]',
  /var firstSku = \(noExpList\[0\] && noExpList\[0\]\.sku\) \|\| '';/.test(appSrc),
  'firstSku capture not found');
checkTrue('1d modal passes firstSku into psReturnAndFixExpDate',
  /psReturnAndFixExpDate\(firstUpc, firstSku\);/.test(appSrc),
  'call site not updated to pass firstSku');
checkTrue('1e psReturnAndFixExpDate resolves by exact SKU first, UPC as fallback',
  /function psReturnAndFixExpDate\(targetUpc, targetSku\) \{[\s\S]{0,300}var idx = targetSku \? psFindBulkIndexBySku\(targetSku\) : -1;\s*\n\s*if \(idx === -1\) idx = psFindBulkIndexByUpc\(targetUpc\);/.test(appSrc),
  'sku-first resolution not found');
checkTrue('1f addSplitPacksToCSV computes _isExactReturnTarget requiring UPC+SKU match',
  /var _isExactReturnTarget = dupIdx !== -1 && _psReturnToFixUpc && _psReturnToFixSku &&\s*\n\s*cur\.upc === _psReturnToFixUpc && sku === _psReturnToFixSku;/.test(appSrc),
  'exact-target computation not found');
checkTrue('1g addSplitPacksToCSV replaces bulk[dupIdx] in place for the exact target only',
  /if \(_isExactReturnTarget\) \{[\s\S]{0,200}bulk\[dupIdx\] = _row;\s*\n\s*replaced\+\+;/.test(appSrc),
  'in-place replace branch not found');
checkTrue('1h context clears only when _targetReplacedThisRun is true',
  /if \(_targetReplacedThisRun\) \{\s*\n\s*_psReturnToFixUpc = null;\s*\n\s*_psReturnToFixSku = null;\s*\n\s*\}/.test(appSrc),
  'gated context-clear block not found');
checkTrue('1i window._psLastAddResult set by addSplitPacksToCSV',
  // #21E: same assignment, now also carrying mode/reason for the button.
  /window\._psLastAddResult = \{ added: added, replaced: replaced, skippedDup: skippedDup, mode: 'split',/.test(appSrc),
  '_psLastAddResult assignment not found');
checkTrue('1j addFn button handler treats replaced>0 as success',
  /var _replaced = \(_r && _r\.replaced\) \|\| 0;\s*\n\s*\n?\s*if \(added > 0 \|\| _replaced > 0\) \{/.test(appSrc),
  'addFn success condition not updated');
checkTrue('1k Clear Session handlers (both) reset _psReturnToFixUpc/_psReturnToFixSku',
  (appSrc.match(/_psReturnToFixUpc=null;_psReturnToFixSku=null;/g) || []).length === 2,
  'expected 2 occurrences, found ' + ((appSrc.match(/_psReturnToFixUpc=null;_psReturnToFixSku=null;/g) || []).length));
checkTrue('1l scan-reset clears both context vars',
  /_psReturnToFixUpc = null;\s*\n\s*_psReturnToFixSku = null;\s*\n\s*cur\._singleProductImg=null;/.test(appSrc),
  'scan-reset clearing not found');

// ─────────────────────────────────────────────────────────────────────────
section('2 — REAL SeroVital 3pk E2E: split-path exact-SKU replace');
// ─────────────────────────────────────────────────────────────────────────
{
  var bulkFixture = [svBulkRow(3, '')];
  setBulk(bulkFixture);
  setCur(svCur({ _expDate: 'Aug 2029', _packImages: packImages([3]) }));
  setRTF(SV_UPC, sandbox.makeSKU(SV_BRAND, SV_UPC, 3, SV_TITLE));
  setLastResult(null);
  getEl('split-total-input').value = '3';
  var card = getEl('split-calc-card'); card.dataset.tier = 'media';
  setSplitActive({ 3: true });
  setSplitManual({ 3: 1 });

  var svResult = await sandbox.addSplitPacksToCSV();
  var svBulk = getBulk();
  var svLast = getLastResult();
  var svCtx = getRTF();

  checkTrue('2a addSplitPacksToCSV() returns true (success)', svResult === true, svResult);
  check('2b bulk.length unchanged (1)', svBulk.length, 1);
  check('2c same row index, same SKU', svBulk[0].sku, sandbox.makeSKU(SV_BRAND, SV_UPC, 3, SV_TITLE));
  check('2d same UPC', svBulk[0].upc, SV_UPC);
  check('2e expDate corrected to Aug 2029', svBulk[0].expDate, 'Aug 2029');
  checkTrue('2f no duplicate SKU introduced', svBulk.filter(function (b) { return b.sku === svBulk[0].sku; }).length === 1, JSON.stringify(svBulk.map(function(b){return b.sku;})));
  check('2g result object: replaced=1, added=0', { added: svLast.added, replaced: svLast.replaced }, { added: 0, replaced: 1 });
  check('2h _psReturnToFixUpc cleared after successful replace', svCtx.upc, null);
  check('2i _psReturnToFixSku cleared after successful replace', svCtx.sku, null);
}

// ─────────────────────────────────────────────────────────────────────────
section('3 — MULTI-PACK SAME-UPC ISOLATION: 2pk/3pk/6pk, only 3pk changes');
// ─────────────────────────────────────────────────────────────────────────
{
  var row2 = svBulkRow(2, 'Jan 2028');
  var row3 = svBulkRow(3, '');
  var row6 = svBulkRow(6, 'Dec 2030');
  var mpBulk = [row2, row3, row6];
  setBulk(mpBulk);
  setCur(svCur({ _expDate: 'Aug 2029', _packImages: packImages([2, 3, 6]) }));
  setRTF(SV_UPC, sandbox.makeSKU(SV_BRAND, SV_UPC, 3, SV_TITLE));
  setLastResult(null);
  getEl('split-total-input').value = '11';
  getEl('split-calc-card').dataset.tier = 'media';
  setSplitActive({ 2: true, 3: true, 6: true });
  setSplitManual({ 2: 1, 3: 1, 6: 1 });

  var mpResult = await sandbox.addSplitPacksToCSV();
  var mpBulkAfter = getBulk();
  var mpLast = getLastResult();

  checkTrue('3a addSplitPacksToCSV() returns true', mpResult === true, mpResult);
  check('3b bulk length remains 3', mpBulkAfter.length, 3);
  check('3c row order unchanged (index 0/1/2)', mpBulkAfter.map(function (b) { return b.packs; }), [2, 3, 6]);
  checkTrue('3d 2pk row is the SAME object reference (byte-identical, untouched)', mpBulkAfter[0] === row2, 'reference changed');
  checkTrue('3e 6pk row is the SAME object reference (byte-identical, untouched)', mpBulkAfter[2] === row6, 'reference changed');
  check('3f 2pk expDate unchanged', mpBulkAfter[0].expDate, 'Jan 2028');
  check('3g 6pk expDate unchanged', mpBulkAfter[2].expDate, 'Dec 2030');
  check('3h ONLY 3pk expDate corrected', mpBulkAfter[1].expDate, 'Aug 2029');
  checkTrue('3i no duplicate SKUs across the 3 rows',
    new Set(mpBulkAfter.map(function (b) { return b.sku; })).size === 3, mpBulkAfter.map(function(b){return b.sku;}));
  check('3j result: replaced=1 (3pk only), added=0, skippedDup=2 (2pk+6pk)',
    { added: mpLast.added, replaced: mpLast.replaced, skippedDup: mpLast.skippedDup },
    { added: 0, replaced: 1, skippedDup: 2 });
}

// ─────────────────────────────────────────────────────────────────────────
section('4 — NORMAL CONTROL: outside return-to-fix, duplicate skip and new-pack add both work as before');
// ─────────────────────────────────────────────────────────────────────────
{
  // 4a — existing duplicate split SKU still skips normally (no replace) when NOT in return-to-fix.
  var dupRow = svBulkRow(3, 'Nov 2027');
  setBulk([dupRow]);
  setCur(svCur({ _expDate: 'Aug 2029', _packImages: packImages([3]) }));
  setRTF(null, null); // no return-to-fix context active
  setLastResult(null);
  getEl('split-total-input').value = '3';
  getEl('split-calc-card').dataset.tier = 'media';
  setSplitActive({ 3: true });
  setSplitManual({ 3: 1 });

  var ctrlResult = await sandbox.addSplitPacksToCSV();
  var ctrlBulk = getBulk();
  var ctrlLast = getLastResult();
  checkTrue('4a addSplitPacksToCSV() returns true (skippedDup path)', ctrlResult === true, ctrlResult);
  checkTrue('4b the pre-existing row is untouched (same reference, same expDate)',
    ctrlBulk[0] === dupRow && ctrlBulk[0].expDate === 'Nov 2027', JSON.stringify(ctrlBulk[0]));
  check('4c result: added=0, replaced=0, skippedDup=1', { added: ctrlLast.added, replaced: ctrlLast.replaced, skippedDup: ctrlLast.skippedDup }, { added: 0, replaced: 0, skippedDup: 1 });

  // 4b — brand-new split pack (no existing row) still adds normally.
  setBulk([]);
  setCur(svCur({ _expDate: 'Aug 2029', _packImages: packImages([3]) }));
  setRTF(null, null);
  setLastResult(null);
  getEl('split-total-input').value = '3';
  getEl('split-calc-card').dataset.tier = 'media';
  setSplitActive({ 3: true });
  setSplitManual({ 3: 1 });

  var newResult = await sandbox.addSplitPacksToCSV();
  var newBulk = getBulk();
  var newLast = getLastResult();
  checkTrue('4d addSplitPacksToCSV() returns true (added path)', newResult === true, newResult);
  check('4e a brand-new row was pushed', newBulk.length, 1);
  check('4f result: added=1, replaced=0, skippedDup=0', { added: newLast.added, replaced: newLast.replaced, skippedDup: newLast.skippedDup }, { added: 1, replaced: 0, skippedDup: 0 });
}

// ─────────────────────────────────────────────────────────────────────────
section('5 — FAILED TARGET REPLACEMENT keeps the return-to-fix context active');
// ─────────────────────────────────────────────────────────────────────────
{
  // Target is 3pk, but only pack 1 is active this run (3pk never reached,
  // so the exact target is never replaced) — context must survive.
  var onlyRow = svBulkRow(3, '');
  setBulk([onlyRow]);
  setCur(svCur({ _expDate: 'Aug 2029', _packImages: packImages([1]) }));
  setRTF(SV_UPC, sandbox.makeSKU(SV_BRAND, SV_UPC, 3, SV_TITLE));
  setLastResult(null);
  getEl('split-total-input').value = '1';
  getEl('split-calc-card').dataset.tier = 'media';
  setSplitActive({ 1: true });
  setSplitManual({ 1: 1 });

  await sandbox.addSplitPacksToCSV();
  var ctxAfterFail = getRTF();
  checkTrue('5a _psReturnToFixUpc remains set — target 3pk was never reached',
    ctxAfterFail.upc === SV_UPC, JSON.stringify(ctxAfterFail));
  checkTrue('5b _psReturnToFixSku remains set — target 3pk was never reached',
    ctxAfterFail.sku === sandbox.makeSKU(SV_BRAND, SV_UPC, 3, SV_TITLE), JSON.stringify(ctxAfterFail));
  check('5c the untouched 3pk row keeps its original (still-missing) expDate', getBulk()[0].expDate, '');
}

// ─────────────────────────────────────────────────────────────────────────
section('6 — SINGLE-ITEM _doAddBulk() exact-SKU regression (Investigación #3 extended)');
// ─────────────────────────────────────────────────────────────────────────
{
  var singleRow = { upc: '111222333444', sku: 'ABC-111222333444-1pk', title: 'X', price: 9.99, packs: 1, brand: 'ABC', category: '180959', expDate: '', shade: '', location: '', _specifics: {} };
  setBulk([singleRow]);
  setCur({ upc: '111222333444', brand: 'ABC', title: 'X', category: '180959', _selectedSKU: 'ABC-111222333444-1pk', _selectedPack: 1, _bundleImg: 'https://cdn.example/x.jpg', _expDate: 'Jul 2030', _psRehydrated: true });
  setRTF('111222333444', 'ABC-111222333444-1pk');
  setLastResult(null);

  await sandbox._doAddBulk('X', 'ABC-111222333444-1pk', 9.99, '', 'Jul 2030', '', 1, 'https://cdn.example/x.jpg');
  var singleBulk = getBulk();
  var singleCtx = getRTF();
  var singleLast = getLastResult();
  check('6a bulk length unchanged', singleBulk.length, 1);
  check('6b expDate replaced in place', singleBulk[0].expDate, 'Jul 2030');
  check('6c same SKU, same UPC, same index', { sku: singleBulk[0].sku, upc: singleBulk[0].upc }, { sku: 'ABC-111222333444-1pk', upc: '111222333444' });
  check('6d context cleared after single-item replace', singleCtx, { upc: null, sku: null });
  check('6e result object: replaced=1, added=0', { added: singleLast.added, replaced: singleLast.replaced }, { added: 0, replaced: 1 });
}

// ─────────────────────────────────────────────────────────────────────────
section('7 — psFindBulkIndexBySku() resolves the exact row among same-UPC siblings');
// ─────────────────────────────────────────────────────────────────────────
{
  var siblingBulk = [svBulkRow(2, 'Jan 2028'), svBulkRow(3, ''), svBulkRow(6, 'Dec 2030')];
  setBulk(siblingBulk);
  var idx2 = sandbox.psFindBulkIndexBySku(sandbox.makeSKU(SV_BRAND, SV_UPC, 2, SV_TITLE));
  var idx3 = sandbox.psFindBulkIndexBySku(sandbox.makeSKU(SV_BRAND, SV_UPC, 3, SV_TITLE));
  var idx6 = sandbox.psFindBulkIndexBySku(sandbox.makeSKU(SV_BRAND, SV_UPC, 6, SV_TITLE));
  check('7a resolves 2pk to index 0', idx2, 0);
  check('7b resolves 3pk to index 1', idx3, 1);
  check('7c resolves 6pk to index 2', idx6, 2);
  check('7d unknown SKU resolves to -1', sandbox.psFindBulkIndexBySku('NOPE-000-9pk'), -1);
}

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
