#!/usr/bin/env node
/**
 * ONE INVENTORY AUTHORITY ON THE SCREEN (Implementación #21D)
 *
 * The Sellbrite status card above Bulk Split and the existing-product warning
 * must show the SAME confirmed /sb/inventory state as the 🔒 YA LISTADO card
 * (never the /sb/search quantity), and inventory can only be changed after
 * that confirmation. A SKU with a 🔒 pack card has its controls only there.
 *
 * Built on the #21C harness:
 *
 * AUTHORITATIVE SELLBRITE INVENTORY FOR LOCKED PACKS (Implementación #21C)
 *
 * /sb/search decides WHICH exact Sellbrite SKUs exist (and locks the pack);
 * /sb/inventory?sku=<exact SKU> decides the quantity shown, the warehouse row
 * updated and whether SUMAR / REEMPLAZAR are enabled. A failed read is never 0.
 *
 * Runs the REAL app.js + multipack-fixes.js (same sandbox as
 * test-existing-pack-lock-inventory.js). Only fetch() is mocked. Fixture data
 * is the confirmed read-only production state for UPC 673419373609
 * (one warehouse 83757c63-124b-4141-8a9d-ddd2cb94b74c): -1 = 0, -1pk = 431,
 * -2pk = 77. No real inventory write is performed.
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
  sbCalls = []; ebCalls = []; otherCalls = []; invCalls = []; readCalls = []; invRead = {}; invWritten = {}; capturedBlobs = [];
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

(async () => {
['psSbCardInvHtml', 'psSbSkuHasLockCard', 'psSbQtyText']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1 — old card never shows the /sb/search quantity');
{
  const hA = hold(), hB = hold(), hC = hold();
  await scan(LEG, 'LEGO', LEGO(), [], { noSettle: true, inv: { [S1PK]: hA, [S1]: hB, [S2PK]: hC } });
  checkTrue('1 first paint: no 447 anywhere (status card, warning, split)', !status().includes('447') && !warn().includes('447') && !results().includes('447'), status().slice(0, 300));
  checkTrue('1b old card says "Consultando inventario…" while loading', cardInv(S1PK).includes('⏳ Consultando inventario…'));
  checkTrue('1c warning says "Sellbrite Qty: consultando…" while loading', warn().includes('Sellbrite Qty: consultando…') && !warn().includes('SIN STOCK'));
  hA.release(S1PK, LEGO_INV[S1PK]); hB.release(S1, LEGO_INV[S1]); hC.release(S2PK, LEGO_INV[S2PK]);
  await settleInventory();
}

section('3–5, 7 — confirmed LEGO values, the same everywhere; no duplicate controls');
await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV });
for (const [sku, q] of [[S1PK, '431'], [S2PK, '77'], [S1, '0']]) {
  const vals = [...NUMS(rec(sku)), ...NUMS(cardInv(sku)), ...NUMS(warnRow(sku))];
  check(`${sku}: lock card, old card and warning all show ${q}`, [vals.length >= 3, [...new Set(vals)]], [true, [q]]);
}
checkTrue('3 authoritative -1pk = 431 (search said 447)', /Qty actual: <strong id="ps-pack-sbavail-\d+">431</.test(rec(S1PK)) && !warn().includes('447'));
checkTrue('4 authoritative -2pk = 77', /Qty actual: <strong id="ps-pack-sbavail-\d+">77</.test(rec(S2PK)));
checkTrue('5 legacy -1 real confirmed 0 (and controls enabled on its lock card)', /Qty actual: <strong id="ps-pack-sbavail-\d+">0</.test(rec(S1)) && btnsEnabled(rec(S1)));
for (const sku of [S1, S1PK, S2PK]) {
  const i = idxOf(sku);
  checkTrue(`7 ${sku}: no old-card input/buttons, pointer to the 🔒 card instead`,
    !cardInv(sku).includes('id="ps-sbqty-' + i + '"') && !cardInv(sku).includes('ps-sbqty-btn-') && !status().includes('id="ps-sbqty-btn-' + i + '"') && cardInv(sku).includes('usa la tarjeta 🔒 YA LISTADO'), cardInv(sku));
  check(`7 ${sku}: exactly one SUMAR and one REEMPLAZAR on screen`,
    [(results().match(new RegExp('id="ps-pack-sbadd-' + i + '"', 'g')) || []).length + (status().match(new RegExp('id="ps-sbqty-btn-' + i + '"', 'g')) || []).length,
     (results().match(new RegExp('id="ps-pack-sbset-' + i + '"', 'g')) || []).length + (status().match(new RegExp('id="ps-sbqty-set-' + i + '"', 'g')) || []).length], [1, 1]);
}

section('After SUMAR every view shows the same new value');
invConfig = { mode: 'ok', current: 431 };
delete invRead[S1PK];                    // the mocked Sellbrite now reflects the write
let r = await click(S1PK, 'add', 5);
check('all views agree on 436', [[...new Set([...NUMS(live(S1PK)), ...NUMS(cardInv(S1PK)), ...NUMS(warnRow(S1PK))])]], [['436']]);

section('6 — failed read never shows a confirmed 0 anywhere');
await scan(LEG, 'LEGO', [sbProd(S2PK, 0)], [], { inv: { [S2PK]: { mode: 'http500' } } });
checkTrue('6 lock card: Inventario no confirmado, no Qty actual', rec(S2PK).includes('⚠️ Inventario no confirmado') && !rec(S2PK).includes('Qty actual'));
checkTrue('6b old card: Inventario no confirmado, no number', cardInv(S2PK).includes('⚠️ Inventario no confirmado') && !NUMS(cardInv(S2PK)).length);
checkTrue('6c warning: "Sellbrite Qty: desconocida", not 0, no SIN STOCK claim', warn().includes('Sellbrite Qty: desconocida') && !/Sellbrite Qty: 0/.test(warn()) && !warn().includes('SIN STOCK'), warn().slice(0, 300));
check('6d evidence qty unknown, pack still locked', [st(2).sellbrite[0].qty, st(2).locked], [null, true]);

section('2 — old-card controls (SKU without a 🔒 pack card) follow the same authority');
const ODD = 'LEG-673419373609-99';            // pack 99: no Bulk Split card
await scan(LEG, 'LEGO', [sbProd(ODD, 12)], [], { inv: { [ODD]: { mode: 'network' } } });
{
  const i = idxOf(ODD);
  check('no lock card for this SKU', sandbox.psSbSkuHasLockCard(ODD), false);
  checkTrue('2 failed read: old card controls disabled, no number shown', /<button disabled id="ps-sbqty-btn-/.test(cardInv(ODD)) && /<button disabled id="ps-sbqty-set-/.test(cardInv(ODD)) && !NUMS(cardInv(ODD)).length && !cardInv(ODD).includes('>12<'));
  invCalls = [];
  await sandbox.psUpdateSellbriteInventory(i, 'add');
  await sandbox.psUpdateSellbriteInventory(i, 'set');
  check('2b forced clicks send nothing', invCalls.length, 0);
}
await scan(LEG, 'LEGO', [sbProd(ODD, 12)], [], { inv: { [ODD]: { rows: [{ warehouse_uuid: WH, available: 9, on_hand: 9 }] } } });
{
  const i = idxOf(ODD);
  checkTrue('2c confirmed: old card shows 9 (not search 12), controls enabled', /<strong id="ps-sbqty-avail-\d+">9</.test(cardInv(ODD)) && /<button id="ps-sbqty-btn-/.test(cardInv(ODD)) && !cardInv(ODD).includes('>12<'));
  vm.runInContext(`_psSellbriteProducts[${i}].warehouse_uuid = 'wh-from-search';`, sandbox);
  invConfig = { mode: 'ok', current: 9 };
  delete invRead[ODD];                   // the mocked Sellbrite now reflects the write
  getEl('ps-sbqty-' + i).value = '2'; invCalls = [];
  await sandbox.psUpdateSellbriteInventory(i, 'add');
  check('2d old-card SUMAR: exact SKU, confirmed warehouse, mode add', [invCalls[0].body.sku, invCalls[0].body.warehouse_uuid, invCalls[0].body.mode, invCalls[0].body.quantity], [ODD, WH, 'add', 2]);
  checkTrue('2e old card then shows the reconciled 11', /<strong id="ps-sbqty-avail-\d+">11</.test(cardInv(ODD)), cardInv(ODD));
}

section('Backend contract: available_confirmed=false is never usable');
check('parser: available_confirmed=false → error even with a numeric row',
  sandbox.psParseSbInventory(S2PK, 200, { status: 'success', sku: S2PK, inventory: { found: true, available_confirmed: false, channels: [{ warehouse_uuid: WH, available: 0, on_hand: 0 }] } }).state, 'error');
check('parser: backend null available (#21D backend) → error',
  sandbox.psParseSbInventory(S2PK, 200, { status: 'success', sku: S2PK, inventory: { found: true, available_confirmed: false, total_quantity: null, channels: [{ warehouse_uuid: WH, available: null, on_hand: 77 }] } }).state, 'error');
check('parser: confirmed row still ok (field present or absent)',
  [sandbox.psParseSbInventory(S2PK, 200, { status: 'success', sku: S2PK, inventory: { found: true, available_confirmed: true, channels: [{ warehouse_uuid: WH, available: 77, on_hand: 77 }] } }).available,
   sandbox.psParseSbInventory(S2PK, 200, { status: 'success', sku: S2PK, inventory: { found: true, channels: [{ warehouse_uuid: WH, available: 0, on_hand: 0 }] } }).available], [77, 0]);

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
