// Regression suite for the physical-measurement-vs-count fix.
// Runs the REAL exported functions from multipack-fixes.js and app.js (no
// reimplementations) against the required fixtures from the approved scope.

const fs = require('fs');
const assert = require('assert');

let passed = 0, failed = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log('  ✓ ' + label); }
  else {
    failed++;
    failures.push(label);
    console.log('  ✗ ' + label);
    console.log('      expected:', JSON.stringify(expected));
    console.log('      actual:  ', JSON.stringify(actual));
  }
}

const fx = require('./multipack-fixes.js');
const {
  psScanSpecificsForCount,
  psGetCanonicalUnitCount,
  psGetPackTotalCount,
  psBuildCountSegments,
  descForPackFixed
} = fx;

// ── app.js: extract descForPack() (live production description builder) and
// psRequireUnitCountForMultipack-adjacent helpers via brace-matching, same
// technique used by test-classifier-type-category.js, so this suite exercises
// the REAL app.js code, not a reimplementation.
const appSrc = fs.readFileSync('./app.js', 'utf8');
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}
// descForPack() calls psCanonicalProductName() and psPluralizeUnitNoun();
// provide real/minimal stand-ins so it runs standalone.
var psGetCanonicalUnitCount_ = psGetCanonicalUnitCount;
var psGetUnitNoun = fx.psGetUnitNoun;
var psPluralizeUnitNoun = fx.psPluralizeUnitNoun;
function psCanonicalProductName(t) { return String(t || '').trim(); }
eval(extractFn(appSrc, 'descForPack').replace('function descForPack', 'var descForPack = function'));

console.log('='.repeat(80));
console.log('COUNT SCANNER FIX — REGRESSION SUITE');
console.log('='.repeat(80));

// ============================================================================
// NEGATIVE MEASUREMENT MATRIX — must all return null
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('NEGATIVE MEASUREMENT MATRIX (psScanSpecificsForCount)');
console.log('='.repeat(80));
[
  '8 Inch', '8 inches', '8 in', '12 oz', '16 fl oz', '500 ml', '2 lb',
  '10 cm', '10 mm', '3 ft', '250 g', '1 kg', '1 liter', '1 gallon',
  '4.76 oz'
].forEach(function (v) {
  check('Size="' + v + '" -> null', psScanSpecificsForCount({ Size: v }), null);
});

// ============================================================================
// POSITIVE COUNT MATRIX — must all return the correct integer
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('POSITIVE COUNT MATRIX (psScanSpecificsForCount)');
console.log('='.repeat(80));
[
  ['25 Count', 25], ['25 Ct', 25], ['100 Pieces', 100], ['100 Pcs', 100],
  ['60 Tablets', 60], ['30 Capsules', 30], ['240 Pellets', 240],
  ['12 Bags', 12], ['26 Strips', 26], ['50 Gummies', 50],
  ['30 Packets', 30], ['60 Softgels', 60], ['90 Pads', 90],
  ['20 Wipes', 20], ['10 Patches', 10], ['6 Tests', 6]
].forEach(function (pair) {
  check('Size="' + pair[0] + '" -> ' + pair[1], psScanSpecificsForCount({ Size: pair[0] }), pair[1]);
});

// ============================================================================
// BARE INTEGER POLICY
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('BARE INTEGER POLICY');
console.log('='.repeat(80));
check('Size="100" (ambiguous field) -> null', psScanSpecificsForCount({ Size: '100' }), null);
check('Count="100" (trusted field name) -> 100', psScanSpecificsForCount({ Count: '100' }), 100);
check("Unit Quantity=\"25\" (trusted field name) -> 25", psScanSpecificsForCount({ 'Unit Quantity': '25' }), 25);
check('Size="100 Count" (explicit noun, trusted regardless of field) -> 100', psScanSpecificsForCount({ Size: '100 Count' }), 100);

