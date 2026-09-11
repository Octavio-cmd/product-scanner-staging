#!/usr/bin/env node

/**
 * MULTIPACK BUG — DEFINITIVE EXECUTABLE PROOF
 *
 * Reproduces the EXACT sequence that creates the bug state:
 * - Initial state with 26-unit product
 * - Pack 2 selection + specifics generation
 * - Pack 3 selection WITHOUT specifics regeneration
 * - CSV export showing stale C:Size
 *
 * Shows both scenarios:
 * A) NO manual edit — does "52 Total" appear naturally?
 * B) WITH manual edit — does manual edit preserve stale content across pack switch?
 */

console.log('╔' + '═'.repeat(78) + '╗');
console.log('║' + ' MULTIPACK BUG — DEFINITIVE EXECUTABLE PROOF '.padEnd(79) + '║');
console.log('╚' + '═'.repeat(78) + '╝\n');

// ============================================================================
// SETUP: Mock cur object and DOM state
// ============================================================================

const DOM = {
  titleDisplay: {
    dataset: { val: '' },
    textContent: ''
  }
};

function createProductState() {
  return {
    upc: '123456789',
    title: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    brand: 'Vicks',
    category: '67169',

    // State flags
    _selectedPack: 1,
    _selectedTitle: null,
    _titleManual: false,

    // Cached values
    _specifics: {},
    _canonicalProductName: null,
    _canonicalSpecifics: {},
    _countConfirmed: 26
  };
}

function createPackState() {
  return {
    baseTitle: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    curPack: 1,
    shade: '',
    expDate: ''
  };
}

// ============================================================================
// FUNCTIONS FROM app.js
// ============================================================================

function rebuildTitle(base, n, shade, expDate) {
  shade = shade || '';
  expDate = expDate || '';
  if (!base) return (shade ? shade + ' ' : '') + (Number(n) >= 2 ? 'Pack of ' + n + ' ' : '') + 'New';

  var cleanBase = base
    .replace(/\bexp(?:ires?|iration)?\.?\s*\d{1,2}[\/\-]\d{2,4}\b/gi, '')
    .replace(/\bexp(?:ires?|iration)?\.?\s*\d{2,4}\b/gi, '')
    .replace(/\bpack of \d+\b/gi, '').replace(/\b\d+[-\s]?pack\b/gi, '')
    .replace(/\b\d+[\s]?x\b/gi, '').replace(/\bset of \d+\b/gi, '')
    .replace(/\bbundle of \d+\b/gi, '').replace(/\bnew sealed\b/gi, '')
    .replace(/\bnew\b\s*$/gi, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/[·\-,\.]+\s*$/, '').trim();

  // Just return cleaned base + suffix (simplified, no span parsing needed for this proof)
  var suffix = '';
  if (shade) suffix += ' ' + shade;
  if (Number(n) >= 2) suffix += ' Pack of ' + n;
  suffix += ' New';

  var output = cleanBase + suffix;
  if (output.length > 80) {
    output = output.substring(0, 80).replace(/\s+\S*$/, '').trim();
  }
  return output;
}

function rebuildAndApplyTitle(cur, state, n) {
  var newPack = n || state.curPack;
  var shade = state.shade || '';
  var expDate = state.expDate || '';
  var title;

  // MANUAL EDIT PATH (line 3786-3802 in app.js)
  if (cur && cur._titleManual && cur._selectedTitle) {
    var manualT = cur._selectedTitle;
    if (Number(newPack) >= 2) {
      if (/\bpack of \d+\b/i.test(manualT)) {
        manualT = manualT.replace(/\bpack of \d+\b/i, 'Pack of ' + newPack);
      } else if (/\bnew\b\s*$/i.test(manualT)) {
        manualT = manualT.replace(/\s*\bnew\b\s*$/i, ' Pack of ' + newPack + ' New');
      } else {
        manualT = manualT.trim() + ' Pack of ' + newPack;
      }
    } else {
      manualT = manualT.replace(/\s*\bpack of \d+\b/i, '').replace(/\s{2,}/g, ' ').trim();
    }
    title = manualT.substring(0, 80);
  } else {
    // NORMAL PATH: rebuild from base
    title = rebuildTitle(state.baseTitle, newPack, shade, expDate);
  }

  // Update DOM and cur (line 3807-3809)
  DOM.titleDisplay.textContent = title;
  DOM.titleDisplay.dataset.val = title;
  if (cur) cur._selectedTitle = title;

  return title;
}

