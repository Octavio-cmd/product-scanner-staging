#!/usr/bin/env node
/**
 * SAVVY SALES — EBAY PANEL (Implementación #22B) — DISPLAY ONLY
 *
 * For every exact SKU already discovered in the scan (Sellbrite /sb/search
 * and own eBay listings /ebay/seller-listings) the scanner reads
 * GET /ebay/savvy-sales?sku=<exact> (backend #22A) with the Savvy session and
 * shows 7d / 30d / 90d gross packs sold, orders and packs/day. Loading never
 * shows 0; an unconfirmed / incomplete / failed / malformed read shows
 * "⚠️ Ventas no confirmadas" (never 0). Nothing here may change Bulk Split,
 * the demand tier, the CSV, the #21 locks, the #21F location UI or
 * Return-to-Fix. The fake "Sold (90d)" line is no longer displayed; the
 * internal ebay.pricing.sold value is untouched.
 *
 * Built on the #21F harness (real multipack-fixes.js + real app.js in a vm
 * sandbox); only fetch() is mocked. No real network, no writes.
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

let capturedBlobs = [];
let invCalls = [], invConfig = { mode: 'ok', current: 4 };
class PsURL extends URL {}
PsURL.createObjectURL = () => 'blob:ps21';
PsURL.revokeObjectURL = () => {};
// Controllable responses. Each entry can be an object (immediate) or a
// function returning a Promise (to deliver a response late / out of order).
let sbConfig = { products: [] };
let ebConfig = { mode: 'ok', listings: [] };   // ok | http502 | http503 | network
let sbCalls = [], ebCalls = [], otherCalls = [], readCalls = [];
// /sb/inventory read specs, per exact SKU:
//   undefined           -> one row in WH with available = fixture qty
//   { rows: [...] }     -> found:true with these rows
//   { mode: 'http500' | 'network' | 'malformed' | 'found_false' | 'nonnum' | 'wrongsku' | 'norows' }
//   { defer: () => Promise<response> }   (late / out-of-order delivery)
let invRead = {};
let salesCalls = [], salesRead = {}, salesDefault = () => ({ mode: 'zero' });
let ssLoc = {}, ssRead = {}, ssReadMode = 'ok', ssSaveMode = 'ok', ssReadCalls = [], ssSaveCalls = [];
let invWritten = {};   // what the mocked Sellbrite holds after a write
const WH = '83757c63-124b-4141-8a9d-ddd2cb94b74c';
function invReadBuild(sku, spec) {
  spec = spec || {};
  if (spec.mode === 'network') throw new TypeError('Failed to fetch');
  if (spec.mode === 'http500') return jsonRes(500, { error: 'boom' });
  if (spec.mode === 'malformed') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  if (spec.mode === 'found_false' || spec.mode === 'norows') return jsonRes(200, { status: 'success', sku, inventory: { total_quantity: 0, total_on_hand: 0, channels: [], warehouses: [], found: spec.mode === 'norows' } });
  if (spec.mode === 'wrongsku') return jsonRes(200, { status: 'success', sku: sku + 'X', inventory: { found: true, channels: [{ warehouse_uuid: WH, available: 5, on_hand: 5 }] } });
  let rows = spec.rows;
  if (!rows) {
    const p = sbConfig.products.find(x => x.sku === sku);
    if (!p) return jsonRes(200, { status: 'success', sku, inventory: { total_quantity: 0, total_on_hand: 0, channels: [], warehouses: [], found: false } });
    const q = (sku in invWritten) ? invWritten[sku] : p.inventory.total_quantity;
    rows = [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: q, on_hand: q, bin_location: '' }];
  }
  if (spec.mode === 'nonnum') rows = rows.map(r => Object.assign({}, r, { available: null }));
  const tot = rows.reduce((a, r) => a + (Number(r.available) || 0), 0);
  return jsonRes(200, { status: 'success', sku, inventory: { total_quantity: tot, total_on_hand: tot, channels: rows, warehouses: rows, found: true } });
}
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
    if (u.indexOf('/sb/update-inventory') >= 0) {
      const body = JSON.parse((opts && opts.body) || '{}');
      invCalls.push({ u, method, body, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization') });
      if (invConfig.mode === 'network') throw new TypeError('Failed to fetch');
      if (invConfig.mode === 'http401') return jsonRes(401, { error: 'no_autorizado' });
      if (invConfig.mode === 'http409') return jsonRes(409, { status: 'error', error: 'current_quantity_unavailable', message: 'No se pudo leer la cantidad actual en Sellbrite; no se sumó nada.' });
      const prev = invConfig.current;
      const avail = body.mode === 'add' ? prev + body.quantity : body.quantity;
      invWritten[body.sku] = avail;
      return jsonRes(200, { status: 'success', sku: body.sku, available: avail, previous_available: prev, mode: body.mode });
    }
    if (u.indexOf('/sb/inventory') >= 0) {
      const sku = decodeURIComponent((u.match(/sku=([^&]+)/) || [])[1] || '');
      readCalls.push({ u, method, sku, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization') });
      const spec = invRead[sku];
      if (spec && typeof spec.defer === 'function') return spec.defer();
      return invReadBuild(sku, spec);
    }
    if (u.indexOf('/ss/location') >= 0) {
      const sku = decodeURIComponent((u.match(/sku=([^&]+)/) || [])[1] || '');
      ssReadCalls.push({ u, method, sku, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization') });
      const spec = ssRead[sku];
      if (spec && typeof spec.defer === 'function') return spec.defer();
      if (ssReadMode === 'network') throw new TypeError('Failed to fetch');
      if (ssReadMode === 'http401') return jsonRes(401, { error: 'no_autorizado' });
      if (!(sku in ssLoc)) return jsonRes(200, { exists: false });
      return jsonRes(200, { exists: true, product_id: 1, warehouse_location: ssLoc[sku] });
    }
    if (u.indexOf('/ss/create-product') >= 0) {
      const body = JSON.parse((opts && opts.body) || '{}');
      ssSaveCalls.push({ u, method, body, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization') });
      if (ssSaveMode === 'http401') return jsonRes(401, { error: 'no_autorizado' });
      if (ssSaveMode === 'fail' || !(body.sku in ssLoc)) return jsonRes(200, { status: 'error', error: 'SKU no existe en ShipStation' });
      ssLoc[body.sku] = body.warehouse_location;
      return jsonRes(200, { status: 'success', productId: 1, warehouseLocation: body.warehouse_location });
    }
    if (u.indexOf('/ebay/savvy-sales') >= 0) {
      const sku = decodeURIComponent((u.match(/sku=([^&]+)/) || [])[1] || '');
      salesCalls.push({ u, method, sku, body: opts && opts.body, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization') });
      const spec = salesRead[sku] || salesDefault(sku);
      if (typeof spec.defer === 'function') return spec.defer();
      return salesBuild(sku, spec);
    }
    otherCalls.push({ u, method });
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
  URL: PsURL, URLSearchParams, Blob: function (parts) { capturedBlobs.push((parts || []).join('')); }, FormData: function () {}, Headers,
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
const appSrc = fs.readFileSync(process.env.PS22B_APP || path.join(__dirname, 'app.js'), 'utf8');
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

const ALL_ON = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 12: true };
const DEF = { 1: true, 2: true, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true };
const IRW = '710363598525', NAT = '031604004033', EUC = '072140041298', SOL = '033984023192', NEWU = '012345678905';
function sbProd(sku, qty) { return { sku: sku, name: sku, inventory: { found: true, total_quantity: qty, total_on_hand: qty, channels: [{ warehouse_uuid: 'wh-1', available: qty, on_hand: qty }] } }; }
function ebL(id, sku, avail, upc, status) {
  return { item_id: id, sku: sku, title: 'T', pack: null, listing_status: status || 'Active', quantity: avail, quantity_sold: 0,
    quantity_available: avail, upc: upc, start_time: '', end_time: '', match: 'sku_upc+ebay_upc' };
}
function fixture(upc, brand) {
  const c = { upc: upc, brand: brand, title: brand + ' Vitamin C Gummies 250mg Immune Support 80ct', _countOK: true, _countConfirmed: true,
    category: '11776', _description: 'Full description already generated.', _specifics: { Formulation: 'Gummy', 'Item Form': 'Gummy' },
    _shade: '', _expDate: 'Oct 2033', location: 'A/1', _bundleImg: 'https://cdn.example/g.jpg', ebay: { prices: { low: 9.99, avg: 18.51 } }, _packImages: {} };
  for (let p = 1; p <= 12; p++) c._packImages[p] = { front: 'https://cdn.example/p' + p + '.jpg' };
  return c;
}
const act = () => getSplitActive();
const st = (p) => sandbox.psPackState(p);
const results = () => getEl('split-results').innerHTML;
function resetAll() {
  setRTF(null, null); setBulk([]);
  sbConfig = { products: [] }; ebConfig = { mode: 'ok', listings: [] }; invConfig = { mode: 'ok', current: 4 };
  sbCalls = []; ebCalls = []; otherCalls = []; salesCalls = []; salesRead = {}; salesDefault = () => ({ mode: 'zero' }); invCalls = []; readCalls = []; invRead = {}; invWritten = {}; capturedBlobs = []; ssRead = {}; ssReadMode = 'ok'; ssSaveMode = 'ok'; ssReadCalls = []; ssSaveCalls = [];
  storage.removeItem('ps_locked_packs_v1'); storage.removeItem('cl_drive_url');
  vm.runInContext("window._psLockedPacks = null; window._psSbState = {upc:'',state:'idle'}; window._psEbSeller = {upc:'',state:'idle',listings:[],error:''}; window._psEbExisting = {}; window._psSbExistingListings = []; window._psSbExisting = {}; _psSellbriteProducts = {};", sandbox);
  getEl('split-calc-card').dataset.tier = 'media';
  getEl('split-total-input').value = '41'; getEl('split-weight-lb').value = '0'; getEl('split-weight-oz').value = '8';
}
async function scan(upc, brand, sbProducts, eb, opts) {
  opts = opts || {};
  if (!opts.keep) resetAll();
  setSplitActive(Object.assign({}, opts.active || ALL_ON));
  setSplitManual(opts.manual || {});
  setCur(opts.cur || fixture(upc, brand));
  if (opts.rtf) setRTF(opts.rtf.upc, opts.rtf.sku);
  if (opts.bulk) setBulk(opts.bulk);
  sbConfig.products = sbProducts || [];
  if (typeof eb === 'string') ebConfig.mode = eb; else ebConfig.listings = eb || [];
  if (opts.sbFail) sbConfig.defer = async () => jsonRes(500, { error: 'boom' }); else sbConfig.defer = null;
  if (opts.inv) invRead = Object.assign(invRead, opts.inv);
  const run = Promise.all([sandbox.psCheckSellbrite(upc, brand), sandbox.psCheckEbaySellerListings(upc, brand, '')]);
  if (opts.noSettle) { for (let n = 0; n < 10; n++) await new Promise(r => setImmediate(r)); return; }
  await run;
  await settleInventory();
}
// #21C: the per-SKU /sb/inventory reads run after /sb/search; wait for them
// and re-render the split so results() reflects the confirmed quantities.
async function settleInventory() {
  for (let n = 0; n < 50; n++) {
    const inv = vm.runInContext('window._psSbInv || {}', sandbox);
    if (!Object.values(inv).some(a => a && a.state === 'loading')) break;
    await new Promise(r => setImmediate(r));
  }
  try { sandbox.updateSplitCalc(); } catch (e) {}
}
async function captureExport() {
  const toasts = [], alerts = [];
  sandbox.__tl = toasts;
  vm.runInContext('toast = function(m){ __tl.push(String(m)); };', sandbox);
  sandbox.alert = (m) => alerts.push(String(m));
  capturedBlobs = [];
  storage.removeItem('cl_drive_url');
  vm.runInContext('window._exportLock = false;', sandbox);
  await sandbox.exportCSV();
  return { csv: capturedBlobs[0] || null, toasts, alerts };
}
function csvHasAddFor(csv, sku) { return !!csv && csv.split('\r\n').some(l => l.startsWith('Add,') && l.indexOf(',' + sku + ',') >= 0); }

// ── /ebay/savvy-sales mock ────────────────────────────────────────────────
function win(orders, packs, ppd, pack, extra) {
  extra = extra || {};
  return { days: 0, orders, packs_sold: packs, physical_units: pack ? packs * pack : null, packs_per_day: ppd,
    avg_item_price_per_pack: null, avg_item_price_currency: null,
    avg_item_price_reason: packs ? 'price_field_semantics_unverified' : 'no_sales',
    excluded: extra.excluded || {},
    refunds: { orders_with_refunds: extra.refunded || 0, packs_in_refunded_lines: 0, net_packs_sold: null,
               net_reason: 'ebay_refunds_report_amounts_not_quantities' } };
}
function salesOk(sku, pack, w7, w30, w90, over) {
  const w = { '7d': w7, '30d': w30, '90d': w90 };
  ['7d', '30d', '90d'].forEach(k => { w[k].days = parseInt(k, 10); });
  return Object.assign({ sku, source: 'ebay_fulfillment_orders', match: 'exact_sku_case_insensitive', pack_size: pack,
    pack_size_reason: pack ? null : 'pack_not_parsed_from_sku', window_basis: 'order_creation_date_utc_rolling',
    status: 'confirmed', complete: true, as_of: '2026-09-26T12:00:00Z', orders_scanned: 6649,
    cache: { hit: false, age_seconds: 0, ttl_seconds: 600 }, windows: w }, over || {});
}
function zeroBody(sku) {
  const pack = (sku.match(/-(\d{1,2})(?:pk)?$/i) || [])[1];
  const p = pack ? parseInt(pack, 10) : null;
  return salesOk(sku, p, win(0, 0, 0, p), win(0, 0, 0, p), win(0, 0, 0, p));
}
function salesBuild(sku, spec) {
  if (spec.mode === 'network') throw new TypeError('Failed to fetch');
  if (spec.mode === 'http401') return jsonRes(401, { error: 'no_autorizado' });
  if (spec.mode === 'malformed') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  if (spec.mode === 'zero') return jsonRes(200, zeroBody(sku));
  return jsonRes(spec.status || 200, spec.body);
}
function hold2() { let release; const p = new Promise(r => { release = r; }); return { defer: () => p, release: (sku, spec) => release(salesBuild(sku, spec)) }; }

// Real #22A acceptance values (LEGO 673419373609) — fixture only, never in app code.
const LEG = '673419373609';
const S1 = 'LEG-673419373609-1', S1PK = 'LEG-673419373609-1pk', S2PK = 'LEG-673419373609-2pk', S12PK = 'LEG-673419373609-12pk';
const LEGO_1PK = () => salesOk(S1PK, 1,
  win(48, 155, 22.143, 1, { excluded: { cancelled: { orders: 1, packs: 1 } }, refunded: 0 }),
  win(105, 234, 7.8, 1, { excluded: { cancelled: { orders: 2, packs: 3 } }, refunded: 1 }),
  win(136, 273, 3.033, 1, { excluded: { cancelled: { orders: 3, packs: 5 } }, refunded: 3 }));
const LEGO_2PK = () => salesOk(S2PK, 2, win(5, 15, 2.143, 2), win(7, 32, 1.067, 2), win(9, 38, 0.422, 2));
const LEGO_SB = () => [sbProd(S1PK, 447), sbProd(S1, 0), sbProd(S2PK, 77)];
const LEGO_INV = {
  [S1]: { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 0, on_hand: 0 }] },
  [S1PK]: { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 431, on_hand: 431 }] },
  [S2PK]: { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 77, on_hand: 77 }] }
};
const slot = () => getEl('ps-savvy-sales-slot').innerHTML;
// #22B-UI: one table row per exact SKU (<tr data-sku="…">), one cell per window.
const block = sku => { const h = slot(); const a = h.indexOf('<tr data-sku="' + sku + '">'); if (a < 0) return ''; const b = h.indexOf('</tr>', a); return h.slice(a, b > 0 ? b + 5 : undefined); };
const cell = (sku, k) => { const r = block(sku); const a = r.indexOf('<td data-label="' + k.toUpperCase() + '"'); if (a < 0) return ''; return r.slice(a, r.indexOf('</td>', a) + 5); };
const shows = (sku, k, packs, orders, perDay) => { const c = cell(sku, k); return c.includes('<span class="ps-ss-n">' + packs + '</span> packs') && c.includes(orders + ' · ' + perDay + ' packs/day'); };
const noSku = (h, sku) => h.split(sku).join('');
const salesState = () => vm.runInContext('window._psSales', sandbox);
async function settleSales() {
  for (let n = 0; n < 80; n++) {
    const st = vm.runInContext('window._psSales || {skus:{}}', sandbox);
    const inv = vm.runInContext('window._psSbInv || {}', sandbox), loc = vm.runInContext('window._psSsLoc || {}', sandbox);
    if (!Object.values(st.skus).concat(Object.values(inv), Object.values(loc)).some(a => a && a.state === 'loading')) break;
    await new Promise(r => setImmediate(r));
  }
  try { sandbox.updateSplitCalc(); } catch (e) {}
}
async function legoScan(sales, eb, extra) {
  resetAll();
  Object.assign(salesRead, sales || {});
  await scan(LEG, 'LEGO', LEGO_SB(), eb || [], Object.assign({ keep: true, inv: LEGO_INV, noSettle: true }, extra || {}));
  await settleSales();
}
async function addAll() { setBulk([]); vm.runInContext('toast = function(){};', sandbox); await sandbox.addSplitPacksToCSV(); return getBulk().map(b => b.sku); }
async function scanWith(upc, brand, sb, eb, sales, extra) {
  resetAll();
  Object.assign(salesRead, sales || {});
  await scan(upc, brand, sb, eb, Object.assign({ keep: true, noSettle: true }, extra || {}));
  await settleSales();
}
const LEGO_SALES = () => ({ [S1PK]: { body: LEGO_1PK() }, [S2PK]: { body: LEGO_2PK() } });
const expired = { n: 0 };
vm.runInContext('savvySesionCaducada = function(){ __exp.n++; };', Object.assign(sandbox, { __exp: expired }));

// Pre-change sources for "unchanged" guards.
let baseSrc = null;
// Employee STAGING: the Preview commit (4f6de91) is not in this repo's history;
// 748cbf2 is the staging commit whose app.js is byte-identical to it (pre-#22B).
for (const sha of ['4f6de91c823de10a5bc51f6970f77884bed466e5', '748cbf24a17449e9f65899978e6395cff3090be1']) {
  try { baseSrc = require('child_process').execSync('git show ' + sha + ':app.js', { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); break; } catch (e) { baseSrc = null; }
}
function fnSrc(src, name) {
  const re = new RegExp('^(async )?function ' + name + '\\(', 'm'); const m = re.exec(src); if (!m) return null;
  const rest = src.slice(m.index + 1); const n = /^(async )?function |^\/\/ ━━|^var |^const |^let |^window\./m.exec(rest.slice(1));
  return src.slice(m.index, n ? m.index + 2 + n.index : undefined);
}
function unchangedFn(name) { return baseSrc != null && fnSrc(appSrc, name) != null && fnSrc(appSrc, name) === fnSrc(baseSrc, name); }
const block22b = (() => { const a = appSrc.indexOf('// ━━ VENTAS PROPIAS DE SAVVY EN EBAY POR SKU EXACTO (Implementación #22B)'); const b = appSrc.indexOf('async function psCheckSellbrite(', a); return a >= 0 && b > a ? appSrc.slice(a, b) : ''; })();

const fetchPaths22b = (block22b.match(/psAuthFetch\(\s*'[^']*'/g) || []).map(x => x.replace(/psAuthFetch\(\s*'/, '').replace(/'$/, ''));
(async () => {
['psRequestSavvySales', 'psReadSavvySales', 'psParseSavvySales', 'psSavvySalesHtml', 'psRenderSavvySales', 'psSalesReset']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1–5, 28 — exact SKU requests, authenticated GET, deduplicated');
await legoScan(LEGO_SALES());
const reqSkus = salesCalls.map(c => c.sku).sort();
check('2/4 one request per exact Sellbrite SKU (1pk, -1, 2pk separate)', reqSkus, [S1, S1PK, S2PK].sort());
checkTrue('1 authenticated GET (Bearer session, no body)', salesCalls.length === 3 && salesCalls.every(c => c.method === 'GET' && c.auth === 'Bearer fake-token' && !c.body), JSON.stringify(salesCalls));
checkTrue('1b token only in the Authorization header (never in URL)', salesCalls.length === 3 && salesCalls.every(c => !c.u.includes('fake-token') && /\/ebay\/savvy-sales\?sku=[^&]+$/.test(c.u)), JSON.stringify(salesCalls.map(c => c.u)));
await scanWith(LEG, 'LEGO', [sbProd(S1, 0)], [], {}, { inv: LEGO_INV });
check('3 -1 alone never requests -1pk / -12pk', salesCalls.map(c => c.sku), [S1]);
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], {}, { inv: LEGO_INV });
check('3b -1pk alone never requests -1', salesCalls.map(c => c.sku), [S1PK]);
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3), sbProd('leg-673419373609-1PK ', 3)],
  [ebL('336000000001', S1PK, 2, LEG), ebL('336000000002', 'LEG-673419373609-12pk', 1, LEG), ebL('336000000003', 'OTHER-012345678905-1pk', 1, '012345678905')],
  {}, { inv: LEGO_INV });
check('5/28 same exact SKU (case/space variants, Sellbrite + eBay) requested once; eBay-only SKU added; other UPC ignored',
  salesCalls.map(c => c.sku).sort(), [S1PK, S12PK].sort());
checkTrue('5b Sellbrite SKUs with same pack are NOT merged (1pk and -1 are separate blocks)', (await (async () => { await legoScan(LEGO_SALES()); return block(S1) && block(S1PK) && block(S1) !== block(S1PK); })()), slot());

section('6–11 — loading / confirmed zero / failure / unconfirmed / incomplete / malformed');
{
  const h = hold2();
  resetAll(); salesRead[S1PK] = { defer: h.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  const b = block(S1PK);
  checkTrue('6 loading shows "⏳ Consultando ventas reales..." and no number', b.includes('⏳ Consultando ventas reales...') && !/ps-ss-n|\b0\b/.test(noSku(b, S1PK)), b);
  h.release(S1PK, { body: LEGO_1PK() }); await settleSales();
  checkTrue('6b after the response the numbers appear', shows(S1PK, '7d', 155, '48 orders', '22.14'), block(S1PK));
}
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { [S1PK]: { mode: 'zero' } }, { inv: LEGO_INV });
checkTrue('7 confirmed zero shows a real 0 in every window', ['7d', '30d', '90d'].every(k => shows(S1PK, k, 0, '0 orders', '0.00')), block(S1PK));
const failCases = {
  '8 HTTP 502 unconfirmed': { status: 502, body: { sku: S1PK, status: 'unconfirmed', complete: false, reason: 'ebay_timeout', windows: null } },
  '8b HTTP 503 seller auth': { status: 503, body: { sku: S1PK, status: 'unconfirmed', complete: false, reason: 'seller_auth_unavailable', windows: null } },
  '8c network error': { mode: 'network' },
  '9 status unconfirmed with 200': { body: Object.assign(LEGO_1PK(), { status: 'unconfirmed' }) },
  '10 complete=false': { body: Object.assign(LEGO_1PK(), { complete: false }) },
  '11 malformed JSON': { mode: 'malformed' },
  '11b missing window': { body: (() => { const b = LEGO_1PK(); delete b.windows['30d']; return b; })() },
  '11c negative packs': { body: (() => { const b = LEGO_1PK(); b.windows['7d'].packs_sold = -1; return b; })() },
  '11d non-integer orders': { body: (() => { const b = LEGO_1PK(); b.windows['90d'].orders = '136'; return b; })() },
  '11e response for another SKU': { body: Object.assign(LEGO_1PK(), { sku: S1 }) },
  '11f windows null on 200': { body: Object.assign(LEGO_1PK(), { windows: null }) },
  '11g missing refunds': { body: (() => { const b = LEGO_1PK(); delete b.windows['7d'].refunds; return b; })() },
  '11h bad excluded entry': { body: (() => { const b = LEGO_1PK(); b.windows['7d'].excluded = { cancelled: { orders: 'x', packs: 1 } }; return b; })() }
};
for (const [name, spec] of Object.entries(failCases)) {
  await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { [S1PK]: spec }, { inv: LEGO_INV });
  const b = block(S1PK);
  checkTrue(name + ' → "⚠️ Ventas no confirmadas", no zero, no numbers', b.includes('⚠️ Ventas no confirmadas') && !/ps-ss-n|data-label=/.test(b), b);
}

section('12 — 401 uses the normal session-expired flow');
expired.n = 0;
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { [S1PK]: { mode: 'http401' } }, { inv: LEGO_INV });
checkTrue('12 401 → savvySesionCaducada() + "no confirmadas" (never 0)', expired.n >= 1 && block(S1PK).includes('⚠️ Ventas no confirmadas') && block(S1PK).includes('sesion_expirada'), expired.n + ' ' + block(S1PK));

section('13–25 + LEGO fixture — real #22A acceptance values');
await legoScan(LEGO_SALES());
const b1 = block(S1PK), b2 = block(S2PK);
check('LEGO 1pk 7d', shows(S1PK, '7d', 155, '48 orders', '22.14'), true);
check('LEGO 1pk 30d', shows(S1PK, '30d', 234, '105 orders', '7.80'), true);
check('LEGO 1pk 90d', shows(S1PK, '90d', 273, '136 orders', '3.03'), true);
check('LEGO 2pk 7d', shows(S2PK, '7d', 15, '5 orders', '2.14'), true);
check('LEGO 2pk 30d', shows(S2PK, '30d', 32, '7 orders', '1.07'), true);
check('LEGO 2pk 90d', shows(S2PK, '90d', 38, '9 orders', '0.42'), true);
checkTrue('13/14/15 7d, 30d, 90d rendered in order', b1.indexOf('data-label="7D"') > 0 && b1.indexOf('data-label="7D"') < b1.indexOf('data-label="30D"') && b1.indexOf('data-label="30D"') < b1.indexOf('data-label="90D"'), b1);
checkTrue('16 gross label present + nested-window note', slot().includes('Gross packs sold · refunded orders remain included') && slot().includes('7d ⊂ 30d ⊂ 90d') && slot().includes('do not add them together'), slot());
checkTrue('17 no "net sold" / "net sales" / bare "Sold" claim', !/net sold|net sales|ventas netas|\bSold \(|>Sold</i.test(slot()), slot());
checkTrue('18 order counts rendered', b1.includes('48 orders') && b2.includes('5 orders'), b1);
checkTrue('19 packs/day rendered (packs, not units)', b2.includes('2.14 packs/day') && !b2.includes('units/day'), b2);
check('20 2pk physical units distinguished from packs', ['7d', '30d', '90d'].map(k => cell(S2PK, k).includes('<span class="ps-ss-n">' + ({ '7d': 15, '30d': 32, '90d': 38 })[k] + '</span> packs') && cell(S2PK, k).includes('= ' + ({ '7d': 30, '30d': 64, '90d': 76 })[k] + ' physical units')), [true, true, true]);
checkTrue('20b 1pk shows no redundant physical-units text', !b1.includes('physical units'), b1);
checkTrue('21 refund warnings rendered (30d: 1, 90d: 3; 7d none)', cell(S1PK, '30d').includes('⚠️ 1 refunded order included') && cell(S1PK, '90d').includes('⚠️ 3 refunded orders included') && !cell(S1PK, '7d').includes('refunded') && (b1.match(/refunded order/g) || []).length === 2, b1);
checkTrue('22 refunds not subtracted (30d stays 234, 90d stays 273)', b1.includes('<span class="ps-ss-n">234</span>') && b1.includes('<span class="ps-ss-n">273</span>') && !b1.includes('<span class="ps-ss-n">233</span>') && !b1.includes('<span class="ps-ss-n">270</span>'), b1);
checkTrue('23 cancellations shown as excluded, not added back', b1.includes('Excluded: 1 cancelled order / 1 pack') && b1.includes('Excluded: 2 cancelled orders / 3 packs') && b1.includes('Excluded: 3 cancelled orders / 5 packs') && !b1.includes('<span class="ps-ss-n">156</span>'), b1);
checkTrue('LEGO 2pk: no refund / exclusion lines', !b2.includes('refunded') && !b2.includes('Excluded'), b2);
checkTrue('24 average sold price not shown', !/\$|avg|average|precio/i.test(slot()), slot());
checkTrue('25 price semantics reason not shown as a price', !slot().includes('price_field_semantics') && !slot().includes('no_sales'), slot());
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { [S1PK]: { body: (() => { const b = LEGO_1PK(); b.windows['7d'].avg_item_price_per_pack = 12.34; return b; })() } }, { inv: LEGO_INV });
checkTrue('24b even a non-null backend price is never displayed', !slot().includes('12.34'), slot());
await legoScan(LEGO_SALES());
{ const h = slot(); checkTrue('blocks ordered 1pk (-1, -1pk) then 2pk', h.indexOf('data-sku="' + S1 + '"') > 0 && h.indexOf('data-sku="' + S1 + '"') < h.indexOf('data-sku="' + S2PK + '"') && h.indexOf('data-sku="' + S1PK + '"') < h.indexOf('data-sku="' + S2PK + '"'), h); }

section('26–27 — stale responses never repaint the current product');
{
  const h = hold2();
  resetAll(); salesRead[S1PK] = { defer: h.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  const IRW = '710363598525', SIRW = 'IRW-710363598525-2';
  salesRead[SIRW] = { body: salesOk(SIRW, 2, win(1, 1, 0.143, 2), win(2, 2, 0.067, 2), win(3, 3, 0.033, 2)) };
  await scan(IRW, 'Irwin Naturals', [sbProd(SIRW, 4)], [], { keep: true, noSettle: true });
  await settleSales();
  h.release(S1PK, { body: LEGO_1PK() }); await settleSales();
  checkTrue('26 late other-UPC response ignored (panel shows only IRW)', !slot().includes(S1PK) && slot().includes(SIRW) && !slot().includes('155'), slot());
  check('26b sales state belongs to the current UPC', (salesState() || {}).upc, IRW);
}
{
  const h = hold2();
  resetAll(); salesRead[S1PK] = { defer: h.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  salesRead[S1PK] = { body: LEGO_1PK() };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  await settleSales();
  h.release(S1PK, { body: salesOk(S1PK, 1, win(999, 999, 142.7, 1), win(999, 999, 33.3, 1), win(999, 999, 11.1, 1)) });
  await settleSales();
  checkTrue('27 older same-UPC response ignored (current values kept)', block(S1PK).includes('<span class="ps-ss-n">155</span>') && !slot().includes('999'), slot());
}

{
  await legoScan(LEGO_SALES());
  checkTrue('26c precondition: LEGO sales painted', block(S1PK).includes('<span class="ps-ss-n">155</span>'), slot());
  setCur(Object.assign(fixture('', 'NoUPC'), { upc: '' }));
  if (typeof sandbox.psRenderSavvySales === 'function') sandbox.psRenderSavvySales();
  check('26c next product WITHOUT a UPC never inherits the previous sales', slot(), '');
  setCur(fixture('710363598525', 'Irwin Naturals'));
  if (typeof sandbox.psRenderSavvySales === 'function') sandbox.psRenderSavvySales();
  check('26d next product with ANOTHER UPC (before its scan starts) shows nothing', slot(), '');
}

section('29–34 — no polling, no writes');
await legoScan(LEGO_SALES());
{ const n = salesCalls.length; await new Promise(r => setTimeout(r, 60)); await settleSales(); check('29 no polling (exactly one read per SKU, none after the scan)', [n, salesCalls.length], [3, 3]); }
checkTrue('29b #22B code has no timers', block22b.length > 0 && !/setInterval|setTimeout/.test(block22b), block22b.length);
checkTrue('30 every sales call is a GET without a body', salesCalls.length > 0 && salesCalls.every(c => c.method === 'GET' && !c.body), JSON.stringify(salesCalls));
checkTrue('30b #22B code has no write methods', !/method\s*:|POST|PUT|PATCH|DELETE/.test(block22b), '');
check('30c #22B calls exactly one endpoint: GET /ebay/savvy-sales', fetchPaths22b, ['/ebay/savvy-sales?sku=']);
checkTrue('31 no Sellbrite write from #22B (no /sb/update-inventory calls)', invCalls.length === 0 && !/update-inventory/.test(block22b), invCalls.length);
checkTrue('32 no ShipStation write from #22B', ssSaveCalls.length === 0 && !/create-product/.test(block22b), ssSaveCalls.length);
checkTrue('33 no Shopify call from #22B', !/shopify/i.test(block22b) && otherCalls.every(c => !/shopify/i.test(c.u)), JSON.stringify(otherCalls));
checkTrue('34 no eBay write: only the /ebay/savvy-sales read (plus the unchanged seller-listings read)', fetchPaths22b.every(p => p === '/ebay/savvy-sales?sku=') && otherCalls.every(c => !/ebay/i.test(c.u)) && ebCalls.every(c => c.method === 'GET'), JSON.stringify(otherCalls));

section('35–37 — Bulk Split, demand tier and CSV unchanged by sales data');
async function splitSnapshot(sales) {
  await scanWith(LEG, 'LEGO', LEGO_SB(), [], sales, { inv: LEGO_INV, active: DEF });
  sandbox.updateSplitCalc();
  const card = getEl('split-calc-card');
  const out = { results: results(), tier: card.dataset.tier, active: JSON.stringify(act()), autoTier: sandbox.getDemandTier(0),
    split: JSON.stringify(sandbox.computeSplit(41, 'media', DEF)) };
  out.adds = await addAll();
  out.bulk = JSON.stringify(getBulk());
  const ex = await captureExport(); out.csv = ex.csv; out.alerts = JSON.stringify(ex.alerts);
  return out;
}
const snapReal = await splitSnapshot(LEGO_SALES());
const snapFail = await splitSnapshot({ [S1PK]: { mode: 'network' }, [S2PK]: { mode: 'http401' }, [S1]: { mode: 'malformed' } });
const snapHuge = await splitSnapshot({ [S1PK]: { body: salesOk(S1PK, 1, win(9999, 99999, 9999, 1), win(9999, 99999, 3333, 1), win(9999, 99999, 1111, 1)) } });
check('35 Bulk Split results/allocation identical with real, failed or huge sales', [snapReal.results === snapFail.results, snapReal.results === snapHuge.results, snapReal.split === snapHuge.split, snapReal.active === snapHuge.active], [true, true, true, true]);
check('36 demand tier identical (auto tier still from the unchanged soldCount path)', [snapReal.tier, snapFail.tier, snapHuge.tier, snapReal.autoTier], [snapReal.tier, snapReal.tier, snapReal.tier, 'baja']);
check('37 CSV + added rows identical', [snapReal.csv === snapFail.csv, snapReal.csv === snapHuge.csv, snapReal.bulk === snapHuge.bulk, JSON.stringify(snapReal.adds) === JSON.stringify(snapHuge.adds)], [true, true, true, true]);
['getDemandTier', 'computeSplit', 'updateSplitCalc', 'addSplitPacksToCSV', 'exportCSV', 'applyVerdict', 'callClaude', 'finishAnalyze']
  .forEach(fn => checkTrue('35b source unchanged vs 4f6de91: ' + fn + '()', unchangedFn(fn), baseSrc == null ? 'no base' : 'changed'));
// #22B-UI: the only change in renderSplitCalculatorHTML is the removed "(N vendidos en 90 días)" text.
checkTrue('35b renderSplitCalculatorHTML() = base minus the misleading sold-count text only', baseSrc != null && fnSrc(appSrc, 'renderSplitCalculatorHTML') === fnSrc(baseSrc, 'renderSplitCalculatorHTML')
  .replace('      Demanda detectada: <strong id="split-tier-label" style="color:var(--ac)"></strong>\n      (${soldCount} vendidos en 90 días)\n', '      Demanda automática actual: <strong id="split-tier-label" style="color:var(--ac)"></strong>\n'), 'changed');
checkTrue('35c internal fake sold value still produced (display only removed)', (appSrc.match(/pricing = \{ sold: \{ avg: 0, count: 0 \}/g) || []).length === 2, '');
checkTrue('35d #22B code never touches split/tier/CSV state', !/_splitActive|_splitManual|DEMAND_TIERS|getDemandTier|computeSplit|updateSplitCalc|bulk\b|exportCSV|soldCount|pricing/.test(block22b), '');

section('Fake Sold (90d) display');
checkTrue('market-data slot no longer renders the fake "✅ Sold (90d)" line (base did)', !(fnSrc(appSrc, 'renderResult') || '').includes('<strong>Sold (90d):</strong>') && (fnSrc(baseSrc || '', 'renderResult') || '').includes('<strong>Sold (90d):</strong>'), '');
checkTrue('market-data slot hosts #ps-savvy-sales-slot', (fnSrc(appSrc, 'renderResult') || '').includes('<div id="ps-savvy-sales-slot">\' + psSavvySalesHtml() + \'</div>'), '');
checkTrue('Active BIN Min/Avg/Max market line kept', (fnSrc(appSrc, 'renderResult') || '').includes('🏷 <strong>Active BIN:</strong> ${ebay.activeListings}'), '');

section('38–40 — #21 locks, #21F location UI, Return-to-Fix unchanged');
await legoScan(LEGO_SALES());
check('38 1pk/2pk still locked', [sandbox.psIsPackLocked(LEG, 1), sandbox.psIsPackLocked(LEG, 2)], [true, true]);
['psPackState', 'psIsPackLocked', 'psRefreshPackLocks', 'psAutoExcludeConfirmedPacks', 'psLoadSbInventory', 'psApplySbInventory', 'psUpdateSellbriteInventory']
  .forEach(fn => checkTrue('38b unchanged: ' + fn + '()', unchangedFn(fn), ''));
['psSsLocEditorHtml', 'psSsLocSummaryHtml', 'psRenderSsLoc', 'psCheckShipStationLocation', 'psSaveShipStationLocation', 'psRemoveLocation', 'psPersistLocation', 'psLockedPackCardHtml']
  .forEach(fn => checkTrue('39 unchanged: ' + fn + '()', unchangedFn(fn), ''));
{
  const sku2 = 'IRW-710363598525-2pk', IRW = '710363598525';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false }, manual: { 2: 3 } });
  await settleSales();
  check('40 Return-to-Fix target still editable; split untouched', [sandbox.psLockSessionEditAllowed(IRW, sku2), act()[2], getSplitManual()[2]], [true, true, 3]);
  ['psReturnAndFixExpDate', 'psCaptureEditorSnapshot'].forEach(fn => checkTrue('40b unchanged: ' + fn + '()', unchangedFn(fn), ''));
}

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