// ============================================================================
// SQUISHMALLOWS REAL FIXTURE
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('SQUISHMALLOWS REAL FIXTURE (UPC 196566213036)');
console.log('='.repeat(80));
var squish = {
  title: 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy',
  category: '220',
  _countConfirmed: null,
  _specifics: { Size: '8 Inch', Type: 'Plushie' },
  _canonicalSpecifics: { Size: '8 Inch' },
  _canonicalProductName: 'Squishmallows Peanuts Woodstock Cupid 8 Inch Plush Toy'
};
check('psScanSpecificsForCount(Size="8 Inch") -> null', psScanSpecificsForCount(squish._canonicalSpecifics), null);
check('psGetCanonicalUnitCount(squish) -> null (before employee confirms)', psGetCanonicalUnitCount(squish), null);
check('psGetPackTotalCount(squish, 3) -> null (no unit count yet)', psGetPackTotalCount(squish, 3), null);
check('psBuildCountSegments(squish, 3, title) -> [] (no unit count yet)', psBuildCountSegments(squish, 3, squish.title), []);

// Simulate the count gate: employee is prompted (unitCount unknown) and
// honestly answers "1" (each package is one indivisible plush).
squish._countConfirmed = 1;
check('psGetCanonicalUnitCount(squish) -> 1 after employee confirms 1', psGetCanonicalUnitCount(squish), 1);
check('psGetPackTotalCount(squish, 3) -> 3 (1 x 3, math still correct)', psGetPackTotalCount(squish, 3), 3);
check('psBuildCountSegments(squish, 3, title) -> [] (unitCount=1 suppressed, no "3 Total")', psBuildCountSegments(squish, 3, squish.title), []);

var squishDesc = descForPack('Soft and cuddly.', 3, squish);
console.log('  description (Pack 3):', JSON.stringify(squishDesc));
check('description does NOT contain "count each"', /count each/i.test(squishDesc), false);
check('description does NOT contain "total"', /\btotal\b/i.test(squishDesc), false);
check('description DOES say "3 individual units"', /3 individual units/i.test(squishDesc), true);

var squishDescFixed = descForPackFixed('Soft and cuddly.', 3, squish);
console.log('  descForPackFixed (Pack 3):', JSON.stringify(squishDescFixed));
check('descForPackFixed does NOT contain "count each"', /count each/i.test(squishDescFixed), false);
check('descForPackFixed does NOT contain "total"', /\btotal\b/i.test(squishDescFixed), false);

// ============================================================================
// REGRESSION — ZICAM / ZELLIES must remain correct
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('REGRESSION — ZICAM / ZELLIES / OTHER REAL COUNT FIXTURES');
console.log('='.repeat(80));
var zicam = {
  title: 'Zicam Ultra Cold Remedy Zinc RapidMelts Quick Dissolve Tablets 25 Count',
  category: '75038',
  _countConfirmed: null,
  _specifics: { Size: '25 Count' },
  _canonicalSpecifics: { Size: '25 Count' }
};
check('Zicam unitCount -> 25', psGetCanonicalUnitCount(zicam), 25);
check('Zicam Pack 3 -> 75 Total', psGetPackTotalCount(zicam, 3), 75);

var zellies = {
  title: 'Zellies Dental Gum Spearmint 100 Pieces 4.76oz Sugar Free Xylitol Gum',
  category: '180959',
  _countConfirmed: null,
  _specifics: { Size: '100 Pieces' },
  _canonicalSpecifics: { Size: '100 Pieces' }
};
check('Zellies unitCount -> 100', psGetCanonicalUnitCount(zellies), 100);
check('Zellies Pack 3 -> 300 Total', psGetPackTotalCount(zellies, 3), 300);

[
  ['30 Count', 30], ['60 Tablets', 60], ['240 Pellets', 240],
  ['12 Bags', 12], ['26 Strips', 26]
].forEach(function (pair) {
  var cur = { _countConfirmed: null, _specifics: {}, _canonicalSpecifics: { Size: pair[0] } };
  check('Regression Size="' + pair[0] + '" unitCount -> ' + pair[1], psGetCanonicalUnitCount(cur), pair[1]);
});

// Segments still emitted normally for a real multi-piece-per-unit product.
var zicamSegments = psBuildCountSegments(zicam, 3, zicam.title);
console.log('  Zicam segments (Pack 3):', JSON.stringify(zicamSegments));
check('Zicam still emits a "75" total segment', zicamSegments.some(function(s){ return /75/.test(s.text); }), true);

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log('passed:', passed);
console.log('failed:', failed);
console.log('total: ', passed + failed);
if (failed) {
  console.log('\nFAILED:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exitCode = 1;
}
console.log('='.repeat(80));
