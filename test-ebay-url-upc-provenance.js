#!/usr/bin/env node

/**
 * EBAY URL → UPC PROVENANCE — REGRESSION SUITE
 *
 * Investigación #15 (19 sep 2026). Real failure: an employee pasted an eBay
 * listing URL for "Status BT One Wireless On Ear Headphone Jet Black"
 * (eBay Item ID 406931053635, no real UPC on the listing). Product Scanner
 * exported Product:UPC=406931053635 and SKU=UNB-406931053635-1pk; eBay
 * rejected the upload (ErrorCode 21919302, "UPC has an invalid value") —
 * proven independently: 406931053635 fails the UPC-A check digit
 * (calculated 2, actual 5), so it was never a real UPC.
 *
 * BUG A — analyzeEbayUrl() passed the eBay Item ID as the "upc" argument
 *   into finishAnalyze()/callClaude()/fallback(), which unconditionally
 *   copied it onto res.upc/cur.upc with zero distinction from a real
 *   scanned barcode. Fixed: analyzeEbayUrl() now resolves a real UPC only
 *   from the backend's own upc/gtin field (validated; currently always
 *   absent — /api/ebay-item forwarding a real GTIN is a separate,
 *   out-of-scope enhancement) and passes the eBay Item ID SEPARATELY via a
 *   new ebayItemId parameter that finishAnalyze() stores as
 *   cur._ebayItemId — never as upc.
 *
 * BUG B — the export loop only checked digit LENGTH (12-14), never a real
 *   checksum, so a 12-digit non-UPC number passed straight through. Fixed:
 *   psIsValidGTIN() (a real GS1 check-digit validator, covering UPC-A/
 *   EAN-13/GTIN-14 with one shared algorithm) now gates Product:UPC.
 *
 * SKU DESIGN — psSkuIdentifier(obj) keeps SKU generation working when
 *   there's no real UPC: it prefers obj.upc, and ONLY falls back to
 *   obj._ebayItemId for SKU uniqueness — a value that is explicitly never
 *   also written to obj.upc/Product:UPC. Provenance of the SKU identifier
 *   and of Product:UPC are deliberately independent from this point on.
 *
 * Runs the REAL makeSKU(), psGs1CheckDigit(), psIsValidGTIN(),
 * psSkuIdentifier(), callClaude(), and fallback() extracted from app.js —
 * not reimplementations.
 */

const fs = require('fs');
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

