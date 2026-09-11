#!/usr/bin/env node

/**
 * MULTIPACK FIXES — COMPREHENSIVE TEST SUITE (rev 2)
 *
 * Real assertion harness. Every check increments passed/failed.
 * Exit code is non-zero if anything fails.
 *
 * A: canonical Size 26 Count / current 52 Count  -> restore 26 Count
 * B: canonical Size missing  / current 120 Count -> preserve 120 Count
 * C: canonical Volume 16 oz  / current 32 oz     -> proven multiple -> restore
 * D: canonical Volume missing/ current 32 oz     -> preserve 32 oz
 * E: exactly one terminal standalone "New"
 * F: unit noun matrix (softgels/tablets/gummies/pellets/strips/capsules)
 * G: 80-char protection — "Pack of N" and "New" never truncated away
 * H: derived totals + manual-edit normalization + description matrix
 */

const fx = require('./multipack-fixes.js');

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    failures.push({ name, actual, expected });
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
  return ok;
}

function checkTrue(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    failures.push({ name, actual: detail, expected: 'true' });
    console.log(`  ✗ ${name}${detail ? '\n      detail: ' + detail : ''}`);
  }
  return !!cond;
}

function section(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }

// ============================================================================
section('TEST A — canonical Size 26 Count, current 52 Count -> RESTORE');
// ============================================================================
{
  const cur = {
    title: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    _countConfirmed: 26,
    _canonicalProductName: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    _canonicalSpecifics: { Size: '26 Count' },
    _specifics: { Size: '52 Count' },
    _selectedPack: 3
  };
  const audit = fx.restoreCanonicalSpecifics(cur, ['Size']);
  console.log(`  audit: ${audit[0].action} — ${audit[0].reason}`);
  check('A1 Size restored to canonical', cur._specifics.Size, '26 Count');
  check('A2 audit action is "restored"', audit[0].action, 'restored');
  check('A3 proven ratio recorded', audit[0].ratio, 2);
  check('A4 unit count stays 26', fx.psGetCanonicalUnitCount(cur), 26);
  check('A5 pack-2 total', fx.psGetPackTotalCount(cur, 2), 52);
  check('A6 pack-3 total', fx.psGetPackTotalCount(cur, 3), 78);
}

// ============================================================================
section('TEST B — canonical Size MISSING, current 120 Count -> PRESERVE');
// ============================================================================
{
  const cur = {
    title: 'Some Supplement 120 Count',
    _canonicalSpecifics: {},
    _specifics: { Size: '120 Count' },
    _selectedPack: 3
  };
  const audit = fx.restoreCanonicalSpecifics(cur, ['Size']);
  console.log(`  audit: ${audit[0].action} — ${audit[0].reason}`);
  check('B1 120 Count preserved verbatim', cur._specifics.Size, '120 Count');
  check('B2 audit action is "preserved"', audit[0].action, 'preserved');
  checkTrue('B3 field was not deleted', Object.prototype.hasOwnProperty.call(cur._specifics, 'Size'));
  checkTrue('B4 no inference claimed', /no canonical per-unit value/.test(audit[0].reason), audit[0].reason);
}

// ============================================================================
section('TEST C — canonical Volume 16 oz, current 32 oz -> proven x2 -> RESTORE');
// ============================================================================
{
  const cur = {
    title: 'Liquid 16 oz',
    _canonicalSpecifics: { Volume: '16 oz' },
    _specifics: { Volume: '32 oz' },
    _selectedPack: 2
  };
  const audit = fx.restoreCanonicalSpecifics(cur, ['Volume']);
  console.log(`  audit: ${audit[0].action} — ${audit[0].reason}`);
  check('C1 Volume restored to per-unit 16 oz', cur._specifics.Volume, '16 oz');
  check('C2 audit action is "restored"', audit[0].action, 'restored');
  check('C3 ratio x2 proven', audit[0].ratio, 2);

  // Non-multiple must NOT be touched: 16 oz canonical vs 20 oz current.
  const cur2 = { _canonicalSpecifics: { Volume: '16 oz' }, _specifics: { Volume: '20 oz' } };
  const audit2 = fx.restoreCanonicalSpecifics(cur2, ['Volume']);
  console.log(`  audit(20 oz): ${audit2[0].action} — ${audit2[0].reason}`);
  check('C4 non-multiple 20 oz preserved', cur2._specifics.Volume, '20 oz');
  check('C5 audit action is "preserved"', audit2[0].action, 'preserved');

  // Unit mismatch must not be treated as pack-derived.
  const cur3 = { _canonicalSpecifics: { Size: '16 oz' }, _specifics: { Size: '32 Count' } };
  fx.restoreCanonicalSpecifics(cur3, ['Size']);
  check('C6 unit mismatch preserved', cur3._specifics.Size, '32 Count');
}

