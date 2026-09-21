#!/usr/bin/env node

/**
 * FORMULATION / ITEM FORM EVIDENCE RESOLUTION — REGRESSION SUITE
 *
 * Investigación #14 (19 sep 2026). Real fixture: UPC 074312006951, Nature's
 * Bounty Sleep Stress Support Sleep3 Maximum Strength. The final/canonical
 * title never says "tablet" — psDetectIngestibleForm() found nothing
 * (Tier 1), there was no real eBay Catalog structured aspect either
 * (Tier 2), so Formulation/Item Form were left to an unconstrained AI
 * guess, which returned "Drug Free" (a real marketing claim from the
 * product's own description, not a physical dosage form) — and that value
 * got locked as canonical for both fields and never rescued, even though
 * the SAME AI response usually also fills Size with "28 Tablets" (the
 * evidence psGetCanonicalUnitCount()/psGetUnitNoun() already use to build
 * "28 tablets each" in the description).
 *
 * Three fixes, all reusing the existing psDetectIngestibleForm() vocabulary
 * (Tablet/Capsule/Softgel/Gummy/Powder/Liquid/Drops — nothing new invented):
 *
 *   FIX 1 — psPreFillSpecifics() gets a new Tier 3: when Tier 1 (title) and
 *   Tier 2 (structured aspect) both find nothing, check canonical
 *   Size/Count/Unit Quantity evidence (via the new
 *   psFindIngestibleFormInSizeFields()) before giving up to the AI.
 *
 *   FIX 2 — psScrubHealthSpecs()'s Formulation/Item Form rule now validates
 *   both values against the same vocabulary (psFormFromText()) instead of
 *   just checking that they agree with each other. An unrecognized value
 *   ("Drug Free", "Sugar Free", "Gluten Free", "Non-GMO", "Non-Habit
 *   Forming"...) is never locked as canonical.
 *
 *   FIX 3 — the same rule's harmonization: if exactly one of the two
 *   fields is a recognized form, that one ALWAYS wins (never averaged away
 *   by the old "title wins, else Formulation wins" tiebreak, which only
 *   applies now when BOTH are valid and disagree). If neither is
 *   recognized, Size/Count/Unit Quantity evidence is checked before
 *   discarding both — never inventing a new destination for the discarded
 *   claim (Features, if the AI also put it there independently, is left
 *   untouched).
 *
 * Runs the REAL psDetectIngestibleForm(), psFormFromText(),
 * psFindIngestibleFormInSizeFields(), psResolveValidIngestibleForm(),
 * psScrubHealthSpecs(), detectType(), psTypeCategoryPlausible(), and
 * psReconcileTypeWithKnownForm() extracted from app.js/multipack-fixes.js
 * — not reimplementations.
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

// ── Extract the REAL functions/vars from app.js and multipack-fixes.js ─────
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const src2 = fs.readFileSync(path.join(__dirname, 'multipack-fixes.js'), 'utf8');

function extractFn(name, source) {
  source = source || src;
  const i = source.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') { d++; started = true; }
    else if (source[j] === '}') { d--; if (started && d === 0) return source.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
function extractVar(name, isArray, source) {
  source = source || src;
  const marker = 'var ' + name + ' = ' + (isArray ? '[' : '{');
  const i = source.indexOf(marker);
  if (i < 0) throw new Error('var not found: ' + name);
  const open = isArray ? '[' : '{', close = isArray ? ']' : '}';
  let d = 0, started = false;
  for (let j = i; j < source.length; j++) {
    if (source[j] === open) { d++; started = true; }
    else if (source[j] === close) { d--; if (started && d === 0) return source.slice(i, j + 2); }
  }
  throw new Error('unbalanced for ' + name);
}

eval(extractVar('PS_COUNT_FIELDS', true, src2));
eval(extractVar('PS_INGESTIBLE_FORMS', true));
const otcMatch = src.match(/var PS_OTC_EXTRA_CATS = (\[[^\]]*\]);/);
if (!otcMatch) throw new Error('PS_OTC_EXTRA_CATS not found');
eval('var PS_OTC_EXTRA_CATS = ' + otcMatch[1] + ';');
const healthCatsMatch = src.match(/window\.PS_HEALTH_CATS = (\[[\s\S]*?\]);/);
if (!healthCatsMatch) throw new Error('PS_HEALTH_CATS not found');
eval('var PS_HEALTH_CATS = ' + healthCatsMatch[1] + ';');
function psBrandFromUPC() { return ''; } // stub, unrelated to Formulation/Item Form

const toyCatsMatch = src.match(/var PS_TOY_CATS = (\[[^\]]*\]);/);
eval('var PS_TOY_CATS = ' + toyCatsMatch[1] + ';');
const foodTypesMatch = src.match(/var PS_FOOD_TYPES = (\[[\s\S]*?\]);/);
const beautyTypesMatch = src.match(/var PS_TOPICAL_BEAUTY_TYPES = (\[[^\]]*\]);/);
eval('var PS_FOOD_TYPES = ' + foodTypesMatch[1] + ';');
eval('var PS_TOPICAL_BEAUTY_TYPES = ' + beautyTypesMatch[1] + ';');
const ingestFormTypesMatch = src.match(/var PS_INGESTIBLE_FORM_TYPES = (\[[^\]]*\]);/);
eval('var PS_INGESTIBLE_FORM_TYPES = ' + ingestFormTypesMatch[1] + ';');
// 21 sep 2026 — Investigación/Implementación #17: detectType() now reads
// PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS — extract it too.
const ambigIngredientsMatch = src.match(/var PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS = (\/[\s\S]*?\/);/);
if (!ambigIngredientsMatch) throw new Error('PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS not found');
eval('var PS_AMBIGUOUS_SUPPLEMENT_INGREDIENTS = ' + ambigIngredientsMatch[1] + ';');
eval(extractVar('CAT_TYPE', false));

eval(extractFn('psDetectIngestibleForm'));
eval(extractFn('psFormFromText'));
eval(extractFn('psFindIngestibleFormInSizeFields'));
eval(extractFn('psResolveValidIngestibleForm'));
eval(extractFn('psScrubHealthSpecs'));
eval(extractFn('psIsPaperTowelTitle'));
eval(extractFn('catId'));
eval(extractFn('detectType'));
eval(extractFn('psTypeCategoryPlausible'));
eval(extractFn('psReconcileTypeWithKnownForm'));

const countNounSrcMatch = src2.match(/var PS_COUNT_NOUN_RE_SRC =\s*([\s\S]*?);\n/);
eval('var PS_COUNT_NOUN_RE_SRC = ' + countNounSrcMatch[1] + ';');
const measureMatch = src2.match(/var PS_MEASURE_UNIT_RE_SRC =\s*([\s\S]*?);\n/);
eval('var PS_MEASURE_UNIT_RE_SRC = ' + measureMatch[1] + ';');
eval('var PS_COUNT_NOUN_RE = new RegExp(\'^\' + PS_COUNT_NOUN_RE_SRC + \'\\\\b\', \'i\');');
eval('var PS_MEASURE_UNIT_RE = new RegExp(\'^\' + PS_MEASURE_UNIT_RE_SRC + \'\\\\b\', \'i\');');
eval(extractFn('psScanSpecificsForCount', src2));
eval(extractFn('psGetCanonicalUnitCount', src2));
eval(extractFn('psGetPackTotalCount', src2));

console.log('═'.repeat(78));
console.log('FORMULATION / ITEM FORM EVIDENCE RESOLUTION — REGRESSION SUITE');
console.log('Investigación #14 — 19 sep 2026');
console.log('═'.repeat(78));

const NB_TITLE = "Nature's Bounty Sleep Stress Support Sleep3 Maximum Strength Exp 02/27 New";
const NB_CAT = '11776';

// ═══ 1. REAL NATURE'S BOUNTY FIXTURE (end to end) ══════════════════════════
section("1. REAL FIXTURE — UPC 074312006951, Nature's Bounty Sleep3");
{
  let specs = { Formulation: 'Drug Free', 'Item Form': 'Drug Free', Size: '28 Tablets' };
  specs = psScrubHealthSpecs(specs, NB_CAT, NB_TITLE, '074312006951');
  check('Formulation resolves to Tablet', specs['Formulation'], 'Tablet');
  check('Item Form resolves to Tablet', specs['Item Form'], 'Tablet');

  let typeVal = detectType(NB_CAT, NB_TITLE);
  if (!psTypeCategoryPlausible(NB_CAT, typeVal, NB_TITLE)) typeVal = 'Other';
  typeVal = psReconcileTypeWithKnownForm(typeVal, specs['Formulation'], specs['Item Form']);
  check('Final C:Type resolves to Tablet', typeVal, 'Tablet');
  checkTrue('Never Paper Towel', typeVal !== 'Paper Towel', typeVal);
  checkTrue('Never Other', typeVal !== 'Other', typeVal);
  checkTrue('Never Drug Free', typeVal !== 'Drug Free' && specs['Formulation'] !== 'Drug Free', typeVal);
}

// ═══ 2-5. SIZE-EVIDENCE RESCUE MATRIX ══════════════════════════════════════
section('2-5. SIZE EVIDENCE RESCUE — canonical title has no form word');
{
  const cases = [
    ['28 Tablets', 'Tablet'],
    ['80 Gummies', 'Gummy'],
    ['90 Softgels', 'Softgel'],
    ['60 Capsules', 'Capsule'],
  ];
  cases.forEach(([size, exp]) => {
    let specs = { Formulation: 'Drug Free', 'Item Form': 'Drug Free', Size: size };
    specs = psScrubHealthSpecs(specs, NB_CAT, NB_TITLE, 'x');
    check(`Size="${size}" -> Formulation=${exp}`, specs['Formulation'], exp);
    check(`Size="${size}" -> Item Form=${exp}`, specs['Item Form'], exp);
  });
}

// ═══ 6. PHYSICAL-MEASUREMENT NEGATIVES ═════════════════════════════════════
section('6. PHYSICAL-MEASUREMENT NEGATIVES — never inferred as an ingestible form');
{
  const cases = ['8 Inch', '15 Piece', '12 oz', '500 ml'];
  cases.forEach(size => {
    let specs = { Formulation: 'Drug Free', 'Item Form': 'Drug Free', Size: size };
    specs = psScrubHealthSpecs(specs, NB_CAT, NB_TITLE, 'x');
    checkTrue(`Size="${size}" never rescues a form (discarded, not Drug Free)`,
      specs['Formulation'] !== 'Drug Free' && !specs['Formulation'], specs);
  });
}

// ═══ 7-10. INVALID FORM CLAIMS DISCARDED ═══════════════════════════════════
section('7-10. INVALID CLAIMS — never become canonical Formulation/Item Form');
{
  const claims = ['Drug Free', 'Sugar Free', 'Gluten Free', 'Non-GMO'];
  claims.forEach(claim => {
    let specs = { Formulation: claim, 'Item Form': claim };
    specs = psScrubHealthSpecs(specs, NB_CAT, NB_TITLE, 'x');
    checkTrue(`"${claim}" alone (no Size evidence) is discarded, not locked`,
      !specs['Formulation'] && !specs['Item Form'], specs);
    checkTrue(`psFormFromText("${claim}") is not a recognized form`, psFormFromText(claim) === '', psFormFromText(claim));
  });
}

// ═══ 11. HARMONIZATION — valid form wins over invalid ══════════════════════
section('11. HARMONIZATION — a recognized form always wins over an unrecognized one');
{
  check('Drug Free / Tablet -> Tablet / Tablet', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Drug Free', 'Item Form': 'Tablet' }, NB_CAT, NB_TITLE, 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Tablet', 'Tablet']);
  check('Tablet / Drug Free -> Tablet / Tablet (order-independent)', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Tablet', 'Item Form': 'Drug Free' }, NB_CAT, NB_TITLE, 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Tablet', 'Tablet']);
  check('Sugar Free / Gummy -> Gummy / Gummy', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Sugar Free', 'Item Form': 'Gummy' }, NB_CAT, NB_TITLE, 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Gummy', 'Gummy']);
  check('Non-GMO / Capsule -> Capsule / Capsule', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Non-GMO', 'Item Form': 'Capsule' }, NB_CAT, NB_TITLE, 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Capsule', 'Capsule']);
  check('Gluten Free / Softgel -> Softgel / Softgel', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Gluten Free', 'Item Form': 'Softgel' }, NB_CAT, NB_TITLE, 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Softgel', 'Softgel']);
  checkTrue('Neither valid (Drug Free / Non-Habit Forming) never becomes a canonical form', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Drug Free', 'Item Form': 'Non-Habit Forming' }, NB_CAT, NB_TITLE, 'x');
    return !s['Formulation'] && !s['Item Form'];
  })());
  check('Both valid, disagree, neither in title -> existing Formulation-wins tiebreak preserved', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Tablet', 'Item Form': 'Capsule' }, NB_CAT, NB_TITLE, 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Tablet', 'Tablet']);
  check('Both valid, disagree, Item Form word IS in title -> existing title-wins tiebreak preserved', (() => {
    let s = psScrubHealthSpecs({ Formulation: 'Tablet', 'Item Form': 'Capsule' }, NB_CAT, 'SeroVital 160 Capsules Supplement New', 'x');
    return [s['Formulation'], s['Item Form']];
  })(), ['Capsule', 'Capsule']);
}

// ═══ 12-15. REAL REGRESSIONS — already-correct fixtures stay correct ══════
section('12-15. REGRESSIONS — Omega-3 Gummy / SeroVital / B12 Softgel / Nature\'s Truth Tablet');
{
  const cases = [
    ['Omega-3 Gummy', 'Nature Made Multivitamin Omega-3 Gummies 160 Total Exp 02/27 Pack of 2 New', 'Gummy'],
    ['SeroVital', 'SeroVital Anti-Aging Renewal Complex 160 Capsules Supplement New', 'Capsule'],
    ['B12 Softgel', 'Nature Made Vitamin B12 Softgels Energy 180 Total Exp 05/27 Pack of 2 New', 'Softgel'],
    ["Nature's Truth Tablet", "Nature's Truth Tablets Non-GMO 270 Total Exp 06/28 Pack of 3 New", 'Tablet'],
  ];
  cases.forEach(([label, title, form]) => {
    let s = psScrubHealthSpecs({ Formulation: form, 'Item Form': form }, NB_CAT, title, 'x');
    check(`${label}: Formulation stays ${form}`, s['Formulation'], form);
    check(`${label}: Item Form stays ${form}`, s['Item Form'], form);
    let typeVal = detectType(NB_CAT, title);
    if (!psTypeCategoryPlausible(NB_CAT, typeVal, title)) typeVal = 'Other';
    typeVal = psReconcileTypeWithKnownForm(typeVal, s['Formulation'], s['Item Form']);
    check(`${label}: final C:Type = ${form}`, typeVal, form);
  });
}

// ═══ 16. NATURE'S BOUNTY COUNT MATH — unaffected by this change ═══════════
section("16. COUNT MATH — Nature's Bounty 28-per-bottle, no amplification");
{
  const cur = { _canonicalSpecifics: { Size: '28 Tablets' } };
  check('psGetCanonicalUnitCount = 28', psGetCanonicalUnitCount(cur), 28);
  const packs = { 1: 28, 2: 56, 3: 84, 6: 168, 12: 336 };
  Object.keys(packs).forEach(p => {
    check(`psGetPackTotalCount(cur, ${p}) = ${packs[p]}`, psGetPackTotalCount(cur, Number(p)), packs[p]);
  });
}

// ═══ 17. TYPE RECONCILIATION PRODUCES TABLET ═══════════════════════════════
section('17. TYPE RECONCILIATION — psReconcileTypeWithKnownForm produces Tablet');
{
  check("psReconcileTypeWithKnownForm('Other', 'Tablet', 'Tablet') = Tablet",
    psReconcileTypeWithKnownForm('Other', 'Tablet', 'Tablet'), 'Tablet');
  check("psReconcileTypeWithKnownForm('Other', 'Drug Free', 'Drug Free') = Other (no rescue, not a known form)",
    psReconcileTypeWithKnownForm('Other', 'Drug Free', 'Drug Free'), 'Other');
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
