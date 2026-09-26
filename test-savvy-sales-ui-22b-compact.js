#!/usr/bin/env node
/**
 * SAVVY SALES — COMPACT TABLE + NO FAKE BULK SPLIT SALES CLAIM (#22B-UI)
 *
 * Display-only change on top of #22B (66c9765):
 *  - SAVVY SALES — EBAY is one compact table: a row per exact SKU, a column
 *    per rolling window (7D / 30D / 90D). Narrow screens (<480px) stack each
 *    row into a card (@media + data-label); wider content scrolls inside
 *    the panel only.
 *  - Bulk Split no longer shows "(N vendidos en 90 días)" — N was the
 *    fixed internal placeholder, never a real sale. The label now says
 *    "Demanda automática actual: <tier>". The internal sold.count, the
 *    demand tier and every Bulk Split number are unchanged: this suite runs
 *    the SAME scenarios against the unmodified 66c9765 app.js in a child
 *    process and requires identical results, tiers, allocations and CSV.
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
const appSrc = fs.readFileSync(process.env.PS22BC_APP || path.join(__dirname, 'app.js'), 'utf8');
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
try { baseSrc = require('child_process').execSync('git show 66c976555be423d667377ff918f77a4e9c48dd7b:app.js', { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (e) { baseSrc = null; }
function fnSrc(src, name) {
  const re = new RegExp('^(async )?function ' + name + '\\(', 'm'); const m = re.exec(src); if (!m) return null;
  const rest = src.slice(m.index + 1); const n = /^(async )?function |^\/\/ ━━|^var |^const |^let |^window\./m.exec(rest.slice(1));
  return src.slice(m.index, n ? m.index + 2 + n.index : undefined);
}
function unchangedFn(name) { return baseSrc != null && fnSrc(appSrc, name) != null && fnSrc(appSrc, name) === fnSrc(baseSrc, name); }
const block22b = (() => { const a = appSrc.indexOf('// ━━ VENTAS PROPIAS DE SAVVY EN EBAY POR SKU EXACTO (Implementación #22B)'); const b = appSrc.indexOf('async function psCheckSellbrite(', a); return a >= 0 && b > a ? appSrc.slice(a, b) : ''; })();

const fetchPaths22b = (block22b.match(/psAuthFetch\(\s*'[^']*'/g) || []).map(x => x.replace(/psAuthFetch\(\s*'/, '').replace(/'$/, ''));
const BASE_SHA = '66c976555be423d667377ff918f77a4e9c48dd7b';
const GCL = '893268000222';
const G = n => 'G00-893268000222-' + n;
const GCL_PACKS = [1, 4, 5, 6, 7, 12];
function wp(orders, packs, days, pack) { return win(orders, packs, Math.round(packs / days * 1000) / 1000, pack); }
// Browser-acceptance shape (not hardcoded in app code): 7d / 30d / 90d packs per pack.
const GCL_REF = { 1: [0, 5, 22], 4: [0, 1, 1], 5: [0, 1, 2], 6: [0, 0, 0], 7: [0, 2, 3], 12: [0, 0, 0] };
const GCL_SALES = () => { const o = {}; GCL_PACKS.forEach(p => { const [a, b, c] = GCL_REF[p]; o[G(p)] = { body: salesOk(G(p), p, wp(a, a, 7, p), wp(b, b, 30, p), wp(c, c, 90, p)) }; }); return o; };
const GCL_SB = () => GCL_PACKS.map(p => sbProd(G(p), 3));
const GCL_INV = {}; GCL_PACKS.forEach(p => { GCL_INV[G(p)] = { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 3, on_hand: 3 }] }; });

// ── Bulk Split snapshot (same scenarios run against base app.js in a child) ──
async function splitSnapshot(sales) {
  await scanWith(LEG, 'LEGO', LEGO_SB(), [], sales, { inv: LEGO_INV, active: DEF });
  sandbox.updateSplitCalc();
  const card = getEl('split-calc-card');
  const out = { results: results(), tier: card.dataset.tier, active: JSON.stringify(act()) };
  out.computeSplit = JSON.stringify([41, 100, 1000, 7].map(t => ['alta', 'media', 'baja'].map(k => [sandbox.computeSplit(t, k, DEF), sandbox.computeSplit(t, k, ALL_ON)])));
  out.tiers = JSON.stringify([0, 1, 4, 5, 19, 20, 999].map(n => sandbox.getDemandTier(n)));
  out.demandTiers = vm.runInContext('JSON.stringify(DEMAND_TIERS)', sandbox);
  const cardHtml = sandbox.renderSplitCalculatorHTML(vm.runInContext('({ pricing: { sold: { avg: 0, count: 0 } }, soldCount: 0 })', sandbox));
  out.cardAttrs = (cardHtml.match(/data-auto-tier="[^"]*" data-sold-count="[^"]*"/) || [''])[0];
  out.adds = JSON.stringify(await addAll());
  out.bulk = JSON.stringify(getBulk());
  const ex = await captureExport(); out.csv = ex.csv; out.alerts = JSON.stringify(ex.alerts);
  return out;
}
const SCENARIOS = {
  real: () => LEGO_SALES(),
  zero: () => ({ [S1PK]: { mode: 'zero' }, [S2PK]: { mode: 'zero' }, [S1]: { mode: 'zero' } }),
  unconfirmed: () => ({ [S1PK]: { status: 502, body: { sku: S1PK, status: 'unconfirmed', complete: false, reason: 'ebay_timeout', windows: null } }, [S2PK]: { mode: 'network' }, [S1]: { mode: 'malformed' } }),
  huge: () => ({ [S1PK]: { body: salesOk(S1PK, 1, win(9999, 99999, 9999, 1), win(9999, 99999, 3333, 1), win(9999, 99999, 1111, 1)) }, [S2PK]: { body: salesOk(S2PK, 2, win(9999, 99999, 9999, 2), win(9999, 99999, 3333, 2), win(9999, 99999, 1111, 2)) } })
};
const NAT4 = 'NAT-012345678905-4';   // NEWU (012345678905) comes from the shared harness
const NEW_SALES = {
  real: () => ({ [NAT4]: { body: salesOk(NAT4, 4, win(3, 5, 0.714, 4), win(9, 14, 0.467, 4), win(20, 31, 0.344, 4)) } }),
  zero: () => ({ [NAT4]: { mode: 'zero' } }),
  unconfirmed: () => ({ [NAT4]: { status: 502, body: { sku: NAT4, status: 'unconfirmed', complete: false, reason: 'ebay_timeout', windows: null } } }),
  huge: () => ({ [NAT4]: { body: salesOk(NAT4, 4, win(9999, 99999, 9999, 4), win(9999, 99999, 3333, 4), win(9999, 99999, 1111, 4)) } })
};
// Same inputs as the #21 golden-CSV test (a new product), plus one existing
// Sellbrite SKU (4pk, not in the split) so a Savvy Sales read really happens.
async function newProductSnapshot(sales) {
  resetAll();
  Object.assign(salesRead, sales);
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
  const o = { results: results(), tier: getEl('split-calc-card').dataset.tier, active: JSON.stringify(act()), salesReads: salesCalls.map(x => x.sku).join(','), salesPainted: slot().includes('data-sku="' + NAT4 + '"') };
  setBulk([]);
  await sandbox.addSplitPacksToCSV();
  o.bulk = JSON.stringify(getBulk());
  const ex = await captureExport(); o.csv = ex.csv; o.alerts = JSON.stringify(ex.alerts);
  return o;
}
async function allSnapshots() {
  const o = {};
  for (const [k, f] of Object.entries(SCENARIOS)) { o[k] = await splitSnapshot(f()); o[k].newProduct = await newProductSnapshot(NEW_SALES[k]()); }
  return o;
}

if (process.env.PS22BC_SNAPSHOT_ONLY) {
  // Written synchronously to a file: piped stdout is async and process.exit()
  // could truncate a large snapshot.
  (async () => { fs.writeFileSync(process.env.PS22BC_SNAPSHOT_OUT, JSON.stringify(await allSnapshots())); process.exit(0); })()
    .catch(e => { console.error(e); process.exit(2); });
} else (async () => {
['psSavvySalesHtml', 'psSavvySalesCellHtml', 'psRenderSavvySales', 'psRequestSavvySales']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1–10, 18–19 — compact table structure (LEGO)');
await legoScan(LEGO_SALES());
const h = slot();
checkTrue('1 compact structure: one table, header row, one <tr> per exact SKU', h.includes('<table id="ps-savvy-sales-table">') && /<th>SKU \/ Pack<\/th><th>7D<\/th><th>30D<\/th><th>90D<\/th>/.test(h) && (h.match(/<tr data-sku=/g) || []).length === 3, h);
checkTrue('1b no repetitive per-window sentences from the old layout', !/7d: <strong>|gross packs sold ·/.test(h), h);
checkTrue('2 exact SKU visible in its row', [S1, S1PK, S2PK].every(s => block(s).includes('>' + s + '</div>')), h);
checkTrue('3 pack visible', block(S1PK).includes('<strong>1pk</strong>') && block(S2PK).includes('<strong>2pk</strong>') && block(S1).includes('<strong>1pk</strong>'), h);
check('4/5/6 7D, 30D, 90D cells present per SKU', [S1PK, S2PK].map(s => ['7d', '30d', '90d'].map(k => !!cell(s, k))), [[true, true, true], [true, true, true]]);
checkTrue('7 gross label in the header (not "net")', h.includes('Gross packs sold · refunded orders remain included') && !/net sold|net sales|net packs|ventas netas/i.test(h), h);
checkTrue('8 orders visible', cell(S1PK, '7d').includes('48 orders') && cell(S2PK, '90d').includes('9 orders'), block(S1PK));
checkTrue('9 packs/day visible (packs, not units)', cell(S1PK, '7d').includes('22.14 packs/day') && cell(S2PK, '30d').includes('1.07 packs/day') && !h.includes('units/day'), block(S2PK));
checkTrue('10 physical units secondary for 2pk only', cell(S2PK, '7d').includes('<div class="ps-ss-sub">= 30 physical units</div>') && cell(S2PK, '90d').includes('= 76 physical units') && !block(S1PK).includes('physical units'), block(S2PK));
checkTrue('10b pack count is the primary number (units never the big figure)', cell(S2PK, '7d').indexOf('<span class="ps-ss-n">15</span>') >= 0 && !cell(S2PK, '7d').includes('<span class="ps-ss-n">30</span>'), cell(S2PK, '7d'));
checkTrue('18 nested-window note', h.includes('7d ⊂ 30d ⊂ 90d are rolling nested windows: do not add them together.'), h);
checkTrue('21 LEGO fixture readable: 1pk and 2pk separate rows with their own values', shows(S1PK, '7d', 155, '48 orders', '22.14') && shows(S1PK, '30d', 234, '105 orders', '7.80') && shows(S1PK, '90d', 273, '136 orders', '3.03') && shows(S2PK, '7d', 15, '5 orders', '2.14') && shows(S2PK, '30d', 32, '7 orders', '1.07') && shows(S2PK, '90d', 38, '9 orders', '0.42'), h);

section('11–17 — zero / unknown / loading / refunds / cancellations');
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { [S1PK]: { mode: 'zero' } }, { inv: LEGO_INV });
checkTrue('11 confirmed zero shows 0 in every window', ['7d', '30d', '90d'].every(k => shows(S1PK, k, 0, '0 orders', '0.00')) && !/—|N\/A|Unknown/.test(block(S1PK)), block(S1PK));
for (const [name, spec] of Object.entries({ 'HTTP 502': { status: 502, body: { sku: S1PK, status: 'unconfirmed', complete: false, reason: 'ebay_timeout', windows: null } }, 'complete=false': { body: Object.assign(LEGO_1PK(), { complete: false }) }, network: { mode: 'network' }, malformed: { mode: 'malformed' } })) {
  await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { [S1PK]: spec }, { inv: LEGO_INV });
  const b = block(S1PK);
  checkTrue('12 unknown (' + name + ') → ⚠️ Ventas no confirmadas, no 0, no cells', b.includes('⚠️ Ventas no confirmadas') && !/ps-ss-n|data-label=|\b0 orders\b/.test(b) && b.includes('colspan="3"'), b);
}
{
  const hd = hold2();
  resetAll(); salesRead[S1PK] = { defer: hd.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  const b = block(S1PK);
  checkTrue('13 loading → "⏳ Consultando ventas reales...", never 0', b.includes('⏳ Consultando ventas reales...') && !/ps-ss-n|\b0\b/.test(noSku(b, S1PK)), b);
  hd.release(S1PK, { body: LEGO_1PK() }); await settleSales();
}
await legoScan(LEGO_SALES());
checkTrue('14 refund warning only where refunds exist (1pk 30d=1, 90d=3; none on 7d or 2pk)', cell(S1PK, '30d').includes('⚠️ 1 refunded order included') && cell(S1PK, '90d').includes('⚠️ 3 refunded orders included') && !cell(S1PK, '7d').includes('refunded') && !block(S2PK).includes('refunded'), block(S1PK));
checkTrue('15 refunds not subtracted', shows(S1PK, '30d', 234, '105 orders', '7.80') && shows(S1PK, '90d', 273, '136 orders', '3.03'), block(S1PK));
checkTrue('16 cancellations shown per window', cell(S1PK, '7d').includes('Excluded: 1 cancelled order / 1 pack') && cell(S1PK, '30d').includes('Excluded: 2 cancelled orders / 3 packs') && cell(S1PK, '90d').includes('Excluded: 3 cancelled orders / 5 packs') && !block(S2PK).includes('Excluded'), block(S1PK));
checkTrue('17 cancelled packs not added back (7d stays 155, not 156)', shows(S1PK, '7d', 155, '48 orders', '22.14') && !block(S1PK).includes('<span class="ps-ss-n">156</span>'), block(S1PK));
checkTrue('19 avg sold price absent', !/\$|avg|average|precio|price/i.test(slot()), slot());

section('20 — Good Clean Love, 6 exact SKUs');
resetAll(); Object.assign(salesRead, GCL_SALES());
await scan(GCL, 'Good Clean Love', GCL_SB(), [], { keep: true, noSettle: true, inv: GCL_INV });
await settleSales();
{
  const g = slot();
  check('20 six rows, one per exact SKU, sorted by pack', (g.match(/<tr data-sku="([^"]+)"/g) || []).map(x => x.slice(14, -1)), GCL_PACKS.map(G));
  check('20b values per exact SKU (7d/30d/90d packs)', GCL_PACKS.map(p => ['7d', '30d', '90d'].map(k => (cell(G(p), k).match(/<span class="ps-ss-n">(\d+)<\/span>/) || [])[1])), GCL_PACKS.map(p => GCL_REF[p].map(String)));
  checkTrue('20c confirmed zeros show 0 (6pk, 12pk, all 7d)', ['7d', '30d', '90d'].every(k => cell(G(6), k).includes('<span class="ps-ss-n">0</span>') && cell(G(12), k).includes('<span class="ps-ss-n">0</span>')) && GCL_PACKS.every(p => cell(G(p), '7d').includes('<span class="ps-ss-n">0</span>')), g);
  checkTrue('20d multipack units secondary (7pk 90d: 3 packs = 21 units)', cell(G(7), '90d').includes('<span class="ps-ss-n">3</span> packs') && cell(G(7), '90d').includes('= 21 physical units'), cell(G(7), '90d'));
  checkTrue('20e compact: one table, 6 rows, no stacked per-window paragraphs', (g.match(/<table/g) || []).length === 1 && (g.match(/<tr data-sku=/g) || []).length === 6 && (g.match(/<td data-label=/g) || []).length === 18, '');
  check('33/34 one request per exact GCL SKU', salesCalls.map(c => c.sku).sort(), GCL_PACKS.map(G).sort());
}

section('22–27 — fake sales claims removed; tier and internal sold.count unchanged');
const rr = fnSrc(appSrc, 'renderResult') || '', rsc = fnSrc(appSrc, 'renderSplitCalculatorHTML') || '', rscBase = fnSrc(baseSrc || '', 'renderSplitCalculatorHTML') || '';
checkTrue('22 no fake market "✅ Sold (90d)" line', !rr.includes('<strong>Sold (90d):</strong>'), '');
checkTrue('23 no "vendidos en 90 días" claim in Bulk Split (base had it)', !/vendidos en 90 d/.test(rsc) && /vendidos en 90 d/.test(rscBase), '');
{
  const card = sandbox.renderSplitCalculatorHTML(vm.runInContext('({ pricing: { sold: { avg: 0, count: 0 } }, soldCount: 0 })', sandbox));
  checkTrue('23b rendered card has no sales-count claim', !/vendidos|\bventas\b|sold/i.test(card.replace(/data-sold-count="\d+"/, '')), card);
  checkTrue('24 demand tier still rendered (label slot + automatic tier attribute)', card.includes('Demanda automática actual: <strong id="split-tier-label"') && card.includes('data-auto-tier="baja"') && card.includes('cambiar'), card);
  await legoScan(LEGO_SALES()); sandbox.updateSplitCalc();
  checkTrue('24b tier label filled by updateSplitCalc (unchanged)', /Demanda|demanda/.test(getEl('split-tier-label').textContent || getEl('split-tier-label').innerHTML), getEl('split-tier-label').textContent);
}
checkTrue('25 getDemandTier() unchanged', unchangedFn('getDemandTier'), '');
checkTrue('26 DEMAND_TIERS unchanged', baseSrc != null && (appSrc.match(/const DEMAND_TIERS = \{[\s\S]*?\n\};/) || [''])[0] === (baseSrc.match(/const DEMAND_TIERS = \{[\s\S]*?\n\};/) || ['x'])[0], '');
checkTrue('27 internal sold placeholder still produced (both paths) and still feeds the tier', (appSrc.match(/pricing = \{ sold: \{ avg: 0, count: 0 \}/g) || []).length === 2 && rsc.includes('const soldCount = (ebay && (ebay.soldCount || (ebay.pricing && ebay.pricing.sold && ebay.pricing.sold.count))) || 0;') && rsc.includes('const autoTier = getDemandTier(soldCount);') && rsc.includes('data-sold-count="${soldCount}"'), '');
checkTrue('27b renderSplitCalculatorHTML() = base minus the one misleading line', rsc === rscBase.replace('      Demanda detectada: <strong id="split-tier-label" style="color:var(--ac)"></strong>\n      (${soldCount} vendidos en 90 días)\n', '      Demanda automática actual: <strong id="split-tier-label" style="color:var(--ac)"></strong>\n'), '');
['computeSplit', 'updateSplitCalc', 'addSplitPacksToCSV', 'exportCSV', 'applyVerdict', 'callClaude', 'finishAnalyze']
  .forEach(fn => checkTrue('28b source unchanged vs 66c9765: ' + fn + '()', unchangedFn(fn), ''));

section('28–32 — Bulk Split BEFORE (66c9765) vs AFTER (#22B-UI): identical');
const after = await allSnapshots();
let before = null, childErr = '';
try {
  const tmp = require('path').join(require('os').tmpdir(), 'ps22bc-base-app-' + process.pid + '.js');
  const snapOut = require('path').join(require('os').tmpdir(), 'ps22bc-base-snap-' + process.pid + '.json');
  fs.writeFileSync(tmp, baseSrc || '');
  require('child_process').execFileSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { PS22BC_SNAPSHOT_ONLY: '1', PS22BC_APP: tmp, PS22BC_SNAPSHOT_OUT: snapOut }), stdio: 'ignore', cwd: __dirname });
  before = JSON.parse(fs.readFileSync(snapOut, 'utf8'));
  fs.unlinkSync(tmp); fs.unlinkSync(snapOut);
} catch (e) { childErr = String(e && e.message || e).slice(0, 300); }
checkTrue('before-snapshot obtained from unmodified 66c9765 app.js', !!before && baseSrc != null, childErr);
for (const sc of Object.keys(SCENARIOS)) {
  const a = after[sc], b = before && before[sc];
  check('28 [' + sc + '] split allocation / results identical', !!b && a.results === b.results && a.computeSplit === b.computeSplit, true);
  check('29 [' + sc + '] listing suggestions + active packs identical', !!b && a.adds === b.adds && a.active === b.active, true);
  check('30 [' + sc + '] leftover identical (computeSplit.leftover across totals/tiers)', !!b && JSON.stringify(JSON.parse(a.computeSplit).flat(2).map(r => r.leftover)) === JSON.stringify(JSON.parse(b.computeSplit).flat(2).map(r => r.leftover)), true);
  check('31 [' + sc + '] CSV rows identical', !!b && a.bulk === b.bulk, true);
  check('32 [' + sc + '] CSV bytes identical', !!b && a.csv === b.csv && a.alerts === b.alerts, true);
  check('36/27c [' + sc + '] tier + getDemandTier + DEMAND_TIERS + card tier attrs identical', !!b && a.tier === b.tier && a.tiers === b.tiers && a.demandTiers === b.demandTiers && a.cardAttrs === b.cardAttrs, true);
  const an = a.newProduct, bn = b && b.newProduct;
  check('28–32 [' + sc + ', new product with real CSV] results / active / rows / CSV bytes / tier identical', !!bn && an.results === bn.results && an.active === bn.active && an.bulk === bn.bulk && an.csv === bn.csv && an.alerts === bn.alerts && an.tier === bn.tier, true);
}
checkTrue('28c sales data cannot change the split (real vs huge vs unconfirmed identical AFTER)', after.real.results === after.huge.results && after.real.results === after.unconfirmed.results && after.real.csv === after.huge.csv, '');
checkTrue('28d CSV actually produced (not vacuous): new-product scenario exports 5 Add rows', typeof after.real.newProduct.csv === 'string' && (after.real.newProduct.csv.match(/\r\nAdd,/g) || []).length === 5, String(after.real.newProduct.csv).slice(0, 80));
checkTrue('28e the Savvy Sales read really happened and was painted in the new-product scenario (AFTER)', after.real.newProduct.salesReads === NAT4 && after.real.newProduct.salesPainted === true, JSON.stringify([after.real.newProduct.salesReads, after.real.newProduct.salesPainted]));
checkTrue('28f new-product CSV identical across real / zero / unconfirmed / huge sales (AFTER)', ['zero', 'unconfirmed', 'huge'].every(k => after[k].newProduct.csv === after.real.newProduct.csv && after[k].newProduct.results === after.real.newProduct.results), '');
checkTrue('28g LEGO CSV is refused because 1pk/2pk are locked (documented; comparison still equal)', after.real.csv === null && before && before.real.csv === null, '');

section('33–39 — requests, auth, stale, polling, writes');
await legoScan(LEGO_SALES());
check('33 exact SKU requests unchanged (one per exact Sellbrite SKU)', salesCalls.map(c => c.sku).sort(), [S1, S1PK, S2PK].sort());
await scanWith(LEG, 'LEGO', [sbProd(S1PK, 3), sbProd('leg-673419373609-1PK ', 3)], [ebL('336000000001', S1PK, 2, LEG)], {}, { inv: LEGO_INV });
check('34 dedupe unchanged (case/space + Sellbrite/eBay duplicates → one request)', salesCalls.map(c => c.sku), [S1PK]);
checkTrue('35 auth unchanged: psAuthFetch GET, Bearer header only', salesCalls.length === 1 && salesCalls.every(c => c.method === 'GET' && c.auth === 'Bearer fake-token' && !c.body && !c.u.includes('fake-token')), JSON.stringify(salesCalls));
checkTrue('35b request/parse/stale code unchanged vs 66c9765', ['psRequestSavvySales', 'psReadSavvySales', 'psParseSavvySales', 'psSalesFresh', 'psSalesReset', 'psRenderSavvySales', 'psCheckSellbrite', 'psCheckEbaySellerListings', 'psAuthFetch'].every(unchangedFn), '');
{
  const hd = hold2();
  resetAll(); salesRead[S1PK] = { defer: hd.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  const IRW = '710363598525', SIRW = 'IRW-710363598525-2';
  salesRead[SIRW] = { body: salesOk(SIRW, 2, win(1, 1, 0.143, 2), win(2, 2, 0.067, 2), win(3, 3, 0.033, 2)) };
  await scan(IRW, 'Irwin Naturals', [sbProd(SIRW, 4)], [], { keep: true, noSettle: true });
  await settleSales();
  hd.release(S1PK, { body: LEGO_1PK() }); await settleSales();
  checkTrue('36 late other-UPC response ignored', !slot().includes(S1PK) && slot().includes(SIRW) && !slot().includes('155'), slot());
}
{
  const hd = hold2();
  resetAll(); salesRead[S1PK] = { defer: hd.defer };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  salesRead[S1PK] = { body: LEGO_1PK() };
  await scan(LEG, 'LEGO', [sbProd(S1PK, 3)], [], { keep: true, noSettle: true, inv: LEGO_INV });
  await settleSales();
  hd.release(S1PK, { body: salesOk(S1PK, 1, win(999, 999, 142.7, 1), win(999, 999, 33.3, 1), win(999, 999, 11.1, 1)) });
  await settleSales();
  checkTrue('37 older same-UPC response ignored', shows(S1PK, '7d', 155, '48 orders', '22.14') && !slot().includes('999'), slot());
  setCur(Object.assign(fixture('', 'NoUPC'), { upc: '' })); sandbox.psRenderSavvySales();
  check('37b next product without UPC shows no previous sales', slot(), '');
}
await legoScan(LEGO_SALES());
{ const n = salesCalls.length; await new Promise(r => setTimeout(r, 60)); await settleSales(); check('38 no polling', [n, salesCalls.length], [3, 3]); }
checkTrue('38b #22B / #22B-UI code has no timers', block22b.length > 0 && !/setInterval|setTimeout/.test(block22b), '');
checkTrue('39 no writes: GET-only sales reads, no write methods/endpoints in #22B code', salesCalls.every(c => c.method === 'GET' && !c.body) && !/method\s*:|POST|PUT|PATCH|DELETE|update-inventory|create-product|shopify/i.test(block22b) && invCalls.length === 0 && ssSaveCalls.length === 0 && otherCalls.every(c => !/ebay|shopify/i.test(c.u)), JSON.stringify(otherCalls));

section('40–42 — #21 locks, #21F location UI, Return-to-Fix unchanged');
await legoScan(LEGO_SALES());
check('40 1pk/2pk still locked', [sandbox.psIsPackLocked(LEG, 1), sandbox.psIsPackLocked(LEG, 2)], [true, true]);
checkTrue('40b lock/inventory code unchanged', ['psPackState', 'psIsPackLocked', 'psRefreshPackLocks', 'psAutoExcludeConfirmedPacks', 'psLoadSbInventory', 'psApplySbInventory', 'psUpdateSellbriteInventory'].every(unchangedFn), '');
checkTrue('41 #21F location UI code unchanged', ['psSsLocEditorHtml', 'psSsLocSummaryHtml', 'psRenderSsLoc', 'psCheckShipStationLocation', 'psSaveShipStationLocation', 'psRemoveLocation', 'psPersistLocation', 'psLockedPackCardHtml'].every(unchangedFn), '');
{
  const sku2 = 'IRW-710363598525-2pk', IRW = '710363598525';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false }, manual: { 2: 3 } });
  await settleSales();
  check('42 Return-to-Fix target still editable; split untouched', [sandbox.psLockSessionEditAllowed(IRW, sku2), act()[2], getSplitManual()[2]], [true, true, 3]);
  checkTrue('42b Return-to-Fix code unchanged', ['psReturnAndFixExpDate', 'psCaptureEditorSnapshot'].every(unchangedFn), '');
}

section('43 — responsive fallback');
{
  const g = (await legoScan(LEGO_SALES()), slot());
  checkTrue('43 panel-local horizontal scroll (never page width)', g.includes('id="ps-savvy-sales-scroll" style="overflow-x:auto;') && g.includes('max-width:100%'), g.slice(0, 400));
  checkTrue('43b narrow screens stack rows into cards (@media max-width:480px, thead hidden, td block + data-label)', /@media \(max-width:480px\)\{#ps-savvy-sales-table thead\{display:none\}/.test(g) && g.includes('#ps-savvy-sales-table td{display:block') && g.includes('content:attr(data-label)') && (g.match(/<td data-label="(7D|30D|90D)"/g) || []).length === 9, '');
  checkTrue('43c CSS scoped to the sales table only', (g.match(/<style>[\s\S]*?<\/style>/) || [''])[0].split('}').filter(r => r.trim() && !r.trim().startsWith('@media')).every(r => /#ps-savvy-sales-table/.test(r) || !r.includes('{')), '');
  checkTrue('43d long SKUs wrap instead of widening the page', g.includes('word-break:break-all'), '');
}

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
