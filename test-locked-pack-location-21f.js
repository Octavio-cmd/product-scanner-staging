#!/usr/bin/env node
/**
 * MULTI-LOCATION ON THE 🔒 YA LISTADO CARD (Implementación #21F)
 *
 * Reuses the existing location UI (chips with ✕, "Nueva ubicación
 * adicional...", 📷, ➕ Añadir, 🔄 Reemplazar) and writes (psSaveShipStationLocation
 * / psRemoveLocation / psPersistLocation: Sellbrite bin_location +
 * ShipStation warehouseLocation). Per exact SKU there is ONE editable
 * location block: inside the 🔒 record when the SKU has a lock card, in the
 * Sellbrite status card otherwise (which then only shows a read-only
 * summary for locked SKUs). Location state is keyed by exact SKU and guarded
 * by the scan sequence; the Sellbrite write uses the #21C confirmed
 * warehouse and is refused when inventory is not confirmed.
 *
 * Built on the #21C/#21D harness; only fetch() is mocked. No real write.
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
const appSrc = fs.readFileSync(process.env.PS21_APP || path.join(__dirname, 'app.js'), 'utf8');
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
  sbCalls = []; ebCalls = []; otherCalls = []; invCalls = []; readCalls = []; invRead = {}; invWritten = {}; capturedBlobs = []; ssRead = {}; ssReadMode = 'ok'; ssSaveMode = 'ok'; ssReadCalls = []; ssSaveCalls = [];
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

const LEG = '673419373609';
const S1 = 'LEG-673419373609-1', S1PK = 'LEG-673419373609-1pk', S2PK = 'LEG-673419373609-2pk';
const LEGO = () => [sbProd(S1PK, 447), sbProd(S1, 0), sbProd(S2PK, 77)];   // /sb/search shape (qty from search is NOT trusted)
const LEGO_INV = {
  [S1]: { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 0, on_hand: 0 }] },
  [S1PK]: { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 431, on_hand: 431 }] },
  [S2PK]: { rows: [{ warehouse_uuid: WH, warehouse_name: '404 E 3rd St', available: 77, on_hand: 77 }] }
};
const idxOf = sku => sandbox.psSbProductIdxForSku(sku);
const inv = sku => sandbox.psSbInvFor(sku);
const rec = sku => { const i = idxOf(sku); const h = results(); const a = h.indexOf('id="ps-pack-sbrec-' + i + '"'); if (a < 0) return ''; const b = h.indexOf('id="ps-pack-sbrec-', a + 5); const c = h.indexOf('id="ps-pack-lock-', a + 5); const e = [b, c].filter(x => x > 0); return h.slice(a, e.length ? Math.min(...e) : undefined); };
const live = sku => getEl('ps-pack-sbrec-' + idxOf(sku)).innerHTML;   // the element psRenderSbRecord repaints
const btnsDisabled = h => /<button disabled id="ps-pack-sbadd-/.test(h) && /<button disabled id="ps-pack-sbset-/.test(h);
const btnsEnabled = h => /<button id="ps-pack-sbadd-/.test(h) && /<button id="ps-pack-sbset-/.test(h);
function hold() { let release; const p = new Promise(r => { release = r; }); return { defer: () => p, release: (sku, spec) => release(invReadBuild(sku, spec)) }; }
async function click(sku, modo, qty) {
  const i = idxOf(sku);
  getEl('ps-pack-sbqty-' + i).value = String(qty);
  invCalls = []; readCalls = [];
  await sandbox.psUpdateSellbriteInventory(i, modo, 'pack');
  return { i, call: invCalls[0], shown: String(getEl('ps-pack-sbavail-' + i).textContent), confirm: getEl('ps-pack-sbconfirm-' + i).innerHTML };
}
async function addAll() { setBulk([]); vm.runInContext('toast = function(){};', sandbox); await sandbox.addSplitPacksToCSV(); return getBulk().map(b => b.sku); }

const status = () => getEl('ps-sellbrite-status').innerHTML;     // as first painted
// live old-card block; before its first repaint the stub element is empty and
// the block only exists inside the status card's first paint.
const cardInv = sku => {
  const i = idxOf(sku), live = getEl('ps-sbcard-inv-' + i).innerHTML;
  if (live) return live;
  const h = status(), a = h.indexOf('id="ps-sbcard-inv-' + i + '">');
  return a < 0 ? '' : h.slice(a, h.indexOf('id="ps-sbqty-confirm-', a) > 0 ? h.indexOf('</div>', h.indexOf('id="ps-sbqty-confirm-', a)) : h.indexOf('</div></div>', a));
};
const warnRow = sku => warn().split('<div').filter(x => x.includes('>' + sku + '</span>')).join('');
const warn = () => getEl('ps-existing-product-slot').innerHTML;       // live warning
const NUMS = h => (h.match(/(?:Qty actual: <strong id="ps-pack-sbavail-\d+">|<strong id="ps-sbqty-avail-\d+">|Sellbrite Qty: )(-?\d+)/g) || []).map(x => x.replace(/.*?(-?\d+)$/, '$1'));

const WHSRCH = 'wh-1';   // warehouse_uuid that /sb/search reports (the fixture channel)
async function settleAll() {
  for (let n = 0; n < 60; n++) {
    const inv = vm.runInContext('window._psSbInv || {}', sandbox), loc = vm.runInContext('window._psSsLoc || {}', sandbox);
    if (!Object.values(inv).concat(Object.values(loc)).some(a => a && a.state === 'loading')) break;
    await new Promise(r => setImmediate(r));
  }
  try { sandbox.updateSplitCalc(); } catch (e) {}
}
const locState = sku => vm.runInContext('psSsLocFor(' + JSON.stringify(sku) + ')', sandbox);
const editorLive = sku => getEl('ps-ssloc-' + idxOf(sku)).innerHTML;
const locConfirm = sku => getEl('ps-ssloc-confirm-' + idxOf(sku)).innerHTML;
const roLive = sku => getEl('ps-ssloc-ro-' + idxOf(sku)).innerHTML;
const toasts = [];
function trapToasts() { toasts.length = 0; sandbox.__tl = toasts; vm.runInContext('toast = function(m){ __tl.push(String(m)); };', sandbox); }
async function legoScan(locs, extra) {
  await scan(LEG, 'LEGO', LEGO(), [], Object.assign({ inv: LEGO_INV }, extra || {}));
  // (resetAll ran inside scan; seed ShipStation AFTER it, then re-read)
}
async function freshLego(locs, extra) {
  const base = { [S1PK]: 'oficina', [S2PK]: 'oficina', [S1]: '' };
  await scan(LEG, 'LEGO', LEGO(), [], Object.assign({ inv: LEGO_INV, noSettle: true }, extra || {}));
  await settleAll();
  ssLoc = Object.assign(base, locs || {});
  ssReadCalls = []; ssSaveCalls = [];
  // re-run the real scan now that ShipStation is seeded
  const run = Promise.all([sandbox.psCheckSellbrite(LEG, 'LEGO'), sandbox.psCheckEbaySellerListings(LEG, 'LEGO', '')]);
  await run; await settleAll(); trapToasts();
}
async function save(sku, mode, text) {
  const i = idxOf(sku);
  getEl('ps-ssloc-input-' + i).value = text;
  invCalls = []; ssSaveCalls = []; ssReadCalls = [];
  await sandbox.psSaveShipStationLocation(i, mode);
  await settleAll();
}

(async () => {
['psSsLocFor', 'psSsLocEditorHtml', 'psSsLocSummaryHtml', 'psRenderSsLoc', 'psCheckShipStationLocation', 'psSaveShipStationLocation', 'psRemoveLocation', 'psPersistLocation', 'psScanLocation']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1–6, 10 — 🔒 card carries the location editor; old card is read-only');
await freshLego();
{
  const r1pk = rec(S1PK), i1pk = idxOf(S1PK);
  checkTrue('1 chips on the lock record (oficina)', r1pk.includes('📍 Ubicaciones:') && r1pk.includes('>oficina</strong>') && r1pk.includes('psRemoveLocation(' + i1pk + ',0)'), r1pk.slice(0, 300));
  checkTrue('2 input "Nueva ubicación adicional..."', r1pk.includes('id="ps-ssloc-input-' + i1pk + '"') && r1pk.includes('Nueva ubicación adicional...'));
  checkTrue('3 camera button', r1pk.includes('psScanLocation(' + i1pk + ')'));
  checkTrue('4 ➕ Añadir', r1pk.includes("psSaveShipStationLocation(" + i1pk + ",'append')") && r1pk.includes('➕ Añadir'));
  checkTrue('5 🔄 Reemplazar (location)', r1pk.includes("psSaveShipStationLocation(" + i1pk + ",'replace')"));
  checkTrue('inventory controls still on the same record', r1pk.includes('ps-pack-sbadd-' + i1pk) && r1pk.includes('ps-pack-sbset-' + i1pk));
  for (const sku of [S1, S1PK, S2PK]) {
    const i = idxOf(sku);
    checkTrue(`6 ${sku}: old card has NO location editor (no input/📷/Añadir/Reemplazar/✕), only read-only summary`,
      !status().includes('id="ps-ssloc-' + i + '"') && !status().includes('ps-ssloc-input-' + i) && !status().includes('psScanLocation(' + i + ')')
      && !roLive(sku).includes('psRemoveLocation(') && !roLive(sku).includes('<input') && roLive(sku).includes('usa la tarjeta 🔒 YA LISTADO'), roLive(sku));
  }
  checkTrue('6b old card summary shows oficina read-only', roLive(S1PK).includes('>oficina</strong>'));
  const card1 = results().slice(results().indexOf('id="ps-pack-lock-1"'), results().indexOf('id="ps-pack-lock-2"'));
  check('10 1pk card: two separate location blocks (-1pk, -1)', [(card1.match(/id="ps-ssloc-\d+"/g) || []).length, card1.includes('id="ps-ssloc-' + idxOf(S1) + '"'), card1.includes('id="ps-ssloc-' + idxOf(S1PK) + '"')], [2, true, true]);
  check('exactly one editor per SKU on screen', [S1, S1PK, S2PK].map(sku => (results() + status()).split('id="ps-ssloc-' + idxOf(sku) + '"').length - 1), [1, 1, 1]);
}

section('8–9, 17 — exact-SKU state');
check('8/9 -1 / -1pk / -2pk states independent', [locState(S1).loc, locState(S1PK).loc, locState(S2PK).loc], ['', 'oficina', 'oficina']);
check('17 each read asked for its exact SKU', ssReadCalls.map(c => c.sku).sort(), [S1, S1PK, S2PK].sort());
checkTrue('-1 shows its own (empty) state, not -1pk\'s', rec(S1).includes('📍 Guardar') && !rec(S1).includes('>oficina</strong>'));

section('11, 18–20 — Añadir keeps the old location, exact SKU, confirmed warehouse');
await freshLego();
vm.runInContext(`_psSellbriteProducts[${idxOf(S1PK)}].warehouse_uuid = 'wh-from-search';`, sandbox);
await save(S1PK, 'append', 'A-12');
check('11 append → "oficina, A-12" to Sellbrite bin + ShipStation', [invCalls[0].body.bin_location, ssSaveCalls[0].body.warehouse_location], ['oficina, A-12', 'oficina, A-12']);
check('18 ShipStation save exact SKU', ssSaveCalls[0].body.sku, S1PK);
check('19 Sellbrite save exact SKU, no quantity sent', [invCalls[0].body.sku, 'quantity' in invCalls[0].body, 'mode' in invCalls[0].body], [S1PK, false, false]);
check('20 confirmed warehouse_uuid used (not the search value)', invCalls[0].body.warehouse_uuid, WH);
check('re-read after save through the exact-SKU read', [ssReadCalls.map(c => c.sku), locState(S1PK).loc], [[S1PK], 'oficina, A-12']);
checkTrue('success message kept', locConfirm(S1PK).includes('Guardada en Sellbrite + ShipStation'), locConfirm(S1PK));
check('other SKUs untouched', [locState(S2PK).loc, locState(S1).loc, ssLoc[S2PK]], ['oficina', '', 'oficina']);
await save(S1PK, 'append', 'B-4');
check('third location appended', locState(S1PK).loc, 'oficina, A-12, B-4');

section('12–13 — duplicate and length limits');
await save(S1PK, 'append', 'OFICINA');
check('12 duplicate (case-insensitive) rejected, nothing written', [invCalls.length, ssSaveCalls.length, toasts.some(t => t.includes('ya está en la lista'))], [0, 0, true]);
await freshLego({ [S1PK]: 'X'.repeat(95) });
await save(S1PK, 'append', 'A-12');
check('13 over 100 characters rejected, nothing written', [invCalls.length, ssSaveCalls.length, locConfirm(S1PK).includes('excede el límite')], [0, 0, true]);

section('14–16 — Reemplazar replaces all; ✕ removes one');
await freshLego({ [S1PK]: 'oficina, A-12' });
await save(S1PK, 'replace', 'B-4');
check('14 replace → "B-4"', [invCalls[0].body.bin_location, ssSaveCalls[0].body.warehouse_location, locState(S1PK).loc], ['B-4', 'B-4', 'B-4']);
await freshLego({ [S1PK]: 'oficina, A-12, B-4' });
invCalls = []; ssSaveCalls = [];
await sandbox.psRemoveLocation(idxOf(S1PK), 1); await settleAll();
check('15 delete A-12 → "oficina, B-4"', [invCalls[0].body.bin_location, locState(S1PK).loc], ['oficina, B-4', 'oficina, B-4']);
await freshLego({ [S1PK]: 'oficina' });
invCalls = []; ssSaveCalls = [];
await sandbox.psRemoveLocation(idxOf(S1PK), 0); await settleAll();
check('16 delete final → empty', [invCalls[0].body.bin_location, ssSaveCalls[0].body.warehouse_location, locState(S1PK).loc], ['', '', '']);

section('21 — no location write without confirmed inventory / confirmed location');
await freshLego({}, { inv: Object.assign({}, LEGO_INV, { [S1PK]: { mode: 'http500' } }) });
await save(S1PK, 'append', 'A-12');
check('21 inventory unconfirmed → no Sellbrite and no ShipStation write', [invCalls.length, ssSaveCalls.length, locConfirm(S1PK).includes('Inventario no confirmado') || toasts.some(t => t.includes('Inventario no confirmado'))], [0, 0, true]);
await freshLego();
vm.runInContext(`window._psSsLoc[psSbInvKey(${JSON.stringify(S1PK)})].state = 'error';`, sandbox);
await save(S1PK, 'append', 'A-12');
check('21b location read not confirmed → Añadir refused (would drop unknown locations)', [invCalls.length, ssSaveCalls.length], [0, 0]);

section('22–25 — stale responses');
{
  // UPC A = LEGO (held), then UPC B = IRW scanned; A's late response must not touch B.
  const hA = { p: null, r: null }; hA.p = new Promise(r => { hA.r = r; });
  await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV, noSettle: true });
  ssLoc = { [S1PK]: 'oficina' }; ssRead = { [S1PK]: { defer: () => hA.p } };
  sandbox.psCheckSellbrite(LEG, 'LEGO');   // A: ShipStation read for -1pk stays pending
  for (let n = 0; n < 10; n++) await new Promise(r => setImmediate(r));
  const IRWSKU = 'IRW-710363598525-2';
  await scan(IRW, 'Irwin Naturals', [sbProd(IRWSKU, 4)], [], { inv: { [IRWSKU]: { rows: [{ warehouse_uuid: WH, available: 4, on_hand: 4 }] } }, noSettle: true });
  ssLoc = { [IRWSKU]: 'E/P1' }; ssRead = { [S1PK]: { defer: () => hA.p } };
  await sandbox.psCheckSellbrite(IRW, 'Irwin Naturals'); await settleAll();
  const iI = idxOf(IRWSKU);
  hA.r(jsonRes(200, { exists: true, product_id: 9, warehouse_location: 'ZZZ-FROM-LEGO' }));
  for (let n = 0; n < 10; n++) await new Promise(r => setImmediate(r));
  await settleAll();
  check('22 late UPC-A response not painted into UPC-B', [editorLive(IRWSKU).includes('ZZZ'), results().includes('ZZZ'), status().includes('ZZZ')], [false, false, false]);
  check('24 B currentLoc / state unchanged', [vm.runInContext(`_psSellbriteProducts[${iI}].currentLoc`, sandbox), locState(IRWSKU).loc, locState(S1PK)], ['E/P1', 'E/P1', null]);
  trapToasts();
  await save(IRWSKU, 'append', 'A-1');
  check('25 B next Añadir uses B\'s own locations', [invCalls[0].body.sku, invCalls[0].body.bin_location], [IRWSKU, 'E/P1, A-1']);
}
{
  const hOld = { p: null, r: null }; hOld.p = new Promise(r => { hOld.r = r; });
  await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV, noSettle: true });
  ssLoc = { [S1PK]: 'oficina', [S2PK]: 'oficina', [S1]: '' }; ssRead = { [S1PK]: { defer: () => hOld.p } };
  sandbox.psCheckSellbrite(LEG, 'LEGO');   // older scan, -1pk read pending
  for (let n = 0; n < 10; n++) await new Promise(r => setImmediate(r));
  ssRead = {};
  await sandbox.psCheckSellbrite(LEG, 'LEGO'); await settleAll();   // newer scan of the same UPC
  hOld.r(jsonRes(200, { exists: true, product_id: 9, warehouse_location: 'OLD-SCAN' }));
  for (let n = 0; n < 10; n++) await new Promise(r => setImmediate(r));
  await settleAll();
  check('23 older same-UPC response ignored', [locState(S1PK).loc, results().includes('OLD-SCAN')], ['oficina', false]);
}

section('26–28 — auth');
{
  sandbox.__exp = 0;
  vm.runInContext('var __realCad2 = savvySesionCaducada; savvySesionCaducada = function(){ __exp++; };', sandbox);
  await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV, noSettle: true });
  ssLoc = { [S1PK]: 'oficina' }; ssReadMode = 'http401';
  await sandbox.psCheckSellbrite(LEG, 'LEGO'); await settleAll();
  check('26 read 401 → session-expired handler, "No se pudo consultar ubicación", no editor', [sandbox.__exp > 0, locState(S1PK).state, rec(S1PK).includes('No se pudo consultar ubicación'), rec(S1PK).includes('ps-ssloc-input-')], [true, 'error', true, false]);
  sandbox.__exp = 0; ssReadMode = 'ok';
  await freshLego();
  invConfig = { mode: 'http401', current: 0 }; ssSaveMode = 'http401';
  await save(S1PK, 'append', 'A-12');
  check('27 save 401 → handler called, failure shown, state unchanged', [sandbox.__exp > 0, locConfirm(S1PK).includes('Falló en ambos sistemas'), locState(S1PK).loc], [true, true, 'oficina']);
  vm.runInContext('savvySesionCaducada = __realCad2;', sandbox);
  invConfig = { mode: 'ok', current: 0 }; ssSaveMode = 'ok';
  await freshLego();
  await save(S1PK, 'append', 'A-12');
  const all = ssReadCalls.concat(ssSaveCalls).concat(invCalls);
  checkTrue('28 Bearer only in Authorization header; not in URL/body', all.length > 0 && all.every(c => c.auth === 'Bearer fake-token' && !String(c.u).includes('fake-token') && !JSON.stringify(c.body || {}).includes('fake-token')), JSON.stringify(all.map(c => c.auth)));
}

section('7 — SKU without a lock card keeps the old-card editor');
{
  const ODD = 'LEG-673419373609-99';
  await scan(LEG, 'LEGO', [sbProd(ODD, 12)], [], { inv: { [ODD]: { rows: [{ warehouse_uuid: WH, available: 12, on_hand: 12 }] } }, noSettle: true });
  ssLoc = { [ODD]: 'oficina' };
  await sandbox.psCheckSellbrite(LEG, 'LEGO'); await settleAll(); trapToasts();
  const i = idxOf(ODD);
  checkTrue('7 old card editor present (span ps-ssloc-i, chips, input, 📷, Añadir)', status().includes('id="ps-ssloc-' + i + '"') && editorLive(ODD).includes('>oficina</strong>') && editorLive(ODD).includes('ps-ssloc-input-' + i) && editorLive(ODD).includes('➕ Añadir') && !status().includes('ps-ssloc-ro-' + i));
  await save(ODD, 'append', 'A-12');
  check('7b old-card Añadir works as before', [invCalls[0].body.bin_location, ssSaveCalls[0].body.sku, locState(ODD).loc], ['oficina, A-12', ODD, 'oficina, A-12']);
}

section('29–30 — inventory SUMAR / REEMPLAZAR unchanged and independent');
await freshLego();
invConfig = { mode: 'ok', current: 369 };
delete invRead[S1PK];
{
  let r = await click(S1PK, 'add', 500);
  check('29 SUMAR body unchanged, no bin_location, location untouched', [r.call.body, locState(S1PK).loc, ssSaveCalls.length], [{ sku: S1PK, warehouse_uuid: WH, quantity: 500, mode: 'add' }, 'oficina', 0]);
  invConfig = { mode: 'ok', current: 869 };
  r = await click(S1PK, 'set', 869);
  check('30 REEMPLAZAR body unchanged, no bin_location, location untouched', [r.call.body, locState(S1PK).loc], [{ sku: S1PK, warehouse_uuid: WH, quantity: 869, mode: 'set' }, 'oficina']);
  await save(S1PK, 'append', 'A-12');
  check('business case: +500 then add location → "oficina, A-12", no quantity in location write', [invCalls[0].body.bin_location, 'quantity' in invCalls[0].body], ['oficina, A-12', false]);
}

section('31–33 — locks, CSV gates, Return-to-Fix unchanged');
await freshLego();
check('31 1pk/2pk locked', [sandbox.psIsPackLocked(LEG, 1), sandbox.psIsPackLocked(LEG, 2)], [true, true]);
setBulk([{ sku: 'LEG-673419373609-2pk', upc: LEG, packs: 2, title: 'x', price: '9.99', quantity: 1 }]);
{ const ex = await captureExport(); checkTrue('32 exportCSV still refuses a locked row', ex.csv === null && ex.alerts.some(a => a.includes('EXPORT BLOQUEADO'))); }
setBulk([]);
check('32b split Add still skips locked packs', (await addAll()).filter(s => /-(1|1pk|2|2pk)$/.test(s)), []);
{
  const sku2 = 'IRW-710363598525-2pk';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false }, manual: { 2: 3 } });
  check('33 Return-to-Fix target still editable', sandbox.psLockSessionEditAllowed(IRW, sku2), true);
}

section('34–36 — no direct third-party calls');
checkTrue('34 app.js never calls api.sellbrite.com', !appSrc.includes('api.sellbrite.com'));
checkTrue('35 app.js never calls ShipStation directly', !/ssapi\.shipstation\.com|api\.shipstation\.com/.test(appSrc));
checkTrue('36 no eBay write endpoint called by location flows', otherCalls.every(c => !/ebay\.com|\/ebay\/(add|revise|end|relist)/i.test(c.u)));

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
