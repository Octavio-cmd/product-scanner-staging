#!/usr/bin/env node
/**
 * "REGRESAR Y CORREGIR" — export-blocked recovery regression suite.
 *
 * Loads the REAL app.js + multipack-fixes.js into a vm sandbox (same
 * technique as test-multipack-integration.js) and drives the REAL
 * psShowExpBlockedModal(), psReturnAndFixExpDate(), psFindBulkIndexByUpc(),
 * and _doAddBulk() functions — no reimplementations.
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

// ── DOM STUB — same shape as test-multipack-integration.js, upgraded with a
// REAL (if minimal) addEventListener/click/remove/appendChild so the modal's
// button wiring can actually be exercised, not just parsed for syntax. ────
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

// Fire the real DOMContentLoaded handler so window.closeBulk (assigned
// inside it) actually exists, exactly like a real browser would trigger it.
let domReadyError = null;
(docListeners.DOMContentLoaded || []).forEach(fn => {
  try { fn(); } catch (e) { domReadyError = e.message; }
});
if (domReadyError) console.log('  note: DOMContentLoaded handler threw (tolerable if past the closeBulk assignment): ' + domReadyError);

// `bulk`, `cur`, `_psReturnToFixUpc` are script-scope `let` bindings, not
// window properties — same reason test-multipack-integration.js drives
// `cur` through vm.runInContext rather than sandbox.cur.
function setBulk(arr) { sandbox.__fixtureBulk = arr; vm.runInContext('bulk = __fixtureBulk;', sandbox); return arr; }
function getBulk() { return vm.runInContext('bulk', sandbox); }
function setCur(obj) { sandbox.__fixtureCur = obj; vm.runInContext('cur = __fixtureCur;', sandbox); return obj; }
function getCur() { return vm.runInContext('cur', sandbox); }
function setReturnToFixUpc(v) { sandbox.__fixtureRTF = v; vm.runInContext('_psReturnToFixUpc = __fixtureRTF;', sandbox); }
function getReturnToFixUpc() { return vm.runInContext('_psReturnToFixUpc', sandbox); }

checkTrue('harness drives the real `bulk`/`cur`/`_psReturnToFixUpc` bindings',
  (() => { setBulk([{ _probe: 1 }]); setCur({ _probe: 'ok' }); setReturnToFixUpc('x');
    return getBulk()[0]._probe === 1 && getCur()._probe === 'ok' && getReturnToFixUpc() === 'x'; })());

const REQUIRED = ['psShowExpBlockedModal', 'psReturnAndFixExpDate', 'psFindBulkIndexByUpc',
  '_doAddBulk', 'closeBulk', 'renderResult', 'screen', 'exportCSV'];
REQUIRED.forEach(fn => {
  checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', `typeof = ${typeof sandbox[fn]}`);
});

// ─────────────────────────────────────────────────────────────────────────
// A — warning modal appears (source-level: alert() replaced by the modal)
// ─────────────────────────────────────────────────────────────────────────
section('A — warning modal replaces alert() for missing expiration');
checkTrue('exportCSV() calls psShowExpBlockedModal(_noExp), not alert(), for the exp-block path',
  /if \(_noExp\.length\) \{[\s\S]{0,800}psShowExpBlockedModal\(_noExp\)/.test(appSrc),
  'expected psShowExpBlockedModal(_noExp) inside the _noExp.length block');
checkTrue('the old plain alert() with EXPORT DETENIDO text is gone from that block',
  !/alert\(\s*\n?\s*['"]🚫 EXPORT DETENIDO/.test(appSrc),
  'found a literal alert(...EXPORT DETENIDO...) call — should have been replaced');

// ─────────────────────────────────────────────────────────────────────────
// B — Cerrar ONLY closes the warning (source + structural proof)
// ─────────────────────────────────────────────────────────────────────────
section('B — "Cerrar" only dismisses the modal');
const closeHandlerMatch = appSrc.match(/expBlockCloseBtn'\)\.addEventListener\('click', function\(\)\{\s*([\s\S]*?)\s*\}\);/);
checkTrue('expBlockCloseBtn handler found', !!closeHandlerMatch, 'regex did not match');
if (closeHandlerMatch) {
  const body = closeHandlerMatch[1].trim();
  check('Cerrar handler body is exactly "ov.remove();" — no other statement', body, 'ov.remove();');
}

setBulk([{ upc: '681168301026', sku: 'SER-681168301026-1pk', expDate: '' }]);
setCur({ upc: '681168301026' });
setReturnToFixUpc(null);
const bulkBeforeClose = JSON.stringify(getBulk());
const curBeforeClose = JSON.stringify(getCur());
sandbox.psShowExpBlockedModal(getBulk());
const ovAfterShow = documentStub.body._lastAppended;
checkTrue('modal overlay was appended to body', !!ovAfterShow, 'no element appended');
checkTrue('modal text includes EXPORT DETENIDO', /EXPORT DETENIDO/.test(ovAfterShow.innerHTML), ovAfterShow.innerHTML);
checkTrue('modal text includes the failing SKU', ovAfterShow.innerHTML.includes('SER-681168301026-1pk'), ovAfterShow.innerHTML);
checkTrue('modal has a "Regresar y corregir" button', /Regresar y corregir/.test(ovAfterShow.innerHTML), ovAfterShow.innerHTML);
checkTrue('modal has a "Cerrar" button', /Cerrar/.test(ovAfterShow.innerHTML), ovAfterShow.innerHTML);

documentStub.getElementById('expBlockCloseBtn').click();
check('Cerrar: bulk unchanged', JSON.stringify(getBulk()), bulkBeforeClose);
check('Cerrar: cur unchanged', JSON.stringify(getCur()), curBeforeClose);
check('Cerrar: _psReturnToFixUpc unchanged (still null)', getReturnToFixUpc(), null);

// ─────────────────────────────────────────────────────────────────────────
// C/D — cur-match path: highest fidelity, no reconstruction
// ─────────────────────────────────────────────────────────────────────────
section('C/D — cur-match path preserves bulk and does NOT reconstruct cur');
const liveCur = { upc: '681168301026', title: 'SeroVital X', _marker: 'THIS EXACT OBJECT', _specifics: { Type: 'Capsule' } };
setBulk([
  { upc: '681168301026', sku: 'SER-681168301026-1pk', title: 'SeroVital X', expDate: '' },
  { upc: 'OTHER-UPC', sku: 'OTH-1pk', title: 'Other product', expDate: '2027-01' }
]);
setCur(liveCur);
setReturnToFixUpc(null);
const bulkBeforeReturn = JSON.parse(JSON.stringify(getBulk()));
sandbox.psReturnAndFixExpDate('681168301026');
checkTrue('cur-match: cur is the SAME object reference (not reconstructed)', getCur()._marker === 'THIS EXACT OBJECT', JSON.stringify(getCur()));
check('cur-match: bulk array unchanged (still 2 rows, same content)', getBulk(), bulkBeforeReturn);
check('cur-match: _psReturnToFixUpc set to the target UPC', getReturnToFixUpc(), '681168301026');
checkTrue('cur-match: CSV Session overlay was hidden via closeBulk()',
  getEl('bulkOv').style.display === 'none', getEl('bulkOv').style.display);
checkTrue('cur-match: exp-toggle-btn highlighted', getEl('exp-toggle-btn').style.borderColor === '#e74c3c', getEl('exp-toggle-btn').style);
checkTrue('cur-match: exp-toggle-btn scrolled into view', !!getEl('exp-toggle-btn')._scrolledIntoView, 'not scrolled');

// ─────────────────────────────────────────────────────────────────────────
// E — rehydration path: cur was overwritten by a later scan
// ─────────────────────────────────────────────────────────────────────────
section('E — rehydration path (cur overwritten) rebuilds only what is needed');
const targetRow = {
  upc: '681168301026', sku: 'SER-681168301026-1pk', title: 'SeroVital Advanced 84 Capsules',
  price: 24.99, category: '180959', brand: 'SeroVital', location: 'Aisle 3',
  packs: 1, shade: '', mfgCode: '', expDate: '',
  photo: 'https://i.ibb.co/serovital.jpg', bundleImg: 'https://i.ibb.co/serovital.jpg',
  description: '<div>This listing includes 1 individual unit of SeroVital Advanced 84 Capsules.</div>',
  _specifics: { Type: 'Capsule', 'Item Form': 'Capsule' },
  _formationStatus: 'locked', _formationLocked: true
};
setBulk([targetRow, { upc: 'OTHER-UPC-2', sku: 'OTH2-1pk', title: 'Unrelated', expDate: '2028-05' }]);
setCur({ upc: 'SOME-OTHER-PRODUCT-SCANNED-AFTER', title: 'Different product entirely' });
setReturnToFixUpc(null);
const bulkBeforeRehydrate = JSON.parse(JSON.stringify(getBulk()));
sandbox.psReturnAndFixExpDate('681168301026');

const rehydratedCur = getCur();
checkTrue('rehydration: cur is a NEW object (not the stale different-product cur)', rehydratedCur.title !== 'Different product entirely', rehydratedCur.title);
checkTrue('rehydration: cur is flagged _psRehydrated', rehydratedCur._psRehydrated === true, rehydratedCur._psRehydrated);
check('rehydration: title preserved', rehydratedCur.title, targetRow.title);
check('rehydration: upc preserved', rehydratedCur.upc, targetRow.upc);
check('rehydration: price preserved', rehydratedCur._selectedPrice, targetRow.price);
check('rehydration: category preserved', rehydratedCur.category, targetRow.category);
check('rehydration: brand preserved', rehydratedCur.brand, targetRow.brand);
check('rehydration: location preserved', rehydratedCur.location, targetRow.location);
check('rehydration: packs preserved', rehydratedCur._selectedPack, targetRow.packs);
check('rehydration: _specifics preserved', rehydratedCur._specifics, targetRow._specifics);
check('rehydration: sku preserved (_selectedSKU)', rehydratedCur._selectedSKU, targetRow.sku);
check('rehydration: photo preserved (_bundleImg)', rehydratedCur._bundleImg, targetRow.bundleImg);
check('rehydration: expDate starts empty (the field being fixed)', rehydratedCur._expDate, '');
check('rehydration: bulk unchanged so far (nothing saved yet, just navigated)', getBulk(), bulkBeforeRehydrate);
check('rehydration: _psReturnToFixUpc set to target UPC', getReturnToFixUpc(), targetRow.upc);

// ─────────────────────────────────────────────────────────────────────────
// F — expiration field targeted/highlighted (already covered above; recheck
// explicitly for the rehydration path too)
// ─────────────────────────────────────────────────────────────────────────
section('F — expiration field highlight/scroll (rehydration path)');
checkTrue('exp-toggle-btn highlighted after rehydration return', getEl('exp-toggle-btn').style.borderColor === '#e74c3c', getEl('exp-toggle-btn').style);
checkTrue('exp-toggle-btn scrolled into view after rehydration return', !!getEl('exp-toggle-btn')._scrolledIntoView, 'not scrolled');

// ─────────────────────────────────────────────────────────────────────────
// G/H/I/J — in-place update via _doAddBulk(): no push, no duplicate, same length
// ─────────────────────────────────────────────────────────────────────────
section('G/H/I/J — _doAddBulk() updates the existing row IN PLACE');
(async () => {
  // cur-match update: employee filled in the expiration date on the live cur.
  const originalOtherRow = { upc: 'OTHER-UPC', sku: 'OTH-1pk', title: 'Other product', expDate: '2027-01', packs: 1 };
  setBulk([
    { upc: '681168301026', sku: 'SER-681168301026-1pk', title: 'SeroVital X', price: 24.99, category: '180959',
      brand: 'SeroVital', expDate: '', packs: 1, description: 'OLD DESC', photo: 'https://old.photo/x.jpg',
      bundleImg: 'https://old.photo/x.jpg', _specifics: { Type: 'Capsule' } },
    originalOtherRow
  ]);
  setCur({
    upc: '681168301026', title: 'SeroVital X', category: '180959', brand: 'SeroVital',
    _selectedTitle: 'SeroVital X', _selectedSKU: 'SER-681168301026-1pk', _selectedPrice: 24.99,
    _selectedPack: 1, _expDate: 'May 2027', _specifics: { Type: 'Capsule' }, _psRehydrated: false
  });
  setReturnToFixUpc('681168301026');

  const lenBefore = getBulk().length;
  await sandbox._doAddBulk('SeroVital X Exp 05/27', 'SER-681168301026-1pk', 24.99, '', 'May 2027', 'Aisle 3', 1, 'https://old.photo/x.jpg');

  const bulkAfter = getBulk();
  checkTrue('G: bulk.length unchanged after in-place update', bulkAfter.length === lenBefore, 'len=' + bulkAfter.length);
  const skus = bulkAfter.map(b => b.sku);
  const upcs = bulkAfter.map(b => b.upc);
  checkTrue('I: no duplicate SKU in bulk after update', new Set(skus).size === skus.length, JSON.stringify(skus));
  checkTrue('J: no duplicate UPC in bulk after update', new Set(upcs).size === upcs.length, JSON.stringify(upcs));
  const updatedRow = bulkAfter.find(b => b.upc === '681168301026');
  checkTrue('G: the SeroVital row now has an expiration date', !!updatedRow.expDate, JSON.stringify(updatedRow));
  check('N: the OTHER row is byte-identical (untouched)', bulkAfter.find(b => b.upc === 'OTHER-UPC'), originalOtherRow);
  check('_psReturnToFixUpc cleared after successful in-place update', getReturnToFixUpc(), null);
  check('array order preserved (SeroVital still at index 0)', bulkAfter[0].upc, '681168301026');

  // ── M — localStorage backup reflects the update ──
  const stored = JSON.parse(sandbox.localStorage.getItem('savvy_bulk_backup'));
  checkTrue('M: localStorage backup updated with the new expDate',
    stored.find(b => b.upc === '681168301026').expDate === updatedRow.expDate, JSON.stringify(stored));

  // ── E continued — rehydrated in-place update preserves photo/description verbatim ──
  section('E continued — rehydrated in-place update preserves photo & description verbatim');
  const rehydRow = {
    upc: '999888777', sku: 'REH-999888777-1pk', title: 'Rehydrated Product', price: 9.99, category: '31786',
    brand: 'RehydBrand', expDate: '', packs: 1,
    description: '<div>ORIGINAL DESCRIPTION — must survive verbatim</div>',
    photo: 'https://cdn.example/original.jpg', bundleImg: 'https://cdn.example/original.jpg',
    _specifics: { Color: 'Blue' }
  };
  setBulk([rehydRow]);
  setCur({
    upc: '999888777', title: 'Rehydrated Product', category: '31786', brand: 'RehydBrand',
    _selectedTitle: 'Rehydrated Product', _selectedSKU: 'REH-999888777-1pk', _selectedPrice: 9.99,
    _selectedPack: 1, _expDate: 'June 2028', _specifics: { Color: 'Blue' },
    _bundleImg: rehydRow.bundleImg, _imgUrl: rehydRow.photo,
    _psRehydrated: true   // set by psReturnAndFixExpDate() in the real rehydration path
  });
  setReturnToFixUpc('999888777');
  await sandbox._doAddBulk('Rehydrated Product Exp 06/28', 'REH-999888777-1pk', 9.99, '', 'June 2028', '', 1, 'https://cdn.example/original.jpg');
  const rehydUpdated = getBulk().find(b => b.upc === '999888777');
  check('rehydrated update: description preserved verbatim (not regenerated)', rehydUpdated.description, rehydRow.description);
  check('rehydrated update: photo preserved verbatim', rehydUpdated.photo, rehydRow.photo);
  check('rehydrated update: bundleImg preserved verbatim', rehydUpdated.bundleImg, rehydRow.bundleImg);
  checkTrue('rehydrated update: expDate did get filled in', !!rehydUpdated.expDate, rehydUpdated.expDate);
  check('rehydrated update: bulk length still 1 (no duplicate row)', getBulk().length, 1);

  // ─────────────────────────────────────────────────────────────────────
  // K — normal duplicate guard is unchanged OUTSIDE fix mode
  // ─────────────────────────────────────────────────────────────────────
  section('K — normal duplicate-UPC guard unchanged outside "Regresar y corregir"');
  const guardMatch = appSrc.match(/if \(bulk\.find\(function\(b\)\{ return b\.upc === cur\.upc; \}\) &&\s*\n\s*!\(_psReturnToFixUpc && _psReturnToFixUpc === cur\.upc\)\) \{\s*\n\s*toast\('⚠️ Already in CSV'\); return;\s*\n\s*\}/);
  checkTrue('duplicate guard source matches the expected fix-mode-aware condition', !!guardMatch, 'regex did not match — guard text may have changed');
  // Logic-level cross-check of the same condition with representative inputs.
  function guardBlocks(dupExists, fixUpc, curUpc) {
    return dupExists && !(fixUpc && fixUpc === curUpc);
  }
  checkTrue('K1: duplicate exists, no fix-mode -> blocked (normal behavior unchanged)', guardBlocks(true, null, 'X') === true);
  checkTrue('K2: duplicate exists, fix-mode for THIS upc -> allowed through', guardBlocks(true, 'X', 'X') === false);
  checkTrue('K3: duplicate exists, fix-mode for a DIFFERENT upc -> still blocked', guardBlocks(true, 'Y', 'X') === true);
  checkTrue('K4: no duplicate -> never blocked, regardless of fix-mode', guardBlocks(false, 'X', 'X') === false && guardBlocks(false, null, 'X') === false);

  // ─────────────────────────────────────────────────────────────────────
  // L — multiple failing rows: fix ONE at a time, sequential
  // ─────────────────────────────────────────────────────────────────────
  section('L — multiple failing rows corrected sequentially, one at a time');
  const rowA = { upc: 'AAA', sku: 'AAA-1pk', title: 'Product A', expDate: '', category: '180959', price: 10, packs: 1, brand: 'A', description: 'descA', photo: 'a.jpg', bundleImg: 'a.jpg', _specifics: {} };
  const rowB = { upc: 'BBB', sku: 'BBB-1pk', title: 'Product B', expDate: '', category: '180959', price: 20, packs: 1, brand: 'B', description: 'descB', photo: 'b.jpg', bundleImg: 'b.jpg', _specifics: {} };
  setBulk([rowA, rowB]);

  // Same predicate exportCSV() uses to decide which rows still fail (minus
  // the eBay-category lookup, irrelevant to this ordering test).
  function stillFailing(list) { return list.filter(it => !String(it.expDate || '').trim()); }
  check('L0: both rows initially fail validation', stillFailing(getBulk()).map(b => b.upc), ['AAA', 'BBB']);

  // First round: return-and-fix targets the FIRST failure (AAA).
  setCur({ upc: 'AAA' }); // cur-match for simplicity
  setReturnToFixUpc(null);
  sandbox.psReturnAndFixExpDate(stillFailing(getBulk())[0].upc);
  check('L1: return targets AAA (the first failure)', getReturnToFixUpc(), 'AAA');
  getCur()._expDate = 'Jan 2028';
  await sandbox._doAddBulk('Product A Exp 01/28', 'AAA-1pk', 10, '', 'Jan 2028', '', 1, 'a.jpg');
  check('L2: bulk length still 2 after fixing A', getBulk().length, 2);
  check('L3: AAA no longer fails, BBB still fails', stillFailing(getBulk()).map(b => b.upc), ['BBB']);
  check('L4: B row untouched by fixing A', getBulk().find(b => b.upc === 'BBB'), rowB);

  // Second round: next export attempt naturally retargets BBB.
  setCur({ upc: 'BBB' });
  sandbox.psReturnAndFixExpDate(stillFailing(getBulk())[0].upc);
  check('L5: return now targets BBB (the remaining failure)', getReturnToFixUpc(), 'BBB');
  getCur()._expDate = 'Feb 2028';
  await sandbox._doAddBulk('Product B Exp 02/28', 'BBB-1pk', 20, '', 'Feb 2028', '', 1, 'b.jpg');
  check('L6: bulk length still 2 after fixing B', getBulk().length, 2);
  check('L7: no rows fail validation anymore', stillFailing(getBulk()), []);
  checkTrue('L8: no duplicate rows were created across both fixes', getBulk().length === 2 &&
    new Set(getBulk().map(b => b.upc)).size === 2, JSON.stringify(getBulk().map(b => b.upc)));

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 9 — REAL SEROVITAL FIXTURE (UPC 681168301026 / SER-681168301026-1pk)
  // Ties the "Regresar y corregir" flow together with the classifier fix
  // already on this branch: after the full workflow, C:Type must still be
  // Capsule, never Face Cream.
  // ─────────────────────────────────────────────────────────────────────
  section('SECTION 9 — real SeroVital fixture: full EXPORT -> Regresar y corregir -> ADD TO CSV workflow');

  const SEROVITAL_TITLE = 'SeroVital Advanced Anti-Aging Renewal Complex 84 Capsules';
  const serovitalRow = {
    upc: '681168301026', sku: 'SER-681168301026-1pk', title: SEROVITAL_TITLE,
    price: 39.99, category: '180959', brand: 'SeroVital', location: 'Aisle 5',
    packs: 1, shade: '', mfgCode: '', expDate: '',   // <- missing, blocks export
    photo: 'https://i.ibb.co/serovital-real.jpg', bundleImg: 'https://i.ibb.co/serovital-real.jpg',
    description: '<div>This listing includes 1 individual unit of SeroVital Advanced Anti-Aging Renewal Complex 84 Capsules.</div>',
    _specifics: { Type: 'Capsule', 'Item Form': 'Capsule', Formulation: 'Capsule' },
    _formationStatus: 'locked', _formationLocked: true
  };
  // Row already in CSV Session (as stated in the approved scope) — CSV count is 1.
  setBulk([serovitalRow]);
  check('9.0: CSV Session starts with exactly 1 row (SER-681168301026-1pk)', getBulk().length, 1);

  // EXPORT -> validation blocks on the missing expiration -> modal shown.
  setCur({ upc: 'SOME-PRODUCT-SCANNED-AFTER-ADDING-SEROVITAL' }); // simulate employee scanned something else meanwhile
  setReturnToFixUpc(null);
  sandbox.psShowExpBlockedModal([serovitalRow]);
  const serovitalModal = documentStub.body._lastAppended;
  checkTrue('9.1: EXPORT DETENIDO modal shown for SER-681168301026-1pk', serovitalModal.innerHTML.includes('SER-681168301026-1pk'), serovitalModal.innerHTML);

  // ← Regresar y corregir -> returns to the SAME SeroVital editor (rehydrated,
  // since cur had moved on to a different product) -> scrolls to Expiration Date.
  documentStub.getElementById('expBlockReturnBtn').click();
  const serovitalCur = getCur();
  checkTrue('9.2: returned to the SAME SeroVital product (rehydrated)', serovitalCur.upc === '681168301026' && serovitalCur.title === SEROVITAL_TITLE, JSON.stringify(serovitalCur));
  checkTrue('9.3: scrolled/highlighted to Expiration Date', getEl('exp-toggle-btn').style.borderColor === '#e74c3c' && !!getEl('exp-toggle-btn')._scrolledIntoView, 'not highlighted/scrolled');
  check('9.4: bulk still has exactly 1 row (nothing removed/duplicated by navigating)', getBulk().length, 1);

  // Employee enters the expiration date.
  serovitalCur._expDate = 'Aug 2027';

  // ADD TO CSV -> existing SER-681168301026-1pk row UPDATED, not duplicated.
  await sandbox._doAddBulk(SEROVITAL_TITLE + ' Exp 08/27', 'SER-681168301026-1pk', 39.99, '', 'Aug 2027', 'Aisle 5', 1, serovitalRow.photo);
  check('9.5: CSV count remains 1 after ADD TO CSV (updated, not appended)', getBulk().length, 1);
  const serovitalUpdated = getBulk()[0];
  check('9.6: same SKU, same UPC — no duplicate row', { sku: serovitalUpdated.sku, upc: serovitalUpdated.upc }, { sku: 'SER-681168301026-1pk', upc: '681168301026' });
  checkTrue('9.7: expiration date now present', !!serovitalUpdated.expDate, serovitalUpdated.expDate);
  check('9.8: description preserved verbatim (rehydrated path)', serovitalUpdated.description, serovitalRow.description);
  check('9.9: photo/bundleImg preserved verbatim', [serovitalUpdated.photo, serovitalUpdated.bundleImg], [serovitalRow.photo, serovitalRow.bundleImg]);
  check('9.10: _specifics preserved (Type/Item Form/Formulation = Capsule)', serovitalUpdated._specifics, serovitalRow._specifics);

  // Export would now succeed: re-run the same validation predicate exportCSV() uses.
  function stillFailingExp(list) { return list.filter(it => !String(it.expDate || '').trim()); }
  check('9.11: export validation no longer blocks (no rows missing expiration)', stillFailingExp(getBulk()), []);

  // CLASSIFIER TIE-IN — C:Type must remain Capsule, never Face Cream, for
  // this exact SeroVital title (the fix from the earlier approved work on
  // this same branch). detectType() is declared INSIDE exportCSV(), so it
  // isn't reachable as sandbox.detectType — extract it (and its free-
  // variable dependencies) the same way test-classifier-type-category.js
  // already does, and eval() them into THIS scope so detectType's own
  // references to CAT_TYPE/PS_TOY_CATS/etc. resolve normally.
  function extractFn(name) {
    const i = appSrc.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('function not found: ' + name);
    let d = 0, started = false;
    for (let j = i; j < appSrc.length; j++) {
      if (appSrc[j] === '{') { d++; started = true; }
      else if (appSrc[j] === '}') { d--; if (started && d === 0) return appSrc.slice(i, j + 1); }
    }
    throw new Error('unbalanced braces for ' + name);
  }
  function extractVar(name) {
    const i = appSrc.indexOf('var ' + name + ' = {');
    if (i < 0) throw new Error('var not found: ' + name);
    let d = 0, started = false;
    for (let j = i; j < appSrc.length; j++) {
      if (appSrc[j] === '{') { d++; started = true; }
      else if (appSrc[j] === '}') { d--; if (started && d === 0) return appSrc.slice(i, j + 2); }
    }
    throw new Error('unbalanced braces for var ' + name);
  }
  eval(extractVar('CAT_TYPE'));
  const foodTypesMatch = appSrc.match(/var PS_FOOD_TYPES = (\[[\s\S]*?\]);/);
  const beautyTypesMatch = appSrc.match(/var PS_TOPICAL_BEAUTY_TYPES = (\[[^\]]*\]);/);
  eval('var PS_FOOD_TYPES = ' + foodTypesMatch[1] + ';');
  eval('var PS_TOPICAL_BEAUTY_TYPES = ' + beautyTypesMatch[1] + ';');
  eval(extractFn('detectType'));
  const serovitalType = detectType('180959', SEROVITAL_TITLE);
  check('9.12: C:Type for SeroVital title is Capsule', serovitalType, 'Capsule');
  checkTrue('9.13: C:Type is NEVER Face Cream', serovitalType !== 'Face Cream', serovitalType);

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
