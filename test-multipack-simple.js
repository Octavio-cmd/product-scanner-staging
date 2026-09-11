#!/usr/bin/env node

/**
 * MULTIPACK COUNT BUG — SIMPLIFIED REPRODUCTION HARNESS
 *
 * Direct execution of production functions in JSDOM environment
 * Traces state across: init → Pack 2 → Pack 3
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Initialize JSDOM with proper storage configuration
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'https://localhost/app/',
  pretendToBeVisualMedia: true,
  beforeParse(window) {
    // Add storage mock BEFORE parsing
    window.localStorage = {
      store: {},
      getItem: function(key) { return this.store[key] || null; },
      setItem: function(key, val) { this.store[key] = String(val); },
      removeItem: function(key) { delete this.store[key]; },
      clear: function() { this.store = {}; }
    };
  }
});

const window = dom.window;
const document = window.document;
global.window = window;
global.document = document;

// Add minimal globals needed for app.js
global.console = console;

// DOM setup
const body = document.body;
body.innerHTML = `
  <div id="pack-title-display" class="val" data-val=""></div>
  <div id="pack-sku-display" class="val" data-val=""></div>
  <div id="pack-bundle-price">0</div>
  <div id="pack-sel-display"></div>
  <textarea id="ps-title-edit" style="display:none;"></textarea>
`;

console.log('='.repeat(80));
console.log('MULTIPACK COUNT BUG REPRODUCTION — DIRECT FUNCTION EXECUTION');
console.log('='.repeat(80));

// Load app.js code
const appCode = fs.readFileSync('/home/user/product-scanner-staging/app.js', 'utf8');

// Execute app.js in window context to define all functions
try {
  const script = document.createElement('script');
  script.textContent = appCode;
  // Instead of appending (which would execute in JSDOM's context),
  // we'll use Function constructor to execute in our controlled scope

  // Ensure localStorage exists on window
  window.localStorage = {
    store: {},
    getItem: function(key) { return this.store[key] || null; },
    setItem: function(key, val) { this.store[key] = String(val); },
    removeItem: function(key) { delete this.store[key]; },
    clear: function() { this.store = {}; }
  };

  // Create execution context
  const ctx = {
    window,
    document,
    console
  };

  // Execute app.js with window/document in scope
  const executeApp = new Function('window', 'document', 'console', 'localStorage', appCode);
  executeApp(window, document, console, window.localStorage);

  console.log('\n✓ app.js executed successfully\n');
} catch (err) {
  console.error('\n✗ Error executing app.js:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}

// Verify critical functions exist
const requiredFuncs = ['rebuildTitle', 'psDetectCount', 'pickPack', 'descForPack'];
const missing = requiredFuncs.filter(f => !window[f]);
if (missing.length > 0) {
  console.error('\n✗ Missing functions:', missing);
  console.error('\nAvailable window functions:', Object.keys(window).filter(k => typeof window[k] === 'function').slice(0, 20).join(', '));
  process.exit(1);
}

console.log('✓ Required functions found');
console.log('  - rebuildTitle');
console.log('  - psDetectCount');
console.log('  - pickPack');
console.log('  - descForPack\n');

// Test state tracking
const stateLog = [];

function captureState(label) {
  const titleEl = document.getElementById('pack-title-display');
  const state = {
    label,
    time: new Date().toISOString(),
    titleElDataVal: titleEl?.dataset?.val || null,
    titleElText: titleEl?.textContent || null
  };

  // Try to access window._packState if it exists
  if (window._packState) {
    state.packState_curPack = window._packState.curPack || null;
    state.packState_baseTitle = window._packState.baseTitle || null;
  }

  stateLog.push(state);
  return state;
}

function printState(label) {
  const s = captureState(label);
  console.log(`[${label}]`);
  console.log(`  titleEl.dataset.val: ${s.titleElDataVal}`);
  console.log(`  titleEl.textContent: ${s.titleElText}`);
  if (s.packState_curPack !== null) {
    console.log(`  _packState.curPack: ${s.packState_curPack}`);
  }
  if (s.packState_baseTitle !== null) {
    console.log(`  _packState.baseTitle: ${s.packState_baseTitle}`);
  }
  return s;
}

// ============================================================================
// TEST CASE: REPRODUCE MULTIPACK COUNT BUG
// ============================================================================

console.log('='.repeat(80));
console.log('CASE A: PACK 2 → PACK 3 WITHOUT MANUAL EDIT');
console.log('='.repeat(80));

try {
  // Initialize product with 26 units
  const baseTitle = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count';
  console.log(`\n→ Initializing with: "${baseTitle}"\n`);

  // Set up DOM as if renderResult was called
  const titleEl = document.getElementById('pack-title-display');
  titleEl.dataset.val = baseTitle;
  titleEl.textContent = baseTitle;

  // Initialize pack wheel (mimics what happens in renderResult)
  if (window.initPackWheel) {
    window._packState = {
      baseTitle: baseTitle,
      curPack: 1,
      shade: '',
      expDate: '',
    };
    console.log('✓ _packState initialized\n');
  }

  printState('A-Init');

  // Pack 2
  console.log('\n→ Selecting Pack 2 via rebuildTitle...');
  let title2 = null;
  if (window.rebuildTitle) {
    title2 = window.rebuildTitle(baseTitle, 2, '', '');
    console.log(`  rebuildTitle returned: "${title2}"\n`);

    // Simulate what rebuildAndApplyTitle does
    titleEl.dataset.val = title2;
    titleEl.textContent = title2;
    if (window._packState) window._packState.curPack = 2;
  }

  const s2 = printState('A-Pack2');

  // Detect count in Pack 2 title
  if (window.psDetectCount) {
    const det2 = window.psDetectCount(title2);
    console.log(`  psDetectCount: ${det2 ? det2.num + ' ' + det2.unit : 'null'}\n`);
  }

  // Pack 3
  console.log('→ Selecting Pack 3 via rebuildTitle...');
  let title3 = null;
  if (window.rebuildTitle) {
    title3 = window.rebuildTitle(baseTitle, 3, '', '');
    console.log(`  rebuildTitle returned: "${title3}"\n`);

    // Simulate what rebuildAndApplyTitle does
    titleEl.dataset.val = title3;
    titleEl.textContent = title3;
    if (window._packState) window._packState.curPack = 3;
  }

  const s3 = printState('A-Pack3');

  // Detect count in Pack 3 title
  if (window.psDetectCount) {
    const det3 = window.psDetectCount(title3);
    console.log(`  psDetectCount: ${det3 ? det3.num + ' ' + det3.unit : 'null'}\n`);
  }

  // Check for bug
  console.log('\n✓ CASE A COMPLETE');

  if (title2 && title2.includes('52')) {
    console.log('  ⚠️  BUG: "52" found in Pack 2 title: ' + title2);
  } else if (title2) {
    console.log('  ✓ Pack 2 title: no "52"');
  }

  if (title3 && title3.includes('52')) {
    console.log('  ✗ BUG DETECTED: "52" found in Pack 3 title!');
    console.log(`     Title: "${title3}"`);
  } else if (title3) {
    console.log('  ✓ Pack 3 title: no "52"');
  }

} catch (err) {
  console.error('\n✗ CASE A ERROR:', err.message);
  console.error(err.stack);
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log('STATE TRACE SUMMARY');
console.log('='.repeat(80));

stateLog.forEach((s, i) => {
  console.log(`\n${i + 1}. ${s.label}`);
  if (s.titleElDataVal?.includes('52')) {
    console.log(`   ⚠️  titleEl.dataset.val contains "52": ${s.titleElDataVal}`);
  }
  if (s.titleElDataVal) {
    console.log(`   titleEl.dataset.val: ${s.titleElDataVal}`);
  }
});

console.log('\n' + '='.repeat(80));
