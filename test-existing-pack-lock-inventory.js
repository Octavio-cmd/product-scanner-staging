#!/usr/bin/env node
/**
 * EXISTING PACK LOCK + SELLBRITE INVENTORY UPDATE (Implementación #21)
 *
 * Rule: a pack that already exists (Sellbrite, or a LIVE seller-owned eBay
 * listing) must never become a new Action=Add. If it exists in Sellbrite the
 * employee updates its inventory with the existing /sb/update-inventory
 * SUMAR/REEMPLAZAR flow; eBay is never written.
 *
 * States:  A new · B Sellbrite (locked, inventory) · C eBay-only (locked,
 *          inventory disabled) · D Completed/Ended-only (warn, not locked)
 *
 * Runs the REAL psCheckSellbrite(), psCheckEbaySellerListings(), psPackState(),
 * updateSplitCalc(), toggleSplitPack(), addSplitPacksToCSV(), _addBulkInternal(),
 * exportCSV() and psUpdateSellbriteInventory() from app.js. Only fetch() is
 * mocked (/sb/search, /ebay/seller-listings, /sb/update-inventory).
 *
 * Group 33 compares the CSV of a completely new product byte-for-byte with
 * test-fixtures/new-product-csv-4e47c34.csv, produced by Employee STAGING
 * 4e47c34 (before #21) with the same inputs.
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
let sbCalls = [], ebCalls = [], otherCalls = [];
let invWritten = {};   // #21D: what the mocked Sellbrite holds after a write
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
      if (invConfig.mode === 'http409') return jsonRes(409, { status: 'error', error: 'current_quantity_unavailable', message: 'No se pudo leer la cantidad actual en Sellbrite; no se sumó nada.' });
      const prev = invConfig.current;
      const avail = body.mode === 'add' ? prev + body.quantity : body.quantity;
      invWritten[body.sku] = avail;
      return jsonRes(200, { status: 'success', sku: body.sku, available: avail, previous_available: prev, mode: body.mode });
    }
    // #21C: /sb/inventory?sku= (read-only) answers from the same fixture
    // products — one warehouse, available = the fixture quantity.
    if (u.indexOf('/sb/inventory') >= 0) {
      const sku = decodeURIComponent((u.match(/sku=([^&]+)/) || [])[1] || '');
      const p = sbConfig.products.find(x => x.sku === sku);
      if (!p) return jsonRes(200, { status: 'success', sku, inventory: { total_quantity: 0, total_on_hand: 0, channels: [], warehouses: [], found: false } });
      const q = (sku in invWritten) ? invWritten[sku] : p.inventory.total_quantity;   // #21D: reflects the last write
      const ch = [{ warehouse_uuid: 'wh-1', warehouse_name: 'Main', available: q, on_hand: q, bin_location: '' }];
      return jsonRes(200, { status: 'success', sku, inventory: { total_quantity: q, total_on_hand: q, channels: ch, warehouses: ch, found: true } });
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
  sbCalls = []; ebCalls = []; otherCalls = []; invCalls = []; capturedBlobs = []; invWritten = {};
  storage.removeItem('ps_locked_packs_v1'); storage.removeItem('cl_drive_url');
  vm.runInContext("window._psLockedPacks = null; window._psSbState = {upc:'',state:'idle'}; window._psEbSeller = {upc:'',state:'idle',listings:[],error:''}; window._psEbExisting = {}; window._psSbExistingListings = []; window._psSbExisting = {}; _psSellbriteProducts = {};", sandbox);
  getEl('split-calc-card').dataset.tier = 'media';
  getEl('split-total-input').value = '41'; getEl('split-weight-lb').value = '0'; getEl('split-weight-oz').value = '8';
}
async function scan(upc, brand, sbProducts, eb, opts) {
  opts = opts || {};
  resetAll();
  setSplitActive(Object.assign({}, opts.active || ALL_ON));
  setSplitManual(opts.manual || {});
  setCur(opts.cur || fixture(upc, brand));
  if (opts.rtf) setRTF(opts.rtf.upc, opts.rtf.sku);
  if (opts.bulk) setBulk(opts.bulk);
  sbConfig.products = sbProducts || [];
  if (typeof eb === 'string') ebConfig.mode = eb; else ebConfig.listings = eb || [];
  if (opts.sbFail) sbConfig.defer = async () => jsonRes(500, { error: 'boom' }); else sbConfig.defer = null;
  await Promise.all([sandbox.psCheckSellbrite(upc, brand), sandbox.psCheckEbaySellerListings(upc, brand, '')]);
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

(async () => {
['psPackState', 'psIsPackLocked', 'psRecordLockedPacks', 'psLockSessionEditAllowed', 'psEbStatusIsLive', 'psLockedPackCardHtml', 'psUpdateSellbriteInventory', '_addBulkInternal', 'exportCSV']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));

section('1 — completely new product unchanged');
await scan(NEWU, 'Nature Made', [], []);
check('all packs state "new"', [1,2,3,6,12].map(p => st(p).state), ['new','new','new','new','new']);
check('nothing locked', [1,2,3,6,12].some(p => sandbox.psIsPackLocked(NEWU, p)), false);
check('splitActive untouched', act(), ALL_ON);
checkTrue('rows still offer quantity inputs (split-manual-*)', results().includes('id="split-manual-1"') && results().includes('id="split-manual-12"'));
checkTrue('🟢 NUEVO badge when both lookups answered', results().includes('🟢 NUEVO'));
checkTrue('no lock card', !results().includes('🔒'));

section('2 — Sellbrite-only pack locks (state B)');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], []);
check('pack 2 state sellbrite, locked', [st(2).state, st(2).locked], ['sellbrite', true]);
check('pack 1 still new', st(1).state, 'new');
checkTrue('🔒 YA LISTADO card', results().includes('🔒 YA LISTADO') && results().includes('IRW-710363598525-2'));
checkTrue('Qty actual shown from Sellbrite', /Qty actual: <strong id="ps-pack-sbavail-\d+">4</.test(results()));
check('psIsPackLocked', sandbox.psIsPackLocked(IRW, 2), true);

section('3 — eBay-only Active pack locks (state C)');
await scan(EUC, 'Eucerin', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
check('pack 5 state ebay, locked', [st(5).state, st(5).locked], ['ebay', true]);
checkTrue('🔒 YA EXISTE EN EBAY card with ItemID', results().includes('🔒 YA EXISTE EN EBAY') && results().includes('237086232118'));
checkTrue('sync message', results().includes('Todavía no está sincronizado con Sellbrite') && results().includes('Actualiza/importa eBay en Sellbrite'));

section('4 — eBay Active + Available 0 locks');
await scan(NAT, 'Nature Made', [], [ebL('336798327261', 'NAT-031604004033-2pk', 0, NAT)]);
check('pack 2 locked with available 0', [st(2).locked, st(2).ebay[0].available], [true, 0]);

section('5 — Completed-only warns but does not lock');
await scan(NAT, 'Nature Made', [], [ebL('111', 'NAT-031604004033-3pk', 0, NAT, 'Completed')]);
check('pack 3 state new, not locked', [st(3).state, st(3).locked, sandbox.psIsPackLocked(NAT, 3)], ['new', false, false]);
check('not auto-excluded', act()[3], true);
checkTrue('warning shows actual status', results().includes('⚠ eBay: Completed (Item 111) — no bloquea'));

section('6 — Ended-only warns but does not lock');
await scan(NAT, 'Nature Made', [], [ebL('112', 'NAT-031604004033-4pk', 0, NAT, 'Ended')]);
check('pack 4 not locked', [st(4).locked, sandbox.psIsPackLocked(NAT, 4), act()[4]], [false, false, true]);
checkTrue('Ended warning', results().includes('Ended (Item 112)'));

section('7 — Sellbrite + Completed still locks');
await scan(NAT, 'Nature Made', [sbProd('NAT-031604004033-1', 0)], [ebL('113', 'NAT-031604004033-1', 0, NAT, 'Completed')]);
check('pack 1 locked by Sellbrite', [st(1).state, st(1).locked], ['sellbrite', true]);
checkTrue('Completed evidence still listed', results().includes('Completed'));

section('8 — unknown live eBay status → conservative lock');
await scan(NAT, 'Nature Made', [], [ebL('114', 'NAT-031604004033-6pk', 2, NAT, 'Custom')]);
check('psEbStatusIsLive("Custom")', sandbox.psEbStatusIsLive('Custom'), true);
check('pack 6 locked', st(6).locked, true);

section('9 — locked pack has no re-include');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], []);
{
  const card = results().split('id="ps-pack-lock-2"')[1].split('id="ps-pack-lock-')[0];
  checkTrue('no "↩ incluir" / toggleSplitPack(2) in the locked card', !card.includes('incluir') && !card.includes('toggleSplitPack(2)'));
  checkTrue('no new-listing quantity input for pack 2', !results().includes('id="split-manual-2"'));
}

section('10 — toggleSplitPack cannot activate a locked pack');
sandbox.toggleSplitPack(2);
check('pack 2 stays false', act()[2], false);

section('11 — unlocked pack behaves exactly as before');
sandbox.toggleSplitPack(1);
check('pack 1 toggles off', act()[1], false);
sandbox.toggleSplitPack(1);
check('pack 1 toggles back on', act()[1], true);

section('12 — locked pack excluded from addSplitPacksToCSV');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { active: DEF });
setSplitManual({ 1: 2, 3: 1, 6: 1, 12: 1 });
await sandbox.addSplitPacksToCSV();
check('rows: 1,3,6,12 (no 2pk)', getBulk().map(b => b.sku), ['IRW-710363598525-1pk', 'IRW-710363598525-3pk', 'IRW-710363598525-6pk', 'IRW-710363598525-12pk']);

section('13 — locked pack blocked from single-pack Add');
{
  await scan(EUC, 'Eucerin', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
  getEl('split-total-input').value = '0';
  const c = getCur(); c._selectedPack = 5; c._specificsReady = true;
  setBulk([]);
  sandbox.__tl = []; vm.runInContext('toast = function(m){ __tl.push(String(m)); };', sandbox);
  await sandbox._addBulkInternal();
  check('no row added for EUC 5pk', getBulk().length, 0);
  checkTrue('toast explains lock', sandbox.__tl.some(t => t.includes('🔒 5pk ya existe')), JSON.stringify(sandbox.__tl));
}

section('14 — locked pack blocked by final exportCSV gate');
{
  await scan(EUC, 'Eucerin', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
  setBulk([{ sku: 'EUC-072140041298-5pk', upc: EUC, packs: 5, title: 'x', price: '9.99', quantity: 1 }]);
  const r = await captureExport();
  check('no CSV produced', r.csv, null);
  checkTrue('export blocked message names the SKU', r.alerts.some(a => a.includes('EXPORT BLOQUEADO') && a.includes('EUC-072140041298-5pk')));
}

section('15 — stale _splitActive=true cannot bypass the lock');
{
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { active: DEF });
  // force a stale/inconsistent UI state: pack 2 marked active with a quantity
  setSplitActive(Object.assign({}, DEF, { 2: true })); setSplitManual({ 1: 1, 2: 3, 3: 1, 6: 1, 12: 1 });
  await sandbox.addSplitPacksToCSV();
  const skus = getBulk().map(b => b.sku);
  checkTrue('other packs added', skus.includes('IRW-710363598525-1pk') && skus.includes('IRW-710363598525-12pk'), JSON.stringify(skus));
  checkTrue('2pk not added even with _splitActive[2]=true', skus.every(b => b !== 'IRW-710363598525-2pk'), JSON.stringify(skus));
}

section('16 — restored local-storage Add cannot bypass export safety');
{
  await scan(SOL, 'Solgar', [], [ebL('336809282498', 'SOL-033984023192-2pk', 2, SOL)]);
  // simulate reload: in-memory record gone, only localStorage remains
  vm.runInContext("window._psLockedPacks = null;", sandbox);
  setCur(null);
  setBulk([{ sku: 'SOL-033984023192-2pk', upc: SOL, packs: 2, title: 'x', price: '9.99', quantity: 2 }]);
  check('lock survives reload via localStorage', sandbox.psIsPackLocked(SOL, 2), true);
  const r = await captureExport();
  check('export refused', r.csv, null);
}

section('17 — Return-to-Fix: existing session row remains editable');
{
  const sku2 = 'IRW-710363598525-2pk';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false }, manual: { 2: 3 } });
  check('RTF target allowed', sandbox.psLockSessionEditAllowed(IRW, sku2), true);
  check('restored splitActive not mutated', act()[2], true);
  checkTrue('RTF target pack shown as editable row, not lock card', results().includes('id="split-manual-2"'));
  await sandbox.addSplitPacksToCSV();
  const row = getBulk().find(b => b.sku === sku2);
  checkTrue('existing row updated in place (still one row)', getBulk().filter(b => b.sku === sku2).length === 1 && row && row.title !== 'old', JSON.stringify(getBulk()));
  check('another SKU of a locked pack is NOT editable', sandbox.psLockSessionEditAllowed(IRW, 'IRW-710363598525-3pk'), false);
}

section('18 — legacy Sellbrite SKU remains the inventory target');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], []);
{
  const r = st(2).sellbrite[0];
  check('target SKU exact', r.sku, 'IRW-710363598525-2');
  getEl('ps-pack-sbqty-' + r.idx).value = '6';
  await sandbox.psUpdateSellbriteInventory(r.idx, 'add', 'pack');
  check('request SKU is the legacy SKU (not rebuilt as -2pk)', invCalls[0].body.sku, 'IRW-710363598525-2');
}

section('19 — modern Sellbrite SKU remains the inventory target');
await scan(NAT, 'Nature Made', [sbProd('NAT-031604004033-2pk', 0)], []);
{
  const r = st(2).sellbrite[0];
  getEl('ps-pack-sbqty-' + r.idx).value = '3';
  await sandbox.psUpdateSellbriteInventory(r.idx, 'set', 'pack');
  check('request SKU', invCalls[0].body.sku, 'NAT-031604004033-2pk');
}

section('20 — multiple Sellbrite SKUs same pack: not guessed');
await scan(NAT, 'Nature Made', [sbProd('NAT-031604004033-2', 1), sbProd('NAT-031604004033-2pk', 5)], []);
{
  const recs = st(2).sellbrite;
  check('both records kept', recs.map(r => r.sku), ['NAT-031604004033-2', 'NAT-031604004033-2pk']);
  checkTrue('distinct targets', recs[0].idx !== recs[1].idx);
  checkTrue('"2 registros en Sellbrite" label', results().includes('2 registros en Sellbrite'));
  checkTrue('one control per Sellbrite record', results().includes('ps-pack-sbqty-' + recs[0].idx) && results().includes('ps-pack-sbqty-' + recs[1].idx));
  getEl('ps-pack-sbqty-' + recs[1].idx).value = '2';
  await sandbox.psUpdateSellbriteInventory(recs[1].idx, 'add', 'pack');
  check('only the chosen record is updated', invCalls.map(c => c.body.sku), ['NAT-031604004033-2pk']);
}

section('21 — multiple eBay ItemIDs same pack → one pack card');
await scan(SOL, 'Solgar', [], [ebL('a', 'SOL-033984023192-2pk', 2, SOL), ebL('b', 'SOL-033984023192-2pk', 0, SOL), ebL('c', 'SOL-033984023192-2', 1, SOL)]);
check('one card for pack 2', (results().match(/id="ps-pack-lock-2"/g) || []).length, 1);
check('all 3 ItemIDs listed under it', ['a', 'b', 'c'].every(i => results().includes('Item ' + i + ' ')), true);
checkTrue('no inventory controls for eBay ItemIDs', !results().includes('ps-pack-sbqty-'));

section('22 — inventory input starts at 0');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], []);
{
  const i = st(2).sellbrite[0].idx;
  checkTrue('pack card input value="0"', results().includes('id="ps-pack-sbqty-' + i + '" type="number" inputmode="numeric" value="0"'));
  // #21D: one inventory authority — a SKU with a 🔒 pack card has its
  // controls ONLY there; the Sellbrite status card just points to it.
  checkTrue('Sellbrite status card has no duplicate inventory input (#21D)', !getEl('ps-sellbrite-status').innerHTML.includes('id="ps-sbqty-' + i + '"') && getEl('ps-sellbrite-status').innerHTML.includes('usa la tarjeta 🔒 YA LISTADO'));
}

section('23 — SUMAR calls the existing endpoint with mode=add');
{
  const i = st(2).sellbrite[0].idx;
  getEl('ps-pack-sbqty-' + i).value = '6';
  await sandbox.psUpdateSellbriteInventory(i, 'add', 'pack');
  check('POST /sb/update-inventory mode add qty 6', [invCalls[0].method, invCalls[0].body.mode, invCalls[0].body.quantity], ['POST', 'add', 6]);
  check('sent with session (psAuthFetch)', invCalls[0].auth, 'Bearer fake-token');
}

section('24 — REEMPLAZAR calls the existing endpoint with mode=set');
{
  invCalls = [];
  const i = st(2).sellbrite[0].idx;
  getEl('ps-pack-sbqty-' + i).value = '6';
  await sandbox.psUpdateSellbriteInventory(i, 'set', 'pack');
  check('mode set qty 6', [invCalls[0].body.mode, invCalls[0].body.quantity], ['set', 6]);
}

section('25 — success uses the backend-returned available');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], []);
{
  const i = st(2).sellbrite[0].idx;
  invConfig.current = 4;
  getEl('ps-pack-sbqty-' + i).value = '6';
  await sandbox.psUpdateSellbriteInventory(i, 'add', 'pack');
  check('pack card shows 10 from backend', getEl('ps-pack-sbavail-' + i).textContent, 10);
  checkTrue('confirmation shows 4 + 6 = 10', getEl('ps-pack-sbconfirm-' + i).innerHTML.includes('4 + 6 = <strong>10</strong>'));
  check('evidence qty updated to 10', st(2).sellbrite[0].qty, 10);
  check('pack stays locked', st(2).locked, true);
  check('nothing added to CSV', getBulk().length, 0);
}

section('26 — failed update does not fake quantity');
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], []);
{
  const i = st(2).sellbrite[0].idx;
  invConfig.mode = 'http409';
  getEl('ps-pack-sbavail-' + i).textContent = 4;
  getEl('ps-pack-sbqty-' + i).value = '6';
  await sandbox.psUpdateSellbriteInventory(i, 'add', 'pack');
  check('quantity display unchanged', getEl('ps-pack-sbavail-' + i).textContent, 4);
  checkTrue('clear error with backend message', getEl('ps-pack-sbconfirm-' + i).innerHTML.includes('No se pudo leer la cantidad actual en Sellbrite'));
  check('evidence qty unchanged', st(2).sellbrite[0].qty, 4);
  check('still locked', st(2).locked, true);
  invConfig.mode = 'network';
  await sandbox.psUpdateSellbriteInventory(i, 'set', 'pack');
  check('network failure: display unchanged', getEl('ps-pack-sbavail-' + i).textContent, 4);
}

section('27 — eBay-only inventory controls disabled');
await scan(SOL, 'Solgar', [], [ebL('336809282498', 'SOL-033984023192-2pk', 2, SOL)]);
{
  const card = results().split('id="ps-pack-lock-2"')[1].split('id="ps-pack-lock-')[0];
  checkTrue('disabled button, no SUMAR/REEMPLAZAR', card.includes('<button disabled') && !card.includes('SUMAR') && !card.includes('REEMPLAZAR'));
  check('no Sellbrite target', st(2).sellbrite.length, 0);
}

section('28 — Sellbrite lookup failure does not claim new');
await scan(NEWU, 'Nature Made', [], [], { sbFail: true });
check('Sellbrite state error', vm.runInContext('window._psSbState.state', sandbox), 'error');
check('pack 1 unconfirmed, not locked', [st(1).state, st(1).unconfirmed, st(1).locked], ['new', true, false]);
checkTrue('no 🟢 NUEVO; "Sin confirmar" shown', !results().includes('🟢 NUEVO') && results().includes('Sin confirmar'));
check('normal operation continues (packs still active)', act()[1], true);

section('29 — eBay lookup failure does not claim new');
await scan(NEWU, 'Nature Made', [], 'http502');
check('pack 1 unconfirmed, not locked', [st(1).unconfirmed, st(1).locked], [true, false]);
checkTrue('no 🟢 NUEVO', !results().includes('🟢 NUEVO'));
await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], 'http503');
check('Sellbrite evidence still locks when eBay fails', st(2).locked, true);
await scan(IRW, 'Irwin Naturals', [], 'network');
check('failed lookups never lock unknown packs', [1,2,3].map(p => st(p).locked), [false, false, false]);

section('30 — Return-to-Fix: late responses do not mutate restored state');
{
  const kept = { 1: false, 2: true, 3: false, 4: false, 5: true, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false };
  await scan(EUC, 'Eucerin', [sbProd('EUC-072140041298-2', 3)], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)],
    { active: kept, manual: { 2: 1, 5: 2 }, rtf: { upc: EUC, sku: 'EUC-072140041298-1pk' } });
  check('splitActive untouched', act(), kept);
  check('splitManual untouched', getSplitManual(), { 2: 1, 5: 2 });
  check('locks still recorded', [sandbox.psIsPackLocked(EUC, 2), sandbox.psIsPackLocked(EUC, 5)], [true, true]);
}

section('31 — Phase #19 regression (legacy/modern parse, all products, Qty 0)');
await scan(NAT, 'Nature Made', [sbProd('NAT-031604004033-1', 0), sbProd('NAT-031604004033-2pk', 0)], []);
check('Sellbrite listings', vm.runInContext('window._psSbExistingListings', sandbox), [{ sku: 'NAT-031604004033-1', pack: 1, qty: 0 }, { sku: 'NAT-031604004033-2pk', pack: 2, qty: 0 }]);
check('packs 1,2 excluded', [act()[1], act()[2]], [false, false]);

section('32 — Phase #20 regression (eBay-only evidence + failure distinction)');
await scan(EUC, 'Eucerin', [], [ebL('237086232118', 'EUC-072140041298-5pk', 1, EUC)]);
checkTrue('combined warning still shows EBAY Item ID', getEl('ps-existing-product-slot').innerHTML.includes('237086232118'));
check('pack 5 excluded', act()[5], false);
await scan(EUC, 'Eucerin', [], []);
check('200+[] → ok with no listings', [vm.runInContext('window._psEbSeller.state', sandbox), vm.runInContext('window._psEbSeller.listings.length', sandbox)], ['ok', 0]);

section('33 — CSV for a completely new product byte-equivalent to 4e47c34');
{
  resetAll();
  setSplitActive({ 1: true, 2: true, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true });
  setSplitManual({ 1: 5, 2: 3, 3: 2, 6: 1, 12: 1 });
  // exactly the inputs used to produce the golden file on 4e47c34
  const c = { upc: NEWU, brand: 'Nature Made', title: 'Nature Made Vitamin C Gummies 250mg Immune Support 80ct',
    category: '11776', _description: 'Full description already generated.', _specifics: { Formulation: 'Gummy', 'Item Form': 'Gummy' },
    _shade: '', _expDate: 'Oct 2033', location: 'A/1', _bundleImg: 'https://cdn.example/g.jpg', ebay: { prices: { low: 9.99, avg: 18.51 } }, _packImages: {} };
  [1, 2, 3, 6, 12].forEach(p => c._packImages[p] = { front: 'https://cdn.example/p' + p + '.jpg' });
  setCur(c);
  await Promise.all([sandbox.psCheckSellbrite(NEWU, 'Nature Made'), sandbox.psCheckEbaySellerListings(NEWU, 'Nature Made', c.title)]);
  setBulk([]);
  await sandbox.addSplitPacksToCSV();
  const r = await captureExport();
  const golden = fs.readFileSync(path.join(__dirname, 'test-fixtures', 'new-product-csv-4e47c34.csv'), 'utf8');
  check('rows', getBulk().map(b => b.sku), ['NAT-012345678905-1pk', 'NAT-012345678905-2pk', 'NAT-012345678905-3pk', 'NAT-012345678905-6pk', 'NAT-012345678905-12pk']);
  checkTrue('CSV byte-identical to the pre-#21 golden file (' + golden.length + ' bytes)', r.csv === golden, r.csv ? ('len ' + r.csv.length) : 'no csv');
}

section('SAFETY — no eBay write, no new endpoint');
checkTrue('only /sb/update-inventory is written', !/\/sb\/update-inventory-|\/ebay\/(?!seller-listings)[a-z-]+/.test(appSrc));
checkTrue('no Trading/revise/end/relist in app.js', !/ReviseItem|EndItem|RelistItem|ReviseInventoryStatus|ws\/api\.dll/.test(appSrc));

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) { console.log('FAILURES:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
process.exit(failed ? 1 : 0);
})();
