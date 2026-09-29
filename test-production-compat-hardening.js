#!/usr/bin/env node
/**
 * PRODUCTION-COMPATIBILITY HARDENING (Employee STAGING, pre-Production catch-up)
 *
 * Compatibility items in app.js, each checked against Product Scanner
 * Production de8ce51 behaviour:
 *   2. Clothing Sheets URL: savvy-config /config is read at startup and ONLY
 *      its https sheets_url is stored in cl_sheets_url (Production contract).
 *   3. rembg warm-up: one fire-and-forget GET /health on startup.
 *   4. The staging-only 🧪 badge / staging Home link block is gone from app.js;
 *      Employee STAGING still identifies itself through index.html.
 * Item 1 (ImgBB fallback) was deliberately NOT ported: Production's fallback
 * uses a hard-coded ImgBB key. These tests pin the approved behaviour instead:
 * authenticated /api/img-upload only, no ImgBB call on success or failure.
 *
 * Harness: real multipack-fixes.js + real app.js in a FRESH vm sandbox per
 * scenario (the startup code runs at load); only fetch() is mocked.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const cp = require('child_process');

let passed = 0, failed = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else { failed++; failures.push(name); }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}
function checkTrue(name, cond, detail) {
  if (cond) passed++; else { failed++; failures.push(name); }
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n      detail: ${detail}`}`);
}
function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

const APP = process.env.PSCOMPAT_APP || path.join(__dirname, 'app.js');
const appSrc = fs.readFileSync(APP, 'utf8');
const fixesSrc = fs.readFileSync(path.join(__dirname, 'multipack-fixes.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const CONFIG_URL = 'https://savvy-config-production.up.railway.app/config';
const HEALTH_URL = 'https://savvy-rembg-production.up.railway.app/health';
const REMOVE_BG_URL = 'https://savvy-rembg-production.up.railway.app/remove-bg';
const SECRETLIKE = 'CFG-SECRET-SHOULD-NOT-BE-STORED';

function jsonRes(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) }; }

// Fresh sandbox; `route(url, opts)` answers every fetch. Returns helpers.
function boot(route, opts) {
  opts = opts || {};
  const calls = [], logs = [];
  const els = {};
  function makeEl(id) {
    const el = { id, textContent: '', innerHTML: '', value: '', dataset: {}, style: {}, children: [],
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      appendChild(c) { el.children.push(c); }, removeChild() {}, remove() {}, scrollIntoView() {}, focus() {}, blur() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {}, getAttribute() { return null; },
      insertAdjacentHTML() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
    return el;
  }
  const getEl = id => (els[id] = els[id] || makeEl(id));
  const docL = {}, winL = {};
  const body = makeEl('body');
  const store = { _d: Object.assign({}, opts.storage || {}), getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }, clear() { this._d = {}; }, key() { return null; }, length: 0 };
  const quiet = (...a) => logs.push(a.map(String).join(' '));
  const sb = {
    console: { log: quiet, error: quiet, warn: quiet, info: quiet, debug: quiet },
    document: { body, head: makeEl('head'), documentElement: makeEl('html'), getElementById: getEl, querySelector: () => null,
      querySelectorAll: () => [], createElement: t => makeEl(t), createTextNode: () => ({}), cookie: '',
      addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, removeEventListener() {} },
    localStorage: store, sessionStorage: store,
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} }, mediaDevices: {} },
    location: { href: 'http://localhost/', search: '', hash: '', protocol: 'http:', reload() {} },
    fetch: (url, o) => { calls.push({ url: String(url), method: (o && o.method) || 'GET', body: o && o.body, auth: o && o.headers && o.headers.get ? o.headers.get('Authorization') : null }); try { const v = route(String(url), o); return Promise.resolve(v); } catch (e) { if (e && e.sync) throw e; return Promise.reject(e); } },
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: f => setTimeout(f, 0),
    alert() {}, confirm: () => true, prompt: () => null,
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); }, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), scrollTo() {}, open() { return null; }, close() {},
    Image: function () { return {}; }, FileReader: function () { return {}; }, XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {} }; },
    URL, URLSearchParams, Blob: function () {}, FormData: function () { this.append = () => {}; }, Headers, AbortController, TextEncoder, TextDecoder,
    Math, JSON, Date, RegExp, Object, Array, String, Number, Boolean, Error, Promise, Map, Set, WeakMap, WeakSet, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    performance: { now: () => Date.now() },
    Html5QrcodeSupportedFormats: {}, Html5Qrcode: function () { return { start: async () => {}, stop: async () => {}, clear() {} }; },
    XLSX: { utils: {} }, process: { env: {} }
  };
  sb.Html5Qrcode.getCameras = async () => [];
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  let err = null;
  try { vm.runInContext(fixesSrc, sb, { filename: 'multipack-fixes.js' }); vm.runInContext(appSrc, sb, { filename: 'app.js' }); }
  catch (e) { err = e; }
  const fireReady = () => { let e2 = null; (docL.DOMContentLoaded || []).forEach(f => { try { f(); } catch (e) { e2 = e2 || e; } }); return e2; };
  const fireLoad = () => (winL.load || []).forEach(f => { try { f(); } catch (e) {} });
  return { sb, calls, logs, store, getEl, fireReady, fireLoad, loadError: err };
}
const tick = (n) => new Promise(r => setTimeout(r, n || 20));
const configCalls = b => b.calls.filter(c => c.url === CONFIG_URL);
const healthCalls = b => b.calls.filter(c => c.url === HEALTH_URL);
const DEFAULT_ROUTE = u => jsonRes(404, {});

(async () => {
// ── 2. CLOTHING SHEETS URL ─────────────────────────────────────────────────
section('2 — Clothing Sheets URL from savvy-config /config (Production contract)');
{
  const b = boot(u => u === CONFIG_URL ? jsonRes(200, { sheets_url: 'https://script.google.com/macros/s/SHEET-A/exec', imgbb: SECRETLIKE, claude: SECRETLIKE, drive_url: 'https://evil.example/x' }) : DEFAULT_ROUTE(u),
    { storage: { cl_drive_url: 'https://script.google.com/macros/s/DRIVE-KEEP/exec' } });
  checkTrue('C0 app.js loads', !b.loadError, b.loadError && b.loadError.message);
  await tick();
  check('C1 config supplies sheets_url → stored in cl_sheets_url', b.store.getItem('cl_sheets_url'), 'https://script.google.com/macros/s/SHEET-A/exec');
  check('C1b exactly one GET to savvy-config /config at startup', configCalls(b).map(c => c.method), ['GET']);
  b.fireReady();
  check('C2 Clothing / Sheets settings field receives it (sheetsIn pre-filled)', b.getEl('sheetsIn').value, 'https://script.google.com/macros/s/SHEET-A/exec');
  const stored = JSON.stringify(b.store._d);
  checkTrue('C4 unrelated config data is ignored (imgbb/claude/drive_url not stored anywhere)', !stored.includes(SECRETLIKE) && !stored.includes('evil.example') && b.store.getItem('cl_drive_url') === 'https://script.google.com/macros/s/DRIVE-KEEP/exec', stored);
  checkTrue('C4b DEFAULT_IMGBB_KEY is not replaced from config', vm.runInContext('DEFAULT_IMGBB_KEY', b.sb) !== SECRETLIKE, '');
  checkTrue('C5 no write: the config request is a plain GET with no body and no session token', configCalls(b).every(c => c.method === 'GET' && !c.body && !c.auth), JSON.stringify(configCalls(b)));
  checkTrue('C5b the config loader issues no other request', b.calls.filter(c => c.url.includes('savvy-config')).length === 1, '');
}
for (const [name, route] of [
  ['network error', u => { if (u === CONFIG_URL) throw new TypeError('Failed to fetch'); return DEFAULT_ROUTE(u); }],
  ['HTTP 500', u => u === CONFIG_URL ? jsonRes(500, { error: 'boom' }) : DEFAULT_ROUTE(u)],
  ['malformed JSON', u => u === CONFIG_URL ? { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } } : DEFAULT_ROUTE(u)],
  ['no sheets_url', u => u === CONFIG_URL ? jsonRes(200, { other: 1 }) : DEFAULT_ROUTE(u)],
  ['non-https sheets_url', u => u === CONFIG_URL ? jsonRes(200, { sheets_url: 'javascript:alert(1)' }) : DEFAULT_ROUTE(u)],
  ['never answers', u => u === CONFIG_URL ? new Promise(() => {}) : DEFAULT_ROUTE(u)]]) {
  const b = boot(route, { storage: { cl_sheets_url: 'https://script.google.com/macros/s/MANUAL/exec' } });
  await tick();
  const readyErr = b.fireReady();
  checkTrue(`C3 config ${name}: Product Scanner loads and starts, manual cl_sheets_url kept`, !b.loadError && !readyErr && b.store.getItem('cl_sheets_url') === 'https://script.google.com/macros/s/MANUAL/exec',
    (b.loadError || readyErr || {}).message + ' ' + b.store.getItem('cl_sheets_url'));
}
{
  const b = boot(u => u === CONFIG_URL ? jsonRes(200, { sheets_url: 'https://script.google.com/macros/s/SHEET-B/exec' }) : DEFAULT_ROUTE(u),
    { storage: { cl_sheets_url: 'https://script.google.com/macros/s/OLD/exec' } });
  await tick();
  check('C6 like Production, a config-supplied sheets_url replaces the stored one', b.store.getItem('cl_sheets_url'), 'https://script.google.com/macros/s/SHEET-B/exec');
  const off = boot(u => u === CONFIG_URL ? jsonRes(500, {}) : DEFAULT_ROUTE(u), { storage: { cl_sheets_url: 'https://script.google.com/macros/s/OLD/exec' } });
  await tick();
  const kOn = Object.keys(b.store._d).sort(), kOff = Object.keys(off.store._d).sort();
  const same = k => b.store._d[k] === off.store._d[k];
  checkTrue('C7 unrelated scanner state untouched: with vs without config, localStorage differs ONLY in cl_sheets_url', JSON.stringify(kOn) === JSON.stringify(kOff) && kOn.filter(k => !same(k)).join() === 'cl_sheets_url', JSON.stringify({ kOn, kOff }));
}

// ── 3. REMBG WARM-UP ───────────────────────────────────────────────────────
section('3 — rembg warm-up (read-only, once, non-blocking, harmless)');
{
  let resolveHealth; const pending = new Promise(r => { resolveHealth = r; });
  const b = boot(u => u === HEALTH_URL ? pending : DEFAULT_ROUTE(u));
  check('R0 no warm-up at script load (only on startup event)', healthCalls(b).length, 0);
  const t0 = Date.now(); const e = b.fireReady(); const dt = Date.now() - t0;
  check('R1 one health warm-up on startup (GET, no body, no token)', healthCalls(b).map(c => [c.method, !!c.body, !!c.auth]), [['GET', false, false]]);
  checkTrue('R2 non-blocking: startup finishes while /health is still pending', !e && dt < 1000, (e && e.message) + ' ' + dt);
  resolveHealth(jsonRes(200, { model_loaded: true }));
  await tick();
  checkTrue('R2b ready answer only logs', b.logs.some(l => l.includes('rembg warm-up: ready')), JSON.stringify(b.logs.slice(-3)));
  b.fireReady(); b.fireReady();
  await tick();
  check('R4 no repeated loop: startup fired 3× → still one /health request', healthCalls(b).length, 1);
}
for (const [name, route] of [
  ['network error', u => { if (u === HEALTH_URL) throw new TypeError('Failed to fetch'); return DEFAULT_ROUTE(u); }],
  ['HTTP 503 / non-JSON', u => u === HEALTH_URL ? { ok: false, status: 503, json: async () => { throw new SyntaxError('x'); } } : DEFAULT_ROUTE(u)],
  ['fetch throws synchronously', u => { if (u === HEALTH_URL) { const e = new Error('sync'); e.sync = true; throw e; } return DEFAULT_ROUTE(u); }]]) {
  const b = boot(route);
  const e = b.fireReady();
  await tick();
  checkTrue(`R3 warm-up failure (${name}) is harmless: startup completes, one attempt, no retry`, !e && healthCalls(b).length === 1, (e && e.message) + ' ' + healthCalls(b).length);
}
{
  let base = null;
  try { base = cp.execSync('git show de48e7459590b3ba9d7774697564db2cb7e2f490:app.js', { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { base = null; }
  const fnSrc = (src, name) => { const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(src); if (!m) return null; const r = src.slice(m.index + 1); const n = /^(async )?function |^\/\/ ━━|^var |^const |^let |^window\./m.exec(r.slice(1)); return src.slice(m.index, n ? m.index + 2 + n.index : undefined); };
  checkTrue('R5 actual rembg POST path unchanged (clRemoveBackground identical to de48e74; /remove-bg POST still there)', base != null && fnSrc(appSrc, 'clRemoveBackground') === fnSrc(base, 'clRemoveBackground') && appSrc.includes("const RAILWAY_RBG = '" + REMOVE_BG_URL + "'"), '');
  checkTrue('R6 warm-up request is GET /health only (no POST to the rembg service at startup)', !/fetch\('https:\/\/savvy-rembg-production\.up\.railway\.app\/health',\s*\{\s*method:\s*'POST'/.test(appSrc), '');

  // ── 1. PHOTO UPLOAD (approved: authenticated primary, NO ImgBB fallback) ──
  section('1 — photo upload: /api/img-upload primary, ImgBB fallback NOT ported (hard-coded key)');
  const png = 'data:image/png;base64,' + Buffer.from('fakepng-bytes-0123456789').toString('base64');
  async function upload(route) {
    const b = boot(route, { storage: { savvy_token: 'SESSION-TOKEN-XYZ', savvy_user: 'tester' } });
    vm.runInContext("savvyToken = function(){ return 'SESSION-TOKEN-XYZ'; }; _compressForImgBB = async function(d){ return d; }; savvySesionCaducada = function(){};", b.sb);
    const url = await b.sb.clUploadPhotoToImgBB(png, 'SOME-IMGBB-KEY', 'front');
    return { b, url, imgbb: b.calls.filter(c => c.url.includes('imgbb.com')), bucket: b.calls.filter(c => c.url.endsWith('/api/img-upload')) };
  }
  let r = await upload(u => u.endsWith('/api/img-upload') ? jsonRes(200, { success: true, url: 'https://bucket.example/p/front.jpg' }) : DEFAULT_ROUTE(u));
  check('P1 primary /api/img-upload success → its URL, no ImgBB call', [r.url, r.bucket.length, r.imgbb.length], ['https://bucket.example/p/front.jpg', 1, 0]);
  checkTrue('P1b primary upload is authenticated (Bearer session token)', r.bucket[0] && r.bucket[0].auth === 'Bearer SESSION-TOKEN-XYZ', r.bucket[0] && r.bucket[0].auth);
  for (const [name, route] of [
    ['HTTP 500', u => u.endsWith('/api/img-upload') ? jsonRes(500, { error: 'x' }) : DEFAULT_ROUTE(u)],
    ['network error', u => { if (u.endsWith('/api/img-upload')) throw new TypeError('Failed to fetch'); return DEFAULT_ROUTE(u); }],
    ['401 session expired', u => u.endsWith('/api/img-upload') ? jsonRes(401, { error: 'no_autorizado' }) : DEFAULT_ROUTE(u)]]) {
    r = await upload(route);
    check(`P2 primary failure (${name}) → existing failure behaviour (null), no ImgBB fallback`, [r.url, r.imgbb.length], [null, 0]);
    const txt = r.b.logs.join('\n');
    checkTrue(`P3 no credential leakage in logs on failure (${name})`, !txt.includes('SOME-IMGBB-KEY') && !txt.includes('SESSION-TOKEN-XYZ') && !txt.includes(vm.runInContext('DEFAULT_IMGBB_KEY', r.b.sb)), txt.slice(0, 300));
  }
  checkTrue('P4 clUploadPhotoToImgBB never calls _uploadToImgBB (fallback deliberately not ported)', !/_uploadToImgBB\(/.test(fnSrc(appSrc, 'clUploadPhotoToImgBB') || 'x'), '');
}

// ── 4. ENVIRONMENT UI ─────────────────────────────────────────────────────
section('4 — app.js is environment-portable');
checkTrue('E1 app.js has no hard-coded staging badge', !appSrc.includes('🧪 STAGING') && !/badge\.textContent\s*=/.test(appSrc), '');
checkTrue('E2 app.js has no staging Home URL / floating Home link', !appSrc.includes('savvy-home-staging') && !appSrc.includes('← Volver a Home'), '');
checkTrue('E3 Employee STAGING index.html still identifies itself as STAGING', indexSrc.includes('<div class="badge dw">🔧 STAGING — DEVELOPMENT</div>'), '');
checkTrue('E4 no Production-specific badge/branding introduced in app.js', !/PRODUCTION —|🟢 PRODUCCI|badge.*PRODUCTION/i.test(appSrc), '');
{
  const b = boot(DEFAULT_ROUTE);
  b.fireReady(); b.fireLoad();
  const marks = b.sb.document.body.children.filter(c => /STAGING|Volver a Home/.test(String(c.textContent || '')) || /savvy-home-staging/.test(String(c.href || '')));
  checkTrue('E5 after window load, app.js has added no STAGING badge / staging Home link to <body>', marks.length === 0, JSON.stringify(marks.map(m => m.textContent)));
}

section('SUMMARY');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