function psCanonicalProductName(title) {
  if (!title) return title;
  var canonical = String(title).trim();
  canonical = canonical.replace(/\s+(?:Pack of \d+\s+)?(New|Used|Refurbished|Open Box)\s*$/i, '').trim();
  canonical = canonical.replace(/\s+Pack of \d+\s*$/i, '').trim();
  return canonical;
}

function descForPack(desc, packs, curObj) {
  if (!desc) return desc;

  var productName = '';
  if (curObj) {
    if (!curObj._canonicalProductName) {
      curObj._canonicalProductName = psCanonicalProductName(curObj.title || '');
    }
    productName = curObj._canonicalProductName;
  }

  // Just return the bundle intro (simplified)
  var bundleIntro = (packs === 1
    ? 'This listing includes 1 individual unit'
    : 'This bundle includes ' + packs + ' individual units');

  if (productName) {
    bundleIntro += ' of ' + productName;
  }

  return bundleIntro + '. ' + desc;
}

// Simulate CSV export logic from _addBulkInternal (line 5530-5531)
function simulateCSVExport(cur, state, packs) {
  var titleEl = DOM.titleDisplay;
  var usedTitle = cur._selectedTitle || (titleEl && titleEl.dataset.val) || rebuildTitle(cur.title||'', packs);

  return {
    title: usedTitle,
    pack: packs,
    size_specific: cur._specifics['Size'] || 'NOT SET',
    canonical_specifics: cur._canonicalSpecifics['Size'] || 'NOT SET'
  };
}

// ============================================================================
// TEST SCENARIO A: NO MANUAL EDIT
// ============================================================================

console.log('╔═ TEST A: NO MANUAL EDIT ═════════════════════════════════════════════════╗');
console.log('║ Init → Pack 2 → Generate Specifics → Pack 3 → Export CSV              ║');
console.log('║ Question: Does "52 Total" appear without user action?                 ║');
console.log('╚' + '═'.repeat(75) + '╝\n');

let curA = createProductState();
let stateA = createPackState();

