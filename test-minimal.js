#!/usr/bin/env node

/**
 * MULTIPACK COUNT BUG — ABSOLUTE MINIMAL TEST
 *
 * Manually define only the core functions needed to test rebuildTitle
 */

// Minimum implementation of core functions

function formatExpForTitle(expDate) {
  if (!expDate) return '';
  // Minimal implementation
  return '';
}

function psFixTitleCase(str, brand) {
  // Minimal implementation - just return as-is for this test
  return str;
}

function parseIntoSpans(base) {
  var words = base.split(/\s+/).filter(Boolean);
  var spans = [];
  var i = 0;

  while (i < words.length) {
    var word = words[i];
    var span = null;

    // Pattern: Number + "in" + Number (e.g., "3 in 1")
    if (/^\d+$/.test(word) && i + 2 < words.length &&
        words[i + 1].toLowerCase() === 'in' && /^\d+$/.test(words[i + 2])) {
      span = {
        value: word + ' in ' + words[i + 2],
        wordCount: 3,
        startIdx: i
      };
      i += 3;
    }
    // Pattern: Number + letter (e.g., "144pcs", "16oz")
    else if (/^\d+[a-zA-Z]+$/.test(word)) {
      span = {
        value: word,
        wordCount: 1,
        startIdx: i
      };
      i++;
    }
    // Pattern: Two consecutive words both starting with capital (compound noun)
    else if (i + 1 < words.length && /^[A-Z]/.test(word) && /^[A-Z]/.test(words[i + 1])) {
      span = {
        value: word + ' ' + words[i + 1],
        wordCount: 2,
        startIdx: i
      };
      i += 2;
    }
    // Single word
    else {
      span = {
        value: word,
        wordCount: 1,
        startIdx: i
      };
      i++;
    }

    if (span) spans.push(span);
  }

  return spans;
}

function classifySpanRole(span, index, spans, curObj) {
  var value = span.value;

  // Check if it matches numeric patterns (unit counts)
  if (/^\d+/.test(value)) {
    // Could be unit count like "26", "100pcs", etc.
    return 'COUNT';
  }
  if (/^\d+\s+in\s+\d+/.test(value)) {
    return 'RATIO';
  }

  return 'GENERIC';
}

function semanticImportance(span, role, index, spans) {
  if (role === 'COUNT') return 8;
  if (role === 'RATIO') return 6;
  return 3;
}

function annotateSpans(spans, base, curObj) {
  spans.forEach(function(span, idx) {
    var role = classifySpanRole(span, idx, spans, curObj);
    span.role = role;
    span.priority = 5; // default priority
    span.semanticScore = semanticImportance(span, role, idx, spans);
  });
}

function buildTitleFromSpans(spans, n, shade, expDate, curObj) {
  var suffix = '';
  if (shade) suffix += ' ' + shade;

  var expStr = formatExpForTitle(expDate);
  if (expStr) suffix += ' ' + expStr;

  if (Number(n) >= 2) suffix += ' Pack of ' + n;
  suffix += ' New';

  // Start with all spans
  var activeSpans = spans.map(function(s, idx) {
    return Object.assign({}, s, {originalIdx: idx});
  });

  // Build base title with all spans in original order
  var baseTitle = activeSpans.map(function(s) { return s.value; }).join(' ');
  var output = baseTitle + suffix;

  // If already fits, return
  if (output.length <= 80) {
    return output;
  }

  // Remove low-priority spans until it fits
  while (activeSpans.length > 0) {
    // Sort by priority (ascending), then by semantic importance (descending)
    activeSpans.sort(function(a, b) {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return (b.semanticScore || 0) - (a.semanticScore || 0);
    });

    // Remove the lowest-priority span
    activeSpans.shift();

    // Rebuild in original order
    activeSpans.sort(function(a, b) { return a.originalIdx - b.originalIdx; });
    baseTitle = activeSpans.map(function(s) { return s.value; }).join(' ');
    output = baseTitle + suffix;

    if (output.length <= 80) {
      return output;
    }
  }

  // Fallback: just the suffix
  return suffix.trim();
}

