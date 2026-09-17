#!/usr/bin/env node
/**
 * INGESTIBLE FORM TITLE-PRESERVATION — REAL PIPELINE REGRESSION SUITE
 * (Investigación #7 fix)
 *
 * Investigation #7 proved that detectType() and psTypeCategoryPlausible()
 * were never the problem: a real SeroVital 3pk row exported C:Type = Other
 * because the 80-char title fitter (buildTitleFromSpans(), driven by
 * classifySpanRole()) demoted the word "Capsules" to SECONDARY_DESCRIPTOR —
 * a rule meant for toy/collectible "capsule toy" vocabulary — and dropped
 * it before less-important filler words. By the time detectType() ran on
 * the final CSV title, the evidence was already gone.
 *
 * The existing classifier suite (test-classifier-type-category.js,
 * test-return-and-fix.js §9.12/9.13) only ever called detectType() against
 * the RAW, un-fitted title — never the real rebuildTitle()-produced title —
 * which is exactly why this regression went uncaught. THIS suite closes
 * that gap: every fixture below runs the REAL, unmodified pipeline —
 *   RAW TITLE -> rebuildTitle() -> buildTitleFromSpans() -> final <=80
 *   title -> detectType(FINAL TITLE) -> psTypeCategoryPlausible() -> C:Type
 * — using the real top-level functions (rebuildTitle, parseIntoSpans,
 * annotateSpans, classifySpanRole, psDetectIngestibleForm) via a vm sandbox,
 * and the real exportCSV()-local functions (detectType,
 * psTypeCategoryPlausible, CAT_TYPE) via the same brace-matching
 * extraction test-classifier-type-category.js already established.
 *
 * Companion regressions (Return-and-Fix, snapshots, Sellbrite, exact-SKU
 * replacement, Zicam/Zellies count behavior) are NOT reimplemented here —
 * they are covered by their own dedicated suites, re-run unmodified as part
 * of this fix's full regression battery.
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

// ── Full vm sandbox (same shape as test-split-return-fix.js) — needed
// because rebuildTitle()/parseIntoSpans()/annotateSpans()/classifySpanRole()/
// psDetectIngestibleForm() are real TOP-LEVEL app.js functions we drive
// directly, not extracted. ──────────────────────────────────────────────
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
const sandbox = {
  console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
  document: documentStub, localStorage: storage, sessionStorage: storage,
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
const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
let loadError = null;
try { vm.runInContext(fixesSrc, sandbox, { filename: 'multipack-fixes.js' }); } catch (e) { loadError = 'fixes: ' + e.message; }
try { vm.runInContext(appSrc, sandbox, { filename: 'app.js' }); } catch (e) { loadError = (loadError ? loadError + ' | ' : '') + 'app.js: ' + e.message; }

section('LOAD — real multipack-fixes.js + real app.js into sandbox');
if (loadError) console.log('  note: ' + loadError);
(docListeners.DOMContentLoaded || []).forEach(fn => { try { fn(); } catch (e) {} });

function setCur(obj) { sandbox.__f = obj; vm.runInContext('cur = __f;', sandbox); return obj; }
function getCur() { return vm.runInContext('cur', sandbox); }

const REQUIRED_TOPLEVEL = ['rebuildTitle', 'parseIntoSpans', 'annotateSpans', 'classifySpanRole',
  'buildTitleFromSpans', 'psFitTitleWithCounts', 'psDetectIngestibleForm', 'psSafeCategory'];
REQUIRED_TOPLEVEL.forEach(fn => {
  checkTrue(`loaded (top-level): ${fn}()`, typeof sandbox[fn] === 'function', `typeof = ${typeof sandbox[fn]}`);
});

// ── Extract the exportCSV()-local detectType()/psTypeCategoryPlausible()/
// CAT_TYPE — same brace-matching technique as test-classifier-type-category.js,
// the established pattern for reaching functions nested inside exportCSV(). ──
function extractFn(name) {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < appSrc.length; j++) {
    if (appSrc[j] === '{') { d++; started = true; }
    else if (appSrc[j] === '}') { d--; if (started && d === 0) return appSrc.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
function extractVar(name) {
  const i = appSrc.indexOf('var ' + name + ' = {');
  if (i < 0) throw new Error('var not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < appSrc.length; j++) {
    if (appSrc[j] === '{') { d++; started = true; }
    else if (appSrc[j] === '}') { d--; if (started && d === 0) return appSrc.slice(i, j + 2); }
  }
  throw new Error('unbalanced braces for var ' + name);
}
const toyCatsMatch = appSrc.match(/var PS_TOY_CATS = (\[[^\]]*\]);/);
eval('var PS_TOY_CATS = ' + toyCatsMatch[1] + ';');
eval(extractVar('CAT_TYPE'));
const foodTypesMatch = appSrc.match(/var PS_FOOD_TYPES = (\[[\s\S]*?\]);/);
const beautyTypesMatch = appSrc.match(/var PS_TOPICAL_BEAUTY_TYPES = (\[[^\]]*\]);/);
eval('var PS_FOOD_TYPES = ' + foodTypesMatch[1] + ';');
eval('var PS_TOPICAL_BEAUTY_TYPES = ' + beautyTypesMatch[1] + ';');
eval(extractFn('catId'));
eval(extractFn('detectType'));
eval(extractFn('psTypeCategoryPlausible'));
checkTrue('loaded (extracted): detectType()', typeof detectType === 'function');
checkTrue('loaded (extracted): psTypeCategoryPlausible()', typeof psTypeCategoryPlausible === 'function');

// Runs the REAL end-to-end pipeline: RAW TITLE -> rebuildTitle() ->
// detectType(FINAL TITLE) -> psTypeCategoryPlausible() -> final C:Type.
function runPipeline(curFixture, packSize, expDate) {
  setCur(curFixture);
  const finalTitle = sandbox.rebuildTitle(curFixture.title, packSize, '', expDate || '');
  const category = curFixture.category;
  const detectResult = detectType(category, finalTitle);
  const finalCat = sandbox.psSafeCategory(category, '31786');
  const plausible = psTypeCategoryPlausible(finalCat, detectResult, finalTitle);
  const finalType = plausible ? detectResult : 'Other';
  return { finalTitle, len: finalTitle.length, detectResult, plausible, finalType };
}

console.log('═'.repeat(78));
console.log('INGESTIBLE FORM TITLE-PRESERVATION — REAL PIPELINE SUITE');
console.log('═'.repeat(78));

// ─────────────────────────────────────────────────────────────────────────
section('1 — REAL SEROVITAL ACCEPTANCE TEST (Investigación #7 fixture)');
// ─────────────────────────────────────────────────────────────────────────
{
  const SOURCE_TITLE = 'SeroVital Reverse the Signs of Aging Hormone Boost 84 Capsules';
  const cur = {
    title: SOURCE_TITLE, prod: { title: SOURCE_TITLE }, brand: 'SeroVital',
    upc: '681168301026', category: '180959', _canonicalProductName: null,
    _specifics: { Formulation: 'Capsule', 'Item Form': 'Capsule' },
    _canonicalSpecifics: { Formulation: 'Capsule', 'Item Form': 'Capsule' },
    _canonicalSpecificsLocked: true, _titleManual: false,
    _selectedPack: 3, packSize: 3
  };
  const r = runPipeline(cur, 3, 'Aug 2029');
  console.log('  FINAL TITLE: ' + JSON.stringify(r.finalTitle));
  checkTrue('1.1 raw source title contains "Capsules"', /capsules/i.test(SOURCE_TITLE));
  checkTrue('1.2 final fitted title <= 80 chars', r.len <= 80, r.len);
  checkTrue('1.3 Capsules survives fitting', /capsules?/i.test(r.finalTitle), r.finalTitle);
  checkTrue('1.4 "Pack of 3" survives', /\bpack of 3\b/i.test(r.finalTitle), r.finalTitle);
  checkTrue('1.5 "New" survives', /\bnew$/i.test(r.finalTitle.trim()), r.finalTitle);
  checkTrue('1.6 derived total "252 Total" survives (84 x 3, current architecture)', /\b252\s*Total\b/i.test(r.finalTitle), r.finalTitle);
  checkTrue('1.7 expiration "08/29" present (current title architecture requires it)', /08\/29/.test(r.finalTitle), r.finalTitle);
  check('1.8 SeroVital brand token present', /serovital/i.test(r.finalTitle), true);
  check('1.9 detectType(final title) = Capsule', r.detectResult, 'Capsule');
  check('1.10 plausibility guard accepts Capsule in supplement context', r.plausible, true);
  check('1.11 final C:Type = Capsule (not Face Cream/Other/Vitamin)', r.finalType, 'Capsule');
}

// ─────────────────────────────────────────────────────────────────────────
section('2 — INGESTIBLE FORM PRESSURE TESTS (long titles that REQUIRE trimming)');
// ─────────────────────────────────────────────────────────────────────────
const PRESSURE_FIXTURES = [
  {
    label: '60 Tablets', unitCount: 60, noun: 'Tablets', expectType: 'Tablet',
    title: 'NutraBoost Daily Wellness Renewal Support Complex Extra Strength 60 Tablets'
  },
  {
    label: '60 Softgels', unitCount: 60, noun: 'Softgels', expectType: 'Softgel',
    title: 'VitaCore Advanced Omega Renewal Daily Support Complex Extra Strength 60 Softgels'
  },
  {
    label: '50 Gummies', unitCount: 50, noun: 'Gummies', expectType: 'Gummy',
    title: 'WellnessPlus Daily Renewal Support Immune Complex Extra Strength 50 Gummies'
  },
  {
    label: '30 Capsules', unitCount: 30, noun: 'Capsules', expectType: 'Capsule',
    title: 'PureRenew Advanced Daily Wellness Support Complex Extra Strength 30 Capsules'
  }
];
PRESSURE_FIXTURES.forEach(function (fx) {
  section('2.x — ' + fx.label + ' pressure test');
  const cur = {
    title: fx.title, prod: { title: fx.title }, brand: 'GenericBrand',
    upc: '000000000000', category: '999999' /* not in CAT_TYPE — proves title evidence, not category fallback */,
    _canonicalProductName: null, _specifics: {}, _canonicalSpecifics: {},
    _selectedPack: 3, packSize: 3
  };
  const r = runPipeline(cur, 3, 'Dec 2028');
  console.log('  base title (' + fx.title.length + ' chars): ' + JSON.stringify(fx.title));
  console.log('  final title (' + r.len + ' chars): ' + JSON.stringify(r.finalTitle));
  const withSuffixLen = (fx.title + ' ' + (fx.unitCount * 3) + ' Total Exp 12/28 Pack of 3 New').length;
  checkTrue(fx.label + ': fixture actually requires trimming (would exceed 80 unfitted)', withSuffixLen > 80, withSuffixLen);
  checkTrue(fx.label + ': final title <= 80 chars', r.len <= 80, r.len);
  checkTrue(fx.label + ': dosage-form noun survives fitting', new RegExp(fx.noun, 'i').test(r.finalTitle), r.finalTitle);
  check(fx.label + ': detectType(final title) = ' + fx.expectType, r.detectResult, fx.expectType);
  check(fx.label + ': final C:Type = ' + fx.expectType + ' (category fallback unreachable — proves title evidence survived)', r.finalType, fx.expectType);
});