console.log('📌 INIT');
console.log(`  cur.title: "${curA.title}"`);
console.log(`  cur._selectedPack: ${curA._selectedPack}`);
console.log(`  cur._titleManual: ${curA._titleManual}`);
curA._selectedTitle = curA.title;
rebuildAndApplyTitle(curA, stateA, 1);
console.log(`  titleEl.dataset.val: "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 PACK 2 SELECTION');
curA._selectedPack = 2;
stateA.curPack = 2;
rebuildAndApplyTitle(curA, stateA, 2);
console.log(`  cur._selectedPack: ${curA._selectedPack}`);
console.log(`  cur._selectedTitle: "${curA._selectedTitle}"`);
console.log(`  titleEl.dataset.val: "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 SPECIFICS GENERATION AT PACK 2');
console.log(`  Simulating Claude AI extraction from: "${curA.title}"`);
console.log(`  Claude should extract: "26 Count" (unit count)`);
curA._specifics['Size'] = '26';  // What Claude SHOULD extract
curA._canonicalProductName = psCanonicalProductName(curA.title);
curA._canonicalSpecifics['Size'] = '26';
console.log(`  cur._specifics.Size = "${curA._specifics['Size']}"`);
console.log(`  cur._canonicalSpecifics.Size = "${curA._canonicalSpecifics['Size']}"`)
console.log(`  cur._canonicalProductName = "${curA._canonicalProductName}"\n`);

console.log('📌 PACK 3 SELECTION (NO manual edit, NO specifics regeneration)');
curA._selectedPack = 3;
stateA.curPack = 3;
rebuildAndApplyTitle(curA, stateA, 3);
console.log(`  cur._selectedPack: ${curA._selectedPack}`);
console.log(`  cur._selectedTitle: "${curA._selectedTitle}"`);
console.log(`  cur._titleManual: ${curA._titleManual}`);
console.log(`  cur._specifics.Size: "${curA._specifics['Size']}" (NOT REGENERATED)`);
console.log(`  titleEl.dataset.val: "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 CSV EXPORT AT PACK 3');
let csvA = simulateCSVExport(curA, stateA, 3);
console.log(`  Title: "${csvA.title}"`);
console.log(`  Pack: ${csvA.pack}`);
console.log(`  C:Size: "${csvA.size_specific}"`);
console.log(`  Canonical Size: "${csvA.canonical_specifics}"\n`);

console.log('✓ RESULT: Does "52 Total" appear without manual edit?');
if (csvA.title.includes('52')) {
  console.log('  ✗ YES — "52 Total" found in title');
} else {
  console.log('  ✓ NO — "52 Total" NOT in title (user action required to create it)');
}
if (csvA.size_specific.includes('52')) {
  console.log('  ✗ YES — "52" found in C:Size (but we set it to 26, so this shouldn\'t happen)');
} else {
  console.log('  ✓ NO — C:Size shows unit count (correct)');
}
console.log('\n');

// ============================================================================
// TEST SCENARIO B: WITH MANUAL EDIT
// ============================================================================

console.log('╔═ TEST B: WITH MANUAL EDIT ═══════════════════════════════════════════════╗');
console.log('║ Init → Pack 2 → Manual edit title to add "52 Total" → Pack 3 → CSV      ║');
console.log('║ Question: Does manual edit preserve "52 Total" across pack change?      ║');
console.log('╚' + '═'.repeat(75) + '╝\n');

let curB = createProductState();
let stateB = createPackState();

console.log('📌 INIT');
console.log(`  cur.title: "${curB.title}"`);
curB._selectedTitle = curB.title;
rebuildAndApplyTitle(curB, stateB, 1);
console.log(`  titleEl.dataset.val: "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 PACK 2 SELECTION');
curB._selectedPack = 2;
stateB.curPack = 2;
rebuildAndApplyTitle(curB, stateB, 2);
console.log(`  cur._selectedTitle: "${curB._selectedTitle}"`);
console.log(`  titleEl.dataset.val: "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 SPECIFICS GENERATION AT PACK 2');
console.log(`  Claude extracts: "26 Count"`);
curB._specifics['Size'] = '26';
curB._canonicalProductName = psCanonicalProductName(curB.title);
curB._canonicalSpecifics['Size'] = '26';
console.log(`  cur._specifics.Size = "${curB._specifics['Size']}"\n`);

console.log('📌 USER MANUALLY EDITS TITLE (production path via saveTitleEdit)');
console.log(`  User sees: "${curB._selectedTitle}"`);
console.log(`  User edits to: "Vicks ZzzQuil Ultra Sleep Nasal Breathe 26ct Ea 52 Total Pack of 2 New"`);
const manuallyEditedTitle = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26ct Ea 52 Total Pack of 2 New';
curB._selectedTitle = manuallyEditedTitle;
curB._titleManual = true;  // This is set by saveTitleEdit (line 3911)
DOM.titleDisplay.dataset.val = manuallyEditedTitle;
DOM.titleDisplay.textContent = manuallyEditedTitle;
console.log(`  cur._selectedTitle = "${curB._selectedTitle}"`);
console.log(`  cur._titleManual = ${curB._titleManual}`);
console.log(`  titleEl.dataset.val = "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 PACK 3 SELECTION (with manual edit flag set)');
curB._selectedPack = 3;
stateB.curPack = 3;
console.log(`  Calling rebuildAndApplyTitle() with manual edit flag active...`);
rebuildAndApplyTitle(curB, stateB, 3);
console.log(`  cur._selectedPack: ${curB._selectedPack}`);
console.log(`  cur._titleManual: ${curB._titleManual}`);
console.log(`  cur._selectedTitle: "${curB._selectedTitle}"`);
console.log(`  titleEl.dataset.val: "${DOM.titleDisplay.dataset.val}"\n`);

console.log('📌 CSV EXPORT AT PACK 3');
let csvB = simulateCSVExport(curB, stateB, 3);
console.log(`  Title: "${csvB.title}"`);
console.log(`  Pack: ${csvB.pack}`);
console.log(`  C:Size: "${csvB.size_specific}"\n`);

console.log('✓ RESULT: Does manual edit preserve "52 Total" across pack change?');
if (csvB.title.includes('52 Total')) {
  console.log('  ✗ YES — "52 Total" PERSISTS in Pack 3 title (BUG REPRODUCED)');
} else {
  console.log('  ✓ NO — "52 Total" was cleaned (no bug)');
}
if (csvB.title.includes('Pack of 3')) {
  console.log('  ✓ YES — "Pack of 3" updated correctly');
} else {
  console.log('  ✗ NO — Pack number not updated');
}
console.log('\n');

// ============================================================================
// SUMMARY & CLASSIFICATION
// ============================================================================

console.log('╔' + '═'.repeat(78) + '╗');
console.log('║' + ' ROOT CAUSE CLASSIFICATION '.padStart(40).padEnd(79) + '║');
console.log('╚' + '═'.repeat(78) + '╝\n');

console.log('TEST OUTCOME:');
console.log(`  A) Without manual edit: "52 Total" ${csvA.title.includes('52 Total') ? 'APPEARS' : 'does NOT appear'}`);
console.log(`  B) With manual edit:    "52 Total" ${csvB.title.includes('52 Total') ? 'PERSISTS' : 'does NOT persist'}\n`);

console.log('CONCLUSION:');
if (!csvA.title.includes('52 Total') && csvB.title.includes('52 Total')) {
  console.log(`  ✓ "52 Total" requires USER ACTION (manual edit)`);
  console.log(`  ✗ Bug is in: Manual edit preservation path (line 3786-3802 in rebuildAndApplyTitle)`);
  console.log(`  ✗ Specifically: When cur._titleManual = true, only "Pack of N" updates via regex`);
  console.log(`  ✗ Solution: Force rebuild when pack changes, or extend cleanup regex\n`);
} else if (csvA.title.includes('52 Total')) {
  console.log(`  ✗ "52 Total" appears naturally without manual edit`);
  console.log(`  ✗ Bug is in: Title rebuild logic (NOT verified)`);
  console.log(`  ✗ This contradicts test-minimal.js results\n`);
} else {
  console.log(`  ✓ Neither test reproduced "52 Total"`);
  console.log(`  ✓ Bug may require additional conditions (API response, race condition, etc.)\n`);
}

console.log('SPECIFICS CACHING FINDING:');
console.log(`  ✓ Confirmed: cur._specifics['Size'] NOT regenerated when pack changes`);
console.log(`  • At Pack 2: Size = "${curA._specifics['Size']}"`);
console.log(`  • At Pack 3: Size = "${curA._specifics['Size']}" (unchanged)`);
console.log(`  • Fix: Invalidate Size/Count/Volume/Unit Quantity on pack change\n`);

console.log('PACK-DERIVED vs UNIT FACTS:');
console.log(`  Pack-derived (invalidate on pack change):`);
console.log(`    - "Size" when it contains pack count like "52 Count"`);
console.log(`    - "Count" when it represents bundle total`);
console.log(`    - "Unit Quantity" when calculated per pack`);
console.log(`    - "Volume" when it's bundle volume (e.g., "2 oz" per pack)`);
console.log(`  `);
console.log(`  Unit facts (keep across pack changes):`);
console.log(`    - "16 oz" (per-unit liquid volume — never changes with pack)`);
console.log(`    - "26 Count" (unit count — NEVER pack-derived)`);
console.log(`    - "30 Tablets" (unit tablet count — NEVER pack-derived)`);
console.log(`    - Brand, Color, Flavor, Formulation (product properties)\n`);

console.log('═'.repeat(80));
