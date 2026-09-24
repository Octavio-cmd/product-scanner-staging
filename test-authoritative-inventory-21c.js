#!/usr/bin/env node
/**
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
    const q = p.inventory.total_quantity;
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
  sbCalls = []; ebCalls = []; otherCalls = []; invCalls = []; readCalls = []; invRead = {}; capturedBlobs = [];
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
  await Promise.all([sandbox.psCheckSellbrite(upc, brand), sandbox.psCheckEbaySellerListings(upc, brand, '')]);
  if (!opts.noSettle) await settleInventory();
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

(async () => {
['psLoadSbInventory', 'psReadSbInventory', 'psParseSbInventory', 'psSbInvFor', 'psRenderSbRecord', 'psReconcileSbInventory', 'psSbRecordInnerHtml']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1–2 — loading state before /sb/inventory answers');
{
  const h1 = hold(), h2 = hold(), h3 = hold();
  await scan(LEG, 'LEGO', LEGO(), [], { noSettle: true, inv: { [S1]: h1, [S1PK]: h2, [S2PK]: h3 } });
  await new Promise(r => setImmediate(r));
  const r = rec(S1PK);
  checkTrue('1 locked -1pk shows "Consultando inventario…"', r.includes('⏳ Consultando inventario…'), r.slice(0, 200));
  checkTrue('1b no "Qty actual" (never a temporary 0) while loading', !r.includes('Qty actual') && !rec(S1).includes('Qty actual'));
  checkTrue('2 SUMAR/REEMPLAZAR disabled while loading', btnsDisabled(r) && btnsDisabled(rec(S1)) && btnsDisabled(rec(S2PK)));
  check('reads are GET, one per exact SKU, in order', readCalls.map(c => [c.method, c.sku]).slice(0, 1), [['GET', S1PK]]);
  invCalls = [];
  await sandbox.psUpdateSellbriteInventory(idxOf(S1PK), 'add', 'pack');
  check('2b clicking while loading sends nothing', invCalls.length, 0);
  h2.release(S1PK, LEGO_INV[S1PK]); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  h1.release(S1, LEGO_INV[S1]); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  h3.release(S2PK, LEGO_INV[S2PK]); await settleInventory();
  check('reads sequential, exact SKUs, GET only', readCalls.map(c => c.method + ' ' + c.sku), ['GET ' + S1PK, 'GET ' + S1, 'GET ' + S2PK]);
}

section('3–6, 12–13, 16 — confirmed LEGO values (real read-only data)');
await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV });
check('1pk locked with TWO separate Sellbrite records', [st(1).state, st(1).sellbrite.map(r => r.sku)], ['sellbrite', [S1PK, S1]]);
check('2pk locked with -2pk', [st(2).state, st(2).sellbrite.map(r => r.sku)], ['sellbrite', [S2PK]]);
checkTrue('3 -1pk Qty actual 431 (search said 447)', /Qty actual: <strong id="ps-pack-sbavail-\d+">431</.test(rec(S1PK)), rec(S1PK).slice(0, 200));
checkTrue('4 -2pk Qty actual 77', /Qty actual: <strong id="ps-pack-sbavail-\d+">77</.test(rec(S2PK)));
checkTrue('5 legacy -1 real confirmed 0 shown as Qty actual 0', /Qty actual: <strong id="ps-pack-sbavail-\d+">0</.test(rec(S1)));
checkTrue('6 confirmed zero enables controls', btnsEnabled(rec(S1)));
checkTrue('controls enabled for 431 / 77', btnsEnabled(rec(S1PK)) && btnsEnabled(rec(S2PK)));
check('12 each record has its own read state', [inv(S1).state, inv(S1).available, inv(S1PK).state, inv(S1PK).available], ['ok', 0, 'ok', 431]);
checkTrue('13 quantities not merged (no 431 on -1, no 0 on -1pk, no 431 total)', !/sbavail-\d+">431</.test(rec(S1)) && !/sbavail-\d+">0</.test(rec(S1PK)) && !results().includes('>431 + 0<'));
checkTrue('"2 registros ... elige cuál actualizar" shown', results().includes('2 registros en Sellbrite — elige cuál actualizar'));
check('no Add for 1pk/2pk', (await addAll()).filter(s => /-(1|1pk|2|2pk)$/.test(s)), []);

section('14–18 — SUMAR / REEMPLAZAR target the exact SKU and the confirmed warehouse');
await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV });
vm.runInContext(`_psSellbriteProducts[${idxOf(S1PK)}].warehouse_uuid = 'wh-from-search';`, sandbox);   // prove the confirmed row wins
invConfig = { mode: 'ok', current: 431 };
invRead[S1PK] = { rows: [{ warehouse_uuid: WH, available: 436, on_hand: 436 }] };                      // Sellbrite after the write
let r = await click(S1PK, 'add', 5);
check('14 exact SKU sent', r.call.body.sku, S1PK);
check('15 confirmed warehouse_uuid sent (not the search one)', r.call.body.warehouse_uuid, WH);
check('16 SUMAR mode=add, quantity = received', [r.call.body.mode, r.call.body.quantity], ['add', 5]);
check('update authenticated', !!r.call.auth, true);
check('18 display = backend available, then reconciled by a fresh /sb/inventory read', [r.shown, inv(S1PK).available, readCalls.map(c => c.sku)], ['436', 436, [S1PK]]);
checkTrue('18b confirmation message kept after reconcile', live(S1PK).includes('✅ Confirmado por Sellbrite') || r.confirm.includes('✅ Confirmado por Sellbrite'), r.confirm);
invConfig = { mode: 'ok', current: 436 };
invRead[S1PK] = { rows: [{ warehouse_uuid: WH, available: 434, on_hand: 434 }] };                      // a sale happened meanwhile
r = await click(S1PK, 'set', 10);
check('17 REEMPLAZAR mode=set to confirmed warehouse', [r.call.body.mode, r.call.body.quantity, r.call.body.warehouse_uuid], ['set', 10, WH]);
check('18c reconcile read wins over stale value (authoritative)', [inv(S1PK).available, /Qty actual: <strong id="ps-pack-sbavail-\d+">434</.test(live(S1PK))], [434, true]);
invConfig = { mode: 'ok', current: 0 };
invRead[S1] = { rows: [{ warehouse_uuid: WH, available: 3, on_hand: 3 }] };
r = await click(S1, 'add', 3);
check('14b legacy -1 update targets the legacy SKU', [r.call.body.sku, r.call.body.mode], [S1, 'add']);

section('19–20 — failures keep the confirmed quantity');
await scan(LEG, 'LEGO', LEGO(), [], { inv: LEGO_INV });
invConfig = { mode: 'http409', current: 77 };
r = await click(S2PK, 'add', 5);
check('19 409: confirmed 77 unchanged (state + display untouched), no reconcile read, still locked', [inv(S2PK).state, inv(S2PK).available, r.shown, /sbavail-\d+">77</.test(rec(S2PK)), readCalls.length, st(2).locked, sandbox.psIsPackLocked(LEG, 2)], ['ok', 77, '', true, 0, true, true]);
checkTrue('19b Safe SUMAR message shown', r.confirm.includes('No se pudo leer la cantidad actual'), r.confirm);
{
  sandbox.__exp = 0;
  vm.runInContext('var __realCad = savvySesionCaducada; savvySesionCaducada = function(){ __exp++; };', sandbox);
  invConfig = { mode: 'http401', current: 77 };
  r = await click(S2PK, 'set', 5);
  vm.runInContext('savvySesionCaducada = __realCad;', sandbox);
  check('20 401: session-expired handler called, quantity unchanged', [sandbox.__exp, r.shown, inv(S2PK).available, readCalls.length], [1, '', 77, 0]);
}

section('7–11 — failed inventory read is never 0 and never unlocks');
for (const mode of ['http500', 'network', 'malformed', 'found_false', 'nonnum', 'wrongsku', 'norows']) {
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { inv: { 'IRW-710363598525-2': { mode } } });
  const h = rec('IRW-710363598525-2');
  checkTrue(`7 [${mode}] shows "Inventario no confirmado", not a quantity`, h.includes('⚠️ Inventario no confirmado') && !h.includes('Qty actual') && h.includes('No se modificó inventario'), h.slice(0, 220));
  checkTrue(`8/9 [${mode}] SUMAR and REEMPLAZAR disabled`, btnsDisabled(h));
  check(`10 [${mode}] hard lock kept`, [st(2).state, st(2).locked, sandbox.psIsPackLocked(IRW, 2)], ['sellbrite', true, true]);
}
invCalls = [];
await sandbox.psUpdateSellbriteInventory(idxOf('IRW-710363598525-2'), 'set', 'pack');
check('8b forced click on unconfirmed record sends no update', invCalls.length, 0);
check('11a split Add refused', (await addAll()).filter(s => /-2(pk)?$/.test(s)), []);
{
  const toasts = []; sandbox.__tl = toasts; vm.runInContext('toast = function(m){ __tl.push(String(m)); };', sandbox);
  setBulk([]);
  const c = getCur(); c.packs = 2; c._packs = 2; setCur(c);
  vm.runInContext('if (typeof cur !== "undefined") { cur.packs = 2; }', sandbox);
  try { await sandbox._addBulkInternal(); } catch (e) {}
  checkTrue('11b single-pack Add refused (27)', !getBulk().some(b => /-2(pk)?$/.test(b.sku)), JSON.stringify(getBulk().map(b => b.sku)));
  setBulk([{ sku: 'IRW-710363598525-2pk', upc: IRW, packs: 2, title: 'x', price: '9.99', quantity: 1 }]);
  const ex = await captureExport();
  checkTrue('11c final export refused (28)', ex.csv === null && ex.alerts.some(a => a.includes('EXPORT BLOQUEADO')));
  setSplitActive(Object.assign({}, ALL_ON, { 2: false }));
  sandbox.toggleSplitPack(2);
  check('11d toggleSplitPack refuses re-activation', getSplitActive()[2], false);
}

section('21–22 — stale responses');
{
  const hA = hold();
  await scan(LEG, 'LEGO', LEGO(), [], { noSettle: true, inv: { [S1PK]: hA } });
  await new Promise(r => setImmediate(r));
  // A newer scan of a DIFFERENT UPC starts before LEGO's read returns.
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { inv: { 'IRW-710363598525-2': { rows: [{ warehouse_uuid: WH, available: 4, on_hand: 4 }] } } });
  hA.release(S1PK, { rows: [{ warehouse_uuid: WH, available: 999, on_hand: 999 }] });
  await settleInventory();
  check('21 late LEGO response ignored on IRW scan', [inv(S1PK), inv('IRW-710363598525-2').available, results().includes('999')], [null, 4, false]);
}
{
  const hOld = hold();
  await scan(LEG, 'LEGO', LEGO(), [], { noSettle: true, inv: { [S1PK]: hOld } });
  await new Promise(r => setImmediate(r));
  const pending = Object.assign({}, LEGO_INV);
  await scan(LEG, 'LEGO', LEGO(), [], { inv: pending });          // newer scan, same UPC
  hOld.release(S1PK, { rows: [{ warehouse_uuid: WH, available: 999, on_hand: 999 }] });
  await settleInventory();
  check('22 older same-UPC response ignored (newer 431 kept)', [inv(S1PK).available, /sbavail-\d+">431</.test(rec(S1PK)), results().includes('999')], [431, true, false]);
}

section('23–24 — eBay-only and new packs unchanged');
await scan(EUC, 'Eucerin', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
checkTrue('23 eBay-only: no /sb/inventory read, inventory disabled, no SUMAR', readCalls.length === 0 && results().includes('🔒 YA EXISTE EN EBAY') && results().includes('Inventario deshabilitado') && !results().includes('ps-pack-sbadd-'));
await scan(NEWU, 'Nature Made', [], []);
checkTrue('24 new product: no /sb/inventory read, 🟢 NUEVO, quantity inputs offered', readCalls.length === 0 && results().includes('🟢 NUEVO') && results().includes('id="split-manual-1"') && !results().includes('🔒'));

section('25 — Return-to-Fix preserved with a late inventory response');
{
  const sku2 = 'IRW-710363598525-2pk';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  const hR = hold();
  const act0 = { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { noSettle: true, rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: act0, manual: { 2: 3 }, inv: { 'IRW-710363598525-2': hR } });
  const before = JSON.stringify([getSplitActive(), getSplitManual(), getBulk(), getRTF()]);
  hR.release('IRW-710363598525-2', { rows: [{ warehouse_uuid: WH, available: 4, on_hand: 4 }] });
  for (let n = 0; n < 5; n++) await new Promise(r => setImmediate(r));
  check('25 late read did not mutate splitActive / manual / bulk / RTF', JSON.stringify([getSplitActive(), getSplitManual(), getBulk(), getRTF()]), before);
  check('25b RTF target still editable', sandbox.psLockSessionEditAllowed(IRW, sku2), true);
  check('25c informational state updated', inv('IRW-710363598525-2').available, 4);
}

section('29 — multiple warehouse rows handled safely');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 9)], [], { inv: { 'IRW-710363598525-2': { rows: [
  { warehouse_uuid: WH, warehouse_name: 'A', available: 4, on_hand: 4 }, { warehouse_uuid: 'wh-2', warehouse_name: 'B', available: 5, on_hand: 5 }] } } });
{
  const h = rec('IRW-710363598525-2');
  checkTrue('29 two warehouses: no summed 9, no Qty actual, message, controls disabled', !h.includes('Qty actual') && !/>9</.test(h) && h.includes('2 almacenes') && btnsDisabled(h), h.slice(0, 260));
  invCalls = [];
  await sandbox.psUpdateSellbriteInventory(idxOf('IRW-710363598525-2'), 'add', 'pack');
  check('29b no update sent to an arbitrary warehouse', invCalls.length, 0);
  check('29c pack still locked', st(2).locked, true);
}

section('26 — split gate with a confirmed record');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { active: DEF });
setSplitActive(Object.assign({}, DEF, { 2: true }));
check('26 _splitActive[2]=true still produces no 2pk row', (await addAll()).filter(s => /-2(pk)?$/.test(s)), []);

section('30 — no direct Sellbrite call from the browser');
checkTrue('30 app.js never calls api.sellbrite.com', !appSrc.includes('api.sellbrite.com'));
checkTrue('30b inventory reads go through psAuthFetch("/sb/inventory…") (GET)', /psAuthFetch\('\/sb\/inventory\?sku=' \+ encodeURIComponent\(sku\)\)/.test(appSrc));

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