// ============================================================================
section('TEST D — canonical Volume MISSING, current 32 oz -> PRESERVE');
// ============================================================================
{
  const cur = {
    title: 'Liquid 32 oz',
    _canonicalSpecifics: {},
    _specifics: { Volume: '32 oz' },
    _selectedPack: 3
  };
  const audit = fx.restoreCanonicalSpecifics(cur, ['Volume']);
  console.log(`  audit: ${audit[0].action} — ${audit[0].reason}`);
  check('D1 32 oz preserved', cur._specifics.Volume, '32 oz');
  check('D2 audit action is "preserved"', audit[0].action, 'preserved');

  // Regression from rev 1: per-unit 16 oz must never be multiplied or dropped.
  const cur2 = { _canonicalSpecifics: { Volume: '16 oz' }, _specifics: { Volume: '16 oz' }, _selectedPack: 3 };
  fx.restoreCanonicalSpecifics(cur2, ['Volume']);
  check('D3 per-unit 16 oz untouched at pack 3', cur2._specifics.Volume, '16 oz');
}

// ============================================================================
section('TEST E — exactly ONE standalone terminal "New"');
// ============================================================================
{
  const cases = [
    { in: '240 Pellets New Pack of 3 New', out: '240 Pellets Pack of 3 New' },
    { in: 'Product New Pack of 3 New',     out: 'Product Pack of 3 New' },
    { in: 'Product new new Pack of 2 New', out: 'Product Pack of 2 New' },
    { in: 'Item',                          out: 'Item New' },
    { in: 'Item New',                      out: 'Item New' }
  ];
  cases.forEach((c, i) => {
    const out = fx.normalizeDuplicateNew(c.in);
    check(`E${i + 1} "${c.in}"`, out, c.out);
    checkTrue(`E${i + 1}a exactly one standalone New`, fx.countStandaloneNewTokens(out) === 1,
      `count=${fx.countStandaloneNewTokens(out)} in "${out}"`);
    checkTrue(`E${i + 1}b terminal New`, out.endsWith(' New'), out);
  });

  // Identity "New" must survive and must not be counted as a condition token.
  const idOut = fx.normalizeDuplicateNew('New York Style Bagels Pack of 2 New');
  check('E6 identity "New York" preserved', idOut, 'New York Style Bagels Pack of 2 New');
  check('E6a condition-New count is 1', fx.countStandaloneNewTokens(idOut), 1);
  checkTrue('E6b terminal New', idOut.endsWith(' New'), idOut);

  // "Newborn" is not a standalone token and must be untouched.
  const nb = fx.normalizeDuplicateNew('Pampers Newborn Diapers Pack of 3 New');
  check('E7 "Newborn" untouched', nb, 'Pampers Newborn Diapers Pack of 3 New');
}

