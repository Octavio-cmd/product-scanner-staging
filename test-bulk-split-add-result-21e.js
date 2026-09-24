#!/usr/bin/env node
/**
 * BULK SPLIT: NO SINGLE-PACK FALL-THROUGH + SPECIFIC ADD RESULT (Implementación #21E)
 *
 * When ADD TO CSV runs the Bulk Split (split total > 0), a failed split must
 * stay a failed split: _addBulkInternal() never falls through to the
 * single-pack Add. addSplitPacksToCSV() leaves the reason in
 * window._psLastAddResult (success / missing_photo / zero_listings /
 * already_in_csv / all_locked / invalid_split / no_packs_selected /
 * nothing_added) and the ADD TO CSV button shows it.
 *
 * Real LEGO fixture (UPC 673419373609): 1pk/2pk locked in Sellbrite; new
 * 3pk/6pk/12pk with 81/58/34 listings (999/1000 units); no pack image and no
 * generic photo; CSV empty -> missing_photo, 0 rows, no single-pack Add.
 *
 * Runs the REAL app.js + multipack-fixes.js in the #21 sandbox; only fetch()
 * is mocked. The button handler is the real addFn source from app.js.
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

const LEG = '673419373609';
const LEGO_SB = () => [sbProd('LEG-673419373609-1', 0), sbProd('LEG-673419373609-1pk', 431), sbProd('LEG-673419373609-2pk', 77)];
const SPLIT_LEGO = { 3: 81, 6: 58, 12: 34 };
const ACT_LEGO = { 1: true, 2: true, 3: true, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: false, 11: false, 12: true };
let singleCalls = [];
vm.runInContext('var __realDoAdd = _doAddBulk; _doAddBulk = async function(){ __single.push(Array.prototype.slice.call(arguments)); return __realDoAdd.apply(this, arguments); };', Object.assign(sandbox, { __single: singleCalls }));
const toasts = [];
sandbox.__tl = toasts;
vm.runInContext('toast = function(m){ __tl.push(String(m)); };', sandbox);
const last = () => vm.runInContext('window._psLastAddResult', sandbox);
const skus = () => getBulk().map(b => b.sku);
function noPhotos(c) { c._packImages = {}; c._bundleImg = ''; c._imgUrl = ''; c._frontImg = ''; c._singleProductImg = ''; return c; }
async function legoState(opts) {
  opts = opts || {};
  await scan(LEG, 'LEGO', LEGO_SB(), []);
  const c = getCur();
  c.title = 'LEGO Creator 3 in 1 Space Shuttle 31134 Building Set';   // no count in the title: that is why the real prompt appeared
  if (opts.photos === 'none') noPhotos(c);
  if (opts.photos === 'generic') { c._packImages = {}; }
  if (opts.photos === 'pack') { c._bundleImg = ''; c._imgUrl = ''; c._frontImg = ''; }
  setCur(c);
  vm.runInContext('_lastBundleUrl = "";', sandbox);
  setSplitActive(Object.assign({}, opts.active || ACT_LEGO));   // 1/2 forced active: the lock must still skip them
  setSplitManual(Object.assign({}, opts.manual || SPLIT_LEGO));
  getEl('split-total-input').value = String(opts.total != null ? opts.total : 1000);
  setBulk(opts.bulk || []);
  singleCalls.length = 0; toasts.length = 0; invCalls = []; otherCalls = []; readCalls = [];
  vm.runInContext('window._psLastAddResult = null;', sandbox);
}
const writesDuringAdd = () => ({ inv: invCalls.length, other: otherCalls.filter(c => !/\/ss\/location/.test(c.u)).map(c => c.method + ' ' + c.u) });
let readCalls = [];

// Real ADD TO CSV handler (addFn) from app.js, bound to a stub button.
function realAddFn() {
  const a = appSrc.indexOf('    var addFn = async function(e){');
  const b = appSrc.indexOf('    addB.addEventListener(\'touchend\', addFn);', a);
  const src = appSrc.slice(a, b);
  const btn = { textContent: '➕ ADD TO CSV', style: { background: '', opacity: '', pointerEvents: '' } };
  const fn = vm.runInContext('(function(addB){ ' + src + ' return addFn; })', sandbox)(btn);
  return { btn, click: () => fn({ preventDefault() {} }) };
}

(async () => {
['psSplitResult', 'addSplitPacksToCSV', '_addBulkInternal']
  .forEach(fn => checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', typeof sandbox[fn]));
checkTrue('PS_SPLIT_MSG has every reason', ['missing_photo', 'zero_listings', 'already_in_csv', 'all_locked', 'invalid_split', 'nothing_added', 'no_packs_selected'].every(k => typeof vm.runInContext('PS_SPLIT_MSG', sandbox)[k] === 'string'));

section('REAL LEGO — 1/2 locked, 3/6/12 new (81/58/34), no photo at all, CSV empty');
await legoState({ photos: 'none' });
check('1pk/2pk locked; 3/6/12 new', [sandbox.psIsPackLocked(LEG, 1), sandbox.psIsPackLocked(LEG, 2), [3, 6, 12].map(p => st(p).state)], [true, true, ['new', 'new', 'new']]);
check('leftover 1 (999/1000)', vm.runInContext('computeSplit(1000, "media", window._splitActive).leftover >= 0', sandbox), true);
await sandbox._addBulkInternal();
check('2 missing photo stops Bulk Split: reason', [last().reason, last().mode], ['missing_photo', 'split']);
check('3 no single-pack Add called', singleCalls.length, 0);
check('4 zero CSV rows added', getBulk().length, 0);
checkTrue('5 specific message names the new packs, not 1pk/2pk', toasts.some(t => t.includes('Falta fotografía para los packs nuevos') && t.includes('3pk') && t.includes('6pk') && t.includes('12pk')) && !toasts.some(t => /1pk ya existe|Already in CSV/.test(t)), JSON.stringify(toasts));
check('5b reason lists 3pk/6pk/12pk', last().packs, ['3pk', '6pk', '12pk']);
check('18 no pack photo + no generic photo → fails', last().reason, 'missing_photo');
check('27–29 no inventory write / Shopify / eBay write during the failed Add', writesDuringAdd(), { inv: 0, other: [] });
{
  await legoState({ photos: 'none' });
  const h = realAddFn();
  await h.click();
  check('5c real button shows the photo message (not "Ya estaba o requisitos faltan")', h.btn.textContent, '⚠️ Falta fotografía para los packs nuevos');
  check('5d button path also added nothing', [getBulk().length, singleCalls.length], [0, 0]);
}

section('12–17, 1 — same LEGO with a generic photo: partial success around the locks');
await legoState({ photos: 'generic' });
await sandbox._addBulkInternal();
check('1 success reason', [last().reason, last().added], ['success', 3]);
check('1b no single-pack path after success', singleCalls.length, 0);
check('13/14 1pk and 2pk never added', skus().filter(s => /-(1|1pk|2|2pk)$/.test(s)), []);
check('15–17 3pk, 6pk, 12pk added with their listings', getBulk().map(b => [b.packs, b.quantity]), [[3, 81], [6, 58], [12, 34]]);
check('12 locked packs reported, valid packs still added', last().locked, ['1pk', '2pk']);
check('20 generic fallback: existing warning toast kept', toasts.some(t => t.includes('Sin imágenes de pack para 3pk, 6pk, 12pk')), true);
{
  await legoState({ photos: 'generic' });
  const h = realAddFn();
  await h.click();
  check('1c real button: ✅ AGREGADO (3 packs)', h.btn.textContent, '✅ AGREGADO (3 packs)');
}

section('19 — pack-specific photos (no generic) permit those packs');
await legoState({ photos: 'pack' });
await sandbox._addBulkInternal();
check('19 pack images only → 3 rows', [last().reason, getBulk().length], ['success', 3]);
await legoState({ photos: 'pack' });
{ const c = getCur(); delete c._packImages[12]; setCur(c); }
await sandbox._addBulkInternal();
check('19b one pack missing its image and no generic → whole split refused (existing rule), 0 rows', [last().reason, last().packs, getBulk().length, singleCalls.length], ['missing_photo', ['12pk'], 0, 0]);

section('6–7 — zero listings');
await legoState({ photos: 'generic', manual: { 3: 81, 6: 58, 12: 0 } });
await sandbox._addBulkInternal();
check('6 zero listings stops, no fall-through, no rows', [last().reason, singleCalls.length, getBulk().length], ['zero_listings', 0, 0]);
check('7 reason names the pack', last().packs, ['12pk']);

section('8 — invalid split');
await legoState({ photos: 'generic' });
{
  const realGet = documentStub.getElementById;
  documentStub.getElementById = (id) => id === 'split-calc-card' ? null : realGet(id);
  await sandbox._addBulkInternal();
  documentStub.getElementById = realGet;
  check('8 missing split card → invalid_split, no fall-through, no rows', [last().reason, singleCalls.length, getBulk().length], ['invalid_split', 0, 0]);
}
await legoState({ photos: 'generic', total: 0 });
await sandbox.addSplitPacksToCSV();
check('8b total 0 → invalid_split', last().reason, 'invalid_split');

section('9 — nothing selected');
await legoState({ photos: 'generic', active: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false } });
await sandbox._addBulkInternal();
check('9 no packs selected → specific reason, no fall-through, no rows', [last().reason, singleCalls.length, getBulk().length], ['no_packs_selected', 0, 0]);

section('10 — every selected pack locked');
await legoState({ photos: 'generic', active: { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false } });
await sandbox._addBulkInternal();
check('10 all_locked, no fall-through, no rows', [last().reason, last().locked, singleCalls.length, getBulk().length], ['all_locked', ['1pk', '2pk'], 0, 0]);
{
  await legoState({ photos: 'generic', active: { 1: true, 2: true } });
  const h = realAddFn(); await h.click();
  check('10b button says the packs already exist', h.btn.textContent, '🔒 Los packs elegidos ya existen');
}

section('11 — already in CSV');
{
  const existing = [3, 6, 12].map(p => ({ sku: 'LEG-673419373609-' + p + 'pk', upc: LEG, packs: p, title: 'x', price: '1.00', quantity: 1 }));
  await legoState({ photos: 'generic', bulk: existing });
  await sandbox._addBulkInternal();
  check('11 already_in_csv, no fall-through, rows unchanged', [last().reason, last().skippedDup, singleCalls.length, getBulk().length], ['already_in_csv', 3, 0, 3]);
  await legoState({ photos: 'generic', bulk: existing.map(r => Object.assign({}, r)) });
  const h = realAddFn(); await h.click();
  check('11b button says they are already in the CSV', h.btn.textContent, 'ℹ️ Esos packs ya están en el CSV');
}

section('21–23 — unit count and leftover unchanged');
{
  await legoState({ photos: 'generic' });
  const c = getCur(); c._countOK = false; c._countConfirmed = null; c._canonicalSpecifics = {}; setCur(c);
  sandbox.prompt = () => '1';
  const ok = sandbox.psRequireUnitCountForMultipack(getCur());
  sandbox.prompt = () => null;
  check('21 answer 1 accepted', [ok, getCur()._countConfirmed, getCur()._countOK], [true, 1, true]);
  check('22 144 not introduced: canonical unit count stays 1', sandbox.psGetCanonicalUnitCount(getCur()), 1);
  await sandbox._addBulkInternal();
  const t3 = (getBulk()[0] || {}).title || '';
  checkTrue('22b 3pk title has no 144 / 432 / "Total" count segment', !/\b(144|432)\b/.test(t3) && !/Total/.test(t3) && /Pack of 3/.test(t3), t3);
  check('23 leftover does not block (3 rows added)', [last().reason, getBulk().length], ['success', 3]);
}

section('24–26 — hard locks, export gate, Return-to-Fix intact');
await legoState({ photos: 'generic', active: Object.assign({}, ACT_LEGO, { 1: false, 2: false }) });
sandbox.toggleSplitPack(2);
check('24 toggleSplitPack refuses locked 2pk', getSplitActive()[2], false);
setBulk([{ sku: 'LEG-673419373609-2pk', upc: LEG, packs: 2, title: 'x', price: '9.99', quantity: 1 }]);
{
  const ex = await captureExport();
  checkTrue('25 exportCSV final gate still refuses a locked row', ex.csv === null && ex.alerts.some(a => a.includes('EXPORT BLOQUEADO')));
}
{
  const sku2 = 'IRW-710363598525-2pk';
  const existingRow = { sku: sku2, upc: IRW, packs: 2, title: 'old', price: '1.00', quantity: 1, expDate: 'Oct 2033' };
  await scan(IRW, 'Irwin Naturals', [sbProd('IRW-710363598525-2', 4)], [], { rtf: { upc: IRW, sku: sku2 }, bulk: [existingRow], active: { 1: false, 2: true, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false, 9: false, 10: false, 11: false, 12: false }, manual: { 2: 3 } });
  singleCalls.length = 0;
  await sandbox._addBulkInternal();
  check('26 Return-to-Fix: exact row replaced in place, no fall-through', [last().reason, last().replaced, getBulk().length, getBulk()[0].sku, singleCalls.length], ['success', 1, 1, sku2, 0]);
}

section('30 — no direct Sellbrite call');
checkTrue('30 app.js never calls api.sellbrite.com', !appSrc.includes('api.sellbrite.com'));

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f.name)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