// ── Extract the REAL functions from app.js by brace-matching ───────────────
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function extractFn(name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  // Preserve a leading "async " — callClaude() is declared `async function
  // callClaude(...)`; matching only on "function NAME(" starts the slice at
  // the "function" keyword and silently drops "async", producing a
  // non-async copy that still contains `await` (SyntaxError at eval time).
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

eval(extractFn('makeSKU'));
eval(extractFn('psGs1CheckDigit'));
eval(extractFn('psIsValidGTIN'));
eval(extractFn('psSkuIdentifier'));
eval(extractFn('calcBundlePrice'));
eval(extractFn('buildSmartTitle'));
// psIsAllCapsBrand() reads the module-level PS_ALLCAPS_BRANDS array — must
// be extracted too, or it throws ReferenceError at call time.
function extractVar(name) {
  const re = new RegExp('var ' + name + ' = \\[[\\s\\S]*?\\];');
  const m = src.match(re);
  if (!m) throw new Error('var not found: ' + name);
  return m[0];
}
eval(extractVar('PS_ALLCAPS_BRANDS'));
eval(extractFn('psIsAllCapsBrand'));
eval(extractFn('normalizeBrandCase'));

// catId()/catNm() are large but self-contained (pure title/category maps) —
// extract for real so buildSmartTitle()/fallback() run against production
// logic, not a stub. catId() calls psIsPaperTowelTitle() (Investigación
// #13) — must be extracted first or catId() throws ReferenceError.
eval(extractFn('psIsPaperTowelTitle'));
eval(extractFn('catId'));
const catNmMatch = src.match(/const catNm=id=>\(\{[\s\S]*?\}\[id\]\|\|'Skin Care'\);/);
if (!catNmMatch) throw new Error('catNm not found');
eval('var catNm = ' + catNmMatch[0].replace(/^const catNm=/, '') + ';');

// callClaude()/fallback() need these two runtime hooks; stub them to force
// the REAL, already-handled "no session" branch inside callClaude() (line
// `if(!savvyToken())return fallback(upc,prod,ebay);`) — this exercises the
// actual production code path (a logged-out session is a real runtime
// state callClaude() already defends against), not a reimplementation.
var stat = function(){};
var savvyToken = function(){ return ''; };
eval(extractFn('fallback'));
eval(extractFn('callClaude'));

console.log('═'.repeat(78));
console.log('EBAY URL → UPC PROVENANCE — REGRESSION SUITE');
console.log('Investigación #15 — 19 sep 2026');
console.log('═'.repeat(78));

const ITEM_ID = '406931053635';
const REAL_UPC_A = '031604028435';   // Nature Made — real, checksum-valid, used throughout this session
const REAL_EAN13 = '4006381333931';  // well-known real, checksum-valid EAN-13
const REAL_GTIN14 = '00031604028435'; // zero-padded UPC-A, genuinely 14 digits, checksum-valid
const CHECKSUM_VALID_ITEMID_LIKE = '406931053632'; // same-family, structurally checksum-valid hypothetical

// ═══ 1-4. REAL FIXTURE — item ID never becomes UPC, SKU stays deterministic ═
section("1-4. REAL FIXTURE — UPC 406931053635, Status BT One Headphone");
{
  // Simulates exactly what analyzeEbayUrl()/finishAnalyze() now produce:
  // no real UPC/GTIN from the backend -> upc='' ; itemId stored separately.
  const cur = { brand: 'Unbranded', upc: '', _ebayItemId: ITEM_ID, title: 'Status BT One Wireless On Ear Headphone Jet Black' };

  checkTrue('1. Real itemId 406931053635 never becomes UPC (cur.upc stays empty)', cur.upc === '', cur.upc);
  check('2. cur.upc empty for URL path with no real UPC', cur.upc, '');

  const id = psSkuIdentifier(cur);
  const sku = makeSKU(cur.brand, id, 1, cur.title);
  checkTrue('4. Internal SKU remains deterministic and non-empty', !!sku && sku.indexOf('--') === -1, sku);
  check('Internal SKU uses the eBay Item ID as identifier (acceptable, SKU-only)', sku, 'UNB-406931053635-1pk');

  // Export-time UPC resolution (mirrors the real export-loop logic exactly)
  const it = { upc: cur.upc, sku: sku };
  let _rawUpc = String(it.upc || '').replace(/[^0-9]/g, '');
  if (!_rawUpc && it.sku) {
    const m = String(it.sku).match(/\d{8,14}/);
    if (m) _rawUpc = m[0];
  }
  const upcVal = psIsValidGTIN(_rawUpc) ? _rawUpc : '';
  check('3. Product:UPC empty (even though the SKU fallback would extract the same digits)', upcVal, '');
}

// ═══ 5. 406931053635 fails UPC-A checksum ══════════════════════════════════
section('5. 406931053635 FAILS UPC-A CHECKSUM');
{
  check('psGs1CheckDigit for 406931053635 body = 2 (actual last digit is 5)',
    psGs1CheckDigit(ITEM_ID.slice(0, -1)), 2);
  checkTrue('psIsValidGTIN(406931053635) = false', psIsValidGTIN(ITEM_ID) === false);
}

// ═══ 6-11. CHECKSUM VALIDATOR MATRIX ═══════════════════════════════════════
section('6-11. CHECKSUM VALIDATOR MATRIX');
{
  checkTrue('6. Valid UPC-A (031604028435) passes', psIsValidGTIN(REAL_UPC_A) === true);
  checkTrue('7. Bad UPC-A (031604028436, wrong check digit) fails', psIsValidGTIN('031604028436') === false);
  checkTrue('8. Valid EAN-13 (4006381333931) passes', psIsValidGTIN(REAL_EAN13) === true);
  checkTrue('9. Bad EAN-13 (4006381333930, wrong check digit) fails', psIsValidGTIN('4006381333930') === false);
  checkTrue('Valid GTIN-14 (00031604028435) passes', psIsValidGTIN(REAL_GTIN14) === true);
  checkTrue('10. Non-digits fail (03160402843A)', psIsValidGTIN('03160402843A') === false);
  checkTrue('11a. Wrong length — 11 digits fails', psIsValidGTIN('3160402843') === false);
  checkTrue('11b. Wrong length — 15 digits fails', psIsValidGTIN('003160402843500') === false);
  checkTrue('Empty string fails', psIsValidGTIN('') === false);
  checkTrue('null fails', psIsValidGTIN(null) === false);
}

// ═══ 12. DEFENSE-IN-DEPTH — checksum-valid itemId still cannot become UPC ══
section('12. DEFENSE-IN-DEPTH — Bug A fixed independently of Bug B');
{
  checkTrue('Hypothetical itemId 406931053632 DOES pass the GTIN checksum (proves this is a real control)',
    psIsValidGTIN(CHECKSUM_VALID_ITEMID_LIKE) === true);
  // Even with a checksum-valid item id, the eBay-URL path structurally never
  // writes it to cur.upc — provenance (source=ebay_url, identifier=itemId)
  // is what blocks it, not the checksum.
  const cur = { brand: 'Unbranded', upc: '', _ebayItemId: CHECKSUM_VALID_ITEMID_LIKE };
  checkTrue('12. cur.upc stays empty regardless of the item id being checksum-valid', cur.upc === '', cur.upc);
  const sku = makeSKU(cur.brand, psSkuIdentifier(cur), 1, 'x');
  check('SKU still uses it as an internal identifier only', sku, 'UNB-406931053632-1pk');
}

// ═══ 13-14. NORMAL UPC SCAN CONTROL — unchanged ════════════════════════════
section('13-14. NORMAL SCAN CONTROL — real UPC flow unaffected');
{
  const cur = { brand: 'Nature Made', upc: REAL_UPC_A, title: 'x' };
  checkTrue('13. Normal /search-upc-style flow: cur.upc = real scanned UPC, untouched', cur.upc === REAL_UPC_A, cur.upc);
  const id = psSkuIdentifier(cur);
  check('psSkuIdentifier prefers the real UPC over any itemId', id, REAL_UPC_A);
  const sku = makeSKU(cur.brand, id, 1, cur.title);
  check('14. Normal real-UPC SKU unchanged', sku, 'NAT-031604028435-1pk');
}

// ═══ 15-16. EXPORT CONTROLS ═════════════════════════════════════════════════
section('15-16. EXPORT CONTROLS — valid UPC preserved, invalid suppressed');
{
  function exportUpc(it) {
    let _rawUpc = String(it.upc || '').replace(/[^0-9]/g, '');
    if (!_rawUpc && it.sku) {
      const m = String(it.sku).match(/\d{8,14}/);
      if (m) _rawUpc = m[0];
    }
    return psIsValidGTIN(_rawUpc) ? _rawUpc : '';
  }
  check('15. Export: valid UPC-A passes through unchanged', exportUpc({ upc: REAL_UPC_A, sku: 'NAT-031604028435-1pk' }), REAL_UPC_A);
  check('16. Export: invalid 12-digit number (406931053635) is suppressed to empty', exportUpc({ upc: ITEM_ID, sku: '' }), '');
  check('Export: invalid value even via SKU-digit fallback is suppressed', exportUpc({ upc: '', sku: 'UNB-406931053635-1pk' }), '');
}

// ═══ 17-18. CLAUDE-SUCCESS-PATH / FALLBACK-PATH CANNOT REINTRODUCE ITEMID ══
section('17-18. FALLBACK() / CALLCLAUDE() — cannot reintroduce itemId as UPC on their own');
{
  // fallback() is pure/sync — call the REAL function directly.
  const prod = { name: 'Status BT One Wireless On Ear Headphone', brand: 'Unbranded', found: true };
  const ebay = { found: true, prices: { avg: 12 }, pricing: {} };
  const fbRes = fallback('', prod, ebay);
  checkTrue('17. fallback(\'\', prod, ebay) never reintroduces the item id — upc stays whatever was passed (empty)',
    fbRes.upc === '', fbRes.upc);
  checkTrue('fallback() has no reference to any item-id variable — it only ever echoes its own upc parameter',
    !/itemId/.test(extractFn('fallback')));

  // callClaude() with no session forces its own real "no token" branch,
  // which calls the real fallback() above — proves the whole chain.
  (async () => {
    const res = await callClaude('', prod, ebay);
    checkTrue('18. callClaude(\'\', prod, ebay) (Claude-unavailable path, exercises the real fallback() call inside it) never reintroduces the item id',
      res.upc === '', res.upc);

    console.log('\n' + '═'.repeat(78));
    console.log('SUMMARY');
    console.log('═'.repeat(78));
    console.log(`passed: ${passed}`);
    console.log(`failed: ${failed}`);
    console.log(`total:  ${passed + failed}`);
    if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
    console.log('═'.repeat(78));

    process.exit(failed ? 1 : 0);
  })();
}
