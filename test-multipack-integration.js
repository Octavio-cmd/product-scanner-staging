#!/usr/bin/env node

/**
 * MULTIPACK — INTEGRATION TEST AGAINST THE REAL app.js
 *
 * This does NOT reimplement anything. It loads the actual multipack-fixes.js
 * and the actual app.js into a sandbox with a minimal DOM stub, then calls the
 * REAL production functions:
 *
 *   rebuildTitle()            rebuildAndApplyTitle()   pickPack()
 *   descForPack()             psApplyPackChange()      psFitTitleWithCounts()
 *   parseIntoSpans() / annotateSpans() / buildTitleFromSpans()
 *
 * Covers: 7 real product fixtures, the sequential pack sweep
 * (1 -> 2 -> 3 -> 2 -> 3), the manual-edit case, and simulated CSV rows.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else { failed++; failures.push({ name, actual, expected }); }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
  return ok;
}
function checkTrue(name, cond, detail) {
  if (cond) passed++;
  else { failed++; failures.push({ name, actual: detail, expected: 'true' }); }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n      detail: ${detail}`}`);
  return !!cond;
}
function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAL DOM STUB — enough for app.js to define its functions and for
// rebuildAndApplyTitle()/pickPack() to run their DOM writes harmlessly.
// ─────────────────────────────────────────────────────────────────────────────
function makeEl(id) {
  const el = {
    id, textContent: '', innerHTML: '', value: '', dataset: {},
    style: { cssText: '', display: '', background: '', color: '' },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, addEventListener() {}, remove() {},
    scrollIntoView() {}, focus() {}, blur() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {}
  };
  return el;
}

const elements = {};
function getEl(id) {
  if (!elements[id]) elements[id] = makeEl(id);
  return elements[id];
}

const documentStub = {
  body: makeEl('body'),
  head: makeEl('head'),
  documentElement: makeEl('html'),
  getElementById: (id) => getEl(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => makeEl(tag),
  addEventListener() {}, removeEventListener() {},
  createTextNode: () => ({}),
  cookie: ''
};

const storage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; },
  key() { return null; }, length: 0
};

const sandbox = {
  console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
  document: documentStub,
  localStorage: storage,
  sessionStorage: storage,
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, mediaDevices: {} },
  location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload() {} },
  fetch: async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  alert() {}, confirm: () => true, prompt: () => null,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  scrollTo() {}, open() { return null; }, close() {},
  Image: function () { return { src: '', onload: null, onerror: null }; },
  FileReader: function () { return {}; },
  XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {} }; },
  URL, URLSearchParams, Blob: function () {}, FormData: function () {},
  AbortController, TextEncoder, TextDecoder,
  Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error,
  Promise, Map, Set, WeakMap, WeakSet, Symbol, parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  // index.html loads these two from CDN *before* app.js. Without them app.js
  // stops executing at its scanner config (line ~917) and every declaration
  // after that point — PS_SMALL_WORDS, cur, the title pipeline — never exists.
  Html5QrcodeSupportedFormats: {
    EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4,
    CODE_39: 5, ITF: 6, CODABAR: 7, QR_CODE: 8, DATA_MATRIX: 9
  },
  Html5Qrcode: function () {
    return { start: async () => {}, stop: async () => {}, clear() {}, scanFile: async () => '' };
  },
  Html5QrcodeScanner: function () { return { render() {}, clear: async () => {} }; },
  XLSX: { utils: { book_new: () => ({}), json_to_sheet: () => ({}), book_append_sheet() {} }, writeFile() {} },
  process: { env: {} }
};
sandbox.Html5Qrcode.getCameras = async () => [];
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

// Load the real files, in the same order index.html loads them.
const fixesSrc = fs.readFileSync(path.join(__dirname, 'multipack-fixes.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

let loadError = null;
try {
  vm.runInContext(fixesSrc, sandbox, { filename: 'multipack-fixes.js' });
} catch (e) {
  loadError = 'multipack-fixes.js: ' + e.message;
}
try {
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
} catch (e) {
  // app.js has browser-only bootstrap at the bottom; function declarations are
  // hoisted and already defined, so a bootstrap throw is tolerable. Record it.
  loadError = (loadError ? loadError + ' | ' : '') + 'app.js bootstrap: ' + e.message;
}

section('LOAD — real multipack-fixes.js + real app.js into sandbox');
if (loadError) console.log(`  note: ${loadError}`);

// app.js:435 declares `let bulk=[],cur=null;` — a script-scope LEXICAL binding,
// not a property of the global object. Setting sandbox.cur would create a
// shadowing window property that app.js never reads. The only way to drive the
// real code is to assign the binding from inside the context.
function setCur(obj) {
  sandbox.__fixtureCur = obj;
  vm.runInContext('cur = __fixtureCur;', sandbox);
  return obj;
}
function getCur() { return vm.runInContext('cur', sandbox); }

// Prove the binding is actually wired before trusting any result below.
setCur({ _probe: 'ok' });
checkTrue('test harness drives the real `cur` lexical binding',
  getCur() && getCur()._probe === 'ok', JSON.stringify(getCur()));

const REQUIRED = [
  'rebuildTitle', 'rebuildAndApplyTitle', 'pickPack', 'descForPack',
  'psApplyPackChange', 'psFitTitleWithCounts', 'psProductionTitleFitter',
  'parseIntoSpans', 'annotateSpans', 'buildTitleFromSpans', 'psFixTitleCase',
  'psGetCanonicalUnitCount', 'psGetUnitNoun', 'psBuildCountSegments',
  'normalizeManualTitleForPackChange', 'restoreCanonicalSpecifics',
  'normalizeDuplicateNew', 'countStandaloneNewTokens'
];
REQUIRED.forEach(fn => {
  checkTrue(`loaded: ${fn}()`, typeof sandbox[fn] === 'function', `typeof = ${typeof sandbox[fn]}`);
});

// Guard: the lab-only fitter exists as a global (any top-level function in a
// classic script does), so the invariant that matters is that PRODUCTION CODE
// NEVER CALLS IT. Assert that against the real app.js source text.
const appCallsLabFitter = /\bpsFitTitleSemantic\s*\(/.test(appSrc);
checkTrue('app.js never calls the lab fitter psFitTitleSemantic()',
  !appCallsLabFitter, 'app.js contains a call to psFitTitleSemantic(');

// And production title fitting must go through the real span pipeline.
checkTrue('production fitter uses buildTitleFromSpans()',
  /function psFitTitleWithCounts[\s\S]{0,900}buildTitleFromSpans\(/.test(appSrc),
  'psFitTitleWithCounts does not delegate to buildTitleFromSpans');
checkTrue('production fitter uses parseIntoSpans()/annotateSpans()',
  /function psFitTitleWithCounts[\s\S]{0,600}parseIntoSpans\([\s\S]{0,300}annotateSpans\(/.test(appSrc),
  'psFitTitleWithCounts does not use the span pipeline');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES — real products
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURES = [
  { key: 'VICKS',     brand: 'Vicks',     title: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe Strips 26 Count', form: 'Strip',   noun: 'strips',   unit: 26,  pack: 3, total: 78,  upc: '323900014725', size: '26 Count' },
  { key: 'IBEROGAST', brand: 'Iberogast', title: 'Iberogast Advance Digestive Health Softgels 30 Count',    form: 'Softgel', noun: 'softgels', unit: 30,  pack: 3, total: 90,  upc: '819893021005', size: '30 Count' },
  { key: 'BOIRON',    brand: 'Boiron',    title: 'Boiron Arnicare Arnica Montana 30C Pellets 240 Count',     form: 'Pellet',  noun: 'pellets',  unit: 240, pack: 3, total: 720, upc: '306962002522', size: '240 Count' },
  { key: 'OCEANBLUE', brand: 'OceanBlue', title: 'OceanBlue Omega 3 2100 Fish Oil Softgels 60 Count',        form: 'Softgel', noun: 'softgels', unit: 60,  pack: 2, total: 120, upc: '869742000128', size: '60 Count' },
  { key: 'AIRBORNE',  brand: 'Airborne',  title: 'Airborne Vitamin C Immune Support Tablets 64 Count',       form: 'Tablet',  noun: 'tablets',  unit: 64,  pack: 3, total: 192, upc: '647865000648', size: '64 Count' },
  { key: 'OLLY',      brand: 'OLLY',      title: 'OLLY Sleep Melatonin Gummies Blackberry Zen 50 Count',     form: 'Gummy',   noun: 'gummies',  unit: 50,  pack: 2, total: 100, upc: '858484005116', size: '50 Count' },
  { key: 'EZCPAK',    brand: 'EZC Pak',   title: 'EZC Pak Immune Support Echinacea Zinc Capsules 14 Count',  form: 'Capsule', noun: 'capsules', unit: 14,  pack: 4, total: 56,  upc: '860000905008', size: '14 Count' }
];

function makeCur(f, overrides) {
  const cur = {
    upc: f.upc,
    title: f.title,
    brand: f.brand,
    category: '180959',
    prod: { title: f.title },
    _countConfirmed: f.unit,
    _canonicalProductName: null,
    _canonicalSpecifics: { Size: f.size, 'Item Form': f.form },
    _canonicalSpecificsLocked: true,
    _specifics: { Size: f.size, 'Item Form': f.form },
    _titleManual: false,
    _selectedPack: 1,
    _selectedTitle: null,
    _expDate: ''
  };
  return Object.assign(cur, overrides || {});
}

function setPackState(f) {
  sandbox.window._packState = {
    baseTitle: f.title, curPack: 1, shade: '', expDate: '',
    baseUPC: f.upc, baseBrand: f.brand, ebayBase: 10, discount: 0.95, els: {}
  };
}

// Drive the REAL production pack-selection path.
function selectPack(f, n) {
  sandbox.window._packState.curPack = n;
  sandbox.pickPack(n);          // real pickPack -> psApplyPackChange + rebuildAndApplyTitle
  return getCur()._selectedTitle;
}

// ─────────────────────────────────────────────────────────────────────────────
section('REAL PRODUCT FIXTURES — title / description / C:Size');
// ─────────────────────────────────────────────────────────────────────────────
const csvRows = [];

FIXTURES.forEach(f => {
  console.log(`\n── ${f.key} (${f.unit} ${f.noun} each, Pack ${f.pack}, expect ${f.total} total)`);
  setCur(makeCur(f));
  setPackState(f);

  const title = selectPack(f, f.pack);
  const cur = getCur();

  console.log(`  title (${title.length}): "${title}"`);

  checkTrue(`${f.key} title has unit count ${f.unit}`, new RegExp(`\\b${f.unit}\\b`).test(title), title);
  checkTrue(`${f.key} title has total count ${f.total}`, new RegExp(`\\b${f.total}\\b`).test(title), title);
  checkTrue(`${f.key} title has "Pack of ${f.pack}"`, title.includes('Pack of ' + f.pack), title);
  check(`${f.key} exactly one standalone New`, sandbox.countStandaloneNewTokens(title), 1);
  checkTrue(`${f.key} terminal New`, /\bNew$/.test(title), title);
  checkTrue(`${f.key} title <= 80 chars`, title.length <= 80, `${title.length}`);
  check(`${f.key} unit count appears exactly once`,
    (title.match(new RegExp(`\\b${f.unit}\\b`, 'g')) || []).length, 1);

  // no stale prior-pack total
  for (let p = 1; p <= 6; p++) {
    if (p === f.pack) continue;
    const stale = f.unit * p;
    if (stale === f.total || stale === f.unit) continue;
    checkTrue(`${f.key} no stale total ${stale}`, !new RegExp(`\\b${stale}\\b`).test(title), title);
  }

  // description from real descForPack()
  const descObj = {
    intro: 'Product intro.', benefits: ['A', 'B'],
    package_contents: 'the product', disclaimer: 'Disclaimer.'
  };
  const out = sandbox.descForPack(descObj, f.pack, cur);
  const pc = out.package_contents;
  console.log(`  package_contents: "${pc}"`);

  checkTrue(`${f.key} desc "${f.unit} ${f.noun} each"`, pc.includes(`${f.unit} ${f.noun} each`), pc);
  checkTrue(`${f.key} desc "${f.total} ${f.noun} total"`, pc.includes(`${f.total} ${f.noun} total`), pc);
  checkTrue(`${f.key} desc pack count ${f.pack}`, pc.includes(`${f.pack} individual units`), pc);

  // C:Size must be the canonical per-unit value
  check(`${f.key} C:Size canonical per-unit`, cur._specifics.Size, f.size);

  csvRows.push({
    Product: f.key,
    Title: title,
    Description: pc,
    'C:Size': cur._specifics.Size,
    Pack: cur._selectedPack,
    UPC: cur.upc,
    SKU: cur._selectedSKU
  });
});

// ─────────────────────────────────────────────────────────────────────────────
section('SEQUENTIAL PACK SWEEP — 1 → 2 → 3 → 2 → 3 (same product)');
// ─────────────────────────────────────────────────────────────────────────────
{
  const f = FIXTURES[0]; // VICKS, 26 each
  setCur(makeCur(f));
  setPackState(f);

  const sequence = [1, 2, 3, 2, 3];
  sequence.forEach((p, i) => {
    const title = selectPack(f, p);
    const cur = getCur();
    const expectedTotal = f.unit * p;

    console.log(`\n  step ${i + 1}: Pack ${p} → "${title}"`);
    console.log(`    C:Size = "${cur._specifics.Size}"`);

    check(`seq${i + 1} pack ${p}: unitCount`, sandbox.psGetCanonicalUnitCount(cur), f.unit);
    check(`seq${i + 1} pack ${p}: totalCount == ${f.unit}x${p}`,
      sandbox.psGetPackTotalCount(cur, p), expectedTotal);
    check(`seq${i + 1} pack ${p}: C:Size canonical`, cur._specifics.Size, f.size);
    check(`seq${i + 1} pack ${p}: one standalone New`, sandbox.countStandaloneNewTokens(title), 1);
    check(`seq${i + 1} pack ${p}: unit count not duplicated`,
      (title.match(new RegExp(`\\b${f.unit}\\b`, 'g')) || []).length, 1);
    checkTrue(`seq${i + 1} pack ${p}: <= 80 chars`, title.length <= 80, `${title.length}`);

    if (p >= 2) {
      checkTrue(`seq${i + 1} pack ${p}: title has Pack of ${p}`, title.includes('Pack of ' + p), title);
      checkTrue(`seq${i + 1} pack ${p}: title has total ${expectedTotal}`,
        new RegExp(`\\b${expectedTotal}\\b`).test(title), title);
    } else {
      checkTrue(`seq${i + 1} pack 1: no "Pack of"`, !/Pack of/i.test(title), title);
      checkTrue(`seq${i + 1} pack 1: no "Total"`, !/\bTotal\b/i.test(title), title);
    }

    // No prior-pack total may survive.
    [1, 2, 3, 4].forEach(op => {
      const stale = f.unit * op;
      if (op === p || stale === f.unit) return;
      checkTrue(`seq${i + 1} pack ${p}: no prior-pack total ${stale}`,
        !new RegExp(`\\b${stale}\\b`).test(title), title);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
section('MANUAL EDIT — Pack 2 "26ct Ea 52 Total" → Pack 3');
// ─────────────────────────────────────────────────────────────────────────────
{
  const f = FIXTURES[0];
  setCur(makeCur(f));
  setPackState(f);
  selectPack(f, 2);

  const manual = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26ct Ea 52 Total Pack of 2 New';
  getCur()._selectedTitle = manual;
  getCur()._titleManual = true;
  console.log(`  manual @ Pack 2: "${manual}"`);

  const after = selectPack(f, 3);
  console.log(`  after  @ Pack 3: "${after}" (${after.length} chars)`);

  checkTrue('manual: stale "52 Total" gone', !/\b52\s+Total\b/i.test(after), after);
  checkTrue('manual: no bare stale 52', !/\b52\b/.test(after), after);
  checkTrue('manual: total 78 present', /\b78\b/.test(after), after);
  checkTrue('manual: "Pack of 3"', after.includes('Pack of 3'), after);
  check('manual: exactly one standalone New', sandbox.countStandaloneNewTokens(after), 1);
  checkTrue('manual: terminal New', /\bNew$/.test(after), after);
  checkTrue('manual: <= 80 chars', after.length <= 80, `${after.length}`);
  checkTrue('manual: operator wording preserved (ZzzQuil)', /ZzzQuil/i.test(after), after);
  checkTrue('manual: _titleManual flag still set', getCur()._titleManual === true,
    String(getCur()._titleManual));
}

// ─────────────────────────────────────────────────────────────────────────────
section('FAIL-SAFE — no canonical evidence must never be overwritten');
// ─────────────────────────────────────────────────────────────────────────────
{
  const cur = {
    title: 'Mystery Supplement 120 Count',
    _canonicalSpecifics: {},                 // no canonical evidence
    _specifics: { Size: '120 Count', Volume: '32 oz' },
    _selectedPack: 3
  };
  sandbox.psApplyPackChange(cur, 3);
  check('failsafe: 120 Count preserved', cur._specifics.Size, '120 Count');
  check('failsafe: 32 oz preserved', cur._specifics.Volume, '32 oz');

  const cur2 = {
    _canonicalSpecifics: { Volume: '16 oz' },
    _specifics: { Volume: '48 oz' },        // 16 x 3 -> proven pack-derived
    _selectedPack: 3
  };
  sandbox.psApplyPackChange(cur2, 3);
  check('failsafe: proven 48 oz restored to 16 oz', cur2._specifics.Volume, '16 oz');

  const cur3 = {
    _canonicalSpecifics: { Volume: '16 oz' },
    _specifics: { Volume: '20 oz' },        // not a pack multiple -> keep
    _selectedPack: 3
  };
  sandbox.psApplyPackChange(cur3, 3);
  check('failsafe: non-multiple 20 oz preserved', cur3._specifics.Volume, '20 oz');
}

// ─────────────────────────────────────────────────────────────────────────────
section('REGRESSION — untouched fields survive pack changes');
// ─────────────────────────────────────────────────────────────────────────────
{
  const f = FIXTURES[1];
  setCur(makeCur(f, {
    _expDate: '03/2027',
    _mfgCode: 'LOT-991',
    _specifics: {
      Size: f.size, 'Item Form': f.form, Flavor: 'Berry', Brand: f.brand,
      'Active Ingredients': 'Herbal blend', 'Country of Origin': 'Germany',
      'Item Weight': '4 oz', 'Number of Doses': '30'
    }
  }));
  setPackState(f);

  const before = JSON.parse(JSON.stringify(getCur()._specifics));
  selectPack(f, 2);
  selectPack(f, 3);
  const after = getCur()._specifics;

  ['Item Form', 'Flavor', 'Brand', 'Active Ingredients', 'Country of Origin',
   'Item Weight', 'Number of Doses'].forEach(field => {
    check(`regression: ${field} unchanged`, after[field], before[field]);
  });

  check('regression: UPC unchanged', getCur().upc, f.upc);
  check('regression: expiration unchanged', getCur()._expDate, '03/2027');
  check('regression: mfg code unchanged', getCur()._mfgCode, 'LOT-991');
  check('regression: base title immutable', getCur().title, f.title);
  check('regression: prod.title immutable', getCur().prod.title, f.title);
  check('regression: canonical Size immutable', getCur()._canonicalSpecifics.Size, f.size);
  checkTrue('regression: SKU tracks pack', /-3pk$/.test(getCur()._selectedSKU || ''),
    getCur()._selectedSKU);
  check('regression: pack quantity', getCur()._selectedPack, 3);
  checkTrue('regression: total never written into canonical facts',
    !/\b90\b/.test(JSON.stringify(getCur()._canonicalSpecifics)),
    JSON.stringify(getCur()._canonicalSpecifics));
}

// ─────────────────────────────────────────────────────────────────────────────
section('CSV FIXTURE OUTPUTS');
// ─────────────────────────────────────────────────────────────────────────────
csvRows.forEach(r => {
  console.log(`\n── ${r.Product}`);
  console.log(`   Title       : ${r.Title}`);
  console.log(`   Description : ${r.Description}`);
  console.log(`   C:Size      : ${r['C:Size']}`);
  console.log(`   Pack        : ${r.Pack}`);
  console.log(`   UPC         : ${r.UPC}`);
  console.log(`   SKU         : ${r.SKU}`);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(78));
console.log('INTEGRATION SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) {
  console.log('\nFAILED:');
  failures.forEach(f => console.log(`  - ${f.name}\n      expected: ${JSON.stringify(f.expected)}\n      actual:   ${JSON.stringify(f.actual)}`));
}
console.log('═'.repeat(78));
process.exit(failed ? 1 : 0);
