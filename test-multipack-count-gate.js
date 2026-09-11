#!/usr/bin/env node

/**
 * MULTIPACK COUNT GATE — psRequireUnitCountForMultipack()
 *
 * A Pack >= 2 listing with no derived total is a commercial defect: the buyer
 * cannot tell whether 75 pieces or 3 arrive. UPC 732216300918 (Zicam) reached
 * export twice with no count anywhere — the title carries no digits, so
 * psDetectCount() never fired the prompt that would have captured it.
 *
 * This drives the REAL app.js gate with a scriptable prompt, and asserts:
 *   - pack 1 alone never prompts
 *   - any active pack >= 2 with an unknown count prompts exactly once
 *   - a known count (canonical / current / confirmed) never prompts
 *   - cancel and invalid input both abort the whole export
 *   - a valid answer flows into title, description and the derived total
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

// ── sandbox with a SCRIPTABLE prompt ───────────────────────────────────────
let promptCalls = [];
let promptQueue = [];

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
  alert(){}, confirm:()=>true,
  prompt: function (msg, def) {
    promptCalls.push(msg);
    return promptQueue.length ? promptQueue.shift() : null;
  },
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
catch(e) { console.log('bootstrap note: ' + e.message); }

const setCur = (o) => { sandbox.__f = o; vm.runInContext('cur = __f;', sandbox); return o; };
const getCur = () => vm.runInContext('cur', sandbox);

// Drive the export gate: set the split allocation, then call the real function.
function runGate(cur, activePacks, splitTotal, answers) {
  promptCalls = [];
  promptQueue = answers.slice();
  getEl('split-total-input').value = String(splitTotal);
  sandbox.window._splitActive = {};
  (activePacks || []).forEach(p => { sandbox.window._splitActive[p] = true; });
  sandbox.window._packState = {
    baseTitle: cur.title, curPack: cur._selectedPack || 1,
    shade: '', expDate: cur._expDate || '', els: {}
  };
  setCur(cur);
  const allowed = sandbox.psRequireUnitCountForMultipack(getCur());
  return { allowed, prompts: promptCalls.length, cur: getCur() };
}

const ZICAM_TITLE = 'Zicam Ultra Cold Remedy Zinc Rapidmelts, Orange Cream';
function zicamCur(extra) {
  return Object.assign({
    upc: '732216300918', title: ZICAM_TITLE, prod: { title: ZICAM_TITLE },
    brand: 'Zicam', category: '180959',
    _canonicalProductName: null,
    _canonicalSpecifics: {}, _canonicalSpecificsLocked: true,
    _specifics: {},                       // no count anywhere
    _titleManual: false, _selectedPack: 3, _expDate: 'Oct 2027'
  }, extra || {});
}
const ZELLIES_TITLE = 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum';
function zelliesCur() {
  return {
    upc: '851278001035', title: ZELLIES_TITLE, prod: { title: ZELLIES_TITLE },
    brand: 'Zellies', category: '180959',
    _canonicalSpecifics: { Count: '100' }, _canonicalSpecificsLocked: true,
    _specifics: { Count: '100' },
    _titleManual: false, _selectedPack: 3, _expDate: ''
  };
}

console.log('═'.repeat(78));
console.log('MULTIPACK COUNT GATE');
console.log('═'.repeat(78));

// ───────────────────────────────────────────────────────────────────────────
section('G1 — the gate exists and is wired into the export');
// ───────────────────────────────────────────────────────────────────────────
const appSrc = fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
['psRequireUnitCountForMultipack','psActivePacksForExport','psParseConfirmedCount'].forEach(fn => {
  checkTrue(`G1 ${fn}() defined`, typeof sandbox[fn] === 'function', typeof sandbox[fn]);
});
checkTrue('G1a called from _addBulkInternal',
  /!psRequireUnitCountForMultipack\(cur\)\) \{\s*\n\s*return;/.test(appSrc), 'call site not found');
const gateIdx = appSrc.indexOf('!psRequireUnitCountForMultipack(cur)');
const splitIdx = appSrc.indexOf('await addSplitPacksToCSV()');
checkTrue('G1b gate runs BEFORE the split export', gateIdx > 0 && gateIdx < splitIdx,
  `gate@${gateIdx} split@${splitIdx}`);

// ───────────────────────────────────────────────────────────────────────────
section('G2 — pack 1 alone: never prompts, never blocks');
// ───────────────────────────────────────────────────────────────────────────
{
  const r = runGate(zicamCur({ _selectedPack: 1 }), [1], 3, []);
  check('G2a export allowed', r.allowed, true);
  check('G2b no prompt shown', r.prompts, 0);
  check('G2c no count invented', r.cur._countConfirmed, undefined);
}

// ───────────────────────────────────────────────────────────────────────────
section('G3 — known count: never prompts (Zellies, canonical 100)');
// ───────────────────────────────────────────────────────────────────────────
{
  const r = runGate(zelliesCur(), [1,2,3], 9, []);
  check('G3a export allowed', r.allowed, true);
  check('G3b no prompt shown', r.prompts, 0);
  check('G3c canonical count untouched', sandbox.psGetCanonicalUnitCount(r.cur), 100);
}
// Known via CURRENT specifics only.
{
  const r = runGate(zicamCur({ _specifics: { Count: '25 Count' } }), [3], 3, []);
  check('G3d current-specifics count suppresses the prompt', r.prompts, 0);
  check('G3e allowed', r.allowed, true);
}
// Known via a previously confirmed count.
{
  const r = runGate(zicamCur({ _countConfirmed: 25, _countOK: true }), [3], 3, []);
  check('G3f previously confirmed count suppresses the prompt', r.prompts, 0);
}

// ───────────────────────────────────────────────────────────────────────────
section('G4 — unknown count + pack >= 2: prompts exactly once');
// ───────────────────────────────────────────────────────────────────────────
[2, 3, 6, 10, 12].forEach(p => {
  const r = runGate(zicamCur({ _selectedPack: p }), [p], 3, ['25']);
  check(`G4 pack ${p}: prompted once`, r.prompts, 1);
  check(`G4 pack ${p}: allowed after valid answer`, r.allowed, true);
  check(`G4 pack ${p}: _countConfirmed set`, r.cur._countConfirmed, 25);
});
// Mixed split 1+2+3 asks once, not three times.
{
  const r = runGate(zicamCur(), [1,2,3], 6, ['25']);
  check('G4x mixed split 1+2+3 prompts once', r.prompts, 1);
  check('G4y allowed', r.allowed, true);
}
// The prompt text is the approved one.
{
  promptCalls = []; promptQueue = ['25'];
  runGate(zicamCur(), [3], 3, ['25']);
}
{
  const r = runGate(zicamCur(), [3], 3, ['25']);
  checkTrue('G4z prompt asks for pieces per unit',
    /CUÁNTAS PIEZAS TRAE CADA UNIDAD/.test(promptCalls[0] || ''), promptCalls[0]);
  checkTrue('G4z2 prompt explains cancel', /Cancelar/.test(promptCalls[0] || ''), promptCalls[0]);
}

// ───────────────────────────────────────────────────────────────────────────
section('G5 — cancel blocks the whole export');
// ───────────────────────────────────────────────────────────────────────────
{
  const r = runGate(zicamCur(), [1,2,3], 6, [null]);
  check('G5a export refused', r.allowed, false);
  check('G5b prompted once', r.prompts, 1);
  check('G5c no count invented', r.cur._countConfirmed, undefined);
  check('G5d _countOK not set', r.cur._countOK, undefined);
}

// ───────────────────────────────────────────────────────────────────────────
section('G6 — invalid input blocks the export and invents nothing');
// ───────────────────────────────────────────────────────────────────────────
[['blank',''], ['zero','0'], ['negative','-5'], ['decimal','2.5'],
 ['decimal comma','2,5'], ['text','abc'], ['spaces','   '], ['too big','10000']]
 .forEach(([label, ans]) => {
  const r = runGate(zicamCur(), [3], 3, [ans]);
  check(`G6 ${label} ("${ans}"): refused`, r.allowed, false);
  check(`G6 ${label}: no count stored`, r.cur._countConfirmed, undefined);
});

// ───────────────────────────────────────────────────────────────────────────
section('G7 — psParseConfirmedCount() validation table');
// ───────────────────────────────────────────────────────────────────────────
[['25',25], ['60',60], ['100',100], ['240',240], ['9999',9999], ['1',1],
 ['25 piezas',25], ['  30  ',30],
 ['0',null], ['-5',null], ['2.5',null], ['2,5',null], ['abc',null],
 ['',null], ['   ',null], ['10000',null], [null,null], [undefined,null]]
 .forEach(([input, expected]) => {
  check(`G7 ${JSON.stringify(input)} -> ${expected}`, sandbox.psParseConfirmedCount(input), expected);
});

// ───────────────────────────────────────────────────────────────────────────
section('G8 — ZICAM end to end after confirming 25');
// ───────────────────────────────────────────────────────────────────────────
{
  const cur = zicamCur();
  const r = runGate(cur, [3], 3, ['25']);
  check('G8a allowed', r.allowed, true);
  check('G8b unitCount', sandbox.psGetCanonicalUnitCount(r.cur), 25);
  check('G8c totalCount', sandbox.psGetPackTotalCount(r.cur, 3), 75);

  sandbox.window._packState = { baseTitle: ZICAM_TITLE, curPack: 3, shade:'', expDate:'Oct 2027', els:{} };
  const title = sandbox.rebuildTitle(ZICAM_TITLE, 3, '', 'Oct 2027');
  console.log(`\n  title: "${title}"  (${title.length})`);
  checkTrue('G8d title has "75 Total"', title.includes('75 Total'), title);
  checkTrue('G8e title keeps "Zicam"', title.includes('Zicam'), title);
  checkTrue('G8f title keeps "Cold Remedy"', title.includes('Cold Remedy'), title);
  checkTrue('G8g title has "Exp 10/27"', title.includes('Exp 10/27'), title);
  checkTrue('G8h title has "Pack of 3"', title.includes('Pack of 3'), title);
  check('G8i exactly one New', sandbox.countStandaloneNewTokens(title), 1);
  checkTrue('G8j <= 80 chars', title.length <= 80, `${title.length}`);

  const d = sandbox.descForPack({ intro:'i', benefits:[], package_contents:'the product', disclaimer:'' }, 3, r.cur);
  console.log(`  desc : "${d.package_contents}"`);
  checkTrue('G8k desc "25 count each"', d.package_contents.includes('25 count each'), d.package_contents);
  checkTrue('G8l desc "75 total"', d.package_contents.includes('75 total'), d.package_contents);

  const sku = sandbox.makeSKU ? sandbox.makeSKU('Zicam', '732216300918', 3, ZICAM_TITLE) : '';
  console.log(`  SKU  : ${sku}`);
  checkTrue('G8m SKU ends -3pk', /-3pk$/.test(sku), sku);
}

// ───────────────────────────────────────────────────────────────────────────
section('G9 — pack-2..12 totals after a confirmed 25');
// ───────────────────────────────────────────────────────────────────────────
[[2,50],[3,75],[6,150],[10,250],[12,300]].forEach(([p, want]) => {
  const cur = zicamCur({ _selectedPack: p });
  runGate(cur, [p], 3, ['25']);
  setCur(cur);
  sandbox.window._packState = { baseTitle: ZICAM_TITLE, curPack: p, shade:'', expDate:'Oct 2027', els:{} };
  const t = sandbox.rebuildTitle(ZICAM_TITLE, p, '', 'Oct 2027');
  checkTrue(`G9 pack ${p}: "${want} Total"`, t.includes(`${want} Total`), t);
  checkTrue(`G9 pack ${p}: <= 80`, t.length <= 80, `${t.length}`);
});

console.log('\n' + '═'.repeat(78));
console.log('COUNT GATE SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
console.log('═'.repeat(78));

process.exit(failed ? 1 : 0);
