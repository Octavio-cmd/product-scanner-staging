#!/usr/bin/env node
/**
 * SELLBRITE + SELLER-OWNED EBAY EXISTING-PRODUCT DETECTION — PHASE 2
 * (Implementación #20B)
 *
 * Production facts this suite encodes (GET /ebay/seller-listings, Trading API):
 *   IRW  336777212657  IRW-710363598525-2    Active  available 1   (endpoint count 3)
 *   NAT  NAT-031604004033-1 / -2pk           Active  available 0   (endpoint count 4)
 *   EUC  237086232118  EUC-072140041298-5pk  Active  available 1   (count 1; Sellbrite/Seller Hub: nothing)
 *   SOL  336809282498  SOL-033984023192-2pk  Active  available 2   (count 3; Sellbrite: "No existe")
 * Only the known listings above are real; the extra listings used to reach
 * the production counts are SYNTHETIC and marked as such.
 *
 * Runs the REAL psCheckSellbrite(), psCheckEbaySellerListings(),
 * toggleSplitPack(), updateSplitCalc(), addSplitPacksToCSV() and the real
 * psAuthFetch() from app.js. Only fetch() is mocked.
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

// Controllable responses. Each entry can be an object (immediate) or a
// function returning a Promise (to deliver a response late / out of order).
let sbConfig = { products: [] };
let ebConfig = { mode: 'ok', listings: [] };   // ok | http502 | http503 | network
let sbCalls = [], ebCalls = [], otherCalls = [];
function jsonRes(status, body) { return { ok: status >= 200 && status < 300, status: status, json: async () => JSON.parse(JSON.stringify(body)) }; }
function sbResponse() {
  if (!sbConfig.products.length) return jsonRes(404, { status: 'not_found', products: [] });
  return jsonRes(200, { status: 'success', products: sbConfig.products });
}
function ebResponse(u) {
  const upc = (u.match(/upc=(\d+)/) || [])[1];
  if (ebConfig.mode === 'network') throw new TypeError('Failed to fetch');
  if (ebConfig.mode === 'http502') return jsonRes(502, { status: 'error', error: 'ebay_trading_error', source: 'ebay_trading' });
  if (ebConfig.mode === 'http503') return jsonRes(503, { status: 'error', error: 'seller_auth_unavailable', source: 'ebay_trading' });
  return jsonRes(200, { status: 'success', source: 'ebay_trading', upc: upc, count: ebConfig.listings.length, listings: ebConfig.listings });
}
// #21D: GET /sb/inventory?sku= answers from the same fixture products (one
// warehouse). A numeric total -> confirmed; the backend "sin_inventario" shape
// with a 0 row -> confirmed 0; no inventory at all -> found:false (unknown).
function invFromFixture(products, sku) {
  const p = (products || []).find(x => x.sku === sku);
  const inv = (p && p.inventory) || {};
  let q;
  if (typeof inv.total_quantity === 'number') q = inv.total_quantity;
  else if (inv.source === 'sin_inventario' && (inv.channels || []).length) q = Number(inv.channels[0].available) || 0;
  if (q === undefined) return { status: 'success', sku, inventory: { total_quantity: 0, total_on_hand: 0, channels: [], warehouses: [], found: false } };
  const ch = [{ warehouse_uuid: 'wh-1', warehouse_name: 'Main', available: q, on_hand: q, bin_location: '' }];
  return { status: 'success', sku, inventory: { total_quantity: q, total_on_hand: q, channels: ch, warehouses: ch, found: true, available_confirmed: true } };
}
// #21D: in the browser the warning slot lives INSIDE #ps-sellbrite-status, so
// reading the status element shows the slot's current content. The stub keeps
// them as separate objects; this getter restores that DOM relationship.
function linkStatusSlot(getEl, sandbox) {
  const st = getEl('ps-sellbrite-status');
  const PRE = '<div id="ps-existing-product-slot">';
  let raw = '', tail = null;
  Object.defineProperty(st, 'innerHTML', {
    configurable: true,
    get() {
      if (tail === null) return raw;
      return PRE + getEl('ps-existing-product-slot').innerHTML + '</div>' + tail;
    },
    set(v) {
      raw = String(v); tail = null;
      if (raw.startsWith(PRE)) {
        let w = '';
        try { w = sandbox.psCombinedExistingWarningHtml(); } catch (e) { w = null; }
        if (w !== null && raw.startsWith(PRE + w + '</div>')) {
          tail = raw.slice((PRE + w + '</div>').length);
          getEl('ps-existing-product-slot').innerHTML = w;
        }
      }
    }
  });
}
const sandbox = {
  console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
  document: documentStub, localStorage: storage, sessionStorage: storage,
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, mediaDevices: {} },
  location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload() {} },
  fetch: async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    if (u.indexOf('/sb/search') >= 0) { sbCalls.push({ u, method }); return (typeof sbConfig.defer === 'function') ? sbConfig.defer(u) : sbResponse(); }
    if (u.indexOf('/ebay/seller-listings') >= 0) { ebCalls.push({ u, method, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization') }); return (typeof ebConfig.defer === 'function') ? ebConfig.defer(u) : ebResponse(u); }
    if (u.indexOf('/sb/inventory') >= 0) return jsonRes(200, invFromFixture(sbConfig.products, decodeURIComponent((u.match(/sku=([^&]+)/) || [])[1] || '')));
    otherCalls.push({ u, method });
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
linkStatusSlot(getEl, sandbox);
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

const DEFAULT_ACTIVE = { 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true };
const ALL_ON = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true };
const IRW = '710363598525', NAT = '031604004033', EUC = '072140041298', SOL = '033984023192';
function sbProd(sku, qty) { return { sku: sku, name: sku, inventory: { found: true, total_quantity: qty, total_on_hand: qty, channels: [] } }; }
function ebL(id, sku, avail, upc, status, extra) {
  return Object.assign({ item_id: id, sku: sku, title: 'T ' + sku, pack: null, listing_status: status || 'Active',
    quantity: avail, quantity_sold: 0, quantity_available: avail, upc: upc, start_time: '', end_time: '', match: 'sku_upc+ebay_upc' }, extra || {});
}
function eb() { return vm.runInContext('window._psEbSeller', sandbox); }
function ebEx() { return vm.runInContext('window._psEbExisting', sandbox); }
function sbList() { return vm.runInContext('window._psSbExistingListings', sandbox); }
function slot() { return getEl('ps-existing-product-slot').innerHTML; }
function reset(active, rtf) {
  setRTF(rtf ? rtf.upc : null, rtf ? rtf.sku : null);
  setSplitActive(Object.assign({}, active || ALL_ON));
  setSplitManual({});
  getEl('ps-sellbrite-status').innerHTML = ''; getEl('ps-existing-product-slot').innerHTML = '';
  sbCalls = []; ebCalls = []; otherCalls = [];
  sbConfig = { products: [] }; ebConfig = { mode: 'ok', listings: [] };
}
async function scan(upc, brand, title, sbProducts, ebListingsOrMode, opts) {
  opts = opts || {};
  reset(opts.active, opts.rtf);
  setCur({ upc: upc, brand: brand, title: title || brand });
  sbConfig.products = sbProducts || [];
  if (typeof ebListingsOrMode === 'string') ebConfig.mode = ebListingsOrMode; else ebConfig.listings = ebListingsOrMode || [];
  await Promise.all([sandbox.psCheckSellbrite(upc, brand), sandbox.psCheckEbaySellerListings(upc, brand, title || brand)]);
}
const act = () => getSplitActive();

(async () => {
['psCheckEbaySellerListings', 'psCombinedExistingWarningHtml', 'psExistingGroups', 'psSkuPrefixFor', 'psCheckSellbrite', 'psAuthFetch']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('PREFIX — reuses makeSKU() (no second algorithm)');
check('Irwin Naturals → IRW', sandbox.psSkuPrefixFor('Irwin Naturals', IRW, ''), 'IRW');
check('Nature Made → NAT', sandbox.psSkuPrefixFor('Nature Made', NAT, ''), 'NAT');
check('Eucerin → EUC', sandbox.psSkuPrefixFor('Eucerin', EUC, ''), 'EUC');
check('Solgar → SOL', sandbox.psSkuPrefixFor('Solgar', SOL, ''), 'SOL');
check('prefix == makeSKU() prefix', sandbox.psSkuPrefixFor('Solgar', SOL, ''), sandbox.makeSKU('Solgar', SOL, 2, '').split('-')[0]);

section('1 — eBay-only match');
await scan(EUC, 'Eucerin', '', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
checkTrue('EXISTING PRODUCT FOUND shown', slot().includes('EXISTING PRODUCT FOUND'), slot().slice(0, 200));
checkTrue('EBAY section, no SELLBRITE rows', slot().includes('EBAY · Item ID') && !slot().includes('SELLBRITE ·'));
checkTrue('"No existe en Sellbrite todavía" still shown below', getEl('ps-sellbrite-status').innerHTML.includes('No existe en Sellbrite todavía'));

section('2 — Sellbrite-only match');
await scan(IRW, 'Irwin Naturals', '', [sbProd('IRW-710363598525-2', 1)], []);
checkTrue('Phase-1 Sellbrite warning shown', slot().includes('EXISTING PRODUCT FOUND') && slot().includes('Sellbrite Qty: 1'));
checkTrue('eBay 200+[] note shown', slot().includes('No existing seller-owned eBay listing found'));
check('pack 2 excluded by Sellbrite', act()[2], false);

section('3 — both sources');
await scan(IRW, 'Irwin Naturals', '', [sbProd('IRW-710363598525-2', 1)], [ebL('336777212657', 'IRW-710363598525-2', 1, IRW), ebL('900000000003', 'IRW-710363598525-3pk', 0, IRW)]);
checkTrue('SELLBRITE and EBAY both present', slot().includes('SELLBRITE ·') && slot().includes('EBAY ·'));
checkTrue('summary counts both sources', slot().includes('SELLBRITE 1 · EBAY 2'));
checkTrue('source footnote Sellbrite + eBay', slot().includes('Fuentes: Sellbrite + eBay'));

section('4 — same SKU from both sources → one coherent row');
{
  const groups = sandbox.psExistingGroups([{ sku: 'NAT-031604004033-2pk', pack: 2, qty: 0 }], [{ item_id: '1', sku: 'NAT-031604004033-2PK', pack: 2, listing_status: 'Active', quantity_available: 0 }]);
  check('one group', groups.length, 1);
  check('one SKU (case-insensitive)', groups[0].skus.length, 1);
  check('both sources kept', [groups[0].sb.length, groups[0].eb.length], [1, 1]);
}
await scan(NAT, 'Nature Made', '', [sbProd('NAT-031604004033-2pk', 0)], [ebL('900000000002', 'NAT-031604004033-2pk', 0, NAT)]);
check('rendered as one "Pack: 2" row', (slot().match(/Pack: 2</g) || []).length, 1);
checkTrue('row shows Sellbrite Qty 0 AND eBay Active/Available 0', /Sellbrite Qty: 0/.test(slot()) && /Status: Active · Available: 0/.test(slot()));

section('5 — same pack, different SKU');
{
  const g = sandbox.psExistingGroups([{ sku: 'NAT-031604004033-2pk', pack: 2, qty: 0 }], [{ item_id: '9', sku: 'NAT-031604004033-2', pack: 2, listing_status: 'Active', quantity_available: 3 }]);
  check('grouped under one pack', g.length, 1);
  check('both SKUs listed', g[0].skus, ['NAT-031604004033-2pk', 'NAT-031604004033-2']);
}

section('6 — multiple eBay listings');
await scan(NAT, 'Nature Made', '', [], [ebL('a1', 'NAT-031604004033-1', 0, NAT), ebL('a2', 'NAT-031604004033-2pk', 0, NAT), ebL('a6', 'NAT-031604004033-6pk', 4, NAT), ebL('a12', 'NAT-031604004033-12', 1, NAT)]);
check('4 listings kept', eb().listings.length, 4);
check('packs 1,2,6,12 confirmed by eBay', Object.keys(ebEx()).map(Number).sort((a, b) => a - b), [1, 2, 6, 12]);
check('1,2,6,12 excluded; others untouched', [1, 2, 3, 6, 12].map(p => act()[p]), [false, false, true, false, false]);

section('7 — IRW real fixture (endpoint count 3; 2 synthetic)');
await scan(IRW, 'Irwin Naturals', 'Irwin Naturals Dual-Action Testosterone', [sbProd('IRW-710363598525-2', 1)], [
  ebL('336777212657', 'IRW-710363598525-2', 1, IRW),
  ebL('900000000101', 'IRW-710363598525-2', 0, IRW),           // synthetic: same pack, another ItemID
  ebL('900000000102', 'OLDFORMAT-SKU', 2, IRW, 'Active', { match: 'ebay_upc' })  // synthetic: GTIN-only match
]);
check('request used prefix IRW', /prefix=IRW/.test(ebCalls[0].u), true);
check('all 3 listings processed', eb().listings.map(l => l.item_id), ['336777212657', '900000000101', '900000000102']);
{
  const k = eb().listings[0];
  check('known control', [k.sku, k.pack, k.listing_status, k.quantity_available], ['IRW-710363598525-2', 2, 'Active', 1]);
}
check('GTIN-only match has no pack (warning only)', eb().listings[2].pack, null);
check('pack 2 auto-excluded', act()[2], false);
check('pack 1 stays available (warning only)', act()[1], true);
checkTrue('Item ID 336777212657 shown', slot().includes('336777212657'));

section('8 — NAT real fixture (endpoint count 4; 2 synthetic)');
await scan(NAT, 'Nature Made', '', [sbProd('NAT-031604004033-1', 0), sbProd('NAT-031604004033-2pk', 0)], [
  ebL('n1', 'NAT-031604004033-1', 0, NAT), ebL('n2', 'NAT-031604004033-2pk', 0, NAT),
  ebL('n3', 'NAT-031604004033-2', 0, NAT),   // synthetic: same pack, legacy SKU
  ebL('n4', 'NAT-031604004033-4pk', 5, NAT)  // synthetic
]);
check('all 4 processed', eb().listings.length, 4);
check('Sellbrite still has its 2', sbList().map(l => l.sku), ['NAT-031604004033-1', 'NAT-031604004033-2pk']);
check('rows deduplicated by pack: 1, 2, 4', (slot().match(/Pack: (\d+)</g) || []), ['Pack: 1<', 'Pack: 2<', 'Pack: 4<']);
check('every existing pack excluded (1,2,4); 3 stays', [act()[1], act()[2], act()[4], act()[3]], [false, false, false, true]);
checkTrue('Qty 0 listings visible', (slot().match(/Available: 0/g) || []).length >= 3);

section('9 — EUC real fixture (critical: Sellbrite/Seller Hub saw nothing)');
await scan(EUC, 'Eucerin', '', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
checkTrue('EXISTING PRODUCT FOUND', slot().includes('⚠ EXISTING PRODUCT FOUND'));
checkTrue('EBAY Item ID 237086232118', slot().includes('Item ID: <span style="font-family:monospace">237086232118</span>'));
checkTrue('SKU EUC-072140041298-5pk, Pack 5, Active, Available 1',
  slot().includes('EUC-072140041298-5pk') && slot().includes('Pack: 5<') && slot().includes('Status: Active · Available: 1'));
check('pack 5 auto-excluded', act()[5], false);
check('other packs available', [1, 2, 3, 6, 12].map(p => act()[p]), [true, true, true, true, true]);

section('10 — SOLGAR real fixture (Sellbrite "No existe"; endpoint count 3; 2 synthetic)');
await scan(SOL, 'Solgar', '', [], [
  ebL('336809282498', 'SOL-033984023192-2pk', 2, SOL),
  ebL('237086038884', 'SOL-033984023192-2pk', 0, SOL),   // synthetic fields (real ItemID, fields not captured)
  ebL('900000000301', 'SOL-033984023192-1', 1, SOL)       // synthetic
]);
checkTrue('Sellbrite says "No existe en Sellbrite todavía"', getEl('ps-sellbrite-status').innerHTML.includes('No existe en Sellbrite todavía'));
checkTrue('EBAY section appears anyway', slot().includes('EBAY · Item ID') && slot().includes('336809282498'));
check('pack 2 auto-excluded', act()[2], false);
check('3 listings processed', eb().listings.length, 3);

section('11 — eBay Active + available 0 = EXISTS');
await scan(NAT, 'Nature Made', '', [], [ebL('z', 'NAT-031604004033-2pk', 0, NAT)]);
check('state ok, listing kept', [eb().state, eb().listings.length], ['ok', 1]);
check('pack 2 excluded despite 0 available', act()[2], false);
checkTrue('shown as Active · Available 0, never "Ended"/"Inactive"', slot().includes('Status: Active · Available: 0') && !/Ended|Inactive/.test(slot()));

section('12 — same-pack auto-exclusion from eBay');
await scan(EUC, 'Eucerin', '', [], [ebL('e', 'EUC-072140041298-5pk', 1, EUC)], { active: DEFAULT_ACTIVE });
check('pack 5 was inactive by default → stays false', act()[5], false);
await scan(EUC, 'Eucerin', '', [], [ebL('e', 'EUC-072140041298-5pk', 1, EUC)], { active: ALL_ON });
check('pack 5 excluded when active', act()[5], false);

section('13 — different pack = warning only');
check('pack 1,2,3,6,12 untouched while eBay has only 5', [1, 2, 3, 6, 12].map(p => act()[p]), [true, true, true, true, true]);
checkTrue('warning explains other packs are not blocked', /NO se bloquean/.test(slot()) && /otro pack/.test(slot()));

section('14 — existing pack cannot be re-included — rule changed by #21');
// Until #21 an eBay-confirmed pack could be re-included by hand.
// Implementación #21: a live eBay listing hard-locks the pack.
sandbox.toggleSplitPack(5);
check('toggleSplitPack(5) refuses (hard lock, #21)', act()[5], false);
sandbox.updateSplitCalc();
check('updateSplitCalc keeps it excluded', act()[5], false);

section('15 — Return-to-Fix: late Sellbrite response');
{
  const kept = { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  await scan(NAT, 'Nature Made', '', [sbProd('NAT-031604004033-2pk', 0)], [], { active: kept, rtf: { upc: NAT, sku: 'NAT-031604004033-2pk' } });
  check('splitActive not mutated', act(), kept);
  checkTrue('warning still informational', slot().includes('EXISTING PRODUCT FOUND'));
}

section('16 — Return-to-Fix: late eBay response');
{
  const kept = { 1: false, 2: false, 3: false, 4: false, 5: true, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  reset(kept, { upc: EUC, sku: 'EUC-072140041298-5pk' });
  setSplitManual({ 5: 3 });
  setCur({ upc: EUC, brand: 'Eucerin', title: 'Eucerin' });
  ebConfig.listings = [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)];
  await sandbox.psCheckEbaySellerListings(EUC, 'Eucerin', 'Eucerin');
  check('eBay confirmed pack 5 (informational)', !!ebEx()[5], true);
  check('splitActive NOT mutated', act(), kept);
  check('splitManual NOT mutated', getSplitManual(), { 5: 3 });
}

section('17 — stale UPC-A eBay response cannot mutate UPC-B');
{
  reset(ALL_ON);
  let releaseA;
  const gateA = new Promise(r => { releaseA = r; });
  ebConfig.defer = async (u) => {
    if (u.indexOf(EUC) >= 0) { await gateA; return jsonRes(200, { status: 'success', listings: [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)] }); }
    return jsonRes(200, { status: 'success', listings: [] });
  };
  setCur({ upc: EUC, brand: 'Eucerin', title: '' });
  const pA = sandbox.psCheckEbaySellerListings(EUC, 'Eucerin', '');
  setCur({ upc: SOL, brand: 'Solgar', title: '' });
  await sandbox.psCheckEbaySellerListings(SOL, 'Solgar', '');
  releaseA(); await pA;
  check('state belongs to UPC-B', [eb().upc, eb().state, eb().listings.length], [SOL, 'ok', 0]);
  check('UPC-A pack 5 NOT excluded on UPC-B', act()[5], true);
  checkTrue('UPC-A listing not rendered', !slot().includes('237086232118'));
  // Sellbrite: stale UPC-A response also ignored
  reset(ALL_ON);
  let relSb; const gSb = new Promise(r => { relSb = r; });
  sbConfig.defer = async (u) => {
    if (u.indexOf(NAT) >= 0) { await gSb; return jsonRes(200, { status: 'success', products: [sbProd('NAT-031604004033-2pk', 0)] }); }
    return jsonRes(404, { status: 'not_found', products: [] });
  };
  const pSbA = sandbox.psCheckSellbrite(NAT, 'Nature Made');
  await sandbox.psCheckSellbrite(SOL, 'Solgar');
  relSb(); await pSbA;
  check('stale Sellbrite UPC-A did not exclude pack 2', act()[2], true);
  checkTrue('stale Sellbrite UPC-A not rendered', !getEl('ps-sellbrite-status').innerHTML.includes('NAT-031604004033-2pk'));
  sbConfig.defer = null; ebConfig.defer = null;
}

section('18 — 200 + [] behavior');
await scan(SOL, 'Solgar', '', [], []);
check('state ok with 0 listings', [eb().state, eb().listings.length], ['ok', 0]);
checkTrue('"No existing seller-owned eBay listing found."', slot().includes('No existing seller-owned eBay listing found'));
check('nothing excluded', act(), ALL_ON);

for (const [n, mode, err] of [['19 — 502 behavior', 'http502', 'ebay_trading_error'], ['20 — 503 behavior', 'http503', 'seller_auth_unavailable'], ['21 — network failure behavior', 'network', null]]) {
  section(n);
  await scan(EUC, 'Eucerin', '', [], mode);
  check('state error (never "ok, none")', eb().state, 'error');
  if (err) check('error code preserved', eb().error, err);
  checkTrue('"eBay seller lookup unavailable" shown', slot().includes('eBay seller lookup unavailable') && slot().includes('NO confirma que el producto sea nuevo'));
  checkTrue('no "No existing ... found" message', !slot().includes('No existing seller-owned eBay listing found'));
  check('nothing excluded on failure', act(), ALL_ON);
  check('_psEbExisting empty', ebEx(), {});
}

section('22 — Sellbrite still works when eBay fails');
await scan(IRW, 'Irwin Naturals', '', [sbProd('IRW-710363598525-2', 1)], 'http502');
check('Sellbrite pack 2 excluded', act()[2], false);
checkTrue('Sellbrite warning + eBay unavailable note', slot().includes('Sellbrite Qty: 1') && slot().includes('eBay seller lookup unavailable'));

section('23 — eBay works when Sellbrite has zero matches');
await scan(EUC, 'Eucerin', '', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
check('Sellbrite empty, eBay ok', [sbList().length, eb().state], [0, 'ok']);
check('pack 5 excluded by eBay alone', act()[5], false);

section('24 — no eBay write endpoints');
{
  const all = ebCalls.concat(sbCalls);
  checkTrue('every eBay call is GET /ebay/seller-listings', ebCalls.every(c => c.method === 'GET' && c.u.indexOf('/ebay/seller-listings?') >= 0), JSON.stringify(ebCalls));
  checkTrue('eBay call carried the normal session (psAuthFetch Bearer)', ebCalls.every(c => c.auth === 'Bearer fake-token'), JSON.stringify(ebCalls));
  const fnSrc = sandbox.psCheckEbaySellerListings.toString();
  checkTrue('no Trading/revise/restock/end/relist/quantity-update in lookup code',
    !/ReviseItem|EndItem|RelistItem|AddItem|api\.ebay\.com|ws\/api\.dll|method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(fnSrc));
  checkTrue('no other ebay/* endpoint in app.js', (appSrc.match(/\/ebay\/[a-z-]+/g) || []).every(s => s === '/ebay/seller-listings'));
}

section('25 — source provenance preserved');
await scan(NAT, 'Nature Made', '', [sbProd('NAT-031604004033-2pk', 0)], [ebL('p2', 'NAT-031604004033-2pk', 0, NAT)]);
checkTrue('Sellbrite rows have no eBay fields', sbList().every(l => !('item_id' in l) && !('listing_status' in l)));
checkTrue('eBay rows tagged source:"ebay"', eb().listings.every(l => l.source === 'ebay' && !('qty' in l)));
checkTrue('separate state objects', vm.runInContext('window._psEbSeller !== window._psSbExistingListings && window._psEbExisting !== window._psSbExisting', sandbox));

section('26 — Phase-1 behavior unchanged when eBay was never queried');
{
  reset(ALL_ON);
  vm.runInContext("window._psEbSeller = { upc: '', state: 'idle', listings: [], error: '' }; window._psEbExisting = {};", sandbox);
  sbConfig.products = [sbProd('IRW-710363598525-2', 1)];
  await sandbox.psCheckSellbrite(IRW, 'Irwin Naturals');
  const h = getEl('ps-sellbrite-status').innerHTML;
  checkTrue('exact Phase-1 warning text', h.includes('⚠ EXISTING PRODUCT FOUND') && h.includes('Sellbrite Qty: 1') && h.includes('Datos de Sellbrite solamente — no se consultó el estado en eBay.'));
  checkTrue('no eBay text when never queried', !/EBAY ·|eBay seller lookup|No existing seller-owned/.test(h));
  check('pack 2 excluded, pack 1 kept', [act()[2], act()[1]], [false, true]);
}
{
  const crypto = require('crypto');
  function fnSource(src, name) {
    const m = new RegExp('(?:async )?function ' + name + '\\s*\\(').exec(src); let d = 0;
    for (let j = src.indexOf('{', m.index); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(m.index, j + 1); } }
  }
  const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
  check('exportCSV fingerprint (#21 gate)', sha(fnSource(appSrc, 'exportCSV')), 'ac8f3636516d82b0');
  check('calcBundlePrice unchanged', sha(fnSource(appSrc, 'calcBundlePrice')), 'd56265fdf8c804e4');
  check('addSplitPacksToCSV fingerprint (#21 gate)', sha(fnSource(appSrc, 'addSplitPacksToCSV')), '469a5d0802931a09');
  check('updateSplitCalc fingerprint (#21 cards)', sha(fnSource(appSrc, 'updateSplitCalc')), '153ed75fd91fa6a8');
  check('computeSplit unchanged', sha(fnSource(appSrc, 'computeSplit')), 'b729a2b0e1211f1a');
  check('makeSKU unchanged', sha(fnSource(appSrc, 'makeSKU')), 'a9b61f94bc5cbbeb');
  check('toggleSplitPack fingerprint (#21 refuses locked)', sha(fnSource(appSrc, 'toggleSplitPack')), '2405e19b21d78b2d');
}

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) { console.log('FAILURES:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
process.exit(failed ? 1 : 0);
})();
