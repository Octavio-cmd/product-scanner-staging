#!/usr/bin/env node
/**
 * SAVVY SALES WARMING AUTO-RETRY + SNAPSHOT AGE UI (Implementación #22C-0B3)
 *
 * Backend #22C-0B2 (stale-while-revalidate) answers a cold/too-old snapshot
 * with status=unconfirmed, reason=sales_snapshot_warming, refreshing=true,
 * windows=null — instantly, while ONE background scan runs. This suite proves
 * the Test Preview frontend:
 *  - shows "⏳ Preparando ventas reales… Actualizando automáticamente." (not
 *    "Ventas no confirmadas", never 0) and retries by itself, bounded
 *    (first 2 s, then every 3 s, ≤30 retries and ≤90 s), one loop per scan +
 *    exact SKU, cancelled by a new scan;
 *  - renders the normal #22B table as soon as a confirmed answer arrives, with
 *    a small age note when snapshot_age_seconds is present;
 *  - keeps every other state (errors, backoff, malformed, network) as the
 *    existing "⚠️ Ventas no confirmadas", without auto-retry;
 *  - is byte-for-byte #22B behaviour against the current backend (no metadata).
 *
 * Harness: real multipack-fixes.js + real app.js in a vm sandbox (same as
 * test-inventory-before-savvy-sales-22c-0a.js); only fetch() is mocked. Retry
 * constants are scaled down in the sandbox (after asserting the real values)
 * so the loops run in milliseconds with the REAL scheduling code.
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
const appSrc = fs.readFileSync(process.env.PS22C0B3_APP || path.join(__dirname, 'app.js'), 'utf8');
// #22C-0B3 (warming auto-retry + age note) is separately scoped: guards compare
// app.js with exactly those edits reverted.
// #22C-0C (one shared warming probe per scan) and the Production-compatibility
// hardening (Clothing Sheets URL, rembg warm-up, staging badge removed) are
// separately scoped: revert exactly those edits first, then #22C-0B3.
const appSrcC = require('./scope-22c-0c.js').undo22c0c(appSrc);
const appSrcP = require('./scope-production-compat.js').undoProdCompat(appSrcC);
const appSrcG = require('./scope-22c-0b3.js').undo22c0b3(appSrcP);
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
// Employee STAGING (separate history): c8579aa is the staging #22C-0A commit
// whose app.js is byte-identical to Test Preview 574a351 — use whichever exists.
const BASE_SHAS = [BASE_SHA, 'c8579aa40aff4011e3b661713cad7f0212c37227'];
let base574 = null;
for (const sha of BASE_SHAS) {
  try { base574 = cp.execSync('git show ' + sha + ':app.js', { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); break; } catch (e) { base574 = null; }
}
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

(async () => {
section('0 — load + constants');
['psSalesIsWarming', 'psSalesFreshness', 'psSalesFreshnessText', 'psSalesWarmSchedule', 'psSalesWarmCancel']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));
check('0b retry constants: 2 s first, 3 s after, ≤30 retries, ≤90 s, retry_after cap 10 s', REAL,
  { PS_SALES_WARM_FIRST_MS: 2000, PS_SALES_WARM_EVERY_MS: 3000, PS_SALES_WARM_MAX_TRIES: 30, PS_SALES_WARM_MAX_MS: 90000, PS_SALES_WARM_RETRY_AFTER_MAX_MS: 10000 });
checkTrue('0c 30 retries fit the 90 s budget (2 + 29×3 = 89 s)', REAL.PS_SALES_WARM_FIRST_MS + (REAL.PS_SALES_WARM_MAX_TRIES - 1) * REAL.PS_SALES_WARM_EVERY_MS <= REAL.PS_SALES_WARM_MAX_MS, '');
FAST();

section('1–2 — backward compatibility with the current backend (no B2 metadata)');
await start({ [S1PK]: { body: LEGO_1PK() }, [S2PK]: { body: LEGO_2PK() } });
checkTrue('1 old-backend confirmed response renders the #22B table', shows(S1PK, '90d', 273, '136 orders', '3.03') && shows(S2PK, '7d', 15, '5 orders', '2.14'), block(S1PK));
checkTrue('2 metadata absent: no age note, no freshness field, no retry loop', !slot().includes('ps-ss-age') && !('freshness' in entry(S1PK)) && armed() === 0 && !Object.values(loops()).some(L => L.phase === 'warming'), JSON.stringify(entry(S1PK)));
check('2b one sales request per exact SKU (as #22B)', [salesOf(S1PK), salesOf(S2PK)], [1, 1]);

section('3–11 — warming → automatic retry → confirmed');
FAST();
await start({ [S1PK]: seq(S1PK, [W(S1PK), W(S1PK), W(S1PK), OK1()]), [S2PK]: seq(S2PK, [OK2()]) });
check('3 warming recognised', entry(S1PK).state, 'warming');
checkTrue('4 warming shows no fake zero', !/ps-ss-n">0</.test(block(S1PK)) && !block(S1PK).includes(' packs'), block(S1PK));
checkTrue('5 warming shows the preparing text, not "Ventas no confirmadas"', block(S1PK).includes('⏳ Preparando ventas reales…') && block(S1PK).includes('Actualizando automáticamente.') && !block(S1PK).includes('Ventas no confirmadas'), block(S1PK));
checkTrue('6 auto-retry scheduled (one armed timer for that SKU)', armed() === 1 && !!loops()[sandbox.psSbInvKey(S1PK)], JSON.stringify(Object.keys(loops())));
// #22C-0C: the other exact SKU waits for the ONE shared probe (no own timer, no own request).
checkTrue('27b the other SKU waits for the shared probe (no own timer, no request yet)', entry(S2PK).state === 'warming' && !loops()[sandbox.psSbInvKey(S2PK)] && salesOf(S2PK) === 0, JSON.stringify({ st: entry(S2PK).state, n: salesOf(S2PK) }));
await waitFor(() => entry(S1PK).state === 'ok', 3000);
checkTrue('11 employee did not rescan: the table filled automatically', entry(S1PK).state === 'ok' && shows(S1PK, '90d', 273, '136 orders', '3.03'), block(S1PK));
check('10 confirmed stops polling: exactly 1 + 3 requests', salesOf(S1PK), 4);
await sleep(150);
check('29 no polling after confirmed', [salesOf(S1PK), armed()], [4, 0]);
check('9 #22C-0C one shared loop per scan; the other SKU is read ONCE after the probe confirms, with its own numbers', [Object.keys(loops()), salesOf(S2PK), shows(S2PK, '90d', 38, '9 orders', '0.42')], [[sandbox.psSbInvKey(S1PK)], 1, true]);

section('7–8, 48 — never resolves: bounded, then unconfirmed');
setWarm(10, 15, 6, 90000);
await start({ [S1PK]: seq(S1PK, [W(S1PK)]), [S2PK]: seq(S2PK, [OK2()]) });
await waitFor(() => entry(S1PK).state === 'error', 3000);
check('7 retry bounded by attempts: 1 + 6 requests', salesOf(S1PK), 7);
checkTrue('7b after the limit: "⚠️ Ventas no confirmadas" (warming timeout)', block(S1PK).includes('⚠️ Ventas no confirmadas') && block(S1PK).includes('sales_snapshot_warming_timeout'), block(S1PK));
await sleep(200);
check('8 no infinite polling (no more requests, no armed timer)', [salesOf(S1PK), armed()], [7, 0]);
setWarm(10, 40, 1000, 200);
await start({ [S1PK]: seq(S1PK, [W(S1PK)]), [S2PK]: seq(S2PK, [OK2()]) });
await waitFor(() => entry(S1PK).state === 'error', 3000);
const byTime = salesOf(S1PK);
checkTrue('7c retry bounded by elapsed time too (200 ms budget, 40 ms steps → ≤ 7 requests)', byTime >= 3 && byTime <= 7, byTime);
await sleep(200);
checkTrue('48 request count bounded (probe ≤ 1 + MAX_TRIES; the waiting SKU is never read; nothing after the limit)', salesOf(S1PK) === byTime && salesOf(S2PK) === 0 && block(S2PK).includes('sales_snapshot_warming_timeout'), salesOf(S1PK) + '/' + salesOf(S2PK));

section('12–17 — freshness note');
FAST();
await start({ [S1PK]: { body: OK1({ snapshot_age_seconds: 0, refreshing: false, stale: false }).body },
              [S2PK]: { body: OK2({ snapshot_age_seconds: 45, refreshing: false, stale: false }).body } });
checkTrue('12 fresh snapshot → "Datos actualizados hace menos de 1 min" (secondary style)', block(S1PK).includes('<div class="ps-ss-sub ps-ss-age">Datos actualizados hace menos de 1 min</div>'), block(S1PK));
checkTrue('13 < 1 minute note', block(S2PK).includes('Datos actualizados hace menos de 1 min'), block(S2PK));
await start({ [S1PK]: { body: OK1({ snapshot_age_seconds: 245, refreshing: false, stale: false }).body },
              [S2PK]: { body: OK2({ snapshot_age_seconds: 720, refreshing: true, stale: true }).body } });
checkTrue('14 multi-minute note: "Datos actualizados hace 4 min"', block(S1PK).includes('Datos actualizados hace 4 min'), block(S1PK));
checkTrue('15 refreshing note: "Datos de hace 12 min · actualizando…"', block(S2PK).includes('Datos de hace 12 min · actualizando…'), block(S2PK));
checkTrue('16 stale confirmed data remains visible (numbers, not a loading screen)', shows(S2PK, '90d', 38, '9 orders', '0.42') && !block(S2PK).includes('⏳'), block(S2PK));
checkTrue('17 stale=true does not hide numbers and uses no alarming wording', shows(S2PK, '30d', 32, '7 orders', '1.07') && !/inválid|incorrect|no confirmad/i.test(block(S2PK)), block(S2PK));
check('17b a stale/refreshing confirmed answer is NOT re-polled', [salesOf(S1PK), salesOf(S2PK), armed()], [1, 1, 0]);

section('18–21 — generic failures keep "⚠️ Ventas no confirmadas", no auto-retry');
FAST();
await start({ [S1PK]: { status: 500, body: { status: 'unconfirmed', complete: false, reason: 'ebay_http_500', windows: null } },
              [S2PK]: { mode: 'malformed' } });
await sleep(120);
checkTrue('18 generic 500 → unconfirmed, not retried', block(S1PK).includes('⚠️ Ventas no confirmadas') && block(S1PK).includes('ebay_http_500') && salesOf(S1PK) === 1, block(S1PK));
checkTrue('19 malformed response → unconfirmed, not retried', block(S2PK).includes('⚠️ Ventas no confirmadas') && salesOf(S2PK) === 1, block(S2PK));
await start({ [S1PK]: { mode: 'network' },
              [S2PK]: { status: 502, body: { status: 'unconfirmed', complete: false, reason: 'ebay_http_500', windows: null, refreshing: false, retry_after_seconds: 42 } } });
await sleep(120);
checkTrue('20 network error → unconfirmed, not retried', block(S1PK).includes('⚠️ Ventas no confirmadas') && salesOf(S1PK) === 1, block(S1PK));
checkTrue('21 backoff (retry_after_seconds on a failure) → unconfirmed, waits for the user, no hammering', block(S2PK).includes('⚠️ Ventas no confirmadas') && salesOf(S2PK) === 1 && armed() === 0, block(S2PK));
await start({ [S1PK]: seq(S1PK, [{ status: 503, body: warmBody(S1PK, { refreshing: false }) }]), [S2PK]: seq(S2PK, [OK2()]) });
await sleep(120);
checkTrue('21b "warming" without refreshing=true is not trusted as warming (no retry)', block(S1PK).includes('⚠️ Ventas no confirmadas') && salesOf(S1PK) === 1, block(S1PK));
setWarm(10, 10, 30, 90000, 120);
await start({ [S1PK]: seq(S1PK, [{ status: 503, body: warmBody(S1PK, { retry_after_seconds: 0.1 }) }, OK1()]), [S2PK]: seq(S2PK, [OK2()]) });
const tWarm = Date.now();
await waitFor(() => salesOf(S1PK) >= 2, 2000);
const waited = Date.now() - tWarm;
checkTrue('21c retry_after_seconds on a warming answer lengthens the wait (100 ms vs 10 ms step)', waited >= 80, waited);
await start({ [S1PK]: seq(S1PK, [{ status: 503, body: warmBody(S1PK, { retry_after_seconds: 99999 }) }, OK1()]), [S2PK]: seq(S2PK, [OK2()]) });
const tCap = Date.now();
await waitFor(() => entry(S1PK).state === 'ok', 3000);
checkTrue('21d a huge retry_after_seconds is capped (cap 120 ms in this run; real 10 s)', entry(S1PK).state === 'ok' && Date.now() - tCap < 1000, Date.now() - tCap);

section('22–25 — a new scan cancels / ignores the old retry');
setWarm(60, 60, 30, 90000);
await start({ [S1PK]: seq(S1PK, [W(S1PK)]), [S2PK]: seq(S2PK, [W(S2PK)]) });
const oldSt = salesState();
checkTrue('27 #22C-0C multiple warming SKUs share ONE loop / ONE armed timer', Object.keys(loops()).length === 1 && armed() === 1, JSON.stringify(Object.keys(loops())));
// employee scans another product (no Sellbrite SKUs) while LEGO is warming
resetAll();
setCur(fixture('012345678905', 'Other')); sbConfig.products = [];
await Promise.all([sandbox.psCheckSellbrite('012345678905', 'Other'), sandbox.psCheckEbaySellerListings('012345678905', 'Other', '')]);
await settleSales();
checkTrue('22 scan change cancels the old retry timers', !!oldSt.warmLoops && Object.keys(oldSt.warmLoops).length === 1 && Object.values(oldSt.warmLoops).every(L => !L.timer && L.done), JSON.stringify(oldSt.warmLoops));
await sleep(250);
check('23 old retry never requests after the new scan (log reset at the new scan; new product has no SKU)', salesCalls.length, 0);
checkTrue('24 old response never paints into the new scan', !slot().includes(S1PK) && !slot().includes('Preparando'), slot());
// same UPC, newer scan: the in-flight old read answers late → ignored; its loop is dead
setWarm(40, 40, 30, 90000);
let rel; const late = new Promise(r => { rel = r; });
await start({ [S1PK]: { defer: () => late }, [S2PK]: seq(S2PK, [OK2()]) });
const staleSt = salesState();
await start({ [S1PK]: seq(S1PK, [OK1({ snapshot_age_seconds: 5, refreshing: false, stale: false })]), [S2PK]: seq(S2PK, [OK2()]) });
const callsNow = salesOf(S1PK);
rel(salesBuild(S1PK, W(S1PK)));
await sleep(200);
checkTrue('25 same UPC, newer scan: the old scan\'s late warming answer starts no loop and paints nothing', !!staleSt.warm && staleSt.warm.phase === 'failed' && !staleSt.warm.timer && staleSt.warm.tries === 0 && entry(S1PK).state === 'ok' && salesOf(S1PK) === callsNow && shows(S1PK, '90d', 273, '136 orders', '3.03'), JSON.stringify({ l: staleSt.warmLoops, n: salesOf(S1PK), c: callsNow }));

section('26, 28 — exact SKU isolation; no duplicate timers');
FAST();
await start({ [S1PK]: seq(S1PK, [W(S1PK), OK1()]), [S2PK]: seq(S2PK, [W(S2PK), W(S2PK), OK2()]) });
await waitFor(() => entry(S1PK).state === 'ok' && entry(S2PK).state === 'ok', 3000);
checkTrue('26 exact SKU isolation: each SKU gets its own numbers', shows(S1PK, '90d', 273, '136 orders', '3.03') && shows(S2PK, '90d', 38, '9 orders', '0.42') && shows(S1, '90d', 0, '0 orders', '0.00') && salesCalls.every(c => [S1, S1PK, S2PK].includes(c.sku)), slot());
check('26b request counts per SKU follow their own sequences', [salesOf(S1PK), salesOf(S2PK)], [2, 3]);
{
  setWarm(80, 80, 30, 90000);
  await start({ [S1PK]: seq(S1PK, [W(S1PK)]), [S2PK]: seq(S2PK, [OK2()]) });
  const st0 = salesState(), k = sandbox.psSbInvKey(S1PK);
  const t0 = st0.warmLoops && st0.warmLoops[k] ? st0.warmLoops[k].timer : null;
  const again = typeof sandbox.psSalesWarmSchedule === 'function' ? [sandbox.psSalesWarmSchedule(st0, k, 0), sandbox.psSalesWarmSchedule(st0, k, 0)] : [false];
  sandbox.psRequestSavvySales(LEG, [S1PK, S1PK]);          // same SKU asked again in the same scan
  checkTrue('28 no duplicate timer per SKU (re-schedule reuses the armed timer; re-request is ignored)', again.every(Boolean) && !!t0 && st0.warmLoops[k].timer === t0 && armed() === 1 && salesOf(S1PK) === 1, JSON.stringify({ again, a: armed(), n: salesOf(S1PK) }));
  if (typeof sandbox.psSalesWarmCancel === 'function') sandbox.psSalesWarmCancel(st0);
}

section('30–36 — sales display semantics unchanged');
FAST();
await start({ [S1PK]: seq(S1PK, [W(S1PK), { mode: 'zero' }]), [S2PK]: seq(S2PK, [OK2()]) });
await waitFor(() => entry(S1PK).state === 'ok', 3000);
await sleep(120);
check('30 no polling on confirmed zero', [salesOf(S1PK), armed()], [2, 0]);
checkTrue('31 confirmed zero remains 0 (after warming)', shows(S1PK, '7d', 0, '0 orders', '0.00') && shows(S1PK, '90d', 0, '0 orders', '0.00'), block(S1PK));
await start({ [S1PK]: seq(S1PK, [W(S1PK), OK1({ snapshot_age_seconds: 30, refreshing: false, stale: false })]), [S2PK]: seq(S2PK, [OK2()]) });
await waitFor(() => entry(S1PK).state === 'ok', 3000);
checkTrue('32 refund display unchanged', cell(S1PK, '90d').includes('⚠️ 3 refunded orders included') && cell(S1PK, '30d').includes('⚠️ 1 refunded order included'), cell(S1PK, '90d'));
checkTrue('33 cancellation display unchanged', cell(S1PK, '90d').includes('Excluded: 3 cancelled orders / 5 packs'), cell(S1PK, '90d'));
checkTrue('34 compact table unchanged (one row per SKU, 7D/30D/90D cells, same header)', slot().includes('<table id="ps-savvy-sales-table"><thead><tr><th>SKU / Pack</th><th>7D</th><th>30D</th><th>90D</th></tr></thead>') && (slot().match(/<tr data-sku=/g) || []).length === 3, slot());
checkTrue('35 nested-window note unchanged', slot().includes('7d ⊂ 30d ⊂ 90d are rolling nested windows: do not add them together.'), '');
checkTrue('36 average price stays hidden', !/avg|\$|USD|price/i.test(slot().replace(/<style>[\s\S]*?<\/style>/, '')), '');

section('37–41 — inventory first, inventory/location/SUMAR/REEMPLAZAR unaffected');
FAST();
await start({ [S1PK]: seq(S1PK, [W(S1PK), W(S1PK), OK1()]), [S2PK]: seq(S2PK, [W(S2PK), OK2()]) });
const lastInv = Math.max(...callLog.filter(c => c.kind === 'inventory').map(c => c.n));
checkTrue('37 inventory-first ordering preserved (every sales read, incl. retries, after the last inventory read)', lastInv >= 0 && callLog.filter(c => c.kind === 'sales').every(c => c.n > lastInv), JSON.stringify(callLog.map(c => c.kind)));
check('38 inventory requests unchanged: one authoritative read per exact SKU, confirmed while sales warm', [readCalls.map(r => r.sku).sort(), inv(S1PK) && inv(S1PK).state], [[S1, S1PK, S2PK].sort(), 'ok']);
checkTrue('39 location reads unchanged (one per exact SKU, GET)', ssReadCalls.length === 3 && ssReadCalls.every(c => c.method === 'GET'), JSON.stringify(ssReadCalls.map(c => c.sku)));
{
  const i = idxOf(S1PK);
  invConfig.current = 431;
  getEl('ps-pack-sbqty-' + i).value = '5'; invCalls = [];
  await sandbox.psUpdateSellbriteInventory(i, 'add', 'pack');
  check('40 SUMAR unchanged while sales are warming', invCalls[0] && invCalls[0].body, { sku: S1PK, warehouse_uuid: WH, quantity: 5, mode: 'add' });
  getEl('ps-pack-sbqty-' + i).value = '869'; invCalls = [];
  await sandbox.psUpdateSellbriteInventory(i, 'set', 'pack');
  check('41 REEMPLAZAR unchanged', invCalls[0] && invCalls[0].body, { sku: S1PK, warehouse_uuid: WH, quantity: 869, mode: 'set' });
}
await waitFor(idle, 3000);

section('42–47 — scope: Bulk Split / CSV / writes / auth / tokens / timeouts');
const undone = scope ? scope.undo22c0b3(appSrcP) : null;
checkTrue('scope: every #22C-0B3 edit present exactly once', !!scope && scope.applied22c0b3(appSrcP), '');
checkTrue('scope: app.js minus exactly the #22C-0B3 edits is byte-identical to 574a351', base574 != null && undone === base574, '');
const EDITED = ['psSalesReset', 'psReadSavvySales', 'psParseSavvySales', 'psSavvySalesHtml'];
const changedFns = base574 == null ? ['?'] : (base574.match(/^(async )?function (\w+)\(/gm) || []).map(x => x.replace(/^(async )?function /, '').replace('(', ''))
  .filter(n => fnSrc(appSrcP, n) !== fnSrc(base574, n));
checkTrue('scope: only the 4 sales display functions changed (+ the tail of saveSheetsUrl before the new section)', JSON.stringify(changedFns.filter(n => n !== 'saveSheetsUrl').sort()) === JSON.stringify(EDITED.slice().sort()), JSON.stringify(changedFns));
const newBlock = (() => { const a = appSrc.indexOf('// ━━ #22C-0B3'); return a > 0 ? appSrc.slice(a) : ''; })();
checkTrue('42 Bulk Split unchanged (sold.count / getDemandTier / DEMAND_TIERS / allocation / leftover untouched)', ['getDemandTier', 'computeSplit', 'updateSplitCalc', 'addSplitPacksToCSV'].every(n => base574 != null && fnSrc(appSrcP, n) === fnSrc(base574, n)) && !/_splitActive|_splitManual|DEMAND_TIERS|getDemandTier|computeSplit|updateSplitCalc|bulk\b|sold\.count|leftover/.test(newBlock + EDITED.map(n => fnSrc(appSrcP, n)).join('')), '');
checkTrue('43 CSV unchanged', base574 != null && fnSrc(appSrcP, 'exportCSV') === fnSrc(base574, 'exportCSV') && !/exportCSV|capturedBlobs|\bBlob\(/.test(newBlock), '');
checkTrue('44 no writes: sales reads are GET-only; new code has no fetch / write methods', salesCalls.every(c => c.method === 'GET' && !c.body) && !/fetch|psAuthFetch|method\s*:|POST|PUT|PATCH|DELETE|update-inventory|create-product/.test(newBlock), '');
checkTrue('45 auth unchanged: every sales read (incl. retries) carries the session bearer', salesCalls.length > 0 && salesCalls.every(c => c.auth === 'Bearer fake-token') && base574 != null && fnSrc(appSrcP, 'psAuthFetch') === fnSrc(base574, 'psAuthFetch'), JSON.stringify(salesCalls.slice(0, 2).map(c => c.auth)));
checkTrue('46 token never logged or rendered', !/console\.|_psDebug|savvyToken/.test(newBlock) && !slot().includes('fake-token'), '');
const timeoutsOf = src => (src.match(/setTimeout\([^;]*?,\s*\d+\s*\)/g) || []).map(x => x.match(/(\d+)\s*\)$/)[1]).sort().join(',');
checkTrue('47 every existing numeric setTimeout (search 10 s, seller-listings 15 s, …) unchanged', base574 != null && timeoutsOf(appSrcP) === timeoutsOf(base574), '');

section('B2 CONTRACT SIMULATION (mocked backend)');
FAST();
await start({ [S1PK]: seq(S1PK, [W(S1PK), W(S1PK), W(S1PK), W(S1PK), W(S1PK), OK1({ snapshot_age_seconds: 1, refreshing: false, stale: false })]),
              [S2PK]: seq(S2PK, [W(S2PK), W(S2PK), W(S2PK), OK2({ snapshot_age_seconds: 1, refreshing: false, stale: false })]) });
const scansBefore = sbCalls.length;
await waitFor(() => entry(S1PK).state === 'ok' && entry(S2PK).state === 'ok', 3000);
await sleep(150);
checkTrue('S1 warming ×N then confirmed: table fills with no rescan', entry(S1PK).state === 'ok' && entry(S2PK).state === 'ok' && sbCalls.length === scansBefore && shows(S1PK, '90d', 273, '136 orders', '3.03'), slot());
check('S2 exactly 1 + N requests per SKU, then silence (no duplicate loops)', [salesOf(S1PK), salesOf(S2PK), armed()], [6, 4, 0]);
checkTrue('S3 age note after the warm-up', block(S1PK).includes('Datos actualizados hace menos de 1 min'), block(S1PK));
setWarm(5, 8, 30, 90000);
await start({ [S1PK]: seq(S1PK, [W(S1PK)]), [S2PK]: seq(S2PK, [W(S2PK)]) });
await waitFor(() => entry(S1PK).state === 'error' && entry(S2PK).state === 'error', 5000);
await sleep(150);
check('S4 never resolves: the one shared probe stops at the limit (1 + 30); the waiting SKU is never polled', [salesOf(S1PK), salesOf(S2PK)], [31, 0]);
checkTrue('S5 never resolves: "⚠️ Ventas no confirmadas" shown, no timer left', block(S1PK).includes('⚠️ Ventas no confirmadas') && block(S2PK).includes('⚠️ Ventas no confirmadas') && armed() === 0, slot());
console.log('  simulated: warming×5 → confirmed = ' + 6 + ' requests (1pk), warming×3 → confirmed = 4 (2pk); never-resolves = 31 for the one probe, 0 for the waiting SKU, then stop (#22C-0C).');

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
