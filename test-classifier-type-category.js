#!/usr/bin/env node

/**
 * CLASSIFIER TYPE/CATEGORY GUARD — REGRESSION SUITE
 *
 * Covers the three approved fixes to detectType()/catId() in app.js:
 *   A. Word-boundary anchoring on short commodity tokens (k.?cup, chip,
 *      cup, pan, pot, usb, soup, broom, candle) that could match inside
 *      unrelated words.
 *   B. Strong product-identity precedence (toy: plush/figure/doll/
 *      squishmallow; supplement: capsule/tablet/softgel) that runs before
 *      any commodity rule can win.
 *   C. A plausibility guard at CSV-row build time that rejects an
 *      incompatible Type/category pairing rather than exporting it.
 *
 * Real fixtures that motivated this fix:
 *   SQU-196566213036-2pk — "Squishmallows Peanuts Woodstock Cupid 8 Inch
 *   Plush Toy" exported Category 14308 (Food) / C:Type "Coffee".
 *   SeroVital (Anti-Aging capsules) exported C:Type "Face Cream".
 *
 * Runs the REAL catId(), detectType(), and psTypeCategoryPlausible()
 * extracted from app.js — not reimplementations.
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
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

// PS_TOY_CATS is a real top-level array in app.js; extract it verbatim so
// psTypeCategoryPlausible() sees the exact same list production uses.
const toyCatsMatch = src.match(/var PS_TOY_CATS = (\[[^\]]*\]);/);
if (!toyCatsMatch) throw new Error('PS_TOY_CATS not found');
eval('var PS_TOY_CATS = ' + toyCatsMatch[1] + ';');

// CAT_TYPE is a free variable detectType() falls back to when no title
// pattern matches — extract it too (same brace-matching approach).
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
eval(extractVar('CAT_TYPE'));

// PS_FOOD_TYPES / PS_TOPICAL_BEAUTY_TYPES live as sibling `var` statements
// right before psTypeCategoryPlausible(), not inside its body — extract them
// verbatim too so the guard sees the exact same lists production uses.
const foodTypesMatch = src.match(/var PS_FOOD_TYPES = (\[[\s\S]*?\]);/);
const beautyTypesMatch = src.match(/var PS_TOPICAL_BEAUTY_TYPES = (\[[^\]]*\]);/);
if (!foodTypesMatch || !beautyTypesMatch) throw new Error('PS_FOOD_TYPES / PS_TOPICAL_BEAUTY_TYPES not found');
eval('var PS_FOOD_TYPES = ' + foodTypesMatch[1] + ';');
eval('var PS_TOPICAL_BEAUTY_TYPES = ' + beautyTypesMatch[1] + ';');

eval(extractFn('catId'));
eval(extractFn('detectType'));
eval(extractFn('psTypeCategoryPlausible'));

console.log('═'.repeat(78));
console.log('CLASSIFIER TYPE/CATEGORY GUARD — REGRESSION SUITE');
console.log('═'.repeat(78));

// ─────────────────────────────────────────────────────────────────────────
section('R1 — REAL FIXTURE: Squishmallows (SQU-196566213036-2pk)');
// ─────────────────────────────────────────────────────────────────────────
{
  const title = 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy';
  const cat = catId(title);
  const type = detectType(cat, title);
  const plausible = psTypeCategoryPlausible(cat, type, title);
  const finalType = plausible ? type : 'Other';
  console.log(`  title    : "${title}"`);
  console.log(`  catId    : ${cat}   (before fix: 14308)`);
  console.log(`  detectType: ${type}`);
  console.log(`  C:Type (post-guard): ${finalType}   (before fix: Coffee)`);
  check('R1a category is 220 (Toys)', cat, '220');
  checkTrue('R1b C:Type is not Coffee', finalType !== 'Coffee', finalType);
  checkTrue('R1c C:Type is not any food type', !['Coffee','Snack','Soup','Tea','Candy'].includes(finalType), finalType);
  check('R1d C:Type is Plushie (identity precedence)', finalType, 'Plushie');
}

// ─────────────────────────────────────────────────────────────────────────
section('R2 — REAL FIXTURE: SeroVital (Anti-Aging capsules)');
// ─────────────────────────────────────────────────────────────────────────
{
  const title = 'SeroVital Advanced Anti-Aging Renewal Complex 160 Capsules';
  const cat = catId(title);
  const type = detectType(cat, title);
  const plausible = psTypeCategoryPlausible(cat, type, title);
  const finalType = plausible ? type : 'Other';
  console.log(`  title    : "${title}"`);
  console.log(`  catId    : ${cat}`);
  console.log(`  detectType: ${type}   (before fix: Face Cream)`);
  console.log(`  C:Type (post-guard): ${finalType}`);
  checkTrue('R2a C:Type is not Face Cream', finalType !== 'Face Cream', finalType);
  checkTrue('R2b C:Type is not any topical beauty type', !['Face Cream','Body Lotion','Lotion','Serum'].includes(finalType), finalType);
  check('R2c C:Type reflects dosage form (Capsule)', finalType, 'Capsule');
}

// ─────────────────────────────────────────────────────────────────────────
section('R3 — NEGATIVE COLLISION MATRIX (must NOT misclassify)');
// ─────────────────────────────────────────────────────────────────────────
const NEGATIVE = [
  { title: "Chip 'n Dale Rescue Rangers Chipmunk Plush Figure Toy", badCat: '14308', badType: 'Snack' },
  { title: 'Vintage Chippendale Style Wooden Side Table Furniture', badCat: '14308', badType: 'Snack' },
  { title: 'Computer Motherboard Chipset Replacement Part', badCat: '14308', badType: 'Snack' },
  { title: 'Microchip RFID Pet Implant Reader', badCat: '14308', badType: 'Snack' },
  { title: "Father's Day Gift for Husband Personalized Mug", badCat: '293', badType: null },
  { title: 'Panda Bear Plush Stuffed Animal Toy 12 Inch', badCat: '20654', badType: null },
  { title: 'Wonder Woman Cupid Bow Costume Accessory', badCat: '20695', badType: null },
  { title: 'Occupant Mail Sorter Organizer Wall Mount', badCat: '20695', badType: null },
  { title: 'Ford Mustang Souped-Up Model Car Die-Cast Toy', badCat: '14308', badType: 'Soup' },
  { title: 'Halloween Witch Broomstick Costume Prop 40 Inch', badCat: '20625', badType: 'Cleaning Tool' },
  { title: 'Birthday Candlestick Holder Set Brass Vintage', badCat: '20625', badType: null },
  { title: 'Panda Express Gift Card $25', badCat: '20654', badType: null },
];
NEGATIVE.forEach(({ title, badCat, badType }) => {
  const cat = catId(title);
  const type = detectType(cat, title);
  const plausible = psTypeCategoryPlausible(cat, type, title);
  const finalType = plausible ? type : 'Other';
  console.log(`\n  "${title}"`);
  console.log(`    catId=${cat}  detectType=${type}  final=${finalType}`);
  checkTrue(`R3 "${title.slice(0,40)}...": category != ${badCat}`, cat !== badCat, cat);
  if (badType) checkTrue(`R3 "${title.slice(0,40)}...": Type != ${badType}`, finalType !== badType, finalType);
});

// ─────────────────────────────────────────────────────────────────────────
section('R4 — POSITIVE CONTROLS (must remain correct)');
// ─────────────────────────────────────────────────────────────────────────
const POSITIVE = [
  { title: 'Starbucks Pike Place K-Cup Coffee Pods 24 Count', wantCat: '14308', wantType: 'Coffee' },
  { title: "Lay's Classic Potato Chips Family Size Bag", wantCat: '14308', wantType: 'Snack' },
  { title: 'Campbell\'s Chicken Noodle Soup 10.5 oz Can', wantCat: '14308', wantType: 'Soup' },
  { title: 'USB C Charging Cable Fast Charge Cord 6ft', wantCat: '293', wantType: null },
  { title: 'Lodge Cast Iron Frying Pan 12 Inch Skillet', wantCat: '20654', wantType: null },
  { title: 'Yeti Rambler 20oz Travel Mug Stainless Steel', wantCat: '20695', wantType: null },
  { title: 'Yankee Candle Large Jar Vanilla Cupcake Scented', wantCat: '20625', wantType: 'Candle' },
  { title: 'Silly Putty Squish Fidget Toy Sensory', wantCat: '220', wantType: null },
  { title: 'Revlon Super Lustrous Lipstick Red', wantCat: null, wantType: 'Lipstick' },
  { title: 'Frontline Plus Flea and Tick Treatment for Dogs', wantCat: null, wantType: 'Flea & Tick' },
];
POSITIVE.forEach(({ title, wantCat, wantType }) => {
  const cat = catId(title);
  const type = detectType(cat, title);
  const plausible = psTypeCategoryPlausible(cat, type, title);
  const finalType = plausible ? type : 'Other';
  console.log(`\n  "${title}"`);
  console.log(`    catId=${cat}  detectType=${type}  final=${finalType}`);
  if (wantCat) check(`R4 "${title.slice(0,40)}...": category == ${wantCat}`, cat, wantCat);
  if (wantType) check(`R4 "${title.slice(0,40)}...": Type == ${wantType}`, finalType, wantType);
});

// ─────────────────────────────────────────────────────────────────────────
section('R5 — HISTORIC REGRESSION: lipstick/chapstick never Flea & Tick');
// ─────────────────────────────────────────────────────────────────────────
['Revlon Lipstick Matte Red', 'ChapStick Classic Original Lip Balm 3 Pack'].forEach(title => {
  const cat = catId(title);
  const type = detectType(cat, title);
  checkTrue(`R5 "${title}": Type != Flea & Tick`, type !== 'Flea & Tick', type);
});

// ─────────────────────────────────────────────────────────────────────────
section('R6 — psTypeCategoryPlausible() direct unit tests');
// ─────────────────────────────────────────────────────────────────────────
check('R6a Coffee + toy category -> implausible', psTypeCategoryPlausible('220', 'Coffee', 'x'), false);
check('R6b Coffee + food category -> plausible', psTypeCategoryPlausible('14308', 'Coffee', 'x'), true);
check('R6c Face Cream + capsule evidence -> implausible', psTypeCategoryPlausible('31786', 'Face Cream', 'Foo Capsules'), false);
check('R6d Face Cream + no capsule evidence -> plausible', psTypeCategoryPlausible('31786', 'Face Cream', 'Foo Face Cream 2oz'), true);
check('R6e null Type is always plausible (nothing to reject)', psTypeCategoryPlausible('220', null, 'x'), true);
check('R6f Toy Type + toy category -> plausible', psTypeCategoryPlausible('220', 'Toy', 'x'), true);

// ─────────────────────────────────────────────────────────────────────────
section('R7 — full before/after fixture matrix');
// ─────────────────────────────────────────────────────────────────────────
const MATRIX = [
  ['Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy', '14308', 'Coffee', '220', 'Plushie'],
  ['SeroVital Advanced Anti-Aging Renewal Complex 160 Capsules', '31786', 'Face Cream', null, 'Capsule'],
  ["Chip 'n Dale Rescue Rangers Chipmunk Plush Figure Toy", '14308', 'Snack', '220', 'Plushie'],
  ['Ford Mustang Souped-Up Model Car Die-Cast Toy', '14308', 'Soup', '220', 'Toy Vehicle'],
];
console.log('title | old category | new category | old Type | new Type | PASS/FAIL');
MATRIX.forEach(([title, oldCat, oldType, expectCat, expectType]) => {
  const cat = catId(title);
  const type = detectType(cat, title);
  const plausible = psTypeCategoryPlausible(cat, type, title);
  const finalType = plausible ? type : 'Other';
  const catOk = expectCat ? cat === expectCat : true;
  const typeOk = finalType === expectType;
  const pass = catOk && typeOk;
  console.log(`\n  "${title}"`);
  console.log(`    old: category=${oldCat} Type=${oldType}`);
  console.log(`    new: category=${cat} Type=${finalType}`);
  console.log(`    expected: category=${expectCat || '(any)'} Type=${expectType}`);
  console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
  check(`R7 "${title.slice(0,40)}...": matrix expectation met`, pass, true);
});

console.log('\n' + '═'.repeat(78));
console.log('SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log(`  - ${f.name}`)); }
console.log('═'.repeat(78));

process.exit(failed ? 1 : 0);