// ─────────────────────────────────────────────────────────────────────────
section('3 — TOY / COLLECTIBLE NEGATIVE CONTROLS (must NOT gain health semantics)');
// ─────────────────────────────────────────────────────────────────────────
const TOY_FIXTURES = [
  'Collectible Blind Box Capsule Toy Figure',
  'Mini Figure Toy Capsule',
  'Capsule Toy Surprise Figure'
];
TOY_FIXTURES.forEach(function (title) {
  section('3.x — toy negative control: "' + title + '"');
  const cur = {
    title: title, prod: { title: title }, brand: 'ToyCo',
    upc: '111222333999', category: '220' /* Toy */,
    _canonicalProductName: null, _specifics: {}, _canonicalSpecifics: {},
    _selectedPack: 3, packSize: 3
  };
  // Direct proof at the source of the fix: classifySpanRole() must NOT
  // promote the "Capsule" span to PRIMARY_FACT in toy context.
  const spans = sandbox.parseIntoSpans(title);
  sandbox.annotateSpans(spans, title, cur);
  const capsuleSpan = spans.find(function (s) { return /capsule/i.test(s.value); });
  checkTrue('  "Capsule" span found in spans', !!capsuleSpan, JSON.stringify(spans.map(function(s){return s.value;})));
  if (capsuleSpan) {
    checkTrue('  classifySpanRole("' + capsuleSpan.value + '") is NOT PRIMARY_FACT in toy context', capsuleSpan.role !== 'PRIMARY_FACT', capsuleSpan.role);
  }
  const r = runPipeline(cur, 3, '');
  console.log('  final title: ' + JSON.stringify(r.finalTitle));
  checkTrue('  detectType() does not classify as a health/supplement form',
    ['Capsule', 'Tablet', 'Softgel', 'Gummy', 'Vitamin', 'Supplement'].indexOf(r.detectResult) === -1, r.detectResult);
  checkTrue('  final C:Type is not a health/supplement form',
    ['Capsule', 'Tablet', 'Softgel', 'Gummy', 'Vitamin', 'Supplement'].indexOf(r.finalType) === -1, r.finalType);
});

