#!/usr/bin/env node

/**
 * ZICAM COUNT LIFECYCLE — UPC 732216300918
 *
 * Second real export, AFTER the fallback fix:
 *   Title  : "Zicam Ultra Cold Remedy Zinc Rapidmelts, Orange Cream Exp 10/27 Pack of 3 New"
 *   C:Size : EMPTY
 *   no "75 Total", description carries no counts
 *
 * The first export of the SAME UPC had C:Size "25 Count". Same product, two
 * different outcomes — so this traces WHERE a per-unit count can be lost
 * between sessions, using the real production functions.
 *
 * Diagnostic only. No production code is modified.
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

const appSrc = fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
vm.runInContext(fs.readFileSync(path.join(__dirname,'multipack-fixes.js'),'utf8'), sandbox, {filename:'multipack-fixes.js'});
try { vm.runInContext(appSrc, sandbox, {filename:'app.js'}); } catch(e) { console.log('bootstrap note: ' + e.message); }

const setCur = (o) => { sandbox.__f = o; vm.runInContext('cur = __f;', sandbox); return o; };
const getCur = () => vm.runInContext('cur', sandbox);

// ── REAL DATA ──────────────────────────────────────────────────────────────
const UPC = '732216300918';
const HEALTH_CAT = '180959';
// Session 1 title (no comma) vs session 2 title (comma) — both from the browser.
const TITLE_S1 = 'Zicam Ultra Cold Remedy Zinc Rapidmelts Orange Cream';
const TITLE_S2 = 'Zicam Ultra Cold Remedy Zinc Rapidmelts, Orange Cream';

console.log('═'.repeat(78));
console.log('ZICAM COUNT LIFECYCLE — UPC ' + UPC);
console.log('═'.repeat(78));
console.log(`session 1 title : "${TITLE_S1}"`);
console.log(`session 2 title : "${TITLE_S2}"   <- note the comma: the base title itself differs`);
console.log(`session 1 CSV   : C:Size "25 Count", no total in title`);
console.log(`session 2 CSV   : C:Size EMPTY,      no total in title\n`);

// ── Q2/Q3: does the title carry a count at all? ────────────────────────────
console.log('─'.repeat(78));
console.log('Q2/Q3 — does the physical title contain a count? psDetectCount()');
console.log('─'.repeat(78));
[TITLE_S1, TITLE_S2].forEach((t, i) => {
  const digits = (t.match(/\d/g) || []).length;
  const det = sandbox.psDetectCount(t, HEALTH_CAT);
  console.log(`  session ${i+1}: digits=${digits}  psDetectCount -> ${JSON.stringify(det)}`);
});
console.log('\n  PS_COUNT_UNITS covers ct/count/tablets/... ; branch (c) needs a bare');
console.log('  2-4 digit number in a health category. Neither title has ANY digit,');
console.log('  so all three branches fail and the function returns null.');

// ── Q4: would the count-confirmation prompt ever fire? ─────────────────────
console.log('\n' + '─'.repeat(78));
console.log('Q4 — does the count-confirmation prompt fire?');
console.log('─'.repeat(78));
console.log('  app.js:5565  var _det = psDetectCount(_tituloActual, cur.category);');
console.log('  app.js:5566  if (_det && cur && !cur._countOK) { prompt(...) }');
console.log(`  _det is ${JSON.stringify(sandbox.psDetectCount(TITLE_S2, HEALTH_CAT))} -> the prompt is GATED OFF.`);
console.log('  So _countConfirmed is never set for this product, in ANY session.');
console.log('  The one UI that could capture the count only appears when the title');
console.log('  ALREADY contains one — exactly the case where it is least needed.');

// ── The measure prompt: the one path that DELETES a count ──────────────────
console.log('\n' + '─'.repeat(78));
console.log('Q6 — the measure-confirmation prompt can DELETE the value (app.js:5537)');
console.log('─'.repeat(78));
console.log('  for campo of [Volume, Size]:');
console.log('      v   = cur._specifics[campo]');
console.log('      num = v stripped to digits');
console.log('      if (!num || title.indexOf(num) !== -1) return;   // in title -> skip');
console.log('      r = prompt("CONFIRMA LA MEDIDA (" + campo + ")", v)');
console.log('      if (r === "")  delete cur._specifics[campo];     // <- BLANK ANSWER DELETES');
console.log('');
console.log('  Zicam has no digits in the title, so "25" is never found there and the');
console.log('  prompt ALWAYS fires for a numeric Size. An operator who leaves it blank');
console.log('  (the box does not print a count) deletes the only copy of the count.');
console.log('  It runs at app.js:5537, BEFORE addSplitPacksToCSV() at :5640.');

function simulateMeasurePrompt(specs, title, answer) {
  // Faithful model of app.js:5537-5560 for one field.
  const out = Object.assign({}, specs);
  ['Volume', 'Size'].forEach(campo => {
    const v = String(out[campo] || '').trim();
    if (!v || !/\d/.test(v)) return;
    const num = v.replace(/[^0-9.]/g, '');
    if (!num || String(title).indexOf(num) !== -1) return;  // verifiable, no prompt
    if (answer === null) return;                             // cancelled
    const lim = String(answer).trim();
    if (lim) out[campo] = lim; else delete out[campo];
  });
  return out;
}

console.log('\n  simulated, Size = "25 Count", title without digits:');
[['operator types 25 Count','25 Count'], ['operator types 25','25'], ['operator leaves it BLANK','']]
  .forEach(([label, ans]) => {
    const after = simulateMeasurePrompt({ Size: '25 Count' }, TITLE_S2, ans);
    console.log(`      ${label.padEnd(28)} -> _specifics = ${JSON.stringify(after)}`);
  });

// ── Full chain for each plausible session state ────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('STATE MATRIX — what each session state yields end to end');
console.log('─'.repeat(78));

const STATES = [
  { id: 'S1', label: 'session 1: Size "25 Count" survived',
    canon: {}, spec: { Size: '25 Count' } },
  { id: 'S2a', label: 'session 2: Size deleted by blank measure prompt',
    canon: {}, spec: {} },
  { id: 'S2b', label: 'session 2: AI never returned any count field',
    canon: {}, spec: { 'Item Form': 'Tablet', Flavor: 'Orange Cream' } },
  { id: 'S2c', label: 'session 2: specifics generation failed -> {}',
    canon: {}, spec: {} },
  { id: 'S3', label: 'hypothetical: operator confirmed count (25)',
    canon: {}, spec: {}, countConfirmed: 25 }
];

STATES.forEach(s => {
  const cur = {
    upc: UPC, title: TITLE_S2, prod: { title: TITLE_S2 }, brand: 'Zicam',
    category: HEALTH_CAT,
    _canonicalProductName: null,
    _canonicalSpecifics: Object.assign({}, s.canon),
    _canonicalSpecificsLocked: true,
    _specifics: Object.assign({}, s.spec),
    _titleManual: false, _selectedPack: 1, _expDate: 'Oct 2027'
  };
  if (s.countConfirmed) cur._countConfirmed = s.countConfirmed;
  setCur(cur);
  sandbox.window._packState = { baseTitle: TITLE_S2, curPack: 3, shade:'', expDate:'Oct 2027', els:{} };

  const unit = sandbox.psGetCanonicalUnitCount(cur);
  const total = sandbox.psGetPackTotalCount(cur, 3);
  const title = sandbox.rebuildTitle(TITLE_S2, 3, '', 'Oct 2027');
  const desc = sandbox.descForPack({ intro:'i', benefits:[], package_contents:'the product', disclaimer:'' }, 3, cur);
  // C:Size as the CSV would compute it (SPEC_COL_MAP: Size/Count/Unit Quantity)
  const csize = ['Size','Count','Unit Quantity'].map(k => cur._specifics[k]).filter(Boolean)[0] || '';

  console.log(`\n  ${s.id} ${s.label}`);
  console.log(`      _specifics            = ${JSON.stringify(cur._specifics)}`);
  console.log(`      _countConfirmed       = ${cur._countConfirmed}`);
  console.log(`      psGetCanonicalUnitCount = ${unit}`);
  console.log(`      psGetPackTotalCount(3)  = ${total}`);
  console.log(`      C:Size exported       = "${csize}"`);
  console.log(`      title                 = "${title}"`);
  console.log(`      desc has counts       = ${/count each|total/.test(desc.package_contents) ? 'YES' : 'NO'}`);
});

// ── Q8: ordering / timing ──────────────────────────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('Q8 — is there a timing problem in the split export?');
console.log('─'.repeat(78));
function bodyOf(name) {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < appSrc.length; j++) {
    if (appSrc[j] === '{') { d++; started = true; }
    else if (appSrc[j] === '}') { d--; if (started && d === 0) return appSrc.slice(i, j + 1); }
  }
  return '';
}
const splitBody = bodyOf('addSplitPacksToCSV');
console.log(`  waits for cur._description        : ${/while \(cur && !cur\._description/.test(splitBody) ? 'YES' : 'no'}`);
console.log(`  waits for cur._specifics !== undefined : ${/while \(cur && cur\._specifics === undefined/.test(splitBody) ? 'YES' : 'no'}`);
console.log('');
console.log('  The guard tests for `undefined`, not for "has a count". Once');
console.log('  psGenerateSpecifics assigns cur._specifics = clean — even an object');
console.log('  with no count field — the wait releases immediately. An empty-but-');
console.log('  defined specifics object is indistinguishable from a complete one.');

// ── Is the existing confirmation UI reusable? ──────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('REUSE — can the existing count-confirmation UI capture a missing count?');
console.log('─'.repeat(78));
const bulkBody = appSrc.slice(appSrc.indexOf('async function _addBulkInternal'), appSrc.indexOf('async function _doAddBulk'));
console.log(`  count prompt exists            : ${/CONFIRMA LA CANTIDAD/.test(bulkBody) ? 'YES' : 'no'}`);
console.log(`  gated behind psDetectCount()   : ${/_det && cur && !cur\._countOK/.test(bulkBody) ? 'YES' : 'no'}`);
console.log(`  writes cur._countConfirmed     : ${/cur\._countConfirmed = _n/.test(bulkBody) ? 'YES' : 'no'}`);
console.log(`  validates 1..N                 : ${/!_n \|\| _n < 1/.test(bulkBody) ? 'YES' : 'no'}`);
console.log(`  cancel aborts the export       : ${/if \(_resp === null\) return;/.test(bulkBody) ? 'YES' : 'no'}`);
console.log('');
console.log('  Everything needed already exists — prompt text, integer validation,');
console.log('  cancel-aborts-export, and it writes _countConfirmed, which is the');
console.log('  TOP authority in psGetCanonicalUnitCount(). Only its gate is wrong for');
console.log('  this case: it fires when a count was DETECTED, never when one is');
console.log('  MISSING and a pack >= 2 is about to be exported.');

console.log('\n' + '═'.repeat(78));

process.exit(0);
