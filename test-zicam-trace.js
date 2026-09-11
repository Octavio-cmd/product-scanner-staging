#!/usr/bin/env node

/**
 * ZICAM REAL REGRESSION TRACE — UPC 732216300918
 *
 * Real exported CSV row (isolated preview, AFTER the A+B fixes):
 *   Title  : "Zicam Ultra Cold Remedy Zinc Rapidmelts Orange Cream Exp 10/27 Pack of 3 New"
 *   C:Size : "25 Count"
 *   SKU    : ZIC-732216300918-3pk
 *   Exp    : Oct 2027 -> "Exp 10/27"
 * Expected: 25 x 3 = 75, title must contain "75 Total".
 *
 * The product title contains NO digits at all, so every title-based fallback
 * in psGetCanonicalUnitCount() is inert — the count can ONLY come from
 * specifics. This trace determines which store actually holds it.
 *
 * Diagnostic only.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

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

vm.runInContext(fs.readFileSync(path.join(__dirname,'multipack-fixes.js'),'utf8'), sandbox, {filename:'multipack-fixes.js'});
try { vm.runInContext(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'), sandbox, {filename:'app.js'}); }
catch(e) { console.log('app.js bootstrap note: ' + e.message); }

const setCur = (o) => { sandbox.__f = o; vm.runInContext('cur = __f;', sandbox); return o; };
const getCur = () => vm.runInContext('cur', sandbox);

// ── THE REAL FIXTURE ───────────────────────────────────────────────────────
const UPC   = '732216300918';
const BRAND = 'Zicam';
const BASE  = 'Zicam Ultra Cold Remedy Zinc Rapidmelts Orange Cream';
const EXP   = 'Oct 2027';
const EXP_R = 'Exp 10/27';
const UNIT  = 25;
const PACK  = 3;
const OBSERVED = 'Zicam Ultra Cold Remedy Zinc Rapidmelts Orange Cream Exp 10/27 Pack of 3 New';

console.log('═'.repeat(78));
console.log('ZICAM TRACE — UPC ' + UPC);
console.log('═'.repeat(78));
console.log(`base title : "${BASE}"  (${BASE.length} chars)`);
console.log(`digits in base title: ${(BASE.match(/\d/g) || []).length}  <-- every title fallback is inert`);
console.log(`expiration : ${EXP} -> "${EXP_R}"`);
console.log(`observed   : "${OBSERVED}"  (${OBSERVED.length} chars)`);
console.log(`expected   : must contain "${UNIT * PACK} Total"\n`);

// ── Length arithmetic: is 80 chars even the constraint here? ───────────────
console.log('─'.repeat(78));
console.log('STEP 0 — is the 80-char limit in play?');
console.log('─'.repeat(78));
const withTotal = BASE + ' ' + (UNIT * PACK) + ' Total ' + EXP_R + ' Pack of ' + PACK + ' New';
console.log(`  observed (no total) : ${OBSERVED.length} chars`);
console.log(`  ideal (with total)  : ${withTotal.length} chars  -> "${withTotal}"`);
console.log(`  ${withTotal.length > 80
  ? '  exceeds 80: the drop loop WOULD run, but with Total at p=4.5 a p=4\n     descriptor is sacrificed first, so the total should still survive.'
  : '  fits in 80: the fitter has no reason to drop anything.'}`);

// ── Hypotheses about where "25 Count" actually lives ───────────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 1 — where does "25 Count" live? (C:Size cannot tell us)');
console.log('─'.repeat(78));
console.log('app.js:9827  var _itSpecs = it._specifics ...   <- the CSV reads');
console.log('app.js:9964  _specByCol[SPEC_COL_MAP[key]] = _itSpecs[key]');
console.log('SPEC_COL_MAP maps Size, Count AND Unit Quantity -> C:Size.');
console.log('So C:Size proves only that cur._specifics holds it. It says NOTHING');
console.log('about _canonicalSpecifics, which is the ONLY store the helper reads.\n');

const HYPOTHESES = [
  { id: 'H1', name: 'canonical Count = "25 Count"      (canonical populated)',
    canon: { Count: '25 Count' },     spec: { Count: '25 Count' } },
  { id: 'H2', name: 'canonical Size = "25 Count"       (canonical populated)',
    canon: { Size: '25 Count' },      spec: { Size: '25 Count' } },
  { id: 'H3', name: 'canonical EMPTY, current only     (count never canonicalized)',
    canon: {},                        spec: { Count: '25 Count' } },
  { id: 'H4', name: 'canonical holds OTHER fields only (Count absent from snapshot)',
    canon: { 'Item Form': 'Tablet', Flavor: 'Orange Cream' },
    spec:  { 'Item Form': 'Tablet', Flavor: 'Orange Cream', Count: '25 Count' } },
  { id: 'H5', name: 'count under "Number of Doses"     (unmapped field name)',
    canon: { 'Number of Doses': '25' }, spec: { 'Number of Doses': '25', Count: '25 Count' } }
];

function makeCur(h, extra) {
  return Object.assign({
    upc: UPC, title: BASE, prod: { title: BASE }, brand: BRAND,
    category: '180959',
    _canonicalProductName: null,
    _canonicalSpecifics: Object.assign({}, h.canon),
    _canonicalSpecificsLocked: true,
    _specifics: Object.assign({}, h.spec),
    _titleManual: false, _selectedPack: 1, _expDate: EXP
  }, extra || {});
}

let reproducing = [];
HYPOTHESES.forEach(h => {
  const c = makeCur(h);
  const cs = c._canonicalSpecifics;
  const unit = sandbox.psGetCanonicalUnitCount(c);
  const total = sandbox.psGetPackTotalCount(c, PACK);
  const segs = sandbox.psBuildCountSegments(c, PACK, BASE);

  setCur(makeCur(h));
  sandbox.window._packState = { baseTitle: BASE, curPack: PACK, shade:'', expDate: EXP,
                                baseUPC: UPC, baseBrand: BRAND, ebayBase: 10, discount: 0.95, els: {} };
  const title = sandbox.rebuildTitle(BASE, PACK, '', EXP);
  const matchesObserved = title === OBSERVED;
  if (matchesObserved) reproducing.push(h.id);

  console.log(`  ${h.id} ${h.name}`);
  console.log(`      _canonicalSpecifics.Size            = ${JSON.stringify(cs.Size)}`);
  console.log(`      _canonicalSpecifics.Count           = ${JSON.stringify(cs.Count)}`);
  console.log(`      _canonicalSpecifics['Unit Quantity']= ${JSON.stringify(cs['Unit Quantity'])}`);
  console.log(`      psGetCanonicalUnitCount()           = ${unit}`);
  console.log(`      psGetPackTotalCount(cur, 3)         = ${total}`);
  console.log(`      psBuildCountSegments(cur, 3)        = ${JSON.stringify(segs.map(s=>s.text))}`);
  console.log(`      rebuildTitle() -> "${title}"  (${title.length})`);
  console.log(`      reproduces the REAL exported title? ${matchesObserved ? 'YES  <-- MATCH' : 'no'}`);
  console.log('');
});

console.log(`  Hypotheses reproducing the exact observed title: ${reproducing.join(', ') || 'NONE'}`);

// ── Full chain under the hypothesis that canonical IS populated ────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 2 — full chain when canonical DOES hold the count (H1)');
console.log('─'.repeat(78));
{
  const h = HYPOTHESES[0];
  const c = setCur(makeCur(h));
  sandbox.window._packState = { baseTitle: BASE, curPack: PACK, shade:'', expDate: EXP, els:{} };

  const segs = sandbox.psBuildCountSegments(c, PACK, BASE);
  const spans = sandbox.parseIntoSpans(BASE);
  sandbox.annotateSpans(spans, BASE, c);

  console.log('  spans:');
  spans.forEach(s => console.log(`      p=${String(s.priority).padEnd(5)} score=${String(s.semanticScore).padEnd(5)} ${s.role.padEnd(20)} "${s.value}"`));
  console.log(`  segments: ${JSON.stringify(segs.map(s=>({t:s.text,p:s.dropPriority})))}`);

  const beforeFit = spans.map(s=>s.value).join(' ') + ' ' + segs.map(s=>s.text).join(' ') + ' ' + EXP_R + ' Pack of 3 New';
  console.log(`\n  title BEFORE fit : "${beforeFit}"  (${beforeFit.length})`);
  const afterFit = sandbox.psFitTitleWithCounts(BASE, segs, PACK, '', EXP, c);
  console.log(`  title AFTER fit  : "${afterFit}"  (${afterFit.length})`);
  const rt = sandbox.rebuildTitle(BASE, PACK, '', EXP);
  console.log(`  rebuildTitle()   : "${rt}"  (${rt.length})`);
  console.log(`  used by addSplitPacksToCSV(): the same rebuildTitle() value.`);
  console.log(`\n  has "75 Total"     : ${rt.includes('75 Total') ? 'YES' : 'NO'}`);
  console.log(`  has "Exp 10/27"    : ${rt.includes(EXP_R) ? 'YES' : 'NO'}`);
  console.log(`  has "Pack of 3"    : ${rt.includes('Pack of 3') ? 'YES' : 'NO'}`);
  console.log(`  keeps brand Zicam  : ${rt.includes('Zicam') ? 'YES' : 'NO'}`);
  console.log(`  one terminal New   : ${sandbox.countStandaloneNewTokens(rt) === 1 ? 'YES' : 'NO'}`);
  console.log(`  <= 80 chars        : ${rt.length <= 80 ? 'YES' : 'NO'}`);
}

// ── Would reading current specifics as a fallback fix it? ──────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 3 — simulate a current-specifics fallback (read-only)');
console.log('─'.repeat(78));
console.log('Proposed: after canonical yields nothing, consult cur._specifics for');
console.log('the same three fields, still refusing "Total"-bearing values.\n');

function simulatedUnitCount(c) {
  const viaCurrent = sandbox.psGetCanonicalUnitCount(c);
  if (viaCurrent) return viaCurrent;
  const FIELDS = ['Size', 'Count', 'Unit Quantity'];
  for (const f of FIELDS) {
    const v = String((c._specifics && c._specifics[f]) || '').trim();
    if (!v || /\bTotals?\b/i.test(v)) continue;
    const m = v.match(/^(\d{1,4})(?:\s|$)/);
    if (m) { const n = parseInt(m[1], 10); if (n > 0 && n < 10000) return n; }
  }
  return null;
}

HYPOTHESES.forEach(h => {
  const c = makeCur(h);
  const before = sandbox.psGetCanonicalUnitCount(c);
  const after = simulatedUnitCount(c);
  console.log(`  ${h.id}: canonical-only = ${String(before).padEnd(5)} -> with fallback = ${after}${after === UNIT ? '  ✓' : ''}`);
});

// ── Regression guard: the fallback must not resurrect the Zellies bug ──────
console.log('\n' + '─'.repeat(78));
console.log('STEP 4 — would the fallback disturb Zellies or the safety rules?');
console.log('─'.repeat(78));
{
  const zellies = {
    title: 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum',
    prod: { title: 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum' },
    brand: 'Zellies',
    _canonicalSpecifics: { Count: '100' },
    _specifics: { Count: '100' }
  };
  console.log(`  Zellies canonical-only = ${sandbox.psGetCanonicalUnitCount(zellies)} (unchanged: canonical already answers)`);

  // A pack-derived value sitting in CURRENT specifics must never be believed.
  const contaminated = {
    title: 'Some Product',
    _canonicalSpecifics: { Size: '26 Count' },
    _specifics: { Size: '52 Count' }   // stale pack-2 total
  };
  console.log(`  contaminated current (canonical 26, current 52) = ${simulatedUnitCount(contaminated)}  (canonical wins)`);

  const totalInCurrent = {
    title: 'Some Product',
    _canonicalSpecifics: {},
    _specifics: { Size: '300 Total' }
  };
  console.log(`  current says "300 Total"                        = ${simulatedUnitCount(totalInCurrent)}  (refused)`);

  const measureOnly = {
    title: 'Some Product',
    _canonicalSpecifics: {},
    _specifics: { Size: '4.76 oz' }
  };
  console.log(`  current says "4.76 oz"                          = ${simulatedUnitCount(measureOnly)}  (not a count)`);
}

console.log('\n' + '═'.repeat(78));

process.exit(0);