function rebuildTitle(base, n, shade, expDate) {
  shade = shade || '';
  expDate = expDate || '';
  if (!base) return (shade ? shade + ' ' : '') + (Number(n) >= 2 ? 'Pack of ' + n + ' ' : '') + 'New';

  // Clean the base title (remove existing pack / new / exp references)
  var cleanBase = base
    .replace(/\bexp(?:ires?|iration)?\.?\s*\d{1,2}[\/\-]\d{2,4}\b/gi, '')
    .replace(/\bexp(?:ires?|iration)?\.?\s*\d{2,4}\b/gi, '')
    .replace(/\bpack of \d+\b/gi, '').replace(/\b\d+[-\s]?pack\b/gi, '')
    .replace(/\b\d+[\s]?x\b/gi, '').replace(/\bset of \d+\b/gi, '')
    .replace(/\bbundle of \d+\b/gi, '').replace(/\bnew sealed\b/gi, '')
    .replace(/\bnew\b\s*$/gi, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/[·\-,\.]+\s*$/, '').trim();

  // Parse into semantic spans
  var spans = parseIntoSpans(cleanBase);

  // Annotate spans
  annotateSpans(spans, cleanBase, null);

  // Build title from spans
  var output = buildTitleFromSpans(spans, n, shade, expDate, null);

  // Hard limit at 80 chars
  if (output.length > 80) {
    output = output.substring(0, 80).replace(/\s+\S*$/, '').trim();
  }

  // Apply title case correction
  return psFixTitleCase(output, '');
}

// ============================================================================
// TEST EXECUTION
// ============================================================================

console.log('='.repeat(80));
console.log('MULTIPACK COUNT BUG — MINIMAL REPRODUCTION');
console.log('='.repeat(80));

const baseTitle = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count';
console.log(`\nBase Title: "${baseTitle}"\n`);

// Test Pack 2
console.log('→ rebuildTitle(base, 2, "", "")');
const title2 = rebuildTitle(baseTitle, 2, '', '');
console.log(`  Result: "${title2}"`);
const has52in2 = title2.includes('52');
console.log(`  Contains "52": ${has52in2 ? '✗ BUG' : '✓ OK'}\n`);

// Test Pack 3
console.log('→ rebuildTitle(base, 3, "", "")');
const title3 = rebuildTitle(baseTitle, 3, '', '');
console.log(`  Result: "${title3}"`);
const has52in3 = title3.includes('52');
console.log(`  Contains "52": ${has52in3 ? '✗ BUG' : '✓ OK'}\n`);

// Test calling rebuildTitle(title2, 3, "", "") — this simulates reusing a stale title
console.log('→ STALE PATH TEST: rebuildTitle(title2, 3, "", "")');
const title2to3 = rebuildTitle(title2, 3, '', '');
console.log(`  Input (title2): "${title2}"`);
console.log(`  Result: "${title2to3}"`);
const has52in2to3 = title2to3.includes('52');
console.log(`  Contains "52": ${has52in2to3 ? '✗ BUG' : '✓ OK'}\n`);

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`rebuildTitle(base, 2): no 52 → ${!has52in2 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`rebuildTitle(base, 3): no 52 → ${!has52in3 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`rebuildTitle(title2, 3): no 52 → ${!has52in2to3 ? '✓ PASS' : '✗ FAIL'}`);

if (has52in2 || has52in3 || has52in2to3) {
  console.log('\n✗ BUG REPRODUCED via rebuildTitle alone');
  console.log('   This means the bug is in the title reconstruction logic itself');
} else {
  console.log('\n✓ Bug NOT reproduced via rebuildTitle');
  console.log('   Bug must be in state management or caching elsewhere');
}