// ─────────────────────────────────────────────────────────────────────────
section('4 — SQUISHMALLOWS REGRESSION (UPC 196566213036)');
// ─────────────────────────────────────────────────────────────────────────
{
  const SQU_TITLE = 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy';
  const cur = {
    title: SQU_TITLE, prod: { title: SQU_TITLE }, brand: 'Squishmallows',
    upc: '196566213036', category: '220', _canonicalProductName: null,
    _specifics: { Size: '8 Inch' }, _canonicalSpecifics: { Size: '8 Inch' },
    _selectedPack: 3, packSize: 3
  };
  setCur(cur);
  const noCountAmplification = sandbox.psGetCanonicalUnitCount(getCur()) == null;
  const r = runPipeline(cur, 3, '');
  console.log('  final title: ' + JSON.stringify(r.finalTitle));
  check('4.1 detectType = Plushie', r.detectResult, 'Plushie');
  check('4.2 final C:Type = Plushie', r.finalType, 'Plushie');
  checkTrue('4.3 Size "8 Inch" never treated as a per-unit count (no amplification)', noCountAmplification, sandbox.psGetCanonicalUnitCount(getCur()));
  checkTrue('4.4 "Pack of 3" present', /\bpack of 3\b/i.test(r.finalTitle), r.finalTitle);
  checkTrue('4.5 no "24 Total" (8 Inch is not a count, so no derived total)', !/24\s*Total/i.test(r.finalTitle), r.finalTitle);
  checkTrue('4.6 no redundant "3 Total"', !/\b3\s*Total\b/i.test(r.finalTitle), r.finalTitle);
  checkTrue('4.7 final title <= 80 chars', r.len <= 80, r.len);
}

// ─────────────────────────────────────────────────────────────────────────
section('SUMMARY');
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}`));
}
process.exit(failed ? 1 : 0);
