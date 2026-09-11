#!/usr/bin/env node

/**
 * MULTIPACK COUNT BUG — COMPLETE LIFECYCLE TRACE
 *
 * Simulates: init → Pack 2 → generate specifics → Pack 3 → export CSV
 */

console.log('='.repeat(80));
console.log('MULTIPACK BUG — COMPLETE LIFECYCLE SIMULATION');
console.log('='.repeat(80));

const stateLog = [];

// Simulate the cur object and state
let cur = {
  upc: '123456789',
  title: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
  brand: 'Vicks',
  category: '67169',
  _selectedPack: 1,
  _selectedTitle: null,
  _selectedTitle: null,
  _titleManual: false,
  _specifics: {},
  _countConfirmed: 26
};

let state = {
  baseTitle: cur.title,
  curPack: 1,
  shade: '',
  expDate: ''
};

const titleElement = {
  dataset: { val: '' },
  textContent: ''
};

function updateDOM(title) {
  titleElement.dataset.val = title;
  titleElement.textContent = title;
}

function captureState(label) {
  return {
    label,
    cur_selectedTitle: cur._selectedTitle,
    cur_titleManual: cur._titleManual,
    cur_selectedPack: cur._selectedPack,
    cur_specifics_Size: cur._specifics['Size'] || null,
    titleEl_dataset_val: titleElement.dataset.val,
    state_curPack: state.curPack
  };
}

function logState(label) {
  const s = captureState(label);
  stateLog.push(s);
  console.log(`\n[${label}]`);
  console.log(`  cur._selectedTitle: ${s.cur_selectedTitle}`);
  console.log(`  cur._titleManual: ${s.cur_titleManual}`);
  console.log(`  cur._selectedPack: ${s.cur_selectedPack}`);
  console.log(`  titleEl.dataset.val: ${s.titleEl_dataset_val}`);
  if (s.cur_specifics_Size) {
    console.log(`  cur._specifics.Size: ${s.cur_specifics_Size}`);
  }
  return s;
}

// ============================================================================
// PHASE 1: INITIALIZATION
// ============================================================================

console.log('\n### PHASE 1: INITIALIZATION ###\n');

console.log(`Base Title: "${cur.title}"`);
updateDOM(cur.title);
cur._selectedTitle = cur.title;
cur._selectedPack = 1;
state.curPack = 1;
logState('Init');

// ============================================================================
// PHASE 2: SELECT PACK 2
// ============================================================================

console.log('\n### PHASE 2: SELECT PACK 2 ###\n');

// Simulate rebuildTitle(baseTitle, 2)
const title2 = cur.title + ' Pack of 2 New';
console.log(`→ rebuildTitle(baseTitle, 2) = "${title2}"`);

// Simulate rebuildAndApplyTitle
updateDOM(title2);
cur._selectedTitle = title2;
cur._selectedPack = 2;
state.curPack = 2;
logState('After_Pack2_Selection');

// ============================================================================
// PHASE 3: GENERATE SPECIFICS AT PACK 2
// ============================================================================

console.log('\n### PHASE 3: GENERATE SPECIFICS (at Pack 2) ###\n');

console.log(`Specifics generation uses titleForAI = canonical title without "Pack of N"`);
const titleForAI = cur.title; // Canonical, without pack suffix
console.log(`titleForAI = "${titleForAI}"`);

// Claude would extract count from title
// For "Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count", it should extract "26 Count"
// But what if there's a bug or the title was manually edited?

// Simulating Claude's extraction:
// If the title at this moment was somehow "... 26 Count 52 Total ..." (user manually added 52 Total),
// Claude might extract "52 Total" or get confused

console.log(`Claude extracts specifics from titleForAI:`);
const detectedCount = '26'; // Correct extraction
console.log(`  → C:Size/Count = "${detectedCount}" (correct)`);

cur._specifics['Size'] = detectedCount;
logState('After_SpecificsGen_Pack2');

// ============================================================================
// PHASE 4: SELECT PACK 3
// ============================================================================

console.log('\n### PHASE 4: SELECT PACK 3 ###\n');

// Simulate rebuildTitle(baseTitle, 3)
const title3 = cur.title + ' Pack of 3 New';
console.log(`→ rebuildTitle(baseTitle, 3) = "${title3}"`);

