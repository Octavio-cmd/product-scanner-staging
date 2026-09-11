#!/usr/bin/env node

/**
 * COUNT-PROMPT FEEDBACK LOOP — UPC 732216300918
 *
 * Real browser: specifics showed "Count = 25 Count", yet the OLD confirmation
 * prompt proposed "50 unidades".
 *
 * "unidades" is the tag used by ONE branch of psDetectCount — branch (c), the
 * bare-number-in-a-health-category fallback. That is the thread this pulls.
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
try { vm.runInContext(appSrc, sandbox, {filename:'app.js'}); } catch(e) {}

const setCur = (o) => { sandbox.__f = o; vm.runInContext('cur = __f;', sandbox); return o; };
const getCur = () => vm.runInContext('cur', sandbox);

const UPC = '732216300918';
const HEALTH = '180959';
const BASE = 'Zicam Ultra Cold Remedy Zinc Rapidmelts, Orange Cream';

console.log('═'.repeat(78));
console.log('COUNT-PROMPT FEEDBACK LOOP — UPC ' + UPC);
console.log('═'.repeat(78));
console.log('observed: specifics "Count = 25 Count", prompt proposed "50 unidades"\n');

function zicam(pack, extra) {
  return Object.assign({
    upc: UPC, title: BASE, prod: { title: BASE }, brand: 'Zicam', category: HEALTH,
    _canonicalProductName: null,
    _canonicalSpecifics: {}, _canonicalSpecificsLocked: true,
    _specifics: { Count: '25 Count' },
    _titleManual: false, _selectedPack: pack, _expDate: 'Oct 2027'
  }, extra || {});
}

// ── STEP 1: build the title the way production does at Pack 2 ──────────────
console.log('─'.repeat(78));
console.log('STEP 1 — what _selectedTitle holds after selecting Pack 2');
console.log('─'.repeat(78));
const cur2 = setCur(zicam(2));
sandbox.window._packState = { baseTitle: BASE, curPack: 2, shade:'', expDate:'Oct 2027', els:{} };
const title2 = sandbox.rebuildTitle(BASE, 2, '', 'Oct 2027');
console.log(`  unitCount from specifics : ${sandbox.psGetCanonicalUnitCount(cur2)}`);
console.log(`  derived total (25 x 2)   : ${sandbox.psGetPackTotalCount(cur2, 2)}`);
console.log(`  _selectedTitle           : "${title2}"`);
console.log(`  ^ this is the string _addBulkInternal feeds to psDetectCount:`);
console.log(`    app.js: var _tituloActual = (cur && (cur._selectedTitle || cur.title)) || '';`);

// ── STEP 2: run the REAL psDetectCount on it ───────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 2 — psDetectCount() on that title');
console.log('─'.repeat(78));
const det2 = sandbox.psDetectCount(title2, HEALTH);
console.log(`  _det = ${JSON.stringify(det2)}`);
if (det2) {
  console.log(`\n  The old prompt renders:`);
  console.log(`      "El sistema propone:  ${det2.num} ${det2.unit}"`);
  console.log(`      prefilled input: ${det2.num}`);
  const matches = det2.num === 50 && det2.unit === 'unidades';
  console.log(`\n  ${matches ? '>>> EXACT MATCH with the real browser screenshot <<<' : '  (does not match the report)'}`);
}

console.log('\n  Why branch (c) fires:');
console.log('    psDetectCount strips "pack of N" first  -> the 2 is removed');
console.log('    branch (a) needs a count UNIT next to the number ("25 Count")');
console.log('    branch (b) needs a unit within two words');
console.log('    branch (c) (health categories only) strips doses/dates/"exp"');
console.log('               and takes the FIRST bare 2-4 digit number, 10..1000');
console.log('    "50 Total" -> "Total" is NOT a count unit, so (a)/(b) miss and');
console.log('    (c) grabs the bare 50 and labels it "unidades".');

// ── STEP 3: the damage if an operator accepts the proposal ─────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 3 — damage if the operator just presses OK on 50');
console.log('─'.repeat(78));
{
  const cur = setCur(zicam(3, { _countConfirmed: 50, _countOK: true }));
  sandbox.window._packState = { baseTitle: BASE, curPack: 3, shade:'', expDate:'Oct 2027', els:{} };
  const t = sandbox.rebuildTitle(BASE, 3, '', 'Oct 2027');
  const d = sandbox.descForPack({ intro:'i', benefits:[], package_contents:'the product', disclaimer:'' }, 3, cur);
  console.log(`  _countConfirmed = 50 (top authority, beats the real 25)`);
  console.log(`  unitCount  -> ${sandbox.psGetCanonicalUnitCount(cur)}`);
  console.log(`  pack 3     -> ${sandbox.psGetPackTotalCount(cur, 3)}   (truth: 75)`);
  console.log(`  title      -> "${t}"`);
  console.log(`  desc       -> "${d.package_contents}"`);
  console.log(`  C:Size still exports "25 Count" from _specifics -> the CSV row`);
  console.log(`  contradicts itself: 25 per unit, 150 total, pack of 3.`);
}

// ── STEP 4: does it amplify across rounds? ─────────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 4 — does the error compound if accepted repeatedly?');
console.log('─'.repeat(78));
{
  let confirmed = null;
  for (let round = 1; round <= 3; round++) {
    const cur = setCur(zicam(2, confirmed ? { _countConfirmed: confirmed, _countOK: true } : {}));
    sandbox.window._packState = { baseTitle: BASE, curPack: 2, shade:'', expDate:'Oct 2027', els:{} };
    const t = sandbox.rebuildTitle(BASE, 2, '', 'Oct 2027');
    const d = sandbox.psDetectCount(t, HEALTH);
    console.log(`  round ${round}: confirmed=${confirmed === null ? '(none)' : confirmed}  title="${t}"`);
    console.log(`           psDetectCount proposes -> ${d ? d.num + ' ' + d.unit : 'null'}`);
    if (!d) break;
    confirmed = d.num;   // operator presses OK
  }
  console.log('\n  Each accepted proposal doubles the stored per-unit count, which');
  console.log('  doubles the total written into the next title, which the prompt');
  console.log('  then proposes again. It is a closed loop, not a one-off slip.');
}

// ── STEP 5: was the new gate ever reached? ─────────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 5 — is the NEW unknown-count gate involved at all?');
console.log('─'.repeat(78));
const oldIdx = appSrc.indexOf('CONFIRMA LA CANTIDAD');
const newIdx = appSrc.indexOf('!psRequireUnitCountForMultipack(cur)');
console.log(`  old prompt at index ${oldIdx}, new gate at index ${newIdx}`);
console.log(`  old prompt runs FIRST: ${oldIdx < newIdx}`);
{
  const cur = setCur(zicam(3));
  console.log(`  psGetCanonicalUnitCount (specifics 25 Count) = ${sandbox.psGetCanonicalUnitCount(cur)}`);
  console.log('  The new gate only prompts when that returns null. Here it returns 25,');
  console.log('  so the gate correctly stays silent — it was NOT reached and is NOT');
  console.log('  the source of the 50. The gate is working as designed.');
}

// ── STEP 6: candidate fixes, measured ──────────────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('STEP 6 — candidate fixes (simulated, nothing modified)');
console.log('─'.repeat(78));

// FIX 1: strip derived segments before detection, exactly as "pack of N" is.
function stripDerived(t) {
  return String(t || '')
    .replace(/\s*\b\d+\s*(?:ct|count)?\s*Total\b/gi, ' ')
    .replace(/\s*\b\d+\s*(?:ct|count)?\s*(?:Ea|Each)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}
console.log('\n  FIX 1 — strip "N Total" / "N Each" before psDetectCount:');
[2, 3].forEach(p => {
  const cur = setCur(zicam(p));
  sandbox.window._packState = { baseTitle: BASE, curPack: p, shade:'', expDate:'Oct 2027', els:{} };
  const t = sandbox.rebuildTitle(BASE, p, '', 'Oct 2027');
  const before = sandbox.psDetectCount(t, HEALTH);
  const after = sandbox.psDetectCount(stripDerived(t), HEALTH);
  console.log(`      pack ${p}: "${t}"`);
  console.log(`          before -> ${JSON.stringify(before)}`);
  console.log(`          after  -> ${JSON.stringify(after)}`);
});

// FIX 2: propose the canonical per-unit count when one exists.
console.log('\n  FIX 2 — propose psGetCanonicalUnitCount() when available:');
{
  const cur = setCur(zicam(2));
  sandbox.window._packState = { baseTitle: BASE, curPack: 2, shade:'', expDate:'Oct 2027', els:{} };
  const t = sandbox.rebuildTitle(BASE, 2, '', 'Oct 2027');
  const det = sandbox.psDetectCount(t, HEALTH);
  const perUnit = sandbox.psGetCanonicalUnitCount(cur);
  console.log(`      title detect proposes : ${det ? det.num : null}`);
  console.log(`      per-unit fact         : ${perUnit}`);
  console.log(`      proposal with FIX 2   : ${perUnit || (det && det.num) || '(none)'}   <- 25, the truth`);
}

// Regression check: a genuine source count must still be proposed.
console.log('\n  Regression — a real source count must survive both fixes:');
[['Zicam con 25 Count de la fuente', 'Zicam Ultra Cold Remedy Zinc Rapidmelts 25 Count Pack of 2 New'],
 ['Zellies base con 100 Pieces', 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum Pack of 2 New']]
 .forEach(([label, t]) => {
  const d = sandbox.psDetectCount(stripDerived(t), HEALTH);
  console.log(`      ${label}: ${JSON.stringify(d)}`);
});


// ═══════════════════════════════════════════════════════════════════════════
// ASSERTIONS — the fix, verified against the real functions
// ═══════════════════════════════════════════════════════════════════════════
let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else { failed++; failures.push({ name, actual, expected }); }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}
function checkTrue(name, cond, detail) {
  if (cond) passed++; else { failed++; failures.push({ name, actual: detail, expected: true }); }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n      detail: ${detail}`}`);
}
function sect(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

// The proposal the old prompt would show, mirroring app.js exactly.
function promptProposal(cur, title, category) {
  const det = sandbox.psDetectCount(title, category);
  if (!det) return { fires: false, proposal: null, det: null };
  const perUnit = sandbox.psGetCanonicalUnitCount(cur);
  return { fires: true, proposal: perUnit || det.num, det: det, fromPerUnit: !!perUnit };
}

sect('F1 — derived Total / Each are stripped before detection');
[[2,50],[3,75],[6,150],[12,300]].forEach(([p, tot]) => {
  const t = `Zicam Ultra Cold Remedy Zinc Rapidmelts, ${tot} Total Exp 10/27 Pack of ${p} New`;
  check(`F1 pack ${p} "${tot} Total" not read as a count`, sandbox.psDetectCount(t, HEALTH), null);
});
check('F1e "25 Ea" not a count',
  sandbox.psDetectCount('Product 25 Ea Pack of 2 New', HEALTH), null);
check('F1f "100 Each" not a count',
  sandbox.psDetectCount('Product 100 Each Pack of 3 New', HEALTH), null);
check('F1g "50 ct Total" not a count',
  sandbox.psDetectCount('Product 50 ct Total Pack of 2 New', HEALTH), null);
check('F1h "50 Count Total" not a count',
  sandbox.psDetectCount('Product 50 Count Total Pack of 2 New', HEALTH), null);
check('F1i lowercase "75 total" not a count',
  sandbox.psDetectCount('Product 75 total Pack of 3 New', HEALTH), null);

sect('F2 — legitimate source counts still detected');
[['25 Count', 'Zicam Rapidmelts 25 Count Pack of 2 New', 25],
 ['100 Pieces', 'Zellies Gum 100 Pieces 4.76oz Pack of 2 New', 100],
 ['120ct', 'CoQ10 Ubiquinol 120ct Pack of 2 New', 120],
 ['30 Saline Packets', 'NeilMed Sinus Rinse 30 Saline Packets Pack of 2 New', 30],
 ['60 Tablets', 'Airborne Immune 60 Tablets Pack of 3 New', 60],
 ['240 Pellets', 'Boiron Arnicare 240 Pellets Pack of 3 New', 240]]
 .forEach(([label, t, want]) => {
  const d = sandbox.psDetectCount(t, HEALTH);
  check(`F2 ${label} still detected`, d && d.num, want);
});

sect('F3 — a trusted per-unit fact outranks the detected title number');
{
  // Source title says 120, specifics say the real per-unit count is 60.
  const cur = { title: 'CoQ10 120ct', prod: { title: 'CoQ10 120ct' },
                _canonicalSpecifics: { Count: '60' }, _specifics: { Count: '60' } };
  const r = promptProposal(cur, 'CoQ10 Ubiquinol 120ct Pack of 2 New', HEALTH);
  check('F3a prompt fires (real source count present)', r.fires, true);
  check('F3b detected number is 120', r.det.num, 120);
  check('F3c proposal uses the per-unit fact 60', r.proposal, 60);
  check('F3d proposal flagged as per-unit', r.fromPerUnit, true);
}

sect('F4 — ZICAM: never proposes 50');
{
  const cur = setCur(zicam(2));
  sandbox.window._packState = { baseTitle: BASE, curPack: 2, shade:'', expDate:'Oct 2027', els:{} };
  const t = sandbox.rebuildTitle(BASE, 2, '', 'Oct 2027');
  const r = promptProposal(cur, t, HEALTH);
  console.log(`  title    : "${t}"`);
  console.log(`  fires    : ${r.fires}`);
  console.log(`  proposal : ${r.proposal}`);
  checkTrue('F4a proposal is never 50', r.proposal !== 50, String(r.proposal));
  check('F4b unit count still resolves to 25', sandbox.psGetCanonicalUnitCount(cur), 25);
  // With the derived total stripped there is nothing left to confirm, so the
  // old prompt does not fire at all for this product. That is the correct
  // outcome, and matches how it behaved before totals entered titles.
  check('F4c old prompt does not fire (no source count in title)', r.fires, false);
}

sect('F5 — no amplification across three rounds');
{
  let confirmed = null;
  const seen = [];
  for (let round = 1; round <= 3; round++) {
    const cur = setCur(zicam(2, confirmed ? { _countConfirmed: confirmed, _countOK: true } : {}));
    sandbox.window._packState = { baseTitle: BASE, curPack: 2, shade:'', expDate:'Oct 2027', els:{} };
    const t = sandbox.rebuildTitle(BASE, 2, '', 'Oct 2027');
    const r = promptProposal(cur, t, HEALTH);
    const unit = sandbox.psGetCanonicalUnitCount(cur);
    seen.push(unit);
    console.log(`  round ${round}: unitCount=${unit}  title="${t}"  promptFires=${r.fires}`);
    confirmed = r.fires ? r.proposal : confirmed;
  }
  check('F5a unit count stays 25 every round', seen, [25, 25, 25]);
  checkTrue('F5b never reaches 50/100/200', !seen.some(v => [50,100,200].includes(v)), JSON.stringify(seen));
}

sect('F6 — accepting the truth: Zicam pack 3');
{
  const cur = setCur(zicam(3, { _countConfirmed: 25, _countOK: true }));
  sandbox.window._packState = { baseTitle: BASE, curPack: 3, shade:'', expDate:'Oct 2027', els:{} };
  const t = sandbox.rebuildTitle(BASE, 3, '', 'Oct 2027');
  const d = sandbox.descForPack({ intro:'i', benefits:[], package_contents:'the product', disclaimer:'' }, 3, cur);
  const csize = ['Size','Count','Unit Quantity'].map(k => cur._specifics[k]).filter(Boolean)[0] || '';
  console.log(`  title : "${t}"`);
  console.log(`  desc  : "${d.package_contents}"`);
  console.log(`  C:Size: "${csize}"`);
  check('F6a total is 75', sandbox.psGetPackTotalCount(cur, 3), 75);
  checkTrue('F6b title has "75 Total"', t.includes('75 Total'), t);
  checkTrue('F6c title has no "150 Total"', !t.includes('150 Total'), t);
  checkTrue('F6d desc "25 count each"', d.package_contents.includes('25 count each'), d.package_contents);
  checkTrue('F6e desc "75 total"', d.package_contents.includes('75 total'), d.package_contents);
  check('F6f C:Size stays per-unit', csize, '25 Count');
  checkTrue('F6g row is self-consistent (25 per unit x 3 = 75)',
    csize.startsWith('25') && t.includes('75 Total') && t.includes('Pack of 3'), t);
}

sect('F7 — ZELLIES unchanged');
{
  const ZB = 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum';
  const cur = setCur({ upc:'851278001035', title: ZB, prod:{title:ZB}, brand:'Zellies',
    category: HEALTH, _canonicalSpecifics:{ Count:'100' }, _canonicalSpecificsLocked:true,
    _specifics:{ Count:'100' }, _titleManual:false, _selectedPack:3, _expDate:'' });
  const r = promptProposal(cur, ZB + ' Pack of 2 New', HEALTH);
  check('F7a proposal is 100', r.proposal, 100);
  check('F7b unit count 100', sandbox.psGetCanonicalUnitCount(cur), 100);
  sandbox.window._packState = { baseTitle: ZB, curPack: 3, shade:'', expDate:'', els:{} };
  const t = sandbox.rebuildTitle(ZB, 3, '', '');
  checkTrue('F7c pack 3 has "300 Total"', t.includes('300 Total'), t);
  checkTrue('F7d keeps brand', t.includes('Zellies Dental'), t);
  checkTrue('F7e <= 80', t.length <= 80, String(t.length));
}

sect('F8 — unknown-count gate still behaves as designed');
{
  getEl('split-total-input').value = '3';
  sandbox.window._splitActive = { 3: true };
  // known count -> silent
  const known = setCur(zicam(3));
  sandbox.window._packState = { baseTitle: BASE, curPack: 3, shade:'', expDate:'Oct 2027', els:{} };
  let asked = 0;
  const realPrompt = sandbox.prompt;
  sandbox.prompt = function(){ asked++; return '25'; };
  const okKnown = sandbox.psRequireUnitCountForMultipack(known);
  check('F8a known count: gate allows', okKnown, true);
  check('F8b known count: no prompt', asked, 0);

  // unknown count -> asks
  asked = 0;
  const unknown = setCur(zicam(3, { _specifics: {} }));
  const okUnknown = sandbox.psRequireUnitCountForMultipack(unknown);
  check('F8c unknown count: gate prompts once', asked, 1);
  check('F8d unknown count: allowed after valid answer', okUnknown, true);
  check('F8e stores the confirmed count', unknown._countConfirmed, 25);

  // cancel -> refuses
  asked = 0;
  sandbox.prompt = function(){ asked++; return null; };
  const cancelled = setCur(zicam(3, { _specifics: {} }));
  check('F8f cancel refuses export', sandbox.psRequireUnitCountForMultipack(cancelled), false);
  sandbox.prompt = realPrompt;
}

console.log('\n' + '═'.repeat(78));
console.log('FEEDBACK-LOOP SUITE SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
console.log('═'.repeat(78));
process.exit(failed ? 1 : 0);