// ============================================================================
section('TEST F — unit noun matrix');
// ============================================================================
{
  const matrix = [
    { form: 'Softgel', unit: 30, pack: 3, noun: 'softgel', expect: '30 softgels each, 90 softgels total' },
    { form: 'Tablet',  unit: 60, pack: 2, noun: 'tablet',  expect: '60 tablets each, 120 tablets total' },
    { form: 'Gummy',   unit: 50, pack: 2, noun: 'gummy',   expect: '50 gummies each, 100 gummies total' },
    { form: 'Pellet',  unit: 240, pack: 3, noun: 'pellet', expect: '240 pellets each, 720 pellets total' },
    { form: 'Strip',   unit: 26, pack: 3, noun: 'strip',   expect: '26 strips each, 78 strips total' },
    { form: 'Capsule', unit: 14, pack: 4, noun: 'capsule', expect: '14 capsules each, 56 capsules total' }
  ];

  matrix.forEach((m, i) => {
    const cur = {
      title: 'Test Product ' + m.unit + ' Count',
      _countConfirmed: m.unit,
      _canonicalProductName: 'Test Product ' + m.unit + ' Count',
      _canonicalSpecifics: { Size: m.unit + ' Count', 'Item Form': m.form },
      _specifics: {}
    };
    const noun = fx.psGetUnitNoun(cur);
    check(`F${i + 1} noun for form "${m.form}"`, noun && noun.key, m.noun);

    const desc = fx.descForPackFixed('Base copy.', m.pack, cur);
    checkTrue(`F${i + 1}a description says "${m.expect}"`, desc.includes(m.expect), desc);
    check(`F${i + 1}b total ${m.unit}x${m.pack}`, fx.psGetPackTotalCount(cur, m.pack), m.unit * m.pack);
  });

  // Unknown form must NOT invent a noun -> neutral "count each / total".
  const unknown = {
    title: 'Mystery Item 26 Count',
    _countConfirmed: 26,
    _canonicalProductName: 'Mystery Item 26 Count',
    _canonicalSpecifics: { Size: '26 Count' },
    _specifics: {}
  };
  check('F7 unknown form yields no noun', fx.psGetUnitNoun(unknown), null);
  const dUnknown = fx.descForPackFixed('Base copy.', 3, unknown);
  checkTrue('F7a neutral fallback phrasing', dUnknown.includes('26 count each, 78 total'), dUnknown);

  // Spec title format: "240 Pellets Each 720 Total Pack of 3 New"
  const pelletCur = {
    title: '240 Pellets',
    _countConfirmed: 240,
    _canonicalProductName: '240 Pellets',
    _canonicalSpecifics: { Size: '240 Count', 'Item Form': 'Pellet' },
    _specifics: {},
    _titleManual: true
  };
  const pelletTitle = fx.normalizeManualTitleForPackChange('240 Pellets New Pack of 2 New', pelletCur, 3);
  console.log(`  spec-format title: "${pelletTitle}"`);
  checkTrue('F9 noun rides the Each segment ("240 Pellets Each")',
    pelletTitle.includes('240 Pellets Each'), pelletTitle);
  checkTrue('F9a total is a bare number ("720 Total")',
    pelletTitle.includes('720 Total') && !pelletTitle.includes('720 pellets Total'), pelletTitle);
  checkTrue('F9b ends "Pack of 3 New"', pelletTitle.endsWith('Pack of 3 New'), pelletTitle);
  check('F9c exactly one condition New', fx.countStandaloneNewTokens(pelletTitle), 1);

  // Singular pluralization guard.
  const single = {
    _countConfirmed: 1,
    _canonicalSpecifics: { Size: '1 Count', 'Item Form': 'Tablet' },
    _specifics: {}
  };
  check('F8 singular noun at count 1', fx.psPluralizeUnitNoun(fx.psGetUnitNoun(single), 1), 'tablet');
}

// ============================================================================
section('TEST G — 80-char protection: Pack of N and New never truncated away');
// ============================================================================
{
  const longCur = {
    title: 'Vicks ZzzQuil Ultra Sleep Aid Nighttime Nasal Breathe Right Extra Strength Drug Free Berry Flavor 26 Count',
    _countConfirmed: 26,
    _canonicalProductName: 'Vicks ZzzQuil Ultra Sleep Aid Nighttime Nasal Breathe Right Extra Strength Drug Free Berry Flavor 26 Count',
    _canonicalSpecifics: { Size: '26 Count', 'Item Form': 'Strip' },
    _specifics: {},
    _titleManual: true
  };

  const long = fx.normalizeManualTitleForPackChange(
    'Vicks ZzzQuil Ultra Sleep Aid Nighttime Nasal Breathe Right Extra Strength Drug Free Berry Flavor 26ct Ea 52 Total Pack of 2 New',
    longCur, 3
  );
  console.log(`  fitted (${long.length} chars): "${long}"`);
  checkTrue('G1 within 80 chars', long.length <= 80, `${long.length}`);
  checkTrue('G2 "Pack of 3" survives', long.includes('Pack of 3'), long);
  checkTrue('G3 terminal "New" survives', long.endsWith(' New'), long);
  check('G4 exactly one condition New', fx.countStandaloneNewTokens(long), 1);
  checkTrue('G5 stale "52 Total" gone', !long.includes('52 Total'), long);

  // Pathological base: a single enormous token must still keep the tail.
  const extreme = fx.psFitTitleSemantic(
    'A'.repeat(70) + ' ' + 'B'.repeat(70),
    [{ text: '26 Each', dropPriority: 1 }, { text: '78 Total', dropPriority: 2 }],
    'Pack of 3 New', 80
  );
  console.log(`  extreme (${extreme.length} chars): "${extreme}"`);
  checkTrue('G6 tail survives pathological base', extreme.endsWith('Pack of 3 New'), extreme);

  // Expiration inside the protected tail must survive too.
  const withExp = fx.psFitTitleSemantic(
    'Some Very Long Product Descriptor Words That Overflow The Limit Easily Indeed',
    [{ text: '26 Each', dropPriority: 1 }, { text: '78 Total', dropPriority: 2 }],
    'Exp 03/27 Pack of 3 New', 80
  );
  console.log(`  withExp (${withExp.length} chars): "${withExp}"`);
  checkTrue('G7 within 80 chars', withExp.length <= 80, `${withExp.length}`);
  checkTrue('G8 expiration survives', withExp.includes('Exp 03/27'), withExp);
  checkTrue('G9 Pack of 3 survives', withExp.includes('Pack of 3'), withExp);
  checkTrue('G10 terminal New survives', withExp.endsWith(' New'), withExp);

  // Short title: nothing should be dropped.
  const shortFit = fx.psFitTitleSemantic('Advil Liqui Gels',
    [{ text: '20 Each', dropPriority: 1 }, { text: '40 Total', dropPriority: 2 }], 'Pack of 2 New', 80);
  check('G11 short title keeps every segment', shortFit, 'Advil Liqui Gels 20 Each 40 Total Pack of 2 New');
}

