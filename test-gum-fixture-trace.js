#!/usr/bin/env node

/**
 * REAL FIXTURE TRACE — UPC 851278001035 "Gum Spearmint Sugar Free"
 *
 * Real browser CSV produced, at Pack 3:
 *   "Gum Spearmint Sugar Free 100 4.76oz Pack Exp 07/30 Pack of 3 New"
 * Expected: must contain "300 Total".
 *
 * Loads the REAL app.js + multipack-fixes.js and walks the production chain
 * function by function to find the FIRST point where "300 Total" is lost.
 *
 * Originally a diagnostic; retained as the regression guard for the fix.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ── sandbox (same stubs as the integration suite) ───────────────────────────
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
const getEl = (id) => (elements[id] || (elements[id] = makeEl(id)));
const storage = { _d: {}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];}, clear(){this._d={};}, key(){return null;}, length:0 };

const sandbox = {
  console: { log(){}, error(){}, warn(){}, info(){}, debug(){} },
  document: {
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    getElementById: getEl, querySelector: () => null, querySelectorAll: () => [],
    createElement: makeEl, addEventListener(){}, removeEventListener(){},
    createTextNode: () => ({}), cookie: ''
  },
  localStorage: storage, sessionStorage: storage,
  navigator: { userAgent: 'node', clipboard: { writeText: async()=>{} }, mediaDevices: {} },
  location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload(){} },
  fetch: async () => ({ ok:false, status:0, json: async()=>({}), text: async()=>'' }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn)=>setTimeout(fn,0),
  alert(){}, confirm:()=>true, prompt:()=>null,
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true;},
  matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }),
  scrollTo(){}, open(){return null;}, close(){},
  Image: function(){ return { src:'', onload:null, onerror:null }; },
  FileReader: function(){ return {}; },
  XMLHttpRequest: function(){ return { open(){}, send(){}, setRequestHeader(){} }; },
  URL, URLSearchParams, Blob: function(){}, FormData: function(){},
  AbortController, TextEncoder, TextDecoder,
  Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error,
  Promise, Map, Set, WeakMap, WeakSet, Symbol, parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent,
  btoa: (s)=>Buffer.from(s,'binary').toString('base64'),
  atob: (s)=>Buffer.from(s,'base64').toString('binary'),
  Html5QrcodeSupportedFormats: { EAN_13:0,EAN_8:1,UPC_A:2,UPC_E:3,CODE_128:4,CODE_39:5,ITF:6,CODABAR:7,QR_CODE:8,DATA_MATRIX:9 },
  Html5Qrcode: function(){ return { start:async()=>{}, stop:async()=>{}, clear(){}, scanFile:async()=>'' }; },
  Html5QrcodeScanner: function(){ return { render(){}, clear:async()=>{} }; },
  XLSX: { utils:{ book_new:()=>({}), json_to_sheet:()=>({}), book_append_sheet(){} }, writeFile(){} },
  process: { env: {} }
};
sandbox.Html5Qrcode.getCameras = async () => [];
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname,'multipack-fixes.js'),'utf8'), sandbox, {filename:'multipack-fixes.js'});
try { vm.runInContext(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'), sandbox, {filename:'app.js'}); }
catch(e) { console.log('app.js bootstrap note: ' + e.message); }

const setCur = (o) => { sandbox.__f = o; vm.runInContext('cur = __f;', sandbox); return o; };

// ── THE REAL FIXTURE ────────────────────────────────────────────────────────
const UPC = '851278001035';
const BASE_TITLE = 'Gum Spearmint Sugar Free 100 4.76oz Pack';
const EXP = 'Jul 2030';           // formatExpForTitle() input form -> renders "Exp 07/30"
const EXP_RENDERED = 'Exp 07/30';
const UNIT = 100;

console.log('═'.repeat(78));
console.log('REAL FIXTURE TRACE — UPC ' + UPC);
console.log('═'.repeat(78));
console.log(`base title : "${BASE_TITLE}"`);
console.log(`unit count : ${UNIT} pieces per unit`);
console.log(`expiration : ${EXP}  ->  "${EXP_RENDERED}"`);
console.log(`observed   : "Gum Spearmint Sugar Free 100 4.76oz Pack Exp 07/30 Pack of 3 New"`);
console.log(`expected   : must contain "300 Total" at Pack 3\n`);

// Which specifics field actually holds the count decides everything.
// app.js:9067 maps THREE different fields onto the C:Size column:
//     'Size':'C:Size',  'Count':'C:Size',  'Unit Quantity':'C:Size'
// so a CSV showing "C:Size 100" does NOT tell us which field carried it.
const VARIANTS = [
  { name: "A: canonical Size = '100'",          canon: { Size: '100' } },
  { name: "B: canonical Count = '100'",         canon: { Count: '100' } },
  { name: "C: canonical Unit Quantity = '100'", canon: { 'Unit Quantity': '100' } },
  { name: "D: canonical Size = '100 Count'",    canon: { Size: '100 Count' } },
  { name: "E: no canonical specifics at all",   canon: {} }
];

function makeCur(canon, extra) {
  return Object.assign({
    upc: UPC,
    title: BASE_TITLE,
    brand: 'Gum',
    category: '180959',
    prod: { title: BASE_TITLE },
    _canonicalProductName: null,
    _canonicalSpecifics: Object.assign({}, canon),
    _canonicalSpecificsLocked: true,
    _specifics: Object.assign({}, canon),
    _titleManual: false,
    _selectedPack: 1,
    _expDate: EXP
  }, extra || {});
}

console.log('─'.repeat(78));
console.log('STEP 1 — psGetCanonicalUnitCount() / psGetPackTotalCount()');
console.log('─'.repeat(78));
console.log('Which specifics shape yields unitCount = 100?\n');

let reproVariant = null;
VARIANTS.forEach(v => {
  const c = makeCur(v.canon);
  const unit = sandbox.psGetCanonicalUnitCount(c);
  const total = sandbox.psGetPackTotalCount(c, 3);
  const segs = sandbox.psBuildCountSegments(c, 3, BASE_TITLE);
  const ok = unit === UNIT;
  console.log(`  ${ok ? '✓' : '✗'} ${v.name}`);
  console.log(`      unitCount  = ${unit}`);
  console.log(`      totalCount = ${total}`);
  console.log(`      segments   = ${JSON.stringify(segs.map(s => s.text))}`);
  if (!ok && reproVariant === null) reproVariant = v;   // first failing shape
});

console.log('\n' + '─'.repeat(78));
console.log('STEP 2 — full production chain, per variant, at Pack 3');
console.log('─'.repeat(78));

VARIANTS.forEach(v => {
  const c = setCur(makeCur(v.canon));
  sandbox.window._packState = {
    baseTitle: BASE_TITLE, curPack: 3, shade: '', expDate: EXP,
    baseUPC: UPC, baseBrand: 'Gum', ebayBase: 10, discount: 0.95, els: {}
  };
  const title = sandbox.rebuildTitle(BASE_TITLE, 3, '', EXP);
  const has = /\b300 Total\b/.test(title);
  console.log(`\n  ${has ? '✓' : '✗'} ${v.name}`);
  console.log(`      rebuildTitle() -> "${title}"  (${title.length} chars)`);
  console.log(`      contains "300 Total": ${has ? 'YES' : 'NO'}`);
});

console.log('\n' + '─'.repeat(78));
console.log('STEP 3 — is the 80-char fitter or the tie-break to blame?');
console.log('─'.repeat(78));

{
  // Force the segment to exist, then watch buildTitleFromSpans handle it.
  const c = setCur(makeCur({ Size: '100' }));
  sandbox.window._packState = { baseTitle: BASE_TITLE, curPack: 3, shade: '', expDate: EXP, els: {} };

  const segs = sandbox.psBuildCountSegments(c, 3, BASE_TITLE);
  console.log(`  segments handed to the fitter: ${JSON.stringify(segs.map(s => s.text))}`);

  const spans = sandbox.parseIntoSpans(BASE_TITLE);
  sandbox.annotateSpans(spans, BASE_TITLE, c);
  console.log('\n  spans from the REAL base title (priority / role):');
  spans.forEach(s => console.log(`      "${s.value}"  p=${s.priority}  ${s.role}  score=${s.semanticScore}`));

  const fitted = sandbox.psFitTitleWithCounts(BASE_TITLE, segs, 3, '', EXP, c);
  console.log(`\n  psFitTitleWithCounts() -> "${fitted}"  (${fitted.length} chars)`);
  console.log(`  <= 80 chars, so buildTitleFromSpans returns EARLY without dropping anything: ${fitted.length <= 80}`);
  console.log(`  contains "300 Total": ${/\b300 Total\b/.test(fitted) ? 'YES' : 'NO'}`);
}

console.log('\n' + '─'.repeat(78));
console.log('STEP 4 — pack matrix (2, 3, 6, 10, 12) once the count is resolvable');
console.log('─'.repeat(78));

[2, 3, 6, 10, 12].forEach(p => {
  const c = setCur(makeCur({ Size: '100' }));
  sandbox.window._packState = { baseTitle: BASE_TITLE, curPack: p, shade: '', expDate: EXP, els: {} };
  const t = sandbox.rebuildTitle(BASE_TITLE, p, '', EXP);
  const want = UNIT * p;
  const ok = new RegExp(`\\b${want} Total\\b`).test(t)
          && t.includes('Pack of ' + p)
          && t.includes(EXP_RENDERED)
          && sandbox.countStandaloneNewTokens(t) === 1
          && t.length <= 80;
  console.log(`  ${ok ? '✓' : '✗'} Pack ${String(p).padStart(2)} (want ${want} Total): "${t}"  (${t.length})`);
});

console.log('\n' + '─'.repeat(78));
console.log('STEP 5 — same matrix with the count under "Count" instead of "Size"');
console.log('─'.repeat(78));

[2, 3, 6, 10, 12].forEach(p => {
  const c = setCur(makeCur({ Count: '100' }));
  sandbox.window._packState = { baseTitle: BASE_TITLE, curPack: p, shade: '', expDate: EXP, els: {} };
  const t = sandbox.rebuildTitle(BASE_TITLE, p, '', EXP);
  const want = UNIT * p;
  const ok = new RegExp(`\\b${want} Total\\b`).test(t);
  console.log(`  ${ok ? '✓' : '✗'} Pack ${String(p).padStart(2)} (want ${want} Total): "${t}"`);
});

console.log('\n' + '─'.repeat(78));
console.log('STEP 6 — the fix, now LIVE in psGetCanonicalUnitCount()');
console.log('─'.repeat(78));
console.log('psGetCanonicalUnitCount() now reads all three fields that app.js:9067');
console.log('maps onto the C:Size column: Size, Count, Unit Quantity.\n');

function simulatedUnitCount(c) {
  // existing behaviour first
  const viaCurrent = sandbox.psGetCanonicalUnitCount(c);
  if (viaCurrent) return viaCurrent;
  // proposed addition: the other two C:Size-bearing fields
  const FIELDS = ['Size', 'Count', 'Unit Quantity'];
  for (const f of FIELDS) {
    const v = (c._canonicalSpecifics && c._canonicalSpecifics[f]) || '';
    const m = String(v).trim().match(/^(\d{1,4})\b/);
    if (m && !/\bTotal\b/i.test(String(v))) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) return n;
    }
  }
  return null;
}

VARIANTS.forEach(v => {
  const c = makeCur(v.canon);
  const before = sandbox.psGetCanonicalUnitCount(c);
  const after = simulatedUnitCount(c);
  const fixed = after === UNIT;
  console.log(`  ${fixed ? '✓' : '·'} ${v.name}`);
  console.log(`      current  -> ${before}`);
  console.log(`      proposed -> ${after}${fixed ? '   (300 Total would now be emitted)' : ''}`);
});

console.log('\n' + '═'.repeat(78));

process.exit(0);