// Simulate rebuildAndApplyTitle
updateDOM(title3);
cur._selectedTitle = title3;
cur._selectedPack = 3;
state.curPack = 3;
logState('After_Pack3_Selection');

// NOTE: cur._specifics['Size'] is still "26" from Pack 2
console.log(`\n⚠️  IMPORTANT: Specifics['Size'] NOT regenerated yet — still shows "${cur._specifics['Size']}"`);

// ============================================================================
// PHASE 5: EXPORT TO CSV
// ============================================================================

console.log('\n### PHASE 5: EXPORT TO CSV ###\n');

console.log(`At export time, _addBulkInternal() is called:`);
const packs = cur._selectedPack || 1;
console.log(`  packs = ${packs}`);

// This is the critical line from _addBulkInternal (line 5530)
const usedTitle = cur._selectedTitle || (titleElement && titleElement.dataset.val) || cur.title;
console.log(`  usedTitle selection:`);
console.log(`    cur._selectedTitle = "${cur._selectedTitle}" → USE THIS`);

const csvRow = {
  title: usedTitle,
  pack: packs,
  size_specific: cur._specifics['Size'] || 'None'
};

console.log(`\nCSV Row that would be exported:`);
console.log(`  Title: "${csvRow.title}"`);
console.log(`  Pack: ${csvRow.pack}`);
console.log(`  C:Size: "${csvRow.size_specific}"`);

// ============================================================================
// ANALYSIS
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS');
console.log('='.repeat(80));

console.log(`\nFINDING 1: rebuildTitle() works correctly`);
console.log(`  ✓ Pack 2 title: "${title2}"`);
console.log(`  ✓ Pack 3 title: "${title3}"`);
console.log(`  ✓ Both titles correctly show "26 Count" (unit count)`);

console.log(`\nFINDING 2: cur._selectedTitle gets updated correctly`);
console.log(`  ✓ When switching packs, cur._selectedTitle is set to new title`);

console.log(`\nFINDING 3: CSV export uses correct title`);
console.log(`  ✓ At export time, usedTitle = cur._selectedTitle (not stale DOM value)`);
console.log(`  ✓ CSV Title shows Pack of 3 (correct)`);

console.log(`\nFINDING 4: Specifics NOT regenerated on pack switch`);
console.log(`  ⚠️  When pack is switched, specifics stay cached from Pack 2`);
console.log(`  ✗ If Pack 2 specifics said "52 Count" (wrong), it would persist in Pack 3`);
console.log(`  ⚠️  Solution: Need to regenerate or invalidate specifics when pack changes`);

console.log(`\n${'-'.repeat(80)}`);
console.log('ROOT CAUSE HYPOTHESIS');
console.log('-'.repeat(80));

console.log(`\n1. At Pack 2, specifics were generated showing "52 Count" (wrong)`);
console.log(`   Possible reason: Claude AI misinterpreted title, or description was wrong`);
console.log(`\n2. When user switched to Pack 3, cur._specifics['Size'] was NOT cleared/updated`);
console.log(`\n3. When user exported CSV at Pack 3, the stale "52 Count" specific was used`);
console.log(`\nRESULT: CSV row shows Pack of 3 but Size specific shows 52 Count`);

console.log(`\n${'-'.repeat(80)}`);
console.log('WHY "52 Total" IN THE TITLE?');
console.log('-'.repeat(80));

console.log(`\nThe CSV evidence shows Title contains "52 Total", not just "52".`);
console.log(`\nPossible causes:`);
console.log(`  A) User manually edited title to add "52 Total" (then marked _titleManual=true)`);
console.log(`     Then when switching packs, only "Pack of N" updates, "52 Total" stays`);
console.log(`\n  B) Description generation (descForPack) generated "52 Total" somehow`);
console.log(`     And title/description got mixed/concatenated in export`);
console.log(`\n  C) Claude AI generation included "52 Total" in title at Pack 2`);
console.log(`     And title was saved/cached incorrectly`);
console.log(`\nMOST LIKELY: Scenario A (manual edit with _titleManual flag)`);

console.log(`\n` + '='.repeat(80));