// ============================================================================
section('TEST H — manual-edit normalization + derived totals + description matrix');
// ============================================================================
{
  const cur = {
    title: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    _countConfirmed: 26,
    _canonicalProductName: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    _canonicalSpecifics: { Size: '26 Count', 'Item Form': 'Strip' },
    _specifics: { Size: '52 Count' },
    _titleManual: true,
    _selectedPack: 2,
    _selectedTitle: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26ct Ea 52 Total Pack of 2 New'
  };

  const out = fx.normalizeManualTitleForPackChange(cur._selectedTitle, cur, 3);
  console.log(`  in : "${cur._selectedTitle}"`);
  console.log(`  out: "${out}" (${out.length} chars)`);
  checkTrue('H1 stale "52 Total" removed', !out.includes('52 Total'), out);
  checkTrue('H2 "78" derived total present', /\b78\b/.test(out), out);
  checkTrue('H3 "Pack of 3" present', out.includes('Pack of 3'), out);
  check('H4 exactly one condition New', fx.countStandaloneNewTokens(out), 1);
  checkTrue('H5 terminal New', out.endsWith(' New'), out);
  checkTrue('H6 within 80 chars', out.length <= 80, `${out.length}`);
  checkTrue('H7 stale "26ct Ea" remnant removed', !/26ct\s+Ea/i.test(out), out);

  // Contaminated canonical must be refused, not parroted.
  const contaminated = {
    _canonicalProductName: 'Widget 52 Count Total',
    _canonicalSpecifics: {},
    _specifics: {}
  };
  check('H8 " Total"-contaminated canonical refused', fx.psGetCanonicalUnitCount(contaminated), null);
  check('H9 total is null when unit count unknown', fx.psGetPackTotalCount(contaminated, 3), null);

  const matrix = [
    [26, 2, 52], [26, 3, 78], [30, 3, 90], [60, 2, 120],
    [64, 3, 192], [240, 3, 720], [50, 2, 100], [14, 4, 56]
  ];
  matrix.forEach(([unit, pack, expected]) => {
    const c = {
      title: 'Test Product ' + unit + ' Count',
      _countConfirmed: unit,
      _canonicalProductName: 'Test Product ' + unit + ' Count',
      _canonicalSpecifics: { Size: unit + ' Count' },
      _specifics: {}
    };
    check(`H matrix ${unit} x ${pack}`, fx.psGetPackTotalCount(c, pack), expected);
  });
}

// ============================================================================
console.log('\n' + '═'.repeat(78));
console.log('TEST SUMMARY');
console.log('═'.repeat(78));
console.log(`passed: ${passed}`);
console.log(`failed: ${failed}`);
console.log(`total:  ${passed + failed}`);
if (failed) {
  console.log('\nFAILED TESTS:');
  failures.forEach(f => console.log(`  - ${f.name}\n      expected: ${JSON.stringify(f.expected)}\n      actual:   ${JSON.stringify(f.actual)}`));
}
console.log('═'.repeat(78));
process.exit(failed ? 1 : 0);
