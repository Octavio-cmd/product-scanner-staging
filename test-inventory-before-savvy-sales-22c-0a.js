#!/usr/bin/env node
/**
 * INVENTORY FIRST, SAVVY SALES SECOND (Implementación #22C-0A)
 *
 * Root cause (#22C-0): the backend serves 2 requests at a time; a cold
 * /ebay/savvy-sales scan can hold both for ~50 s, and the authoritative
 * /sb/inventory reads (#21C) queued behind it. Now each scan's Savvy Sales
 * reads start only after that scan's inventory phase SETTLES (success or
 * failure), and a scan that is no longer current never starts them.
 * Nothing else changes: same requests, same payloads, same UI, same
 * inventory / sales / Bulk Split behaviour — only WHEN sales reads begin.
 *
 * Includes a deterministic performance harness: a mocked backend with
 * capacity 2 (FIFO), slow cold sales, fast inventory — run BEFORE (the
 * unmodified 77d3cab app.js, in a child process) and AFTER.
 *
 * Harness: real multipack-fixes.js + real app.js in a vm sandbox; only
 * fetch() is mocked. No real network, no writes.
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
const appSrc = fs.readFileSync(process.env.PS22C0A_APP || path.join(__dirname, 'app.js'), 'utf8');
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
// Employee STAGING: the Preview commit (66c9765) is not in this repo's history;
// dcc8cd4 is the staging commit whose app.js is byte-identical to it (#22B before #22B-UI).
for (const sha of ['66c976555be423d667377ff918f77a4e9c48dd7b', 'dcc8cd4e58d3e75fdec3de88d28840255581c317']) {
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
// ── "before" = Employee STAGING 77d3cab (inventory/sales order pre-#22C-0A) ──
const BEFORE_SHA = '77d3cabb9a663d6e3b63ef841a074daea1e8a398';
let beforeSrc = null;
try { beforeSrc = require('child_process').execSync('git show ' + BEFORE_SHA + ':app.js', { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { beforeSrc = null; }
const sameAsBefore = name => beforeSrc != null && fnSrc(appSrc, name) != null && fnSrc(appSrc, name) === fnSrc(beforeSrc, name);

// ── ordered request log + optional capacity-limited backend model ─────────
const callLog = [];
const origFetch = sandbox.fetch;
let perf = null;   // { cap, service(u) -> ms, active, queue }
function kindOf(u) {
  if (u.includes('/sb/inventory')) return 'inventory';
  if (u.includes('/ebay/savvy-sales')) return 'sales';
  if (u.includes('/ss/location')) return 'location';
  if (u.includes('/sb/search')) return 'search';
  if (u.includes('/ebay/seller-listings')) return 'seller-listings';
  if (u.includes('/sb/update-inventory')) return 'update-inventory';
  return 'other';
}
sandbox.fetch = (url, opts) => {
  const u = String(url);
  callLog.push({ n: callLog.length, kind: kindOf(u), u, method: (opts && opts.method) || 'GET', t: Date.now() });
  if (!perf) return origFetch(url, opts);
  return new Promise((resolve, reject) => { perf.queue.push({ url, opts, resolve, reject }); pump(); });
};
function pump() {
  while (perf && perf.active < perf.cap && perf.queue.length) {
    const job = perf.queue.shift(); perf.active++;
    const p = perf;
    setTimeout(async () => {
      try { job.resolve(await origFetch(job.url, job.opts)); } catch (e) { job.reject(e); }
      p.active--; pump();
    }, perf.service(String(job.url)));
  }
}
const inv = sku => sandbox.psSbInvFor(sku);
const idxOf = sku => sandbox.psSbProductIdxForSku(sku);
const firstOf = k => { const x = callLog.find(c => c.kind === k); return x ? x.n : -1; };
const countOf = k => callLog.filter(c => c.kind === k).length;
const invStates = () => vm.runInContext('window._psSbInv || {}', sandbox);
const invPending = () => Object.values(invStates()).some(a => a && a.state === 'loading');
async function ticks(n) { for (let i = 0; i < (n || 20); i++) await new Promise(r => setImmediate(r)); }
function holdInv() { let ok, ko; const p = new Promise((r, j) => { ok = r; ko = j; }); return { defer: () => p, release: (sku, spec) => { try { ok(invReadBuild(sku, spec)); } catch (e) { ko(e); } } }; }
async function startLego(extra) {
  resetAll(); callLog.length = 0;
  Object.assign(salesRead, LEGO_SALES());
  if (extra && extra.inv) invRead = Object.assign(invRead, extra.inv);
  const cur0 = fixture(LEG, 'LEGO'); setCur(cur0);
  setSplitActive(Object.assign({}, ALL_ON)); setSplitManual({});
  sbConfig.products = LEGO_SB(); sbConfig.defer = null; ebConfig.listings = (extra && extra.eb) || [];
  invRead = Object.assign(invRead, Object.assign({}, LEGO_INV, (extra && extra.inv) || {}));
  const p = Promise.all([sandbox.psCheckSellbrite(LEG, 'LEGO'), sandbox.psCheckEbaySellerListings(LEG, 'LEGO', '')]);
  return p;
}

// ── deterministic performance model (capacity 2) ─────────────────────────
const SALES_MS = 400, FAST_MS = 20;
async function perfRun() {
  resetAll(); callLog.length = 0;
  Object.assign(salesRead, LEGO_SALES());
  setCur(fixture(LEG, 'LEGO')); setSplitActive(Object.assign({}, ALL_ON)); setSplitManual({});
  sbConfig.products = LEGO_SB(); sbConfig.defer = null; ebConfig.listings = [];
  invRead = Object.assign(invRead, LEGO_INV);
  perf = { cap: 2, active: 0, queue: [], service: u => (u.includes('/ebay/savvy-sales') ? SALES_MS : FAST_MS) };
  const t0 = Date.now();
  let searchDone = null, invDone = null;
  const run = Promise.all([sandbox.psCheckSellbrite(LEG, 'LEGO'), sandbox.psCheckEbaySellerListings(LEG, 'LEGO', '')]);
  while (Date.now() - t0 < 10000) {
    await new Promise(r => setTimeout(r, 2));
    const inv = invStates();
    if (searchDone == null && Object.keys(inv).length) searchDone = Date.now() - t0;
    if (searchDone != null && invDone == null && !invPending()) invDone = Date.now() - t0;
    const st = vm.runInContext('window._psSales || {skus:{}}', sandbox);
    const salesDone = st.order && st.order.length === 3 && Object.values(st.skus).every(e => e.state !== 'loading');
    if (invDone != null && salesDone) break;
  }
  await run.catch(() => {});
  const total = Date.now() - t0;
  const out = { skuDiscoveredMs: searchDone, inventoryConfirmedMs: invDone, allDoneMs: total,
    order: callLog.filter(c => c.kind === 'inventory' || c.kind === 'sales').map(c => c.kind[0]).join(''),
    counts: { search: countOf('search'), inventory: countOf('inventory'), sales: countOf('sales'), location: countOf('location'), sellerListings: countOf('seller-listings') },
    invOk: Object.values(invStates()).every(a => a && a.state === 'ok') };
  perf = null;
  return out;
}

if (process.env.PS22C0A_PERF_ONLY) {
  (async () => { fs.writeFileSync(process.env.PS22C0A_OUT, JSON.stringify(await perfRun())); process.exit(0); })()
    .catch(e => { console.error(e); process.exit(2); });
} else (async () => {
['psSalesHoldUntilInventory', 'psSalesReleaseAfterInventory', 'psSalesAfterInventory']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1–4 — inventory first; sales wait for the inventory phase to SETTLE');
{
  await startLego(); await settleSales();
  checkTrue('1 first /sb/inventory is sent before the first /ebay/savvy-sales', firstOf('inventory') >= 0 && firstOf('sales') > firstOf('inventory'), JSON.stringify(callLog.map(c => c.kind)));
  const lastInv = Math.max(...callLog.filter(c => c.kind === 'inventory').map(c => c.n));
  checkTrue('1b every sales read is sent after the LAST inventory read (inventory phase settled)', callLog.filter(c => c.kind === 'sales').every(c => c.n > lastInv), JSON.stringify(callLog.map(c => c.kind)));
}
{
  const hi = holdInv();
  const run = startLego({ inv: { [S1]: { defer: hi.defer } } });
  await ticks(40);
  checkTrue('2 while inventory is pending: zero sales reads, card shows "Consultando inventario"', countOf('sales') === 0 && invPending() && countOf('inventory') >= 1, JSON.stringify(callLog.map(c => c.kind)));
  checkTrue('2b location reads NOT blocked by the inventory phase', countOf('location') === 3, JSON.stringify(callLog.map(c => c.kind)));
  hi.release(S1, LEGO_INV[S1]); await run; await settleSales();
  check('3 after inventory resolves, one sales read per exact SKU', callLog.filter(c => c.kind === 'sales').map(c => decodeURIComponent(c.u.split('sku=')[1])).sort(), [S1, S1PK, S2PK].sort());
}
for (const mode of ['http500', 'network', 'malformed']) {
  const hi = holdInv();
  const run = startLego({ inv: { [S1PK]: { defer: hi.defer } } });
  await ticks(40);
  const before = countOf('sales');
  hi.release(S1PK, { mode }); await run; await settleSales();
  checkTrue('4 inventory failure (' + mode + ') still releases sales; that SKU stays unconfirmed (not 0)', before === 0 && countOf('sales') === 3 && inv(S1PK).state === 'error' && inv(S1PK).available == null, JSON.stringify([before, countOf('sales'), inv(S1PK)]));
}
{
  resetAll(); callLog.length = 0; Object.assign(salesRead, LEGO_SALES());
  await scan(LEG, 'LEGO', LEGO_SB(), [], { keep: true, noSettle: true, inv: { [S1]: { mode: 'network' }, [S1PK]: { mode: 'network' }, [S2PK]: { mode: 'network' } } });
  await settleSales();
  checkTrue('4b ALL inventory reads failing still releases sales', countOf('sales') === 3 && [S1, S1PK, S2PK].every(k => inv(k).state === 'error'), JSON.stringify(callLog.map(c => c.kind)));
}
{
  resetAll(); callLog.length = 0; Object.assign(salesRead, { [S1PK]: { body: LEGO_1PK() } });
  await scan(LEG, 'LEGO', [], [ebL('336000000001', S1PK, 2, LEG)], { keep: true, noSettle: true });
  await settleSales();
  checkTrue('4c Sellbrite has no SKU (no inventory phase) → eBay-only SKU sales still start', countOf('inventory') === 0 && countOf('sales') === 1 && shows(S1PK, '7d', 155, '48 orders', '22.14'), JSON.stringify(callLog.map(c => c.kind)));
  resetAll(); callLog.length = 0; Object.assign(salesRead, { [S1PK]: { body: LEGO_1PK() } });
  await scan(LEG, 'LEGO', [], [ebL('336000000001', S1PK, 2, LEG)], { keep: true, noSettle: true, sbFail: true });
  await settleSales();
  checkTrue('4d /sb/search error (no inventory phase) → eBay-only SKU sales still start', countOf('sales') === 1, JSON.stringify(callLog.map(c => c.kind)));
}
{
  const hi = holdInv();
  const run = startLego({ inv: { [S1]: { defer: hi.defer } }, eb: [ebL('336000000009', 'LEG-673419373609-12pk', 1, LEG)] });
  await ticks(40);
  checkTrue('4e eBay own-listing SKUs also wait for the inventory phase', countOf('sales') === 0 && countOf('seller-listings') === 1, JSON.stringify(callLog.map(c => c.kind)));
  hi.release(S1, LEGO_INV[S1]); await run; await settleSales();
  checkTrue('4f …and start after it (Sellbrite + eBay-only SKU, each once)', countOf('sales') === 4 && callLog.some(c => c.kind === 'sales' && c.u.includes('12pk')), JSON.stringify(callLog.map(c => c.kind)));
}

section('5–12 — payloads, SKU set, dedupe, inventory semantics unchanged');
await startLego(); await settleSales();
checkTrue('5 inventory request unchanged: GET /sb/inventory?sku=<exact>, Bearer, no body', readCalls.length === 3 && readCalls.every(c => c.method === 'GET' && c.auth === 'Bearer fake-token' && /\/sb\/inventory\?sku=[^&]+$/.test(c.u)), JSON.stringify(readCalls));
checkTrue('6 sales request unchanged: GET /ebay/savvy-sales?sku=<exact>, Bearer, no body', salesCalls.length === 3 && salesCalls.every(c => c.method === 'GET' && c.auth === 'Bearer fake-token' && !c.body && /\/ebay\/savvy-sales\?sku=[^&]+$/.test(c.u)), JSON.stringify(salesCalls));
check('7 exact SKU set unchanged (inventory == sales == Sellbrite SKUs)', [readCalls.map(c => c.sku).sort(), salesCalls.map(c => c.sku).sort()], [[S1, S1PK, S2PK].sort(), [S1, S1PK, S2PK].sort()]);
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3), sbProd('leg-673419373609-1PK ', 3)], [ebL('336000000001', S1PK, 2, LEG)], {}, { inv: LEGO_INV });
check('8 sales dedupe unchanged (case/space + Sellbrite/eBay → one request)', salesCalls.map(c => c.sku), [S1PK]);
await startLego(); await settleSales();
check('9 inventory exact-SKU isolation (-1 / -1pk / -2pk distinct)', [inv(S1).available, inv(S1PK).available, inv(S2PK).available], [0, 431, 77]);
checkTrue('10 confirmed zero stays a real 0 (state ok, available 0)', inv(S1).state === 'ok' && inv(S1).available === 0, JSON.stringify(inv(S1)));
{
  resetAll(); Object.assign(salesRead, LEGO_SALES());
  await scan(LEG, 'LEGO', LEGO_SB(), [], { keep: true, noSettle: true, inv: Object.assign({}, LEGO_INV, { [S2PK]: { mode: 'http500' } }) });
  await settleSales();
  checkTrue('11 unknown inventory stays unknown (never 0)', inv(S2PK).state === 'error' && inv(S2PK).available == null, JSON.stringify(inv(S2PK)));
}
await startLego(); await settleSales();
checkTrue('12 authoritative warehouse from /sb/inventory (not /sb/search)', inv(S1PK).warehouse_uuid === WH && inv(S1PK).warehouse_uuid !== 'wh-1', JSON.stringify(inv(S1PK)));
checkTrue('12b inventory pipeline code unchanged vs 77d3cab', ['psReadSbInventory', 'psParseSbInventory', 'psApplySbInventory', 'psLoadSbInventory', 'psSbInvFresh', 'psReconcileSbInventory', 'psSbCardInvHtml', 'psRenderSbRecord'].every(sameAsBefore), '');
checkTrue('12c sales pipeline code unchanged vs 77d3cab', ['psRequestSavvySales', 'psReadSavvySales', 'psParseSavvySales', 'psSalesFresh', 'psSalesReset', 'psSavvySalesHtml', 'psSavvySalesCellHtml', 'psRenderSavvySales', 'psAuthFetch'].every(sameAsBefore), '');

section('13–18 — stale scans');
{
  // scan A (LEGO) inventory pending → employee scans B (IRW)
  const hi = holdInv();
  const runA = startLego({ inv: { [S1]: { defer: hi.defer } } });
  await ticks(40);
  const IRW = '710363598525', SIRW = 'IRW-710363598525-2';
  invRead[SIRW] = { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 9, on_hand: 9 }] };
  salesRead[SIRW] = { body: salesOk(SIRW, 2, win(1, 1, 0.143, 2), win(2, 2, 0.067, 2), win(3, 3, 0.033, 2)) };
  const nBeforeB = callLog.length;
  setCur(fixture(IRW, 'Irwin Naturals')); sbConfig.products = [sbProd(SIRW, 4)];
  await Promise.all([sandbox.psCheckSellbrite(IRW, 'Irwin Naturals'), sandbox.psCheckEbaySellerListings(IRW, 'Irwin Naturals', '')]);
  await settleSales();
  const afterB = callLog.slice(nBeforeB);
  checkTrue('15/17 scan changes while A inventory pending → B starts its own inventory', afterB.some(c => c.kind === 'inventory' && c.u.includes(SIRW)), JSON.stringify(afterB.map(c => c.kind + ' ' + c.u.split('sku=')[1])));
  checkTrue('18 B then starts its own sales (after its inventory)', afterB.some(c => c.kind === 'sales' && c.u.includes(SIRW)) && afterB.findIndex(c => c.kind === 'sales') > afterB.findIndex(c => c.kind === 'inventory'), '');
  const nBeforeRelease = callLog.length;
  hi.release(S1, LEGO_INV[S1]); await runA; await settleSales();
  const afterRelease = callLog.slice(nBeforeRelease);
  checkTrue('16 A never starts sales after its inventory settles (not current)', !afterRelease.some(c => c.kind === 'sales') && !callLog.some(c => c.kind === 'sales' && c.u.includes(LEG)), JSON.stringify(afterRelease.map(c => c.kind)));
  checkTrue('13 A\'s late inventory never paints into B', !vm.runInContext('Object.keys(window._psSbInv || {})', sandbox).some(k => k.includes(LEG)) && inv(SIRW).available === 9 && (vm.runInContext('window._psSbState', sandbox).upc === IRW), JSON.stringify(Object.keys(invStates())));
  checkTrue('13b A\'s remaining SKUs were never read after the switch', !afterRelease.some(c => c.kind === 'inventory'), JSON.stringify(afterRelease.map(c => c.kind)));
}
{
  const hs = hold2();
  resetAll(); salesRead[S1PK] = { defer: hs.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  await settleSales();
  const IRW = '710363598525', SIRW = 'IRW-710363598525-2';
  salesRead[SIRW] = { body: salesOk(SIRW, 2, win(1, 1, 0.143, 2), win(2, 2, 0.067, 2), win(3, 3, 0.033, 2)) };
  await scan(IRW, 'Irwin Naturals', [sbProd(SIRW, 4)], [], { keep: true, noSettle: true });
  await settleSales();
  hs.release(S1PK, { body: LEGO_1PK() }); await settleSales();
  checkTrue('14 stale sales response ignored (other UPC)', !slot().includes(S1PK) && slot().includes(SIRW) && !slot().includes('155'), slot());
}
{
  resetAll(); Object.assign(salesRead, LEGO_SALES());
  await scan(LEG, 'LEGO', LEGO_SB(), [], { keep: true, noSettle: true, inv: LEGO_INV });
  await scan(LEG, 'LEGO', LEGO_SB(), [], { keep: true, noSettle: true, inv: LEGO_INV });
  await settleSales();
  check('14b re-scan of the same UPC: one sales read per SKU per scan (3 + 3)', salesCalls.length, 6);
}

section('19–25 — Savvy Sales UI and safety unchanged');
await startLego(); await settleSales();
checkTrue('19 compact table unchanged (rows, cells, LEGO values)', slot().includes('<table id="ps-savvy-sales-table">') && shows(S1PK, '7d', 155, '48 orders', '22.14') && shows(S2PK, '90d', 38, '9 orders', '0.42') && cell(S2PK, '7d').includes('= 30 physical units'), slot());
checkTrue('20 refunds unchanged', cell(S1PK, '30d').includes('⚠️ 1 refunded order included') && cell(S1PK, '90d').includes('⚠️ 3 refunded orders included'), block(S1PK));
checkTrue('21 cancellations unchanged', cell(S1PK, '90d').includes('Excluded: 3 cancelled orders / 5 packs'), block(S1PK));
checkTrue('22 nested-window note unchanged', slot().includes('7d ⊂ 30d ⊂ 90d are rolling nested windows: do not add them together.'), '');
checkTrue('23 avg sold price still hidden', !/\$|avg|average|precio|price/i.test(slot()), '');
{ const n = callLog.length; await new Promise(r => setTimeout(r, 60)); await settleSales(); check('24 no polling (no new requests after settle)', callLog.length, n); }
checkTrue('25 no writes during a scan (only GETs; no update-inventory / create-product)', callLog.every(c => c.method === 'GET') && countOf('update-inventory') === 0 && ssSaveCalls.length === 0, JSON.stringify(callLog.filter(c => c.method !== 'GET')));
checkTrue('25b #22C-0A code issues no request itself and has no timers', (() => { const a = appSrc.indexOf('// ━━ #22C-0A'); const b = appSrc.indexOf('async function psReadSavvySales(', a); const blk = a > 0 && b > a ? appSrc.slice(a, b) : 'X'; return !/fetch|psAuthFetch|setTimeout|setInterval|POST|PUT|PATCH|DELETE/.test(blk); })(), '');

section('26–28 — SUMAR / REEMPLAZAR / post-write reconcile unchanged');
async function click(sku, modo, qty) {
  const i = idxOf(sku);
  getEl('ps-pack-sbqty-' + i).value = String(qty);
  invCalls = []; readCalls = [];
  await sandbox.psUpdateSellbriteInventory(i, modo, 'pack');
  return { i, call: invCalls[0], reads: readCalls.map(r => r.sku) };
}
await startLego(); await settleSales();
{
  invConfig.current = 431;
  let r = await click(S1PK, 'add', 5);
  check('26 SUMAR body unchanged (exact SKU, confirmed warehouse, mode add)', r.call && r.call.body, { sku: S1PK, warehouse_uuid: WH, quantity: 5, mode: 'add' });
  check('28 post-write reconcile: one authoritative re-read of that exact SKU', r.reads, [S1PK]);
  r = await click(S1PK, 'set', 869);
  check('27 REEMPLAZAR body unchanged (mode set)', r.call && r.call.body, { sku: S1PK, warehouse_uuid: WH, quantity: 869, mode: 'set' });
  checkTrue('26b write/reconcile code unchanged vs 77d3cab', ['psUpdateSellbriteInventory', 'psReconcileSbInventory', 'psAdjustSbQty', 'psPersistLocation'].every(sameAsBefore), '');
}

section('29–37 — locks, #21F, Bulk Split, CSV, Return-to-Fix unchanged');
await startLego(); await settleSales();
check('29 1pk/2pk still locked', [sandbox.psIsPackLocked(LEG, 1), sandbox.psIsPackLocked(LEG, 2)], [true, true]);
checkTrue('29b lock code unchanged vs 77d3cab', ['psPackState', 'psIsPackLocked', 'psRefreshPackLocks', 'psAutoExcludeConfirmedPacks', 'psLockedPackCardHtml'].every(sameAsBefore), '');
checkTrue('30 #21F location UI code unchanged vs 77d3cab', ['psSsLocEditorHtml', 'psSsLocSummaryHtml', 'psRenderSsLoc', 'psCheckShipStationLocation', 'psSaveShipStationLocation', 'psRemoveLocation'].every(sameAsBefore), '');
checkTrue('31 Bulk Split code unchanged vs 77d3cab', ['computeSplit', 'updateSplitCalc', 'addSplitPacksToCSV', 'renderSplitCalculatorHTML', 'applyVerdict'].every(sameAsBefore), '');
checkTrue('32 getDemandTier() unchanged', sameAsBefore('getDemandTier'), '');
checkTrue('33 DEMAND_TIERS unchanged', beforeSrc != null && (appSrc.match(/const DEMAND_TIERS = \{[\s\S]*?\n\};/) || [''])[0] === (beforeSrc.match(/const DEMAND_TIERS = \{[\s\S]*?\n\};/) || ['x'])[0], '');
checkTrue('34 internal sold.count placeholder unchanged (both paths)', (appSrc.match(/pricing = \{ sold: \{ avg: 0, count: 0 \}/g) || []).length === 2, '');
{
  // New product, same inputs as the #21 golden CSV; an existing 4pk SKU makes a real sales read happen.
  resetAll();
  const NAT4 = 'NAT-012345678905-4';
  salesRead[NAT4] = { body: salesOk(NAT4, 4, win(3, 5, 0.714, 4), win(9, 14, 0.467, 4), win(20, 31, 0.344, 4)) };
  setSplitActive({ 1: true, 2: true, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  setSplitManual({ 1: 5, 2: 3, 3: 2, 6: 1, 12: 1 });
  const c = { upc: NEWU, brand: 'Nature Made', title: 'Nature Made Vitamin C Gummies 250mg Immune Support 80ct',
    category: '11776', _description: 'Full description already generated.', _specifics: { Formulation: 'Gummy', 'Item Form': 'Gummy' },
    _shade: '', _expDate: 'Oct 2033', location: 'A/1', _bundleImg: 'https://cdn.example/g.jpg', ebay: { prices: { low: 9.99, avg: 18.51 } }, _packImages: {} };
  [1, 2, 3, 6, 12].forEach(p => c._packImages[p] = { front: 'https://cdn.example/p' + p + '.jpg' });
  setCur(c);
  sbConfig.products = [sbProd(NAT4, 5)];
  invRead[NAT4] = { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 5, on_hand: 5 }] };
  await Promise.all([sandbox.psCheckSellbrite(NEWU, 'Nature Made'), sandbox.psCheckEbaySellerListings(NEWU, 'Nature Made', c.title)]);
  await settleSales();
  setBulk([]); await sandbox.addSplitPacksToCSV();
  const rows = getBulk().map(b => b.sku);
  const ex = await captureExport();
  const golden = fs.readFileSync(path.join(__dirname, 'test-fixtures', 'new-product-csv-4e47c34.csv'), 'utf8');
  check('35 CSV rows unchanged', rows, ['NAT-012345678905-1pk', 'NAT-012345678905-2pk', 'NAT-012345678905-3pk', 'NAT-012345678905-6pk', 'NAT-012345678905-12pk']);
  checkTrue('36 CSV bytes identical to the #21 golden file (sales read happened: ' + salesCalls.length + ')', ex.csv === golden && salesCalls.length === 1, ex.csv ? 'len ' + ex.csv.length : 'no csv');
}
{
  const sku2 = 'IRW-710363598525-2pk', IRW = '710363598525';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false }, manual: { 2: 3 } });
  await settleSales();
  check('37 Return-to-Fix target still editable; split untouched', [sandbox.psLockSessionEditAllowed(IRW, sku2), act()[2], getSplitManual()[2]], [true, true, 3]);
  checkTrue('37b Return-to-Fix code unchanged vs 77d3cab', ['psReturnAndFixExpDate', 'psCaptureEditorSnapshot'].every(sameAsBefore), '');
}

section('38–40 — no timeout / URL / request-count changes');
const timeoutsOf = src => (src.match(/setTimeout\([^;]*?,\s*\d+\s*\)/g) || []).map(x => x.match(/(\d+)\s*\)$/)[1]).sort().join(',');
checkTrue('38 every setTimeout delay in app.js unchanged vs 77d3cab', beforeSrc != null && timeoutsOf(appSrc) === timeoutsOf(beforeSrc), '');
checkTrue('38b /sb/search 10 s abort and seller-listings 15 s abort unchanged', appSrc.includes('setTimeout(function(){ sbCtrl.abort(); }, 10000)') && appSrc.includes('setTimeout(function(){ ctrl.abort(); }, 15000)'), '');
check('39 SAVVY_API unchanged', (appSrc.match(/^const SAVVY_API = '[^']+';/m) || [''])[0], (beforeSrc || '').match(/^const SAVVY_API = '[^']+';/m) ? beforeSrc.match(/^const SAVVY_API = '[^']+';/m)[0] : 'x');
checkTrue('39b app.js diff vs 77d3cab touches only the #22C-0A gating', beforeSrc != null && (() => {
  const a = appSrc.indexOf('// ━━ #22C-0A'), b = appSrc.indexOf('async function psReadSavvySales(', a);
  let x = appSrc.slice(0, a) + appSrc.slice(b);
  x = x.replace("  var salesSt = window._psSales;          // #22C-0A: ventas esperan al inventario\n  psSalesHoldUntilInventory(salesSt);\n", '')
    .replace("      psSalesReleaseAfterInventory(salesSt);   // #22C-0A: no hay inventario que leer\n", '')
    .replace("    // #22C-0A: se piden DESPUÉS de que termine la fase de inventario.\n    psSalesAfterInventory(upcClean, sbListings", "    psRequestSavvySales(upcClean, sbListings")
    .replace("    Promise.resolve(_invLoad).then(function(){ psSalesReleaseAfterInventory(salesSt); },\n                                   function(){ psSalesReleaseAfterInventory(salesSt); });\n", '')
    .replace("    psSalesReleaseAfterInventory(salesSt);   // #22C-0A: sin fase de inventario\n", '')
    .replace("  psSalesAfterInventory(upcClean, listings.map(", "  psRequestSavvySales(upcClean, listings.map(");
  return x === beforeSrc;
})(), '');

section('PERFORMANCE — capacity-2 backend, cold sales ' + SALES_MS + ' ms, other requests ' + FAST_MS + ' ms');
const after = await perfRun();
let before = null, childErr = '';
try {
  const tmp = path.join(require('os').tmpdir(), 'ps22c0a-before-' + process.pid + '.js');
  const outF = path.join(require('os').tmpdir(), 'ps22c0a-before-' + process.pid + '.json');
  fs.writeFileSync(tmp, beforeSrc || '');
  require('child_process').execFileSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { PS22C0A_PERF_ONLY: '1', PS22C0A_APP: tmp, PS22C0A_OUT: outF }), stdio: 'ignore', cwd: __dirname });
  before = JSON.parse(fs.readFileSync(outF, 'utf8')); fs.unlinkSync(tmp); fs.unlinkSync(outF);
} catch (e) { childErr = String(e && e.message || e).slice(0, 200); }
console.log('  BEFORE (77d3cab): ' + JSON.stringify(before));
console.log('  AFTER  (#22C-0A): ' + JSON.stringify(after));
checkTrue('P1 before-run obtained from unmodified 77d3cab', !!before, childErr);
checkTrue('P2 BEFORE: inventory waits behind the slow sales work (≥ ' + SALES_MS + ' ms)', !!before && before.inventoryConfirmedMs >= SALES_MS, JSON.stringify(before));
checkTrue('P3 AFTER: inventory confirmed well before the slow sales work (< ' + SALES_MS / 2 + ' ms)', after.inventoryConfirmedMs != null && after.inventoryConfirmedMs < SALES_MS / 2 && after.invOk, JSON.stringify(after));
checkTrue('P4 AFTER: request order is all inventory, then all sales', after.order === 'iiisss', after.order);
checkTrue('P5 AFTER: sales still complete (not blocked forever)', after.allDoneMs < 10000 && after.order.includes('s'), JSON.stringify(after));
check('40 no request-count increase (same counts per endpoint BEFORE vs AFTER)', after.counts, before ? before.counts : null);

section('NEGATIVE-CONTROL NOTE');
console.log('  Against 77d3cab app.js the ordering / gating / performance checks fail (sales are sent before inventory).');

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
