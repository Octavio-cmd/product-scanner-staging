#!/usr/bin/env node
/**
 * EXISTING PRODUCT DETECTION ACROSS ALL SELLBRITE PACKS — PHASE 1
 * (Implementación #19)
 *
 * Real cases:
 *   IRW  — attempted IRW-710363598525-1pk; Sellbrite/eBay already had the
 *          legacy SKU IRW-710363598525-2 (no "pk"). eBay rejected the Add
 *          with 21919067 (duplicate listing).
 *   NAT  — attempted NAT-031604004033-1pk; NAT-031604004033-2pk existed with
 *          quantity 0. eBay still rejected the Add with 21919067.
 *   EUC  — EUC-072140041298-5pk got 21919067 with NO listing found by UPC.
 *          Unexplained — intentionally NOT solved or blocked here.
 *
 * Phase 1 behavior under test:
 *   - one parser (psParseSellbritePack) for PREFIX-UPC-Npk / -NPK / -N,
 *     anchored to the full UPC and the SKU tail, packs 1-12 only;
 *   - every same-UPC Sellbrite listing is shown in an
 *     "EXISTING PRODUCT FOUND" warning (quantity 0 included);
 *   - SAME pack → auto-excluded from Bulk Split (legacy and modern SKUs);
 *   - DIFFERENT pack → warning only, never excluded;
 *   - Investigación #5 return-to-fix protection unchanged.
 *
 * Runs the REAL psCheckSellbrite(), toggleSplitPack(), updateSplitCalc(),
 * addSplitPacksToCSV(), makeSKU() from app.js. Only fetch() (/sb/search,
 * /ss/location) is mocked.
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

// Controllable /sb/search response: a list of Sellbrite products exactly as
// the backend returns them ({ sku, name, inventory }). sbCalls counts hits.
let sbConfig = { products: [] };
let sbCalls = 0;
const sandbox = {
  console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
  document: documentStub, localStorage: storage, sessionStorage: storage,
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, mediaDevices: {} },
  location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload() {} },
  fetch: async (url) => {
    const u = String(url);
    if (u.indexOf('/sb/search') >= 0) {
      sbCalls++;
      if (!sbConfig.products.length) return { ok: false, status: 404, json: async () => ({ status: 'not_found', products: [] }) };
      const products = JSON.parse(JSON.stringify(sbConfig.products));
      return { ok: true, status: 200, json: async () => ({ status: 'success', products: products }) };
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

const REQUIRED = ['psCheckSellbrite', 'psParseSellbritePack', 'psSkuHasUpc', 'toggleSplitPack', 'updateSplitCalc', 'addSplitPacksToCSV', 'makeSKU'];
REQUIRED.forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

const DEFAULT_ACTIVE = { 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true };
const ALL_ON = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true };
function prod(sku, qty) {
  // Backend /sb/search shape. qty === undefined → inventory not available.
  if (qty === undefined) return { sku: sku, name: sku, inventory: {} };
  return { sku: sku, name: sku, inventory: { found: true, total_quantity: qty, total_on_hand: qty, channels: [] } };
}
function getListings() { return vm.runInContext('window._psSbExistingListings', sandbox); }
function statusHtml() { return getEl('ps-sellbrite-status').innerHTML; }
async function scan(upc, brand, products, active, rtf) {
  setRTF(rtf ? rtf.upc : null, rtf ? rtf.sku : null);
  setSplitActive(Object.assign({}, active || DEFAULT_ACTIVE));
  sbConfig.products = products;
  getEl('ps-sellbrite-status').innerHTML = '';
  await sandbox.psCheckSellbrite(upc, brand);
}
const parse = (sku, upc) => sandbox.psParseSellbritePack(sku, upc);

const IRW_UPC = '710363598525', NAT_UPC = '031604004033', EUC_UPC = '072140041298';

function fnSource(src, name) {
  const m = new RegExp('(?:async )?function ' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  let d = 0;
  for (let j = src.indexOf('{', m.index); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(m.index, j + 1); }
  }
  return null;
}
const sha = (s) => require('crypto').createHash('sha256').update(s || '').digest('hex').slice(0, 16);

(async () => {

section('1 — LEGACY "-N" PARSING');
check('IRW-710363598525-2 → 2', parse('IRW-710363598525-2', IRW_UPC), 2);
check('NAT-031604004033-2 → 2', parse('NAT-031604004033-2', NAT_UPC), 2);
check('IRW-710363598525-12 → 12', parse('IRW-710363598525-12', IRW_UPC), 12);
check('lowercase/space tolerant: " irw-710363598525-3 " → 3', parse(' irw-710363598525-3 ', IRW_UPC), 3);

section('2 — MODERN "-Npk" PARSING');
check('NAT-031604004033-2pk → 2', parse('NAT-031604004033-2pk', NAT_UPC), 2);
check('IRW-710363598525-12pk → 12', parse('IRW-710363598525-12pk', IRW_UPC), 12);
check('makeSKU() output parses back to its own pack (6)', parse(sandbox.makeSKU('Nature Made', NAT_UPC, 6, ''), NAT_UPC), 6);

section('3 — UPPERCASE "-NPK"');
check('NAT-031604004033-2PK → 2', parse('NAT-031604004033-2PK', NAT_UPC), 2);
check('NAT-031604004033-2 PK → 2 (legacy \\s* tolerance kept)', parse('NAT-031604004033-2 PK', NAT_UPC), 2);

section('4 — PACKS 1-12 (both formats)');
for (let p = 1; p <= 12; p++) {
  check(`-${p}pk → ${p}`, parse(`NAT-${NAT_UPC}-${p}pk`, NAT_UPC), p);
  check(`-${p} → ${p}`, parse(`NAT-${NAT_UPC}-${p}`, NAT_UPC), p);
}

section('5 — OUT-OF-RANGE / NON-PACK NEGATIVES');
for (const bad of ['-0', '-13', '-20pk', '-0pk', '-13PK', '-02', '-99', '-100pk']) {
  check(`NAT-${NAT_UPC}${bad} → null`, parse(`NAT-${NAT_UPC}${bad}`, NAT_UPC), null);
}
check('no pack tail: NAT-031604004033 → null', parse('NAT-031604004033', NAT_UPC), null);
check('unrelated suffix: NAT-031604004033-2-B → null', parse('NAT-031604004033-2-B', NAT_UPC), null);
check('unrelated suffix: NAT-031604004033-LOT2 → null', parse('NAT-031604004033-LOT2', NAT_UPC), null);
check('digits inside UPC never read as pack: NAT-03160400403-3 (UPC truncated) → null', parse('NAT-03160400403-3', NAT_UPC), null);
check('UPC tail digit not a pack: "NAT-031604004033" with upc ending "3" → null', parse('NAT-031604004033', NAT_UPC), null);
check('pack must follow "UPC-": NAT-031604004033X-2 → null', parse('NAT-031604004033X-2', NAT_UPC), null);
{
  await scan(NAT_UPC, 'Nature Made', [prod('NAT-' + NAT_UPC + '-13'), prod('NAT-' + NAT_UPC + '-20pk'), prod('NAT-' + NAT_UPC + '-0')], ALL_ON);
  check('out-of-range SKUs mark no pack existing', getSbExisting(), {});
  check('out-of-range SKUs exclude nothing', getSplitActive(), ALL_ON);
}

section('6 — WRONG UPC NEGATIVES');
check('IRW-999999999999-2 does not parse for 710363598525', parse('IRW-999999999999-2', IRW_UPC), null);
check('NAT-999999999999-2pk does not parse for 031604004033', parse('NAT-999999999999-2pk', NAT_UPC), null);
check('longer GTIN containing the UPC (0710363598525-2) does not match', parse('IRW-0710363598525-2', IRW_UPC), null);
checkTrue('psSkuHasUpc rejects 0710363598525 for 710363598525', !sandbox.psSkuHasUpc('IRW-0710363598525-2', IRW_UPC));
{
  await scan(IRW_UPC, 'Irwin Naturals', [prod('IRW-999999999999-2', 5), prod('NAT-999999999999-2pk', 0)], ALL_ON);
  check('wrong-UPC products: no pack marked existing', getSbExisting(), {});
  check('wrong-UPC products: not in existing-product listings', getListings(), []);
  checkTrue('wrong-UPC products: no EXISTING PRODUCT warning', statusHtml().indexOf('EXISTING PRODUCT FOUND') === -1, statusHtml().slice(0, 200));
  check('wrong-UPC products: nothing excluded', getSplitActive(), ALL_ON);
}

section('7 — IRW REAL FIXTURE (legacy IRW-710363598525-2, qty 1)');
{
  await scan(IRW_UPC, 'Irwin Naturals', [prod('IRW-710363598525-2', 1)], ALL_ON);
  check('recognized as same UPC, parsed pack 2', getListings(), [{ sku: 'IRW-710363598525-2', pack: 2, qty: 1 }]);
  check('_psSbExisting[2] = true', !!getSbExisting()[2], true);
  check('_splitActive[2] = false (same pack auto-excluded)', getSplitActive()[2], false);
  check('_splitActive[1] = true (pack 1 NOT blocked)', getSplitActive()[1], true);
  const h = statusHtml();
  checkTrue('warning shows "EXISTING PRODUCT FOUND"', h.indexOf('EXISTING PRODUCT FOUND') !== -1, h.slice(0, 300));
  checkTrue('warning lists SKU IRW-710363598525-2', h.indexOf('IRW-710363598525-2') !== -1);
  checkTrue('warning shows Pack: 2', h.indexOf('Pack: 2') !== -1);
  checkTrue('warning shows Sellbrite Qty: 1', h.indexOf('Sellbrite Qty: 1') !== -1);
  checkTrue('warning mentions possible eBay duplicate / other pack', /duplicado en eBay/.test(h) && /otro pack/.test(h));
  checkTrue('warning does NOT claim an eBay status', !/Active on eBay|Activo en eBay|eBay Out of Stock/i.test(h));
  checkTrue('warning says the data is Sellbrite-only', /Datos de Sellbrite solamente/.test(h));
}

section('8 — NAT REAL FIXTURE (NAT-031604004033-2pk, qty 0)');
{
  await scan(NAT_UPC, 'Nature Made', [prod('NAT-031604004033-2pk', 0)], ALL_ON);
  check('parsed pack 2, qty 0 preserved', getListings(), [{ sku: 'NAT-031604004033-2pk', pack: 2, qty: 0 }]);
  check('_splitActive[2] = false', getSplitActive()[2], false);
  check('_splitActive[1] = true (not blocked)', getSplitActive()[1], true);
  const h = statusHtml();
  checkTrue('displayed even with qty 0', h.indexOf('NAT-031604004033-2pk') !== -1);
  checkTrue('labeled "SIN STOCK EN SELLBRITE / EXISTING PRODUCT FOUND"', h.indexOf('SIN STOCK EN SELLBRITE / EXISTING PRODUCT FOUND') !== -1, h.slice(0, 300));
  checkTrue('shows "Sellbrite Qty: 0" (not an eBay out-of-stock claim)', h.indexOf('Sellbrite Qty: 0') !== -1 && !/eBay Out of Stock/i.test(h));
  // backend "sin_inventario" shape (product.quantity 0, no inventory row) is also a real 0
  await scan(NAT_UPC, 'Nature Made', [{ sku: 'NAT-031604004033-2pk', name: 'x', inventory: { source: 'sin_inventario', channels: [{ available: 0 }] } }], ALL_ON);
  check('backend "sin_inventario" → qty 0', getListings()[0].qty, 0);
  // inventory not returned at all → unknown, never invented
  await scan(NAT_UPC, 'Nature Made', [prod('NAT-031604004033-2pk')], ALL_ON);
  check('inventory missing → qty null (shown as "desconocida")', getListings()[0].qty, null);
  checkTrue('"Sellbrite Qty: desconocida" shown', statusHtml().indexOf('Sellbrite Qty: desconocida') !== -1);
}

section('9 — MULTIPLE MATCHES RETURNED (-1pk, -2, -6pk, -12)');
const MULTI = ['NAT-' + NAT_UPC + '-1pk', 'NAT-' + NAT_UPC + '-2', 'NAT-' + NAT_UPC + '-6pk', 'NAT-' + NAT_UPC + '-12'];
{
  await scan(NAT_UPC, 'Nature Made', MULTI.map((s, i) => prod(s, i)), ALL_ON);
  const l = getListings();
  check('all four listings kept', l.map(x => x.sku), MULTI);
  check('packs parsed 1,2,6,12', l.map(x => x.pack), [1, 2, 6, 12]);
  const h = statusHtml();
  MULTI.forEach(s => checkTrue(`warning shows ${s}`, h.indexOf(s) !== -1));
  checkTrue('warning counts 4 listings', h.indexOf('4 listados') !== -1);
}

section('10 — NO FIRST-MATCH-ONLY BEHAVIOR');
{
  check('_psSbExisting has 1,2,6,12 (not only the first)', Object.keys(getSbExisting()).map(Number).sort((a, b) => a - b), [1, 2, 6, 12]);
  // Same SKU twice (e.g. found through two lookup paths) → listed once
  await scan(NAT_UPC, 'Nature Made', [prod('NAT-' + NAT_UPC + '-2pk', 0), prod('nat-' + NAT_UPC + '-2PK', 0)], ALL_ON);
  check('duplicate SKU (case-insensitive) listed once', getListings().length, 1);
}

section('11 — SAME-PACK AUTO-EXCLUSION (legacy + modern, each independently)');
{
  await scan(NAT_UPC, 'Nature Made', MULTI.map(s => prod(s, 3)), ALL_ON);
  const a = getSplitActive();
  check('1,2,6,12 excluded; 3,4,5,7,8,9,10,11 untouched',
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(p => a[p]),
    [false, false, true, true, true, false, true, true, true, true, true, false]);
  for (const [sku, p] of [['IRW-' + IRW_UPC + '-4', 4], ['IRW-' + IRW_UPC + '-4pk', 4], ['IRW-' + IRW_UPC + '-4PK', 4]]) {
    await scan(IRW_UPC, 'Irwin Naturals', [prod(sku, 2)], ALL_ON);
    check(`${sku}: pack ${p} excluded`, getSplitActive()[p], false);
  }
}

section('12 — DIFFERENT-PACK = WARNING ONLY (never excluded, still reaches CSV)');
{
  setSplitManual({});
  await scan(IRW_UPC, 'Irwin Naturals', [prod('IRW-710363598525-2', 1)], { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false });
  check('pack 1 stays active', getSplitActive()[1], true);
  check('pack 2 excluded', getSplitActive()[2], false);
  checkTrue('warning present for the different-pack case', statusHtml().indexOf('EXISTING PRODUCT FOUND') !== -1);
  getEl('split-calc-card').dataset.tier = 'media';
  getEl('split-total-input').value = '10';
  getEl('split-weight-lb').value = '0';
  getEl('split-weight-oz').value = '8';
  setSplitManual({ 1: 5 });
  setBulk([]);
  setCur({
    upc: IRW_UPC, brand: 'Irwin Naturals', title: 'Irwin Naturals Dual-Action Testosterone-Extra Fat Burner 60 Softgels',
    category: '180959', _description: 'Full description already generated.',
    _specifics: { Formulation: 'Softgel', 'Item Form': 'Softgel' },
    _shade: '', _expDate: 'Oct 2028', location: '',
    _bundleImg: 'https://cdn.example/irw.jpg', ebay: { prices: { low: 20.00, avg: 25.00 } },
    _packImages: { 1: { front: 'https://cdn.example/irw-1pk.jpg' } }
  });
  const ok = await sandbox.addSplitPacksToCSV();
  const skus = getBulk().map(b => b.sku);
  checkTrue('addSplitPacksToCSV() succeeded', ok === true, ok);
  check('CSV contains IRW-710363598525-1pk (different pack NOT blocked)', skus, ['IRW-710363598525-1pk']);
  check('no 2pk row generated', skus.indexOf('IRW-710363598525-2pk'), -1);
}

section('13 — MANUAL RE-INCLUDE PRESERVED (legacy SKU)');
{
  await scan(IRW_UPC, 'Irwin Naturals', [prod('IRW-710363598525-2', 1)], ALL_ON);
  check('2 excluded after scan', getSplitActive()[2], false);
  sandbox.toggleSplitPack(2);
  check('toggleSplitPack(2) re-includes pack 2', getSplitActive()[2], true);
}

section('14 — updateSplitCalc() DOES NOT REACTIVATE EXCLUDED PACKS');
{
  await scan(NAT_UPC, 'Nature Made', MULTI.map(s => prod(s, 0)), ALL_ON);
  getEl('split-total-input').value = '1000';
  getEl('split-weight-lb').value = '0';
  getEl('split-weight-oz').value = '8';
  sandbox.updateSplitCalc();
  sandbox.updateSplitCalc();
  const a = getSplitActive();
  check('1,2,6,12 still excluded after two recalculations', [a[1], a[2], a[6], a[12]], [false, false, false, false]);
}

section('15 — RETURN-TO-FIX PROTECTION, LEGACY SKU');
{
  const preserved = { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  setSplitManual({ 2: 7 });
  await scan(IRW_UPC, 'Irwin Naturals', [prod('IRW-710363598525-2', 1)], preserved, { upc: IRW_UPC, sku: 'IRW-710363598525-2pk' });
  check('_psSbExisting[2] still recorded (informational)', !!getSbExisting()[2], true);
  check('splitActive NOT mutated', getSplitActive(), preserved);
  check('splitManual NOT mutated', getSplitManual(), { 2: 7 });
  checkTrue('warning still shown (informational)', statusHtml().indexOf('EXISTING PRODUCT FOUND') !== -1);
}

section('16 — RETURN-TO-FIX PROTECTION, MODERN SKU');
{
  const preserved = { 1: true, 2: true, 3: false, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  setSplitManual({ 1: 3, 6: 1 });
  await scan(NAT_UPC, 'Nature Made', [prod('NAT-' + NAT_UPC + '-2pk', 0), prod('NAT-' + NAT_UPC + '-6PK', 0)], preserved, { upc: NAT_UPC, sku: 'NAT-' + NAT_UPC + '-6pk' });
  check('_psSbExisting 2 and 6 recorded', [!!getSbExisting()[2], !!getSbExisting()[6]], [true, true]);
  check('splitActive NOT mutated', getSplitActive(), preserved);
  check('splitManual NOT mutated', getSplitManual(), { 1: 3, 6: 1 });
  // a normal scan of a DIFFERENT upc is not protected by this return-to-fix
  await scan(IRW_UPC, 'Irwin Naturals', [prod('IRW-710363598525-2', 1)], ALL_ON, { upc: NAT_UPC, sku: 'NAT-' + NAT_UPC + '-6pk' });
  check('return-to-fix for another UPC does not protect this scan: pack 2 excluded', getSplitActive()[2], false);
}

section('17 — #9 SELLBRITE MATRIX REGRESSION (makeSKU output, packs 1-12)');
for (let p = 1; p <= 12; p++) {
  const s = sandbox.makeSKU('Nature Made', '031604028435', p, 'Nature Made Vitamin C Gummies');
  await scan('031604028435', 'Nature Made', [prod(s)], ALL_ON);
  check(`pack ${p}: recorded + excluded`, [!!getSbExisting()[p], getSplitActive()[p]], [true, false]);
}
checkTrue('#9 source guard kept: PACK_SIZES check line present',
  /if \(PACK_SIZES\.indexOf\(pn\) !== -1\) sbExisting\[pn\] = true;/.test(appSrc));
checkTrue('old PK-only regex removed from psCheckSellbrite',
  (fnSource(appSrc, 'psCheckSellbrite') || '').indexOf("match(/-(\\d+)\\s*PK$/)") === -1);

section('18 — PRICING UNCHANGED');
check('calcBundlePrice() byte-identical to base 53b5994', sha(fnSource(appSrc, 'calcBundlePrice')), 'd56265fdf8c804e4');
check('computeSplit() byte-identical to base', sha(fnSource(appSrc, 'computeSplit')), 'b729a2b0e1211f1a');
check('addSplitPacksToCSV() byte-identical to base', sha(fnSource(appSrc, 'addSplitPacksToCSV')), '83da9fd221c58ef5');
check('updateSplitCalc() byte-identical to base', sha(fnSource(appSrc, 'updateSplitCalc')), '2db0a5bc890a3021');
{
  const row = getBulk().find(b => b.sku === 'IRW-710363598525-1pk');
  check('IRW 1pk price from section 12 = (low 20 * 1 * 0.88).toFixed(2), same formula as #9', row && row.price, (20 * 1 * 0.88).toFixed(2));
}

section('19 — CSV GENERATION UNCHANGED');
check('exportCSV() byte-identical to base 53b5994', sha(fnSource(appSrc, 'exportCSV')), '3b2558c7421eb3fd');
check('makeSKU() byte-identical to base', sha(fnSource(appSrc, 'makeSKU')), 'a9b61f94bc5cbbeb');
check('toggleSplitPack() byte-identical to base', sha(fnSource(appSrc, 'toggleSplitPack')), '3ac3e89b406a5c22');

section('20 — EUC INTENTIONALLY NOT SOLVED / NOT BLOCKED');
{
  const before = sbCalls;
  await scan(EUC_UPC, 'Eucerin', [], ALL_ON);
  check('EUC: Sellbrite not found → nothing excluded', getSplitActive(), ALL_ON);
  check('EUC: no existing listings recorded', getListings(), []);
  checkTrue('EUC: no EXISTING PRODUCT warning invented', statusHtml().indexOf('EXISTING PRODUCT FOUND') === -1);
  check('EUC: exactly one /sb/search call (no extra lookups added)', sbCalls - before, 1);
  checkTrue('no eBay seller API added (Trading / Inventory / seller OAuth)',
    !/GetMyeBaySelling|GetSellerList|sell\/inventory|X-EBAY-API-CALL-NAME|auth\/oauth2\/authorize/.test(appSrc));
}

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}`));
}
process.exit(failed ? 1 : 0);

})();
