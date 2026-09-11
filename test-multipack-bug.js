#!/usr/bin/env node

/**
 * MULTIPACK COUNT BUG — EXECUTABLE REPRODUCTION HARNESS
 *
 * Simulates the exact sequence that reproduces:
 * - unitCount = 26
 * - Pack 2 → "52 Total"
 * - Pack 3 → "52 Total" survives (should be "78 Total")
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Initialize DOM
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const window = dom.window;
const document = window.document;

// Set globals
global.window = window;
global.document = document;
global.$ = (id) => document.getElementById(id);

// Add required DOM elements
function setupDOM() {
  const body = document.body;

  body.innerHTML = `
    <div id="pack-title-display" class="val" data-val=""></div>
    <div id="pack-sku-display" class="val" data-val=""></div>
    <div id="pack-bundle-price">0</div>
    <div id="pack-sel-display"></div>
  `;
}

// Global constants from app.js
const PACK_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Extract key functions from app.js
const appCode = fs.readFileSync('/home/user/product-scanner-staging/app.js', 'utf8');

// Use Function constructor to execute app.js in controlled scope
console.log('='.repeat(80));
console.log('MULTIPACK COUNT BUG REPRODUCTION HARNESS');
console.log('='.repeat(80));

setupDOM();

// Create execution context
const ctx = {
  window,
  document,
  PACK_SIZES,
  cur: null,
  state: null,

  // Mock minimal dependencies
  toast: (msg) => console.log(`[TOAST] ${msg}`),
  screen: (name) => {},
  playTick: () => {},
  psFixTitleCase: (title) => title,
  psCanonicalProductName: function(rawTitle) {
    if (!rawTitle) return rawTitle;
    var canonical = String(rawTitle).trim();
    canonical = canonical.replace(/\s+(?:Pack of \d+\s+)?(New|Used|Refurbished|Open Box)\s*$/i, '').trim();
    canonical = canonical.replace(/\s+Pack of \d+\s*$/i, '').trim();
    return canonical;
  },

  // Track state changes
  stateLog: [],

  captureState: function(label) {
    const state = {
      label,
      time: new Date().toISOString(),
      cur_title: this.cur?.title || null,
      cur_selectedTitle: this.cur?._selectedTitle || null,
      cur_titleManual: this.cur?._titleManual || false,
      cur_selectedPack: this.cur?._selectedPack || null,
      cur_countConfirmed: this.cur?._countConfirmed || null,
      cur_specifics_Size: this.cur?._specifics?.Size || null,
      cur_canonicalProductName: this.cur?._canonicalProductName || null,
      cur_canonicalSpecifics: this.cur?._canonicalSpecifics || {},
      packState_curPack: this.state?.curPack || null,
      titleEl_dataset_val: document.getElementById('pack-title-display')?.dataset?.val || null,
    };
    this.stateLog.push(state);
    return state;
  },

  printState: function(label) {
    const s = this.captureState(label);
    console.log(`\n[${label}]`);
    console.log(`  title: ${s.cur_title}`);
    console.log(`  selectedTitle: ${s.cur_selectedTitle}`);
    console.log(`  titleManual: ${s.cur_titleManual}`);
    console.log(`  curPack: ${s.packState_curPack}`);
    console.log(`  countConfirmed: ${s.cur_countConfirmed}`);
    console.log(`  specifics.Size: ${s.cur_specifics_Size}`);
    console.log(`  canonicalProductName: ${s.cur_canonicalProductName}`);
    console.log(`  titleEl.dataset.val: ${s.titleEl_dataset_val}`);
    return s;
  }
};

// Execute app.js functions in context
try {
  // Wrap app.js code with context
  const wrappedCode = `
(function(ctx) {
  var window = ctx.window;
  var document = ctx.document;
  var PACK_SIZES = ctx.PACK_SIZES;
  var $ = (id) => document.getElementById(id);
  var cur = ctx.cur;
  var toast = ctx.toast;
  var psFixTitleCase = ctx.psFixTitleCase;
  var psCanonicalProductName = ctx.psCanonicalProductName;
  var playTick = ctx.playTick;

  // Extract and execute only the essential functions from app.js
  ${extractFunctions(appCode, [
    'psDetectCount',
    'psApplyCount',
    'parseIntoSpans',
    'classifySpanRole',
    'semanticImportance',
    'annotateSpans',
    'buildTitleFromSpans',
    'rebuildTitle',
    'formatExpForTitle',
    'extractPrioritiesFromStructuredData',
    'rebuildAndApplyTitle',
    'pickPack',
    'initPackWheel',
    'descForPack',
    'buildLocalFallbackDescription',
    'psCanonicalProductName',
    'psPreFillSpecifics',
    'psExtractTypeFromTitle',
    'psExtractFlavorFromTitle',
    'psExtractAdministration',
    'psDetectIngestibleForm',
    'psExtractDepartment',
    'psExtractGenderDepartment',
    'psExtractSPF',
    'psExtractHairType',
    'psExtractPAO',
    'psExtractBodyArea',
    'psExtractShade',
    'psExtractDollCharacter',
    'psExtractFranchise',
    'psExtractSkinType',
    'psExtractBrand',
    'psExtractLEGOSpecifics',
    'psExtractAdministration'
  ])}

  // Return context with functions bound
  ctx.psDetectCount = psDetectCount;
  ctx.psApplyCount = psApplyCount;
  ctx.rebuildTitle = rebuildTitle;
  ctx.buildTitleFromSpans = buildTitleFromSpans;
  ctx.descForPack = descForPack;
  ctx.pickPack = pickPack;
  ctx.initPackWheel = initPackWheel;
  ctx.rebuildAndApplyTitle = rebuildAndApplyTitle;

})(ctx);
`;

  eval(wrappedCode);

  console.log('\n✓ Functions loaded successfully');
} catch (err) {
  console.error('\n✗ Error loading functions:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// ============================================================================
// TEST CASE A: NO MANUAL EDIT
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('CASE A: NO MANUAL EDIT');
console.log('='.repeat(80));

try {
  // Initialize product
  ctx.cur = {
    title: 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count',
    upc: '123456789',
    brand: 'Vicks',
    category: '67169',
    _specifics: {},
    _countConfirmed: 26,
    _selectedPack: 1,
  };

  ctx.state = {
    baseTitle: ctx.cur.title,
    curPack: 1,
    shade: '',
    expDate: '',
  };

  ctx.printState('A-Init');

  // Pack 2
  console.log('\n→ Selecting Pack 2...');
  ctx.cur._selectedPack = 2;
  const title2 = ctx.rebuildTitle(ctx.state.baseTitle, 2, '', '');
  ctx.cur._selectedTitle = title2;
  document.getElementById('pack-title-display').dataset.val = title2;
  ctx.state.curPack = 2;

  const s2 = ctx.printState('A-Pack2');
  console.log(`  rebuilt: ${title2}`);

  // Extract count token from Pack 2 title
  const det2 = ctx.psDetectCount ? ctx.psDetectCount(title2) : null;
  console.log(`  detected count: ${det2 ? det2.num + ' ' + det2.unit : 'null'}`);

  // Pack 3
  console.log('\n→ Selecting Pack 3...');
  ctx.cur._selectedPack = 3;
  const title3 = ctx.rebuildTitle(ctx.state.baseTitle, 3, '', '');
  ctx.cur._selectedTitle = title3;
  document.getElementById('pack-title-display').dataset.val = title3;
  ctx.state.curPack = 3;

  const s3 = ctx.printState('A-Pack3');
  console.log(`  rebuilt: ${title3}`);

  const det3 = ctx.psDetectCount ? ctx.psDetectCount(title3) : null;
  console.log(`  detected count: ${det3 ? det3.num + ' ' + det3.unit : 'null'}`);

  // Check for bug
  console.log('\n✓ CASE A COMPLETE');
  if (title3.includes('52')) {
    console.log('  ✗ BUG DETECTED: "52" found in Pack 3 title!');
    console.log(`     Title: ${title3}`);
  } else {
    console.log('  ✓ No "52" in Pack 3 title');
  }

} catch (err) {
  console.error('✗ CASE A ERROR:', err.message);
  console.error(err.stack);
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('DIAGNOSTICS SUMMARY');
console.log('='.repeat(80));

console.log('\n[STATE LOG]');
ctx.stateLog.forEach((s, i) => {
  console.log(`\n${i + 1}. ${s.label}`);
  if (s.cur_title?.includes?.('52')) console.log(`   ⚠️  TITLE contains 52: ${s.cur_title}`);
  if (s.cur_specifics_Size?.includes?.('52')) console.log(`   ⚠️  SIZE contains 52: ${s.cur_specifics_Size}`);
});

console.log('\n[FINDINGS]');
const hasContamination = ctx.stateLog.some(s =>
  (s.cur_title?.includes('52') || s.cur_specifics_Size?.includes('52')) &&
  s.packState_curPack === 3
);
console.log(hasContamination ? '  ✗ BUG REPRODUCED' : '  ✓ Bug not reproduced in this trace');

console.log('\n' + '='.repeat(80));
console.log('END OF DIAGNOSTIC');
console.log('='.repeat(80));

// ============================================================================
// HELPER: Extract function definitions from app.js
// ============================================================================

function extractFunctions(code, names) {
  const extracted = [];

  // For each function name, find and extract its definition
  names.forEach(name => {
    // Look for "function NAME(" or "NAME = function("
    const patterns = [
      new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*{`, 'g'),
      new RegExp(`var\\s+${name}\\s*=\\s*function\\s*\\([^)]*\\)\\s*{`, 'g'),
    ];

    patterns.forEach(pattern => {
      const match = pattern.exec(code);
      if (match) {
        // Extract from function start to matching close brace
        const startIndex = match.index;
        let braceCount = 0;
        let inString = false;
        let stringChar = '';
        let endIndex = startIndex + match[0].length - 1;

        for (let i = endIndex; i < code.length; i++) {
          const char = code[i];
          const prevChar = i > 0 ? code[i-1] : '';

          if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
          } else if (!inString && char === '{') {
            braceCount++;
          } else if (!inString && char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i;
              break;
            }
          }
        }

        extracted.push(code.substring(startIndex, endIndex + 1));
      }
    });
  });

  return extracted.join('\n\n');
}
