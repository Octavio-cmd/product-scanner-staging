#!/usr/bin/env node
/**
 * ONE SHARED SAVVY SALES WARMING PROBE PER SCAN (Implementación #22C-0C)
 *
 * Backend c503df8: /ebay/savvy-sales = 30 requests / minute / session user;
 * every exact-SKU read and every warming retry costs one unit. #22C-0B3 ran one
 * warming loop PER SKU (4 cold SKUs ≈ 84 req/min → http_429 at ~20 s). Now one
 * gate/probe per scan: the first exact SKU is read alone; if the shared B2
 * snapshot is warming it is the ONLY poller (2 s, then 3 s, ≤30 retries,
 * ≤90 s); when it confirms, every other exact SKU is read ONCE.
 *
 * The request-budget checks run the REAL scheduling code on a 1:100 clock
 * (1 s → 10 ms): B3 timings, a cold snapshot that becomes ready at "50 s", and
 * a mock of the backend fixed-window limiter (30 per "60 s"). Every sliding
 * "60 s" window must hold ≤ 30 sales requests and no 429 may occur.
 *
 * Harness: real multipack-fixes.js + real app.js in a vm sandbox (same as the
 * #22C-0B3 suite); only fetch() is mocked.
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
const appSrc = fs.readFileSync(process.env.PS22C0C_APP || path.join(__dirname, 'app.js'), 'utf8');
// #22C-0B3 (warming auto-retry + age note) is separately scoped: guards compare
// app.js with exactly those edits reverted.
// #22C-0C (one shared warming probe per scan) is separately scoped: revert
// exactly those edits first, then #22C-0B3.
const appSrcC = require('./scope-22c-0c.js').undo22c0c(appSrc);
const appSrcG = require('./scope-22c-0b3.js').undo22c0b3(appSrcC);
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


// ── #22C-0B3 helpers ──────────────────────────────────────────────────────
const cp = require('child_process');
const BASE_SHA = '574a351333432bf40b4a2e405f20f18e24ac81fd';
let base574 = null;
try { base574 = cp.execSync('git show ' + BASE_SHA + ':app.js', { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { base574 = null; }
let scope = null;
try { scope = require('./scope-22c-0b3.js'); } catch (e) { scope = null; }
function fnSrc(src, name) {
  const re = new RegExp('^(async )?function ' + name + '\\(', 'm'); const m = re.exec(src); if (!m) return null;
  const rest = src.slice(m.index + 1); const n = /^(async )?function |^\/\/ ━━|^var |^const |^let |^window\./m.exec(rest.slice(1));
  return src.slice(m.index, n ? m.index + 2 + n.index : undefined);
}
const REAL = {};
['PS_SALES_WARM_FIRST_MS', 'PS_SALES_WARM_EVERY_MS', 'PS_SALES_WARM_MAX_TRIES', 'PS_SALES_WARM_MAX_MS', 'PS_SALES_WARM_RETRY_AFTER_MAX_MS']
  .forEach(k => { REAL[k] = sandbox[k]; });
function setWarm(first, every, tries, maxMs, raMax) {
  sandbox.PS_SALES_WARM_FIRST_MS = first; sandbox.PS_SALES_WARM_EVERY_MS = every;
  sandbox.PS_SALES_WARM_MAX_TRIES = tries; sandbox.PS_SALES_WARM_MAX_MS = maxMs;
  sandbox.PS_SALES_WARM_RETRY_AFTER_MAX_MS = raMax == null ? 10000 : raMax;
}
const FAST = () => setWarm(20, 30, 30, 90000, 150);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, ms) { const t = Date.now(); while (Date.now() - t < (ms || 3000)) { if (cond()) return true; await sleep(5); } return !!cond(); }
function warmBody(sku, over) {
  return Object.assign({ sku, source: 'ebay_fulfillment_orders', match: 'exact_sku_case_insensitive', pack_size: null,
    pack_size_reason: null, window_basis: 'order_creation_date_utc_rolling', status: 'unconfirmed', complete: false,
    reason: 'sales_snapshot_warming', as_of: null, windows: null, snapshot_age_seconds: null, refreshing: true,
    stale: null, retry_after_seconds: 0 }, over || {});
}
// A per-SKU response queue: each entry is { status, body } or a mode spec; the last one repeats.
function seq(sku, list) {
  const q = list.slice();
  return { defer: async () => { const s = q.length > 1 ? q.shift() : q[0]; return salesBuild(sku, s); } };
}
const W = sku => ({ status: 503, body: warmBody(sku) });
const OK1 = over => ({ status: 200, body: salesOk(S1PK, 1, win(48, 155, 22.143, 1, { excluded: { cancelled: { orders: 1, packs: 1 } } }),
  win(105, 234, 7.8, 1, { excluded: { cancelled: { orders: 2, packs: 3 } }, refunded: 1 }),
  win(136, 273, 3.033, 1, { excluded: { cancelled: { orders: 3, packs: 5 } }, refunded: 3 }), over) });
const OK2 = over => ({ status: 200, body: salesOk(S2PK, 2, win(5, 15, 2.143, 2), win(7, 32, 1.067, 2), win(9, 38, 0.422, 2), over) });
const salesOf = sku => salesCalls.filter(c => c.sku === sku).length;
const entry = sku => (salesState().skus || {})[sandbox.psSbInvKey(sku)] || {};
const loops = () => salesState().warmLoops || {};
const armed = () => Object.values(loops()).filter(L => L.timer).length;
async function start(sales, extra) {
  resetAll(); callLog.length = 0;
  Object.assign(salesRead, sales || {});
  setCur(fixture(LEG, 'LEGO')); setSplitActive(Object.assign({}, ALL_ON)); setSplitManual({});
  sbConfig.products = LEGO_SB(); sbConfig.defer = null; ebConfig.listings = (extra && extra.eb) || [];
  invRead = Object.assign(invRead, LEGO_INV, (extra && extra.inv) || {});
  await Promise.all([sandbox.psCheckSellbrite(LEG, 'LEGO'), sandbox.psCheckEbaySellerListings(LEG, 'LEGO', '')]);
  await settleSales();
}
const idle = () => armed() === 0 && !Object.values(salesState().skus || {}).some(e => e.state === 'loading');


// ── #22C-0C helpers ───────────────────────────────────────────────────────
const S3PK = 'LEG-673419373609-3pk', S6PK = 'LEG-673419373609-6pk';
const SCALE = 100;                                   // 1 real second → 10 ms
const SEC = s => Math.round(s * 1000 / SCALE);
const B3_TIMINGS = () => setWarm(SEC(2), SEC(3), 30, SEC(90), SEC(10));
// mock of the backend fixed-window limiter (per user, 30 per "60 s")
let lim = null, salesTimes = [];
const fetchInner = sandbox.fetch;
sandbox.fetch = (url, opts) => {
  const u = String(url);
  if (u.indexOf('/ebay/savvy-sales') >= 0) {
    const now = Date.now(); salesTimes.push(now);
    if (lim) {
      if (lim.start == null || now - lim.start >= lim.windowMs) { lim.start = now; lim.count = 0; }
      if (++lim.count > lim.max) {
        lim.hits++;
        const sku = decodeURIComponent((u.match(/sku=([^&]+)/) || [])[1] || '');
        salesCalls.push({ u, method: 'GET', sku, auth: opts && opts.headers && opts.headers.get && opts.headers.get('Authorization'), limited: true });
        return Promise.resolve({ ok: false, status: 429, json: async () => { throw new SyntaxError('Unexpected token <'); } });
      }
    }
  }
  return fetchInner(url, opts);
};
function limiterOn() { lim = { windowMs: SEC(60), max: 30, start: null, count: 0, hits: 0 }; }
function maxInWindow(times, win) { let m = 0; for (let i = 0; i < times.length; i++) { let c = 0; for (let j = i; j < times.length && times[j] - times[i] < win; j++) c++; m = Math.max(m, c); } return m; }
// cold B2 snapshot: warming until `ready.t`, then each exact SKU's OWN confirmed body
function cold(ready, sku, spec) { return { defer: async () => salesBuild(sku, Date.now() >= ready.t ? spec : W(sku)) }; }
const Z = sku => ({ mode: 'zero' });
const OK3 = over => ({ status: 200, body: salesOk(S3PK, 3, win(1, 2, 0.286, 3), win(2, 4, 0.133, 3), win(3, 6, 0.067, 3), over) });
const OK6 = over => ({ status: 200, body: salesOk(S6PK, 6, win(0, 0, 0, 6), win(1, 1, 0.033, 6), win(2, 2, 0.022, 6), over) });
const OK12 = over => ({ status: 200, body: salesOk(S12PK, 12, win(0, 0, 0, 12), win(0, 0, 0, 12), win(1, 1, 0.011, 12), over) });
const EB = skus => skus.map((s, i) => ebL(String(900 + i), s, 3, LEG));
const allSkus = () => Object.values(salesState().skus || {}).map(e => e.sku);
const states = () => Object.fromEntries(Object.values(salesState().skus || {}).map(e => [e.sku, e.state]));
const settled = () => Object.values(salesState().skus || {}).every(e => e.state === 'ok' || e.state === 'error');
async function coldScan(extraEb, bodies, readyS) {
  const ready = { t: Infinity };
  const map = {};
  Object.keys(bodies).forEach(k => { map[k] = cold(ready, k, bodies[k]); });
  salesTimes = []; limiterOn();
  ready.t = Date.now() + SEC(readyS);
  const t0 = Date.now();
  await start(map, { eb: EB(extraEb) });
  await waitFor(settled, SEC(120));
  await sleep(SEC(15));
  const rel = salesTimes.map(t => t - t0);
  const out = { t0, rel, max60: maxInWindow(salesTimes, SEC(60)), hits: lim.hits, total: salesTimes.length };
  lim = null;                                        // the mock limiter only runs inside budget scans
  return out;
}

(async () => {
section('0 — load');
['psSalesStartRead', 'psSalesWarmSchedule', 'psSalesWarmSettled', 'psSalesWarmCancel', 'psSalesSnapshotReady']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1–2, 5, 7, 9–11 — 4-SKU LEGO cold (snapshot ready at "50 s"), real B3 timings, mock 30/min limiter');
B3_TIMINGS();
{
  const r = await coldScan([S3PK], { [S1]: Z(), [S1PK]: OK1(), [S2PK]: OK2(), [S3PK]: OK3() }, 50);
  const per = [S1, S1PK, S2PK, S3PK].map(salesOf);
  console.log('    4-SKU requests: total=' + r.total + ' per SKU ' + JSON.stringify(per) + ' max per "60 s" window=' + r.max60 + ' 429s=' + r.hits);
  checkTrue('5 4 SKU cold: every exact SKU ends confirmed', [S1, S1PK, S2PK, S3PK].every(s => entry(s).state === 'ok'), JSON.stringify(states()));
  checkTrue('7 4-SKU request budget ≤ 30 in EVERY sliding "60 s" window, and no 429', r.max60 <= 30 && r.hits === 0, JSON.stringify(r));
  check('10 final exact-SKU reads: every non-probe SKU read exactly ONCE', per.filter(n => n === 1).length, 3);
  checkTrue('9 probe warming → confirmed (the one probe carried all the retries)', per.filter(n => n > 1).length === 1 && Math.max(...per) >= 10, JSON.stringify(per));
  checkTrue('11 exact-SKU results independent (each row shows its OWN numbers)', shows(S1PK, '90d', 273, '136 orders', '3.03') && shows(S2PK, '90d', 38, '9 orders', '0.42') && shows(S3PK, '90d', 6, '3 orders', '0.07') && shows(S1, '90d', 0, '0 orders', '0.00'), slot());
  check('1 one warming loop per scan (single shared entry) and nothing armed afterwards', [Object.keys(loops()).length, armed()], [1, 0]);
}
{ // 2: during warming, 4 warming rows but ONE armed timer
  const ready = { t: Infinity };
  await start({ [S1]: cold(ready, S1, Z()), [S1PK]: cold(ready, S1PK, OK1()), [S2PK]: cold(ready, S2PK, OK2()), [S3PK]: cold(ready, S3PK, OK3()) }, { eb: EB([S3PK]) });
  await sleep(SEC(8));
  const warmingRows = Object.values(salesState().skus).filter(e => e.state === 'warming').length;
  checkTrue('2 no per-SKU warming timers: 4 warming rows, ONE armed timer, ONE loop entry', warmingRows === 4 && armed() === 1 && Object.keys(loops()).length === 1, JSON.stringify({ warmingRows, armed: armed(), loops: Object.keys(loops()) }));
  checkTrue('25 unresolved rows never show zero while warming', !/ps-ss-n">0</.test(slot()) && (slot().match(/Preparando ventas reales/g) || []).length === 4, slot().slice(0, 200));
  const before = salesCalls.length;
  sandbox.psRequestSavvySales(LEG, [S1, S1PK, S2PK, S3PK]);          // loader called again for the same scan
  await sleep(SEC(4));
  checkTrue('24 duplicate loader call for the same scan creates no second loop / timer / extra reads', Object.keys(loops()).length === 1 && armed() <= 1 && salesCalls.length - before <= 2, JSON.stringify({ loops: Object.keys(loops()), d: salesCalls.length - before }));
  ready.t = 0; await waitFor(settled, SEC(30));
}

section('6, 8 — 6-SKU cold, same conditions');
{
  const r = await coldScan([S3PK, S6PK, S12PK], { [S1]: Z(), [S1PK]: OK1(), [S2PK]: OK2(), [S3PK]: OK3(), [S6PK]: OK6(), [S12PK]: OK12() }, 50);
  console.log('    6-SKU requests: total=' + r.total + ' max per "60 s" window=' + r.max60 + ' 429s=' + r.hits);
  checkTrue('6 6 SKU cold: every exact SKU ends confirmed', allSkus().length === 6 && allSkus().every(s => entry(s).state === 'ok'), JSON.stringify(states()));
  checkTrue('8 6-SKU request budget ≤ 30 in EVERY sliding "60 s" window, and no 429', r.max60 <= 30 && r.hits === 0, JSON.stringify(r));
  const late = await coldScan([S3PK, S6PK, S12PK], { [S1]: Z(), [S1PK]: OK1(), [S2PK]: OK2(), [S3PK]: OK3(), [S6PK]: OK6(), [S12PK]: OK12() }, 60);
  checkTrue('8b 6-SKU budget holds even if the refresh takes "60 s" (≤ 30 per window, no 429)', late.max60 <= 30 && late.hits === 0, JSON.stringify(late));
}

section('3, 4 — 1 SKU and 2 SKU cold');
{
  const ready = { t: Date.now() + SEC(20) };
  resetAll(); callLog.length = 0; salesRead = {};
  salesRead['NAT-031604004033-1'] = cold(ready, 'NAT-031604004033-1', { mode: 'zero' });
  setCur(fixture(NAT, 'Nature Made')); setSplitActive(Object.assign({}, ALL_ON)); setSplitManual({});
  sbConfig.products = [sbProd('NAT-031604004033-1', 5)]; sbConfig.defer = null; ebConfig.listings = [];
  await Promise.all([sandbox.psCheckSellbrite(NAT, 'Nature Made'), sandbox.psCheckEbaySellerListings(NAT, 'Nature Made', '')]);
  await waitFor(settled, SEC(60)); await sleep(SEC(8));
  const n = salesOf('NAT-031604004033-1');
  checkTrue('3 1 SKU cold: its SKU is the probe, confirmed stops polling', entry('NAT-031604004033-1').state === 'ok' && n >= 5 && armed() === 0, JSON.stringify({ n, st: entry('NAT-031604004033-1').state }));
}
{
  const r = await coldScan([], { [S1]: Z(), [S1PK]: OK1(), [S2PK]: OK2() }, 50);   // LEGO Sellbrite-only: 3 exact SKUs
  checkTrue('4 multi-SKU cold (Sellbrite SKUs only): all confirmed, one probe, ≤ 30 per window', allSkus().every(s => entry(s).state === 'ok') && r.max60 <= 30 && r.hits === 0, JSON.stringify(r));
}

section('12–14, 27–30 — confirmed zero, stale / fresh (no polling), display semantics');
FAST();
{
  const ready = { t: Date.now() + 60 };
  await start({ [S1]: cold(ready, S1, Z()), [S1PK]: cold(ready, S1PK, OK1({ snapshot_age_seconds: 1, refreshing: false, stale: false })), [S2PK]: cold(ready, S2PK, Z()) });
  await waitFor(settled, 3000);
  checkTrue('12 confirmed zero after warming stays a REAL 0 (its own read)', shows(S2PK, '7d', 0, '0 orders', '0.00') && salesOf(S2PK) === 1, block(S2PK));
  checkTrue('27 refunds preserved', cell(S1PK, '90d').includes('⚠️ 3 refunded orders included'), cell(S1PK, '90d'));
  checkTrue('28 cancellations preserved', cell(S1PK, '90d').includes('Excluded: 3 cancelled orders / 5 packs'), cell(S1PK, '90d'));
  checkTrue('29 freshness preserved', block(S1PK).includes('Datos actualizados hace menos de 1 min'), block(S1PK));
}
{
  await start({ [S1PK]: seq(S1PK, [OK1({ snapshot_age_seconds: 720, refreshing: true, stale: true })]), [S2PK]: seq(S2PK, [OK2({ snapshot_age_seconds: 720, refreshing: true, stale: true })]) });
  await sleep(200);
  checkTrue('13 stale confirmed (refreshing:true): numbers shown at once, one read per SKU, no polling', [S1, S1PK, S2PK].every(s => salesOf(s) === 1) && armed() === 0 && block(S2PK).includes('Datos de hace 12 min · actualizando…') && shows(S2PK, '90d', 38, '9 orders', '0.42'), JSON.stringify([S1, S1PK, S2PK].map(salesOf)));
  checkTrue('30 physical units preserved', cell(S2PK, '90d').includes('= 76 physical units'), cell(S2PK, '90d'));
  await start({ [S1PK]: seq(S1PK, [OK1({ snapshot_age_seconds: 30, refreshing: false, stale: false })]), [S2PK]: seq(S2PK, [OK2()]) });
  await sleep(200);
  checkTrue('14 fresh confirmed: one read per exact SKU, no loop timer', [S1, S1PK, S2PK].every(s => salesOf(s) === 1) && armed() === 0, JSON.stringify([S1, S1PK, S2PK].map(salesOf)));
}

section('15–19, 26 — probe failures');
{
  limiterOn(); lim.max = 3;                         // tiny budget: the probe's 4th call gets 429
  const ready = { t: Infinity };
  await start({ [S1]: cold(ready, S1, Z()), [S1PK]: cold(ready, S1PK, OK1()), [S2PK]: cold(ready, S2PK, OK2()) });
  await waitFor(settled, 3000); await sleep(200);
  const n = salesCalls.length;
  await sleep(300);
  checkTrue('15 probe 429 stops the loop: unresolved rows "Ventas no confirmadas (http_429)", no retry storm', Object.values(salesState().skus).every(e => e.state === 'error' && e.reason === 'http_429') && salesCalls.length === n && n === 4 && armed() === 0, JSON.stringify({ n, s: states() }));
  checkTrue('25b failed rows never show zero', !/ps-ss-n">0</.test(slot()) && (slot().match(/Ventas no confirmadas <span class="ps-ss-sub">\(http_429\)/g) || []).length === 3, slot().slice(0, 200));
  lim = null;
}
for (const [id, name, spec] of [['16', 'HTTP 500', { status: 500, body: { status: 'unconfirmed', complete: false, reason: 'ebay_http_500', windows: null } }],
                                  ['17', 'malformed response', { mode: 'malformed' }], ['18', 'network error', { mode: 'network' }]]) {
  let first = true;
  await start({ [S1PK]: { defer: async () => { const r = salesBuild(S1PK, first ? W(S1PK) : spec); first = false; return r; } },
                [S1]: seq(S1, [Z()]), [S2PK]: seq(S2PK, [OK2()]) });
  await waitFor(settled, 3000); await sleep(200);
  const n = salesCalls.length; await sleep(200);
  checkTrue(`${id} probe ${name} stops the loop; the row is "no confirmadas", others read once (existing fail-safe), no retries`, entry(S1PK).state === 'error' && salesOf(S1PK) === 2 && salesOf(S1) === 1 && salesOf(S2PK) === 1 && salesCalls.length === n && armed() === 0 && !/ps-ss-n">0<\/span> packs<div class="ps-ss-sub">0 orders · 0.00 packs\/day<\/div><\/td><td data-label="30D" class="ps-ss-cell"><span class="ps-ss-n">0/.test(block(S1PK)), JSON.stringify({ s: states(), n: [S1, S1PK, S2PK].map(salesOf) }));
}
{
  const before = expired.n;
  await start({ [S1PK]: seq(S1PK, [{ mode: 'http401' }]), [S1]: seq(S1, [Z()]), [S2PK]: seq(S2PK, [OK2()]) });
  await waitFor(settled, 3000);
  checkTrue('19 401 on the gate → existing session-expired behaviour (savvySesionCaducada, "sesion_expirada"), no polling', entry(S1PK).state === 'error' && entry(S1PK).reason === 'sesion_expirada' && expired.n > before && armed() === 0, JSON.stringify({ r: entry(S1PK).reason, e: expired.n - before }));
}
{
  // gate confirmed first, then a later final read comes back warming and its probe hits 429
  limiterOn(); lim.max = 4;
  await start({ [S1PK]: seq(S1PK, [OK1()]), [S1]: seq(S1, [W(S1)]), [S2PK]: seq(S2PK, [W(S2PK)]) });
  await waitFor(settled, 3000); await sleep(150);
  checkTrue('26 already-confirmed rows are not erased by a later failure', entry(S1PK).state === 'ok' && shows(S1PK, '90d', 273, '136 orders', '3.03') && Object.values(salesState().skus).some(e => e.state === 'error'), JSON.stringify(states()));
  lim = null;
}

section('20–23 — stale scan safety');
{
  setWarm(40, 40, 30, 5000);
  const ready = { t: Infinity };
  await start({ [S1]: cold(ready, S1, Z()), [S1PK]: cold(ready, S1PK, OK1()), [S2PK]: cold(ready, S2PK, OK2()) });
  const oldSt = salesState(), oldW = oldSt.warm;
  resetAll(); setCur(fixture(NEWU, 'Other')); sbConfig.products = [];
  await Promise.all([sandbox.psCheckSellbrite(NEWU, 'Other'), sandbox.psCheckEbaySellerListings(NEWU, 'Other', '')]);
  await sleep(250);
  checkTrue('20 new scan cancels the old shared timer', !!oldW && !oldW.timer && oldW.phase === 'failed' && oldW.failReason === 'scan_replaced', JSON.stringify(oldW && { p: oldW.phase, t: !!oldW.timer }));
  check('21 late probe ignored: no request for the old scan after the new one', salesCalls.length, 0);
  checkTrue('21b nothing from the old product paints into the new one', !slot().includes(S1PK) && !slot().includes('Preparando'), slot());
}
{
  // late FINAL read: gate confirms, a final read is still in flight when the same UPC is scanned again
  FAST();
  let relS2; const lateS2 = new Promise(r => { relS2 = r; });
  await start({ [S1PK]: seq(S1PK, [OK1()]), [S1]: seq(S1, [Z()]), [S2PK]: { defer: () => lateS2 } });
  const g1 = salesState();
  await start({ [S1PK]: seq(S1PK, [OK1({ snapshot_age_seconds: 5, refreshing: false, stale: false })]), [S1]: seq(S1, [Z()]), [S2PK]: seq(S2PK, [Z()]) });
  const g2 = salesState();
  await waitFor(settled, 2000);
  relS2(salesBuild(S2PK, OK2()));
  await sleep(150);
  checkTrue('22 late final read from the previous scan is ignored (the new scan keeps its own confirmed zero)', shows(S2PK, '90d', 0, '0 orders', '0.00') && entry(S2PK).state === 'ok', block(S2PK));
  checkTrue('23 same UPC rescanned = new scan generation (new state object, new shared probe state)', g1 !== g2 && g1.warm !== g2.warm && g2.upc === g1.upc, '');
}

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
