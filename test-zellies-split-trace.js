#!/usr/bin/env node

/**
 * BULK SPLIT TRACE — real UI state, UPC 851278001035 (Zellies Dental Gum)
 *
 * Observed in the browser after configuring Bulk Split (inventory 3, 3pk = 1
 * listing, 1pk and 2pk excluded):
 *
 *   main title : "Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum New"
 *   main SKU   : "ZEL-851278001035-1pk"
 *
 * Questions:
 *   1. Is Bulk Split independent of the main pack preview?
 *   2. Does addSplitPacksToCSV() build each pack title correctly anyway?
 *
 * Diagnostic only.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', value: '', dataset: {},
    style: { cssText:'', display:'', background:'', color:'' },
    classList: { toggle(){}, add(){}, remove(){}, contains(){return false;} },
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
  console: { log(){}, error(){}, warn(){}, info(){}, debug(){} },
  document: {
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    getElementById: getEl, querySelector: () => null, querySelectorAll: () => [],
    createElement: makeEl, addEventListener(){}, removeEventListener(){},
    createTextNode: () => ({}), cookie: ''
  },
  localStorage: storage, sessionStorage: storage,
  navigator: { userAgent:'node', clipboard:{writeText:async()=>{}}, mediaDevices:{} },
  location: { href:'http://localhost/', search:'', hash:'', protocol:'http:', reload(){} },
  fetch: async () => ({ ok:false, status:0, json:async()=>({}), text:async()=>'' }),
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
  btoa:(s)=>Buffer.from(s,'binary').toString('base64'),
  atob:(s)=>Buffer.from(s,'base64').toString('binary'),
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
const getCur = () => vm.runInContext('cur', sandbox);

// ── REAL STATE FROM THE BROWSER ─────────────────────────────────────────────
const UPC   = '851278001035';
const BRAND = 'Zellies';
// The 1pk title the UI is showing, minus the trailing condition word: this is
// exactly what _packState.baseTitle holds.
const BASE  = 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum';
const UNIT  = 100;

console.log('═'.repeat(78));
console.log('BULK SPLIT TRACE — UPC ' + UPC + ' (Zellies Dental Gum Spearmint)');
console.log('═'.repeat(78));
console.log(`base title  : "${BASE}"`);
console.log(`base length : ${BASE.length} chars`);
console.log(`unit count  : ${UNIT} pieces`);
console.log(`observed UI : title = "${BASE} New"   SKU = ZEL-${UPC}-1pk\n`);

function makeCur(extra) {
  return Object.assign({
    upc: UPC,
    title: BASE,
    prod: { title: BASE },
    brand: BRAND,
    category: '180959',
    _canonicalProductName: null,
    _canonicalSpecifics: { Count: '100' },
    _canonicalSpecificsLocked: true,
    _specifics: { Count: '100' },
    _titleManual: false,
    _selectedPack: 1,
    _expDate: ''
  }, extra || {});
}

// ── Q1: does anything in the split UI touch the main pack preview? ──────────
console.log('─'.repeat(78));
console.log('Q1 — is Bulk Split independent of the main pack preview?');
console.log('─'.repeat(78));

const appSrc = fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
function bodyOf(name) {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let j = i; j < appSrc.length; j++) {
    if (appSrc[j] === '{') { depth++; started = true; }
    else if (appSrc[j] === '}') { depth--; if (started && depth === 0) return appSrc.slice(i, j + 1); }
  }
  return '';
}
['toggleSplitPack', 'updateSplitCalc', 'computeSplit'].forEach(fn => {
  const b = bodyOf(fn);
  const callsPick = /\bpickPack\s*\(/.test(b);
  const callsRebuild = /\brebuildAndApplyTitle\s*\(/.test(b);
  const touchesSel = /_selectedPack\s*=/.test(b);
  console.log(`  ${fn}()`);
  console.log(`      calls pickPack()            : ${callsPick ? 'YES' : 'no'}`);
  console.log(`      calls rebuildAndApplyTitle(): ${callsRebuild ? 'YES' : 'no'}`);
  console.log(`      assigns cur._selectedPack   : ${touchesSel ? 'YES' : 'no'}`);
});
console.log('\n  => the split allocation never drives the main preview.');
console.log('     A main title/SKU frozen at 1pk is therefore EXPECTED.\n');

// ── Q2: what does the split path actually generate per pack? ────────────────
console.log('─'.repeat(78));
console.log('Q2 — titles the split path builds, per pack (the CSV rows)');
console.log('─'.repeat(78));
console.log('addSplitPacksToCSV() calls rebuildTitle(baseTitle, p, shade, expDate)');
console.log('once per active pack, independent of the main preview.\n');

[1, 2, 3, 6, 12].forEach(p => {
  setCur(makeCur());
  sandbox.window._packState = {
    baseTitle: BASE, curPack: 1, shade: '', expDate: '',
    baseUPC: UPC, baseBrand: BRAND, ebayBase: 10, discount: 0.95, els: {}
  };
  const c = getCur();
  const unit = sandbox.psGetCanonicalUnitCount(c);
  const total = sandbox.psGetPackTotalCount(c, p);
  const segs = sandbox.psBuildCountSegments(c, p, BASE);
  const title = sandbox.rebuildTitle(BASE, p, '', '');
  const sku = sandbox.makeSKU ? sandbox.makeSKU(BRAND, UPC, p, BASE) : '(makeSKU n/a)';

  const wantTotal = p >= 2 ? `${UNIT * p} Total` : null;
  const hasTotal = wantTotal ? title.includes(wantTotal) : true;

  console.log(`  Pack ${String(p).padStart(2)}`);
  console.log(`      unitCount     : ${unit}`);
  console.log(`      totalCount    : ${total}`);
  console.log(`      segments      : ${JSON.stringify(segs.map(s => s.text))}`);
  console.log(`      title         : "${title}"`);
  console.log(`      length        : ${title.length}${title.length > 80 ? '  ⚠ OVER 80' : ''}`);
  console.log(`      has "${wantTotal || '(n/a at 1pk)'}" : ${hasTotal ? 'YES' : 'NO  ← LOST'}`);
  console.log(`      SKU           : ${sku}`);
  console.log('');
});

// ── Q3: when the title exceeds 80, what does the fitter drop? ───────────────
console.log('─'.repeat(78));
console.log('Q3 — the 80-char drop loop: what gets sacrificed at Pack 3?');
console.log('─'.repeat(78));

{
  setCur(makeCur());
  const c = getCur();
  const segs = sandbox.psBuildCountSegments(c, 3, BASE);

  const spans = sandbox.parseIntoSpans(BASE);
  sandbox.annotateSpans(spans, BASE, c);

  console.log('  spans from the REAL base title:');
  spans.forEach(s => console.log(`      p=${String(s.priority).padEnd(4)} score=${String(s.semanticScore).padEnd(5)} ${s.role.padEnd(20)} "${s.value}"`));
  console.log(`\n  derived segments: ${JSON.stringify(segs.map(s => ({ text: s.text, p: s.dropPriority })))}`);

  const unfitted = spans.map(s => s.value).join(' ') + ' ' + segs.map(s => s.text).join(' ') + ' Pack of 3 New';
  console.log(`\n  unfitted length: ${unfitted.length} chars -> drop loop MUST run (> 80)`);

  const fitted = sandbox.psFitTitleWithCounts(BASE, segs, 3, '', '', c);
  console.log(`  psFitTitleWithCounts() -> "${fitted}"  (${fitted.length})`);
  console.log(`  kept "300 Total": ${fitted.includes('300 Total') ? 'YES' : 'NO'}`);
  console.log(`  kept brand "Zellies": ${fitted.includes('Zellies') ? 'YES' : 'NO'}`);

  // Which spans share a priority? Ties are where the inverted comparator bites.
  const byPriority = {};
  spans.forEach(s => { (byPriority[s.priority] = byPriority[s.priority] || []).push(s.value); });
  console.log('\n  priority groups (ties are where the inverted tie-break applies):');
  Object.keys(byPriority).sort().forEach(k => {
    const g = byPriority[k];
    console.log(`      p=${k}: ${g.length} span(s)${g.length > 1 ? '  ← TIE' : ''}  ${JSON.stringify(g)}`);
  });
}


// ── Q4: what would the minimum fix produce, and does it expose the tie-break?
console.log('─'.repeat(78));
console.log('Q4 — why A and B had to ship together (read-only comparison)');
console.log('─'.repeat(78));

// Faithful re-implementation of the buildTitleFromSpans drop loop so both
// tie-break directions can be compared without touching production.
function simulateFit(spans, segs, totalPriority, invertedTieBreak, n) {
  var active = spans.map(function(s, i){ return Object.assign({}, s, {originalIdx:i}); });
  segs.forEach(function(sg, k){
    active.push({ value: sg.text, priority: totalPriority, role:'DERIVED_COUNT',
                  semanticScore: 760, originalIdx: spans.length + k });
  });
  var suffix = ' Pack of ' + n + ' New';
  var out = active.map(function(s){return s.value;}).join(' ') + suffix;
  if (out.length <= 80) return out;
  while (active.length > 0) {
    active.sort(function(a,b){
      if (a.priority !== b.priority) return a.priority - b.priority;
      return invertedTieBreak
        ? (b.semanticScore||0) - (a.semanticScore||0)   // current app.js
        : (a.semanticScore||0) - (b.semanticScore||0);  // corrected
    });
    active.shift();
    active.sort(function(a,b){ return a.originalIdx - b.originalIdx; });
    out = active.map(function(s){return s.value;}).join(' ') + suffix;
    if (out.length <= 80) return out;
  }
  return suffix.trim();
}

{
  setCur(makeCur());
  const c = getCur();
  const segs = sandbox.psBuildCountSegments(c, 3, BASE);
  const spans = sandbox.parseIntoSpans(BASE);
  sandbox.annotateSpans(spans, BASE, c);

  const scenarios = [
    { label: 'HISTORICAL: total p=3.5, inverted tie-break (the bug)', pr: 3.5, inv: true },
    { label: 'fix A alone: total p=4.5, inverted tie-break (rejected)', pr: 4.5, inv: true },
    { label: 'fix A + B: total p=4.5, corrected tie-break (SHIPPING)', pr: 4.5, inv: false }
  ];

  scenarios.forEach(sc => {
    const t = simulateFit(spans, segs, sc.pr, sc.inv, 3);
    const keepsTotal = t.includes('300 Total');
    const keepsBrand = t.includes('Zellies');
    const keepsCore  = /Gum Spearmint/.test(t);
    console.log(`\n  ${sc.label}`);
    console.log(`      -> "${t}"  (${t.length})`);
    console.log(`      300 Total     : ${keepsTotal ? 'KEPT ✓' : 'DROPPED ✗'}`);
    console.log(`      brand Zellies : ${keepsBrand ? 'KEPT ✓' : 'DROPPED ✗'}`);
    console.log(`      "Gum Spearmint": ${keepsCore ? 'KEPT ✓' : 'DROPPED ✗'}`);
  });
}


console.log('\n' + '═'.repeat(78));

process.exit(0);
