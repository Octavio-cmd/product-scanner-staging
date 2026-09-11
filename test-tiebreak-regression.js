#!/usr/bin/env node

/**
 * TIE-BREAK REGRESSION — buildTitleFromSpans()
 *
 * Proves the contract of the equal-priority tie-breaker:
 *
 *   BEFORE (b.semanticScore - a.semanticScore):
 *       highest-importance span sorted to index 0, shift() removed it
 *       -> brand / core identity sacrificed before filler
 *
 *   AFTER  (a.semanticScore - b.semanticScore):
 *       lowest-importance span removed first
 *
 * The "before" behaviour is reproduced by a faithful local model of the loop,
 * so the regression is a comparison of two executable orderings — not a claim
 * about code that no longer exists. The "after" side calls the REAL
 * buildTitleFromSpans() from app.js.
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
  if (cond) passed++; else { failed++; failures.push({ name, actual: detail, expected: true }); }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n      detail: ${detail}`}`);
  return !!cond;
}
function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

// ── sandbox ────────────────────────────────────────────────────────────────
function makeEl(id) {
  return {
    id, textContent:'', innerHTML:'', value:'', dataset:{},
    style:{cssText:'',display:'',background:'',color:''},
    classList:{toggle(){},add(){},remove(){},contains(){return false;}},
    appendChild(){}, removeChild(){}, addEventListener(){}, remove(){},
    scrollIntoView(){}, focus(){}, blur(){}, click(){},
    querySelector(){return null;}, querySelectorAll(){return [];},
    setAttribute(){}, getAttribute(){return null;}, insertAdjacentHTML(){}
  };
}
const elements = {};
const getEl = (id) => (elements[id] || (elements[id] = makeEl(id)));
const storage = { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];}, clear(){this._d={};}, key(){return null;}, length:0 };

const sandbox = {
  console:{log(){},error(){},warn(){},info(){},debug(){}},
  document:{ body:makeEl('body'), head:makeEl('head'), documentElement:makeEl('html'),
    getElementById:getEl, querySelector:()=>null, querySelectorAll:()=>[],
    createElement:makeEl, addEventListener(){}, removeEventListener(){},
    createTextNode:()=>({}), cookie:'' },
  localStorage:storage, sessionStorage:storage,
  navigator:{userAgent:'node',clipboard:{writeText:async()=>{}},mediaDevices:{}},
  location:{href:'http://localhost/',search:'',hash:'',protocol:'http:',reload(){}},
  fetch:async()=>({ok:false,status:0,json:async()=>({}),text:async()=>''}),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame:(fn)=>setTimeout(fn,0),
  alert(){}, confirm:()=>true, prompt:()=>null,
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true;},
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  scrollTo(){}, open(){return null;}, close(){},
  Image:function(){return {src:'',onload:null,onerror:null};},
  FileReader:function(){return {};},
  XMLHttpRequest:function(){return {open(){},send(){},setRequestHeader(){}};},
  URL, URLSearchParams, Blob:function(){}, FormData:function(){},
  AbortController, TextEncoder, TextDecoder,
  Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error,
  Promise, Map, Set, WeakMap, WeakSet, Symbol, parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent,
  btoa:(s)=>Buffer.from(s,'binary').toString('base64'),
  atob:(s)=>Buffer.from(s,'base64').toString('binary'),
  Html5QrcodeSupportedFormats:{EAN_13:0,EAN_8:1,UPC_A:2,UPC_E:3,CODE_128:4,CODE_39:5,ITF:6,CODABAR:7,QR_CODE:8,DATA_MATRIX:9},
  Html5Qrcode:function(){return {start:async()=>{},stop:async()=>{},clear(){},scanFile:async()=>''};},
  Html5QrcodeScanner:function(){return {render(){},clear:async()=>{}};},
  XLSX:{utils:{book_new:()=>({}),json_to_sheet:()=>({}),book_append_sheet(){}},writeFile(){}},
  process:{env:{}}
};
sandbox.Html5Qrcode.getCameras = async () => [];
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const appSrc = fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
vm.runInContext(fs.readFileSync(path.join(__dirname,'multipack-fixes.js'),'utf8'), sandbox, {filename:'multipack-fixes.js'});
try { vm.runInContext(appSrc, sandbox, {filename:'app.js'}); } catch(e) {}

const setCur = (o) => { sandbox.__f = o; vm.runInContext('cur = __f;', sandbox); return o; };
const getCur = () => vm.runInContext('cur', sandbox);

// Faithful model of the drop loop, parameterised by tie-break direction.
function modelFit(spans, n, inverted) {
  var active = spans.map((s,i)=>Object.assign({},s,{originalIdx:i}));
  var suffix = (Number(n) >= 2 ? ' Pack of ' + n : '') + ' New';
  var out = active.map(s=>s.value).join(' ') + suffix;
  if (out.length <= 80) return out;
  while (active.length > 0) {
    active.sort(function(a,b){
      if (a.priority !== b.priority) return a.priority - b.priority;
      return inverted ? (b.semanticScore||0)-(a.semanticScore||0)
                      : (a.semanticScore||0)-(b.semanticScore||0);
    });
    active.shift();
    active.sort((a,b)=>a.originalIdx-b.originalIdx);
    out = active.map(s=>s.value).join(' ') + suffix;
    if (out.length <= 80) return out;
  }
  return suffix.trim();
}

console.log('═'.repeat(78));
console.log('TIE-BREAK REGRESSION — buildTitleFromSpans()');
console.log('═'.repeat(78));

// ───────────────────────────────────────────────────────────────────────────
section('T1 — the comparator in app.js source');
// ───────────────────────────────────────────────────────────────────────────
checkTrue('T1a app.js uses (a.semanticScore) - (b.semanticScore)',
  /return\s*\(a\.semanticScore\s*\|\|\s*0\)\s*-\s*\(b\.semanticScore\s*\|\|\s*0\);/.test(appSrc),
  'corrected comparator not found');
checkTrue('T1b the inverted form is gone',
  !/return\s*\(b\.semanticScore\s*\|\|\s*0\)\s*-\s*\(a\.semanticScore\s*\|\|\s*0\);/.test(appSrc),
  'inverted comparator still present');

// ───────────────────────────────────────────────────────────────────────────
section('T2 — equal priority: which span is sacrificed first?');
// ───────────────────────────────────────────────────────────────────────────
// Five spans tied at priority 4; only differ by semanticScore. Long enough to
// force the drop loop.
const tied = [
  { value: 'Alphaaaa Brandzz', priority: 4, semanticScore: 1000, role: 'BRAND' },
  { value: 'Corezzz Producttt', priority: 4, semanticScore: 850,  role: 'CORE_PRODUCT' },
  { value: 'Variantttt',       priority: 4, semanticScore: 500,  role: 'VARIANT' },
  { value: 'Descriptorrrrr',   priority: 4, semanticScore: 100,  role: 'SECONDARY_DESCRIPTOR' },
  { value: 'Fillerrrrrrrrrr',  priority: 4, semanticScore: 50,   role: 'VARIANT' }
];
const unfitted = tied.map(s=>s.value).join(' ') + ' Pack of 3 New';
console.log(`  unfitted (${unfitted.length} chars): "${unfitted}"`);
checkTrue('T2a fixture actually exceeds 80 chars', unfitted.length > 80, `${unfitted.length}`);

const before = modelFit(tied, 3, true);
const after  = modelFit(tied, 3, false);
console.log(`\n  BEFORE (inverted): "${before}"`);
console.log(`  AFTER  (corrected): "${after}"`);

checkTrue('T2b BEFORE sacrificed the highest-importance span (BRAND)',
  !before.includes('Alphaaaa Brandzz'), before);
checkTrue('T2c BEFORE kept the lowest-importance filler',
  before.includes('Fillerrrrrrrrrr'), before);
checkTrue('T2d AFTER keeps the BRAND', after.includes('Alphaaaa Brandzz'), after);
checkTrue('T2e AFTER keeps CORE_PRODUCT', after.includes('Corezzz Producttt'), after);
checkTrue('T2f AFTER dropped the lowest-importance filler first',
  !after.includes('Fillerrrrrrrrrr'), after);
checkTrue('T2g the two orderings genuinely differ', before !== after,
  'both produced the same title — fixture does not discriminate');

// ───────────────────────────────────────────────────────────────────────────
section('T3 — the REAL buildTitleFromSpans() now behaves as corrected');
// ───────────────────────────────────────────────────────────────────────────
{
  const real = sandbox.buildTitleFromSpans(
    tied.map((s,i)=>Object.assign({},s,{wordCount:s.value.split(/\s+/).length,startIdx:i})),
    3, '', '', null);
  console.log(`  real buildTitleFromSpans() -> "${real}"  (${real.length})`);
  checkTrue('T3a real function keeps BRAND', real.includes('Alphaaaa Brandzz'), real);
  checkTrue('T3b real function keeps CORE_PRODUCT', real.includes('Corezzz Producttt'), real);
  checkTrue('T3c real function drops the filler', !real.includes('Fillerrrrrrrrrr'), real);
  check('T3d real matches the corrected model', real, after);
  checkTrue('T3e <= 80 chars', real.length <= 80, `${real.length}`);
  checkTrue('T3f suffix intact', /Pack of 3 New$/.test(real), real);
}

// ───────────────────────────────────────────────────────────────────────────
section('T4 — priority still outranks semanticScore');
// ───────────────────────────────────────────────────────────────────────────
// A low-priority, HIGH-score span must still go before a high-priority,
// low-score one: the correction only reorders ties.
{
  const mixed = [
    { value: 'Keeperrrrrrrrrrrrrrrrrrrrrrrr', priority: 5, semanticScore: 50,   role: 'BRAND' },
    { value: 'Droppppppppppppmeeeeeeeeeeeee', priority: 2, semanticScore: 1000, role: 'VARIANT' },
    { value: 'Middlingggggggggggggggggggggg', priority: 4, semanticScore: 500,  role: 'CORE_PRODUCT' }
  ];
  const mixedUnfitted = mixed.map(s => s.value).join(' ') + ' Pack of 3 New';
  checkTrue('T4-pre fixture exceeds 80 chars (or the loop never runs)',
    mixedUnfitted.length > 80, `${mixedUnfitted.length}`);
  const out = modelFit(mixed, 3, false);
  console.log(`  unfitted (${mixedUnfitted.length}) -> "${out}"  (${out.length})`);
  checkTrue('T4a low-priority high-score span dropped first',
    !out.includes('Droppppppppppppme'), out);
  checkTrue('T4b priority-5 span survives', out.includes('Keeperrrrrrrrrrrr'), out);
}

// ───────────────────────────────────────────────────────────────────────────
section('T5 — short titles are never trimmed');
// ───────────────────────────────────────────────────────────────────────────
{
  const shortSpans = [
    { value: 'Tiny', priority: 5, semanticScore: 1000, role: 'BRAND', wordCount:1, startIdx:0 },
    { value: 'Item', priority: 2, semanticScore: 50,  role: 'VARIANT', wordCount:1, startIdx:1 }
  ];
  const out = sandbox.buildTitleFromSpans(shortSpans, 3, '', '', null);
  console.log(`  -> "${out}"  (${out.length})`);
  check('T5a nothing dropped from a short title', out, 'Tiny Item Pack of 3 New');
  checkTrue('T5b <= 80', out.length <= 80, `${out.length}`);
}

// ───────────────────────────────────────────────────────────────────────────
section('T6 — ZELLIES real fixture, through the real production chain');
// ───────────────────────────────────────────────────────────────────────────
const BASE = 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum';
const UPC = '851278001035';
const UNIT = 100;

function zelliesCur() {
  return {
    upc: UPC, title: BASE, prod: { title: BASE }, brand: 'Zellies',
    category: '180959',
    _canonicalProductName: null,
    _canonicalSpecifics: { Count: '100' },
    _canonicalSpecificsLocked: true,
    _specifics: { Count: '100' },
    _titleManual: false, _selectedPack: 1, _expDate: ''
  };
}

[2, 3, 6, 10, 12].forEach(p => {
  setCur(zelliesCur());
  sandbox.window._packState = {
    baseTitle: BASE, curPack: p, shade: '', expDate: '',
    baseUPC: UPC, baseBrand: 'Zellies', ebayBase: 10, discount: 0.95, els: {}
  };
  const t = sandbox.rebuildTitle(BASE, p, '', '');
  const want = UNIT * p;
  console.log(`\n  Pack ${String(p).padStart(2)}: "${t}"  (${t.length})`);
  checkTrue(`T6 pack ${p}: has "${want} Total"`, t.includes(`${want} Total`), t);
  checkTrue(`T6 pack ${p}: keeps brand "Zellies Dental"`, t.includes('Zellies Dental'), t);
  checkTrue(`T6 pack ${p}: keeps core "Gum Spearmint"`, t.includes('Gum Spearmint'), t);
  checkTrue(`T6 pack ${p}: has "Pack of ${p}"`, t.includes('Pack of ' + p), t);
  check(`T6 pack ${p}: exactly one New`, sandbox.countStandaloneNewTokens(t), 1);
  checkTrue(`T6 pack ${p}: terminal New`, /\bNew$/.test(t), t);
  checkTrue(`T6 pack ${p}: <= 80 chars`, t.length <= 80, `${t.length}`);
});

// 1pk must NOT gain a derived total.
{
  setCur(zelliesCur());
  sandbox.window._packState = { baseTitle: BASE, curPack: 1, shade: '', expDate: '', els: {} };
  const t1 = sandbox.rebuildTitle(BASE, 1, '', '');
  console.log(`\n  Pack  1: "${t1}"  (${t1.length})`);
  checkTrue('T6 pack 1: no "Total"', !/\bTotal\b/i.test(t1), t1);
  checkTrue('T6 pack 1: no "Pack of"', !/Pack of/i.test(t1), t1);
  check('T6 pack 1: exactly one New', sandbox.countStandaloneNewTokens(t1), 1);
  checkTrue('T6 pack 1: <= 80', t1.length <= 80, `${t1.length}`);
}

// With an expiration the suffix grows — the total must still survive.
{
  setCur(zelliesCur());
  sandbox.window._packState = { baseTitle: BASE, curPack: 3, shade: '', expDate: 'Jul 2030', els: {} };
  const te = sandbox.rebuildTitle(BASE, 3, '', 'Jul 2030');
  console.log(`\n  Pack  3 + exp: "${te}"  (${te.length})`);
  checkTrue('T6 exp: has "300 Total"', te.includes('300 Total'), te);
  checkTrue('T6 exp: has "Exp 07/30"', te.includes('Exp 07/30'), te);
  checkTrue('T6 exp: keeps brand', te.includes('Zellies Dental'), te);
  checkTrue('T6 exp: has "Pack of 3"', te.includes('Pack of 3'), te);
  checkTrue('T6 exp: <= 80 chars', te.length <= 80, `${te.length}`);
}

console.log('\n' + '═'.repeat(78));
console.log('TIE-BREAK REGRESSION SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) {
  console.log('\nFAILED:');
  failures.forEach(f => console.log(`  - ${f.name}`));
}
console.log('═'.repeat(78));

process.exit(failed ? 1 : 0);
