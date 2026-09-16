#!/usr/bin/env node
// End-to-end title/description proof for the Squishmallows real fixture,
// against the REAL app.js + multipack-fixes.js loaded in a vm sandbox
// (same technique as test-multipack-integration.js). Not part of the
// graded baseline suites — a standalone proof for this fix's RETURN report.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', value: '', dataset: {},
    style: { cssText: '', display: '', background: '', color: '' },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, addEventListener() {}, remove() {},
    scrollIntoView() {}, focus() {}, blur() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {}
  };
}
const elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; }
const documentStub = {
  body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
  getElementById: (id) => getEl(id), querySelector: () => null, querySelectorAll: () => [],
  createElement: (tag) => makeEl(tag), addEventListener() {}, removeEventListener() {},
  createTextNode: () => ({}), cookie: ''
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
  Html5QrcodeSupportedFormats: {
    EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4,
    CODE_39: 5, ITF: 6, CODABAR: 7, QR_CODE: 8, DATA_MATRIX: 9
  },
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
try { vm.runInContext(fixesSrc, sandbox, { filename: 'multipack-fixes.js' }); } catch (e) { console.log('fixes load note:', e.message); }
try { vm.runInContext(appSrc, sandbox, { filename: 'app.js' }); } catch (e) { console.log('app.js bootstrap note:', e.message); }

function setCur(obj) { sandbox.__fixtureCur = obj; vm.runInContext('cur = __fixtureCur;', sandbox); return obj; }

console.log('='.repeat(80));
console.log('SQUISHMALLOWS END-TO-END TITLE/DESCRIPTION PROOF (real app.js in vm sandbox)');
console.log('='.repeat(80));

var passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}

const BASE_TITLE = 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy';
var fixture = setCur({
  title: BASE_TITLE,
  category: '220',
  _countConfirmed: 1,          // employee answered the count-gate prompt with 1
  _countOK: true,
  _specifics: { Size: '8 Inch', Type: 'Plushie' },
  _canonicalSpecifics: { Size: '8 Inch' },
  _canonicalProductName: BASE_TITLE
});

const title3 = sandbox.rebuildTitle(BASE_TITLE, 3, '', '');
console.log('\nrebuildTitle(base, packSize=3):');
console.log('  ' + JSON.stringify(title3));

check('title contains "8 Inch" (physical size preserved)', /\b8\s*Inch\b/i.test(title3), title3);
check('title contains "Pack of 3"', /\bPack of 3\b/i.test(title3), title3);
check('title has exactly one terminal "New"', (title3.match(/\bNew\b/gi) || []).length === 1, title3);
check('title does NOT contain "3 Total"', !/\b3\s*Total\b/i.test(title3), title3);
check('title does NOT contain "1 " + noun/count "Each"', !/\bEach\b/i.test(title3), title3);
check('title length <= 80', title3.length <= 80, 'length=' + title3.length);

const desc3 = sandbox.descForPack('Soft and cuddly collectible.', 3, fixture);
console.log('\ndescForPack(desc, packSize=3):');
console.log('  ' + JSON.stringify(desc3));
check('description says "3 individual units"', /3 individual units/i.test(desc3), desc3);
check('description does NOT say "count each"', !/count each/i.test(desc3), desc3);
check('description does NOT say "total"', !/\btotal\b/i.test(desc3), desc3);

console.log('\n' + '='.repeat(80));
console.log('SUMMARY: passed=' + passed + ' failed=' + failed);
console.log('='.repeat(80));
process.exit(failed ? 1 : 0);
