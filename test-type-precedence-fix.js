#!/usr/bin/env node
/**
 * INGESTIBLE FORM OVER GENERIC SUPPLEMENT TYPE PRECEDENCE — REGRESSION SUITE
 * (Investigación #8 fix)
 *
 * Investigation #7 fixed the title fitter dropping "Capsules" under 80-char
 * pressure. Investigation #8 proved that fix was real and sufficient — but
 * the REAL browser CSV (category 11776, final title "SeroVital Reverse
 * Capsules Supplement 252 Total Exp 08/29 Pack of 3 New") still exported
 * C:Type = Vitamin. Root cause: detectType()'s generic class-word branches
 * ("multivitamin/vitamin D3/B12/prenatal" at one line, bare "vitamin" or
 * "supplement" at another) sat BEFORE the specific ingestible dosage-form
 * branches (gummy/softgel/capsule/tablet) in source order, so any title
 * naming BOTH the product class ("Supplement") and the specific form
 * ("Capsules") always lost the specific evidence to the generic one.
 *
 * The fix reuses the existing `_hasIngestibleForm` flag (already computed
 * once at the top of detectType(), already used by the Face Cream/Body
 * Lotion/Serum/Lotion guards from Investigation #1) to gate both generic
 * branches: a title with NO explicit dosage form keeps returning
 * 'Vitamin' exactly as before; a title WITH one now defers to the existing
 * Forma block so the specific evidence wins, per the approved contract.
 *
 * This suite runs the REAL detectType()/psTypeCategoryPlausible()/
 * psDetectIngestibleForm() extracted verbatim from app.js (brace-matching
 * extraction, the same technique as test-classifier-type-category.js), and
 * the REAL rebuildTitle()/buildTitleFromSpans() pipeline (top-level
 * functions, the same vm-sandbox technique as
 * test-ingestible-title-pipeline.js) for the raw-to-final pipeline case.
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

// ── Full vm sandbox (same shape as test-ingestible-title-pipeline.js) for
// the real top-level rebuildTitle()/buildTitleFromSpans() pipeline test. ──
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

// ── Extract the exportCSV()-local detectType()/psTypeCategoryPlausible()/
// CAT_TYPE — established brace-matching technique. ─────────────────────
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
// 21 sep 2026 — Investigación/Implementación #17: detectType() now reads
// PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS — extract it too.
const ambigIngredientsMatch = appSrc.match(/var PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS = (\/[\s\S]*?\/);/);
if (!ambigIngredientsMatch) throw new Error('PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS not found');
eval('var PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS = ' + ambigIngredientsMatch[1] + ';');
eval(extractFn('catId'));
eval(extractFn('detectType'));
eval(extractFn('psTypeCategoryPlausible'));
eval(extractFn('psDetectIngestibleForm'));
eval(extractFn('psSafeCategory'));
checkTrue('loaded (extracted): detectType()', typeof detectType === 'function');
checkTrue('loaded (extracted): psTypeCategoryPlausible()', typeof psTypeCategoryPlausible === 'function');
checkTrue('loaded (extracted): psDetectIngestibleForm()', typeof psDetectIngestibleForm === 'function');
checkTrue('loaded (top-level): rebuildTitle()', typeof sandbox.rebuildTitle === 'function');

function runType(category, title) {
  const detectResult = detectType(category, title);
  const finalCat = psSafeCategory(category, '31786');
  const plausible = psTypeCategoryPlausible(finalCat, detectResult, title);
  const finalType = plausible ? detectResult : 'Other';
  return { detectResult, plausible, finalType };
}

console.log('═'.repeat(78));
console.log('INGESTIBLE FORM OVER GENERIC SUPPLEMENT — TYPE PRECEDENCE SUITE');
console.log('═'.repeat(78));

// ─────────────────────────────────────────────────────────────────────────
section('1 — REAL SEROVITAL ACCEPTANCE TEST (category 11776, real final title)');
// ─────────────────────────────────────────────────────────────────────────
{
  const CATEGORY = '11776';
  const FINAL_TITLE = 'SeroVital Reverse Capsules Supplement 252 Total Exp 08/29 Pack of 3 New';
  check('1.1 psDetectIngestibleForm(FINAL_TITLE) = Capsule', psDetectIngestibleForm(FINAL_TITLE), 'Capsule');
  const r = runType(CATEGORY, FINAL_TITLE);
  check('1.2 detectType(11776, FINAL_TITLE) = Capsule', r.detectResult, 'Capsule');
  check('1.3 psTypeCategoryPlausible passes = true', r.plausible, true);
  check('1.4 final C:Type = Capsule (not Vitamin/Other/Face Cream)', r.finalType, 'Capsule');
}

// ─────────────────────────────────────────────────────────────────────────
section('2 — GENERIC CLASS CONTROLS (no dosage form present — must stay Vitamin)');
// ─────────────────────────────────────────────────────────────────────────
{
  const CATEGORY = '11776';
  const r1 = runType(CATEGORY, 'Daily Multivitamin');
  check('2.1 "Daily Multivitamin" -> Vitamin', r1.finalType, 'Vitamin');
  const r2 = runType(CATEGORY, 'Immune Support Supplement');
  check('2.2 "Immune Support Supplement" -> Vitamin', r2.finalType, 'Vitamin');
}

// ─────────────────────────────────────────────────────────────────────────
section('3 — FORM + CLASS COLLISION MATRIX (dosage form present — form must win)');
// ─────────────────────────────────────────────────────────────────────────
const COLLISION_MATRIX = [
  { title: 'Daily Supplement Capsules', expect: 'Capsule' },
  { title: 'Daily Vitamin Capsules', expect: 'Capsule' },
  { title: 'Immune Support Supplement Tablets', expect: 'Tablet' },
  { title: 'Vitamin D3 Softgels', expect: 'Softgel' },
  { title: 'Daily Multivitamin Gummies', expect: 'Gummy' },
  { title: 'Supplement Gummies', expect: 'Gummy' },
  { title: 'Vitamin Tablets', expect: 'Tablet' },
  { title: 'Supplement Softgels', expect: 'Softgel' }
];
COLLISION_MATRIX.forEach(function (fx) {
  const r = runType('11776', fx.title);
  check(`3.x "${fx.title}" -> ${fx.expect}`, r.finalType, fx.expect);
});

// ─────────────────────────────────────────────────────────────────────────
section('4 — RAW-TO-FINAL REAL PIPELINE (rebuildTitle -> buildTitleFromSpans -> detectType, category 11776)');
// ─────────────────────────────────────────────────────────────────────────
{
  const SOURCE_TITLE = 'SeroVital Reverse the Signs of Aging Hormone Boost 84 Capsules';
  const cur = {
    title: SOURCE_TITLE, prod: { title: SOURCE_TITLE }, brand: 'SeroVital',
    upc: '681168301026', category: '11776', _canonicalProductName: null,
    _specifics: { Formulation: 'Capsule', 'Item Form': 'Capsule' },
    _canonicalSpecifics: { Formulation: 'Capsule', 'Item Form': 'Capsule' },
    _canonicalSpecificsLocked: true, _titleManual: false,
    _selectedPack: 3, packSize: 3
  };
  setCur(cur);
  const finalTitle = sandbox.rebuildTitle(SOURCE_TITLE, 3, '', 'Aug 2029');
  console.log('  final fitted title: ' + JSON.stringify(finalTitle));
  checkTrue('4.1 final title <= 80 chars', finalTitle.length <= 80, finalTitle.length);
  checkTrue('4.2 Capsules preserved by the fitter', /capsules?/i.test(finalTitle), finalTitle);
  const r = runType('11776', finalTitle);
  check('4.3 detectType(11776, real fitted title) = Capsule', r.detectResult, 'Capsule');
  check('4.4 final C:Type = Capsule', r.finalType, 'Capsule');
}

// ─────────────────────────────────────────────────────────────────────────
section('5 — TOY / COLLECTIBLE NEGATIVE CONTROLS (must not regress Investigación #7)');
// ─────────────────────────────────────────────────────────────────────────
[
  'Collectible Blind Box Capsule Toy Figure',
  'Capsule Toy Surprise Figure',
  'Mini Figure Toy Capsule'
].forEach(function (title) {
  const r = runType('220', title);
  checkTrue(`5.x "${title}" stays toy/collectible, not health form`,
    ['Capsule', 'Tablet', 'Softgel', 'Gummy', 'Vitamin', 'Supplement'].indexOf(r.finalType) === -1, r.finalType);
});

// ─────────────────────────────────────────────────────────────────────────
section('6 — CLASSIFIER REGRESSION (Face Cream / Squishmallows)');
// ─────────────────────────────────────────────────────────────────────────
{
  const rFace = runType('11776', 'SeroVital Advanced Anti-Aging Renewal Complex 160 Capsules');
  checkTrue('6.1 SeroVital never returns Face Cream', rFace.finalType !== 'Face Cream', rFace.finalType);
  const rSqu = runType('220', 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy');
  check('6.2 Squishmallows stays Plushie', rSqu.finalType, 'Plushie');
}

// ─────────────────────────────────────────────────────────────────────────
section('7 — MULTIPACK COUNT REGRESSION (unaffected by this fix — spot check)');
// ─────────────────────────────────────────────────────────────────────────
{
  const seroCur = {
    title: 'SeroVital Reverse the Signs of Aging Hormone Boost 84 Capsules',
    brand: 'SeroVital', upc: '681168301026', category: '11776',
    _canonicalProductName: null, _specifics: {}, _canonicalSpecifics: {},
    _selectedPack: 3, packSize: 3
  };
  setCur(seroCur);
  const seroTitle = sandbox.rebuildTitle(seroCur.title, 3, '', 'Aug 2029');
  checkTrue('7.1 SeroVital: 84 x 3 = 252 Total survives', /\b252\s*Total\b/i.test(seroTitle), seroTitle);

  const zicamCur = {
    title: 'Zicam Ultra Cold Remedy Zinc Rapidmelts 25 Count', brand: 'Zicam',
    upc: '732216300918', category: '180959', _canonicalProductName: null,
    _specifics: {}, _canonicalSpecifics: {}, _selectedPack: 3, packSize: 3
  };
  setCur(zicamCur);
  const zicamTitle = sandbox.rebuildTitle(zicamCur.title, 3, '', '');
  checkTrue('7.2 Zicam: 25 x 3 = 75 Total, no amplification', /\b75\s*Total\b/i.test(zicamTitle), zicamTitle);

  const zelliesCur = {
    title: 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum', brand: 'Zellies',
    upc: '851278001035', category: '180959', _canonicalProductName: null,
    _specifics: {}, _canonicalSpecifics: {}, _selectedPack: 3, packSize: 3
  };
  setCur(zelliesCur);
  const zelliesTitle = sandbox.rebuildTitle(zelliesCur.title, 3, '', '');
  checkTrue('7.3 Zellies: 100 x 3 = 300 Total, no amplification', /\b300\s*Total\b/i.test(zelliesTitle), zelliesTitle);

  const squCur = {
    title: 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy', brand: 'Squishmallows',
    upc: '196566213036', category: '220', _canonicalProductName: null,
    _specifics: { Size: '8 Inch' }, _canonicalSpecifics: { Size: '8 Inch' },
    _selectedPack: 3, packSize: 3
  };
  setCur(squCur);
  const squTitle = sandbox.rebuildTitle(squCur.title, 3, '', '');
  checkTrue('7.4 Squishmallows 8 Inch: no "24 Total" (not a count)', !/24\s*Total/i.test(squTitle), squTitle);
}

// ─────────────────────────────────────────────────────────────────────────
section('8 — SOURCE-LEVEL: unchanged branches documented, changed branches verified');
// ─────────────────────────────────────────────────────────────────────────
checkTrue('8.1 multivitamin/vitamin-letter branch gated by !_hasIngestibleForm',
  /if\(!_hasIngestibleForm && \/multivitamin\|vitamin \[abcdek\]\|vitamin d3\|vitamin b12\|prenatal vitamin\/\.test\(t\)\) return 'Vitamin';/.test(appSrc),
  'gated branch not found');
checkTrue('8.2 generic vitamin|supplement branch gated by !_hasIngestibleForm',
  /if\(!_hasIngestibleForm && \/\\bvitamin\\b\|supplement\/\.test\(t\)\) return 'Vitamin';/.test(appSrc),
  'gated branch not found');
// 18 sep 2026 — Investigación #13 gave this branch its own deterministic
// fixture (NAT-031604042127-2pk, "...Omega-3 Gummies..." exporting
// Supplement instead of Gummy), so it is no longer "left unchanged": it now
// also carries the standalone !_hasIngestibleForm guard, same pattern as
// 8.1/8.2 above.
//
// 21 sep 2026 — Investigación/Implementación #17: the third AND-term used to
// repeat the ingredient regex literal (`/probiotic|.../.test(t)`) inline;
// it now reads _hasAmbiguousIngredient directly (computed earlier from the
// shared PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS source), so the two ingredient
// lists can never diverge again (see test-ambiguous-topical-ingredients.js
// #20 for the functional proof). The structural pattern below was updated
// to match — the guard itself (!_hasIngestibleForm gating this whole
// branch) is unchanged.
checkTrue('8.3 ambiguous-ingredient Supplement branch now ALSO gated by !_hasIngestibleForm (Investigación #13)',
  /if\(!_hasIngestibleForm &&\s*\n\s*!\(_hasAmbiguousIngredient && _hasTopicalForm && !_hasIngestibleForm\) &&\s*\n\s*_hasAmbiguousIngredient\) return 'Supplement';/.test(appSrc),
  'ambiguous-ingredient branch missing the new !_hasIngestibleForm guard');
checkTrue('8.4 testosterone booster Supplement branch left UNCHANGED',
  /if\(\/testosterone booster\|test booster\|nugenix\|t\.boost\/\.test\(t\)\) return 'Supplement';/.test(appSrc),
  'testosterone branch text changed unexpectedly');

// ─────────────────────────────────────────────────────────────────────────
section('SUMMARY');
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}`));
}
process.exit(failed ? 1 : 0);
