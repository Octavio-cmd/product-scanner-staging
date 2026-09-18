#!/usr/bin/env node

/**
 * TYPE / FORMULATION / ITEM FORM CONSISTENCY — REGRESSION SUITE
 *
 * Investigación #13 (18 sep 2026). Covers the two confirmed, currently-live
 * classifier regressions found against Employee STAGING @ c6ff8c1, plus the
 * narrow Type<->Formulation/Item-Form reconciliation guard added alongside
 * them, and a battery of negative/positive controls + prior regressions
 * proving nothing else moved.
 *
 * BUG A — NAT-074312006951-1pk "Nature's Bounty Sleep Stress Support
 *   Sleep3 Maximum Strength Exp 02/27 New" exported C:Type=Paper Towel
 *   (with C:Formulation=Tablet, C:Item Form=Tablet in the SAME row) because
 *   detectType()/catId() matched the bare word "bounty" — a brand-name
 *   collision between "Nature's Bounty" (supplement brand) and "Bounty"
 *   (paper towel brand). Fix: psIsPaperTowelTitle() now requires actual
 *   paper-towel evidence (the phrase "paper towel(s)"/"towel roll(s)", or a
 *   brand keyword co-occurring with the word "towel(s)"), used by both
 *   catId() occurrences and detectType().
 *
 * BUG B — NAT-031604042127-2pk "Nature Made Multivitamin Omega-3 Gummies
 *   160 Total Exp 02/27 Pack of 2 New" exported C:Type=Supplement (with
 *   C:Formulation=Gummy, C:Item Form=Gummy in the SAME row) because the
 *   ambiguous-ingredient rule ("omega-3" et al.) fired before the "Forma"
 *   block could see "gummies" — its three-way exclusion guard only covered
 *   the ambiguous-ingredient + topical-form collision, not the general
 *   explicit-ingestible-form case. Fix: the same !_hasIngestibleForm guard
 *   already used for the generic Vitamin/Supplement rules (Investigación
 *   #8) now also gates the ambiguous-ingredient rule.
 *
 * CONSISTENCY GUARD — psReconcileTypeWithKnownForm(): a narrow safety net
 *   for cases where the FINAL COMPRESSED title (what detectType() sees)
 *   lost the dosage-form word that the CANONICAL, pre-compression
 *   C:Formulation/C:Item Form (resolved earlier, more reliably) still
 *   knows. Scoped ONLY to the four ingestible forms the app already
 *   recognizes (Gummy/Softgel/Capsule/Tablet) — never a blanket
 *   Type = Item Form rule.
 *
 * Runs the REAL psIsPaperTowelTitle(), catId(), detectType(),
 * psTypeCategoryPlausible(), and psReconcileTypeWithKnownForm() extracted
 * from app.js — not reimplementations. Sections 11-12 additionally spawn
 * the existing dedicated Squishmallows/Zicam/Zellies regression scripts
 * (their real fixtures, not shallow duplicates) to confirm this change
 * does not interact with the multipack count architecture.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

// ── Extract the REAL functions/vars from app.js by brace-matching ──────────
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function extractFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
function extractVar(name) {
  const i = src.indexOf('var ' + name + ' = {');
  if (i < 0) throw new Error('var not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 2); }
  }
  throw new Error('unbalanced braces for var ' + name);
}

const toyCatsMatch = src.match(/var PS_TOY_CATS = (\[[^\]]*\]);/);
if (!toyCatsMatch) throw new Error('PS_TOY_CATS not found');
eval('var PS_TOY_CATS = ' + toyCatsMatch[1] + ';');

eval(extractVar('CAT_TYPE'));

const foodTypesMatch = src.match(/var PS_FOOD_TYPES = (\[[\s\S]*?\]);/);
const beautyTypesMatch = src.match(/var PS_TOPICAL_BEAUTY_TYPES = (\[[^\]]*\]);/);
if (!foodTypesMatch || !beautyTypesMatch) throw new Error('PS_FOOD_TYPES / PS_TOPICAL_BEAUTY_TYPES not found');
eval('var PS_FOOD_TYPES = ' + foodTypesMatch[1] + ';');
eval('var PS_TOPICAL_BEAUTY_TYPES = ' + beautyTypesMatch[1] + ';');

const ingestFormTypesMatch = src.match(/var PS_INGESTIBLE_FORM_TYPES = (\[[^\]]*\]);/);
if (!ingestFormTypesMatch) throw new Error('PS_INGESTIBLE_FORM_TYPES not found');
eval('var PS_INGESTIBLE_FORM_TYPES = ' + ingestFormTypesMatch[1] + ';');

eval(extractFn('psIsPaperTowelTitle'));
eval(extractFn('catId'));
eval(extractFn('detectType'));
eval(extractFn('psTypeCategoryPlausible'));
eval(extractFn('psReconcileTypeWithKnownForm'));
eval(extractFn('psDetectIngestibleForm'));

// Simulates the exact export-loop sequence: detectType() -> plausibility
// guard -> psReconcileTypeWithKnownForm() using canonical Formulation/Item
// Form, the same order app.js applies at CSV-row-build time.
function finalExportedType(category, title, formulationVal, itemFormVal) {
  var t = detectType(String(category), title);
  if (!psTypeCategoryPlausible(String(category), t, title)) t = 'Other';
  t = psReconcileTypeWithKnownForm(t, formulationVal || '', itemFormVal || '');
  return t;
}

console.log('═'.repeat(78));
console.log('TYPE / FORMULATION / ITEM FORM CONSISTENCY — REGRESSION SUITE');
console.log('Investigación #13 — 18 sep 2026');
console.log('═'.repeat(78));

// ═══ 1. REAL NATURE'S BOUNTY PAPER TOWEL FAILURE ═══════════════════════════
section('1. REAL FAILURE — NAT-074312006951-1pk (Nature\'s Bounty Sleep3)');
{
  const TITLE = "Nature's Bounty Sleep Stress Support Sleep3 Maximum Strength Exp 02/27 New";
  const CAT = '11776';
  checkTrue('detectType() no longer returns Paper Towel', detectType(CAT, TITLE) !== 'Paper Towel', detectType(CAT, TITLE));
  check('detectType() falls to honest Other (no form word survived compression)', detectType(CAT, TITLE), 'Other');
  checkTrue('catId() no longer returns 20625 via the bounty collision', catId(TITLE) !== '20625', catId(TITLE));
  check('Full export-loop with canonical Formulation=Tablet/Item Form=Tablet -> final C:Type = Tablet',
    finalExportedType(CAT, TITLE, 'Tablet', 'Tablet'), 'Tablet');
  checkTrue('Full export-loop result is NEVER Paper Towel/Supplement/Vitamin',
    !['Paper Towel', 'Supplement', 'Vitamin'].includes(finalExportedType(CAT, TITLE, 'Tablet', 'Tablet')),
    finalExportedType(CAT, TITLE, 'Tablet', 'Tablet'));
}

// ═══ 2. REAL OMEGA-3 GUMMIES FAILURE ═══════════════════════════════════════
section('2. REAL FAILURE — NAT-031604042127-2pk (Nature Made Omega-3 Gummies)');
{
  const TITLE = 'Nature Made Multivitamin Omega-3 Gummies 160 Total Exp 02/27 Pack of 2 New';
  const CAT = '11776';
  check('detectType() = Gummy', detectType(CAT, TITLE), 'Gummy');
  check('Full export-loop with canonical Formulation=Gummy/Item Form=Gummy -> final C:Type = Gummy',
    finalExportedType(CAT, TITLE, 'Gummy', 'Gummy'), 'Gummy');
}

// ═══ 3-4. POSITIVE CONTROLS (SOFTGEL / TABLET) ═════════════════════════════
section('3-4. POSITIVE CONTROLS — Softgel / Tablet');
{
  check('Softgel control: Nature Made Vitamin B12 Softgels...',
    detectType('11776', 'Nature Made Vitamin B12 Softgels Energy 180 Total Exp 05/27 Pack of 2 New'), 'Softgel');
  check('Tablet control: Nature\'s Truth Tablets Non-GMO...',
    detectType('11776', "Nature's Truth Tablets Non-GMO 270 Total Exp 06/28 Pack of 3 New"), 'Tablet');
}

// ═══ 5. REAL PAPER-TOWEL POSITIVE CONTROLS ═════════════════════════════════
section('5. PAPER TOWEL POSITIVE CONTROLS — must still classify correctly');
{
  const cases = [
    'Bounty Paper Towels Select-A-Size New',
    'Scott Paper Towels New',
    'Paper Towel Rolls New',
  ];
  cases.forEach(t => {
    check(`detectType("${t}") = Paper Towel`, detectType('20625', t), 'Paper Towel');
    check(`catId("${t}") = 20625`, catId(t), '20625');
  });
}

// ═══ 6. NATURE'S BOUNTY BRAND COLLISION NEGATIVE CONTROLS ══════════════════
section('6. BRAND COLLISION NEGATIVE CONTROLS — Nature\'s Bounty ≠ Paper Towel');
{
  const cases = [
    ["Nature's Bounty Vitamin C Tablets New", 'Tablet'],
    ["Nature's Bounty Melatonin Gummies New", 'Gummy'],
    ["Nature's Bounty Fish Oil Softgels New", 'Softgel'],
  ];
  cases.forEach(([t, exp]) => {
    const v = detectType('11776', t);
    check(`detectType("${t}") = ${exp}`, v, exp);
    checkTrue(`"${t}" is never Paper Towel`, v !== 'Paper Towel', v);
    checkTrue(`catId("${t}") is never 20625`, catId(t) !== '20625', catId(t));
  });
  // The exact real fixture, with canonical Item Form known, run end-to-end.
  check("Nature's Bounty Sleep3 with canonical Item Form=Tablet -> Tablet, never Paper Towel",
    finalExportedType('11776', "Nature's Bounty Sleep Stress Support Sleep3 Maximum Strength Exp 02/27 New", '', 'Tablet'),
    'Tablet');
}

// ═══ 7. AMBIGUOUS INGREDIENT + EXPLICIT FORM MATRIX ════════════════════════
section('7. AMBIGUOUS INGREDIENT MATRIX — explicit form must win');
{
  const cases = [
    ['Omega-3 Gummies New', 'Gummy'],
    ['Omega-3 Softgels New', 'Softgel'],
    ['Omega-3 Capsules New', 'Capsule'],
    ['Omega-3 Tablets New', 'Tablet'],
    ['Melatonin Gummies New', 'Gummy'],
    ['Melatonin Tablets New', 'Tablet'],
    ['Biotin Softgels New', 'Softgel'],
    ['Collagen Capsules New', 'Capsule'],
    ['Probiotic Gummies New', 'Gummy'],
  ];
  cases.forEach(([t, exp]) => {
    check(`detectType("${t}") = ${exp}`, detectType('11776', t), exp);
  });
}

// ═══ 8. GENERIC SUPPLEMENT CONTROLS (no explicit form — semantics preserved) ═
section('8. GENERIC SUPPLEMENT CONTROLS — no explicit form, semantics unchanged');
{
  const cases = [
    'Omega-3 Supplement New',
    'Melatonin Supplement New',
    'Biotin Supplement New',
  ];
  cases.forEach(t => {
    check(`detectType("${t}") = Supplement`, detectType('11776', t), 'Supplement');
  });
}

// ═══ 9. CANONICAL FORMULATION/ITEM FORM RESCUE — psReconcileTypeWithKnownForm ═
section('9. RECONCILIATION GUARD — canonical rescue, and its deliberately narrow scope');
{
  check('Paper Towel + Formulation=Tablet -> Tablet', psReconcileTypeWithKnownForm('Paper Towel', 'Tablet', ''), 'Tablet');
  check('Supplement + Item Form=Gummy -> Gummy', psReconcileTypeWithKnownForm('Supplement', '', 'Gummy'), 'Gummy');
  check('Other + Formulation=Softgel -> Softgel', psReconcileTypeWithKnownForm('Other', 'Softgel', ''), 'Softgel');
  check('Vitamin + Item Form=Capsule -> Capsule', psReconcileTypeWithKnownForm('Vitamin', '', 'Capsule'), 'Capsule');
  check('Already-correct Type is left alone (Gummy + Formulation=Gummy -> Gummy, no-op)',
    psReconcileTypeWithKnownForm('Gummy', 'Gummy', ''), 'Gummy');
  check('No canonical form known -> Type untouched', psReconcileTypeWithKnownForm('Paper Towel', '', ''), 'Paper Towel');
  // Deliberately narrow: forms outside the recognized ingestible vocabulary
  // must NOT be forced onto Type — Cream/Liquid/etc. stay out of scope.
  check('Cookware + Formulation=Cream -> Cookware unchanged (Cream is out of scope)',
    psReconcileTypeWithKnownForm('Cookware', 'Cream', ''), 'Cookware');
  check('Paper Towel + Formulation=Liquid -> Paper Towel unchanged (Liquid is out of scope)',
    psReconcileTypeWithKnownForm('Paper Towel', 'Liquid', ''), 'Paper Towel');
}

// ═══ 10. SEROVITAL REGRESSION ══════════════════════════════════════════════
section('10. SEROVITAL REGRESSION — Investigación #7/#8, must remain Capsule');
{
  const TITLE = 'SeroVital Anti-Aging Renewal Complex 160 Capsules Supplement New';
  check('detectType() = Capsule', detectType('11776', TITLE), 'Capsule');
  checkTrue('never Face Cream/Vitamin/Supplement/Paper Towel',
    !['Face Cream', 'Vitamin', 'Supplement', 'Paper Towel'].includes(detectType('11776', TITLE)),
    detectType('11776', TITLE));
}

// ═══ 11. SQUISHMALLOWS REGRESSION ══════════════════════════════════════════
section('11. SQUISHMALLOWS REGRESSION — Type=Plushie, real e2e suite spawned');
{
  check('detectType() = Plushie',
    detectType('220', 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy New'), 'Plushie');
  try {
    execFileSync('node', [path.join(__dirname, 'test-squishmallows-title-e2e.js')], { stdio: 'pipe' });
    checkTrue('test-squishmallows-title-e2e.js (real dedicated suite) still exits 0', true);
  } catch (e) {
    checkTrue('test-squishmallows-title-e2e.js (real dedicated suite) still exits 0', false,
      (e.stdout || '').toString().slice(-500));
  }
}

// ═══ 12. ZICAM / ZELLIES COUNT REGRESSION ══════════════════════════════════
section('12. ZICAM / ZELLIES COUNT REGRESSION — real dedicated suites spawned');
{
  ['test-zicam-trace.js', 'test-zicam-count-lifecycle.js', 'test-zellies-split-trace.js'].forEach(f => {
    try {
      execFileSync('node', [path.join(__dirname, f)], { stdio: 'pipe' });
      checkTrue(`${f} still exits 0 (count architecture untouched)`, true);
    } catch (e) {
      checkTrue(`${f} still exits 0 (count architecture untouched)`, false,
        (e.stdout || '').toString().slice(-500));
    }
  });
}

console.log('\n' + '═'.repeat(78));
console.log('SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
console.log('═'.repeat(78));

process.exit(failed ? 1 : 0);
