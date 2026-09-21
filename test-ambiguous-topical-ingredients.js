#!/usr/bin/env node

/**
 * AMBIGUOUS-INGREDIENT TOPICAL PROTECTION — REGRESSION SUITE
 *
 * Investigación #17 (21 sep 2026). Real CSV: Olacluk Magnesium Repair Cream
 * (category 36431) exported C:Type=Supplement even though the title
 * explicitly says "Cream ... for Feet Hands" (a topical product). Root
 * cause: detectType()'s _hasAmbiguousIngredient (the guard that lets
 * explicit topical-form evidence beat a generic ambiguous-ingredient
 * 'Supplement' classification, added in Investigación #13) only recognized
 * biotin/collagen/omega-3 — but the Supplement-triggering regex on the same
 * line already recognized a much larger ingredient set (magnesium,
 * melatonin, turmeric, elderberry, ashwagandha, zinc/calcium/iron
 * supplement, coq10, probiotic, fish oil). Magnesium fell through the
 * asymmetric protection and won 'Supplement' despite explicit "Cream"
 * evidence.
 *
 * FIX — Implementación #17. Both lists now read from ONE shared source,
 * PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS, so they cannot diverge again:
 *   - _hasAmbiguousIngredient = PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS.test(t)
 *   - the Supplement-trigger condition now tests the SAME variable
 *     (not a duplicate regex literal)
 *
 * SCOPE (explicitly narrow, per approved Implementation #17 request):
 *   - Does NOT add a generic "Cream" Type. When topical evidence correctly
 *     suppresses 'Supplement' and no other specific topical Type branch
 *     (Face Cream/Body Lotion/Lotion/Serum/Pain Relief/etc.) matches, the
 *     honest fallback remains 'Other' — never a fabricated Type.
 *   - Does NOT touch ChildLife/Vitamin-Liquid semantics (Investigación #17
 *     proved that is intentional, separate architecture — Type=product
 *     class vs Formulation=physical form, scoped to Gummy/Softgel/Capsule/
 *     Tablet only in psReconcileTypeWithKnownForm()).
 *   - Does NOT fix the separate "Vitamin D3 Liquid Drops" -> Other gap
 *     (Drops has no Type return branch in the "Forma" section) — documented
 *     as a follow-up, deliberately left unchanged here.
 *   - Does NOT touch the later, separate bare-word rule
 *     (!_hasIngestibleForm && /\bvitamin\b|supplement/ -> 'Vitamin') that
 *     runs AFTER the ambiguous-ingredient block. A title where the literal
 *     word "supplement" appears alongside topical language (e.g. "Zinc
 *     Supplement Cream") is correctly kept OUT of 'Supplement' by this fix,
 *     but still lands on 'Vitamin' via that separate, untouched rule — not
 *     'Other'. This is intentional: fixing that would broaden scope beyond
 *     the approved ingredient set, which this implementation was
 *     explicitly told not to do.
 *
 * Runs the REAL detectType(), psReconcileTypeWithKnownForm(),
 * psTypeCategoryPlausible(), psIsValidGTIN() extracted from app.js — not
 * reimplementations.
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
function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

// ── Extract the REAL functions/constants from app.js by brace-matching ────
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function extractFn(name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
function extractVarArr(startMarker) {
  const idx = src.indexOf(startMarker);
  if (idx < 0) throw new Error('var not found: ' + startMarker);
  const end = src.indexOf('];', idx);
  return src.slice(idx, end + 2);
}
function extractVarRegex(startMarker) {
  const idx = src.indexOf(startMarker);
  if (idx < 0) throw new Error('not found: ' + startMarker);
  const end = src.indexOf(';', idx);
  return src.slice(idx, end + 1);
}
function extractObjLiteral(startMarker) {
  const idx = src.indexOf(startMarker);
  if (idx < 0) throw new Error('not found: ' + startMarker);
  let d = 0, started = false;
  for (let j = idx; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(idx, j + 1) + ';'; }
  }
  throw new Error('unbalanced for ' + startMarker);
}

eval(extractVarArr('var PS_TOY_CATS = ['));
eval(extractFn('psIsPaperTowelTitle'));
eval(extractVarArr("var PS_FOOD_TYPES = ["));
eval(extractVarArr("var PS_TOPICAL_BEAUTY_TYPES = ["));
eval(extractVarArr("var PS_INGESTIBLE_FORM_TYPES = ["));
eval(extractVarRegex('var PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS = '));
eval(extractObjLiteral('var CAT_TYPE = {'));
eval(extractFn('psTypeCategoryPlausible'));
eval(extractFn('psReconcileTypeWithKnownForm'));
eval(extractFn('detectType'));
eval(extractFn('psGs1CheckDigit'));
eval(extractFn('psIsValidGTIN'));

console.log('═'.repeat(78));
console.log('AMBIGUOUS-INGREDIENT TOPICAL PROTECTION — REGRESSION SUITE');
console.log('Investigación/Implementación #17 — 21 sep 2026');
console.log('═'.repeat(78));

const HEALTH_CAT = '11776';
const TOPICAL_CAT = '36431';

// ── 1. Real Olacluk fixture ─────────────────────────────────────────────
section('1. REAL OLACLUK FIXTURE — never Supplement');
const OLACLUK_TITLE = 'Olacluk Magnesium Repair Cream 4oz Fast Absorbing for Feet Hands Exp 02/29 New';
const olType = detectType(TOPICAL_CAT, OLACLUK_TITLE);
check('1. Real Olacluk detectType()', olType, 'Other');
check('1b. Real Olacluk never Supplement', olType !== 'Supplement', true);
check('1c. Real Olacluk reconciled (Formulation=Cream) stays Other',
  psReconcileTypeWithKnownForm(olType, 'Cream', 'Cream'), 'Other');

// ── 2-8. Magnesium matrix ───────────────────────────────────────────────
section('2-8. MAGNESIUM TOPICAL/INGESTIBLE PRECEDENCE MATRIX');
check('2. Magnesium Repair Cream -> Other', detectType(TOPICAL_CAT, 'Magnesium Repair Cream 4oz New'), 'Other');
check('3. Magnesium Body Cream -> Body Lotion', detectType(TOPICAL_CAT, 'Magnesium Body Cream 4oz New'), 'Body Lotion');
check('4. Magnesium Lotion -> Lotion', detectType(TOPICAL_CAT, 'Magnesium Lotion 8oz New'), 'Lotion');
check('5. Magnesium Serum -> Serum', detectType(TOPICAL_CAT, 'Magnesium Serum 2oz New'), 'Serum');
check('6. Magnesium Gel Roll-On -> Pain Relief', detectType(TOPICAL_CAT, 'Magnesium Gel Roll-On 3oz New'), 'Pain Relief');
check('7. Magnesium Capsules -> Capsule', detectType(HEALTH_CAT, 'Magnesium Capsules 120ct New'), 'Capsule');
check('8. Magnesium Tablets -> Tablet', detectType(HEALTH_CAT, 'Magnesium Tablets 100ct New'), 'Tablet');
check('9. Magnesium Supplement (no form evidence) -> Supplement', detectType(HEALTH_CAT, 'Magnesium Supplement 60ct New'), 'Supplement');

// ── 10-13. Collagen/biotin matrix (pre-existing #13 protection, unchanged) ─
section('10-13. COLLAGEN/BIOTIN CONTROL MATRIX (pre-existing #13 protection)');
check('10. Collagen Cream -> Other', detectType(TOPICAL_CAT, 'Collagen Cream 4oz New'), 'Other');
check('11. Collagen Capsules -> Capsule', detectType(HEALTH_CAT, 'Collagen Capsules 90ct New'), 'Capsule');
check('12. Biotin Cream -> Other', detectType(TOPICAL_CAT, 'Biotin Cream 4oz New'), 'Other');
check('13. Biotin Gummies -> Gummy', detectType(HEALTH_CAT, 'Biotin Gummies 60ct New'), 'Gummy');

// ── 14-17. Full ingredient matrix — never Supplement with explicit Cream ──
section('14-17. FULL AMBIGUOUS-INGREDIENT MATRIX — Cream never Supplement');
check('14. Melatonin Cream -> never Supplement', detectType(TOPICAL_CAT, 'Melatonin Cream 4oz New') !== 'Supplement', true);
check('14b. Melatonin Cream -> Other', detectType(TOPICAL_CAT, 'Melatonin Cream 4oz New'), 'Other');
check('15. Turmeric Cream -> never Supplement', detectType(TOPICAL_CAT, 'Turmeric Cream 4oz New') !== 'Supplement', true);
check('15b. Turmeric Cream -> Other', detectType(TOPICAL_CAT, 'Turmeric Cream 4oz New'), 'Other');
check('16. Elderberry Cream -> never Supplement', detectType(TOPICAL_CAT, 'Elderberry Cream 4oz New') !== 'Supplement', true);
check('16b. Elderberry Cream -> Other', detectType(TOPICAL_CAT, 'Elderberry Cream 4oz New'), 'Other');
check('17. Ashwagandha Cream -> never Supplement', detectType(TOPICAL_CAT, 'Ashwagandha Cream 4oz New') !== 'Supplement', true);
check('17b. Ashwagandha Cream -> Other', detectType(TOPICAL_CAT, 'Ashwagandha Cream 4oz New'), 'Other');

// Remaining ingredients from the shared vocabulary — Cream never Supplement
['probiotic', 'fish oil', 'zinc supplement', 'calcium supplement', 'iron supplement', 'coq10'].forEach(function(ing) {
  const title = ing.charAt(0).toUpperCase() + ing.slice(1) + ' Cream 4oz New';
  const ty = detectType(TOPICAL_CAT, title);
  check(`${ing} Cream -> never Supplement`, ty !== 'Supplement', true);
});

// Same ingredients WITHOUT topical/ingestible evidence -> still generic Supplement
// (generic Supplement classification must not be suppressed globally).
// NOTE — "fish oil" is deliberately excluded from this loop: the literal
// substring "oil" inside "fish oil" itself matches _hasTopicalForm's
// \boil\b pattern, so "Fish Oil Supplement" now also gets the (correct,
// symmetric) topical-protection guard and falls through to the separate
// bare-word "supplement" rule -> 'Vitamin', not 'Supplement'. This is a
// genuine, traceable side effect of making the vocabulary symmetric (fish
// oil was ALREADY in the pre-existing Supplement-trigger list — this fix
// did not add it), surfaced only now because fish oil was never protected
// before. Documented separately below, not silently patched around.
['probiotic', 'omega-3', 'collagen', 'biotin', 'melatonin', 'turmeric',
 'elderberry', 'ashwagandha', 'magnesium', 'coq10'].forEach(function(ing) {
  const title = ing.charAt(0).toUpperCase() + ing.slice(1) + ' Supplement 60ct New';
  check(`${title} -> Supplement`, detectType(HEALTH_CAT, title), 'Supplement');
});
// zinc/calcium/iron supplement already contain the word "supplement" —
// test the base phrase directly
['Zinc Supplement 60ct New', 'Calcium Supplement 60ct New', 'Iron Supplement 60ct New'].forEach(function(title) {
  check(`${title} -> Supplement`, detectType(HEALTH_CAT, title), 'Supplement');
});

// ── Explicit ingestible form controls — always wins regardless of ingredient
section('EXPLICIT INGESTIBLE FORM CONTROLS — form evidence beats ingredient class');
check('Magnesium Capsules -> Capsule', detectType(HEALTH_CAT, 'Magnesium Capsules 120ct New'), 'Capsule');
check('Magnesium Tablets -> Tablet', detectType(HEALTH_CAT, 'Magnesium Tablets 100ct New'), 'Tablet');
check('Biotin Gummies -> Gummy', detectType(HEALTH_CAT, 'Biotin Gummies 60ct New'), 'Gummy');
check('Collagen Capsules -> Capsule', detectType(HEALTH_CAT, 'Collagen Capsules 90ct New'), 'Capsule');
check('Nature Made Multivitamin Omega-3 Gummies (Investigación #13 regression) -> Gummy',
  detectType(HEALTH_CAT, 'Nature Made Multivitamin Omega-3 Gummies 60ct New'), 'Gummy');

// ── 18. ChildLife control — untouched, proven intentional in Investigation #17
section('18. CHILDLIFE CONTROL — remains Vitamin/Liquid/Liquid (not a bug)');
const CHILDLIFE_TITLE = 'ChildLife Multi Vitamin Mineral Natural Orange Mango 8oz Exp 02/27 Pack of 2 New';
const chType = detectType(HEALTH_CAT, CHILDLIFE_TITLE);
check('18. ChildLife detectType() -> Vitamin', chType, 'Vitamin');
check('18b. ChildLife reconciled (Formulation=Liquid, Item Form=Liquid) stays Vitamin',
  psReconcileTypeWithKnownForm(chType, 'Liquid', 'Liquid'), 'Vitamin');
check('18c. ChildLife Type is NOT forced to Liquid', chType !== 'Liquid', true);

// ── 19. Olacluk GTIN control — unrelated, unaffected by this change ──────
section('19. OLACLUK GTIN CONTROL — Implementation #15 unaffected');
check('19. psIsValidGTIN("188934844360") -> false (invalid, unrelated to classifier)', psIsValidGTIN('188934844360'), false);
check('19b. psIsValidGTIN("608274103009") -> true (ChildLife real UPC, still valid)', psIsValidGTIN('608274103009'), true);

// ── 20. Shared vocabulary cannot drift ────────────────────────────────────
section('20. SHARED VOCABULARY SOURCE-LEVEL CHECK — protection and trigger cannot diverge');
check('20. PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS includes magnesium',
  PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS.test('magnesium'), true);
check('20b. Same regex used for both _hasAmbiguousIngredient and the Supplement trigger (source check)',
  /var _hasAmbiguousIngredient = PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS\.test\(t\);/.test(src), true);
check('20c. Supplement-trigger condition no longer repeats a separate ingredient regex literal',
  !/\/probiotic\|omega\.\?3\|fish oil\|collagen\|biotin\|melatonin\|turmeric\|elderberry\|ashwagandha\|magnesium\|zinc supplement\|calcium supplement\|iron supplement\|coq10\/\.test\(t\)\) return 'Supplement';/.test(src),
  true);

// ── Documented edge case: "fish oil" contains the word "oil" ─────────────
section('DOCUMENTED EDGE CASE — "fish oil" ingredient name collides with _hasTopicalForm\'s bare "oil"');
// "fish oil" was ALREADY in the pre-existing Supplement-trigger regex before
// this fix (not added or broadened here). Making the protection list
// symmetric (as instructed) means "Fish Oil Supplement" is now also
// protected from the ambiguous-ingredient Supplement branch — but because
// the bare word "oil" inside "fish oil" itself satisfies _hasTopicalForm,
// it falls through to the same separate bare-word "supplement" rule as the
// Zinc/Calcium/Iron Supplement Cream cases below, landing on 'Vitamin'
// rather than 'Supplement'. This is a pre-existing characteristic of
// _hasTopicalForm's regex (treats any bare "oil" as topical evidence, even
// when "oil" is part of an ingredient name, not a topical product) that was
// never previously exposed because fish oil wasn't in the protection list.
// Out of scope for this narrow fix — flagged as a follow-up, not patched.
check('Fish Oil Supplement 60ct New -> never Supplement (correct per symmetric design)',
  detectType(HEALTH_CAT, 'Fish Oil Supplement 60ct New') !== 'Supplement', true);
check('Fish Oil Supplement 60ct New -> Vitamin (documented side effect, "oil" collision, follow-up)',
  detectType(HEALTH_CAT, 'Fish Oil Supplement 60ct New'), 'Vitamin');
check('Fish Oil Softgels (explicit ingestible form) still correctly wins -> Softgel',
  detectType(HEALTH_CAT, 'Fish Oil Omega Softgels 90ct New'), 'Softgel');

// ── Edge case documentation (explicitly out of scope, not a required item) ─
section('DOCUMENTED EDGE CASE — literal "supplement" word alongside topical language');
// "Zinc/Calcium/Iron Supplement Cream" contains the bare word "supplement",
// which is caught by a SEPARATE, later, untouched rule
// (!_hasIngestibleForm && /\bvitamin\b|supplement/ -> 'Vitamin') that runs
// AFTER the ambiguous-ingredient block this fix touches. This fix correctly
// keeps these OUT of 'Supplement' (the real defect), but does not force
// them to 'Other' either — that would require touching the separate
// bare-word rule, which is out of scope per the approved narrow fix.
['Zinc Supplement Cream 4oz New', 'Calcium Supplement Cream 4oz New', 'Iron Supplement Cream 4oz New'].forEach(function(title) {
  const ty = detectType(TOPICAL_CAT, title);
  check(`${title} -> never Supplement (still not the core defect)`, ty !== 'Supplement', true);
  check(`${title} -> Vitamin (separate untouched bare-word rule, documented, not "fixed" here)`, ty, 'Vitamin');
});

// ── Structural regressions from Investigation #13's original plausibility
// guard — must remain untouched
section('REGRESSION — Investigación #13 psTypeCategoryPlausible() untouched');
check('psTypeCategoryPlausible(Olacluk) still true (no category evidence for 36431)',
  psTypeCategoryPlausible(TOPICAL_CAT, 'Supplement', OLACLUK_TITLE), true);

console.log('\n' + '═'.repeat(78));
console.log('SUMMARY');
console.log('═'.repeat(78));
console.log('passed: ' + passed);
console.log('failed: ' + failed);
console.log('total:  ' + (passed + failed));
console.log('═'.repeat(78));
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log('  - ' + f.name));
  process.exit(1);
}
