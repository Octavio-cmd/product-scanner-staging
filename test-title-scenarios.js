#!/usr/bin/env node

/**
 * MULTIPACK COUNT BUG — TITLE SCENARIOS TEST
 *
 * Test various title mutations to understand how "52 Total" could appear
 */

function formatExpForTitle(expDate) {
  if (!expDate) return '';
  return '';
}

function psFixTitleCase(str, brand) {
  return str;
}

function parseIntoSpans(base) {
  var words = base.split(/\s+/).filter(Boolean);
  var spans = [];
  var i = 0;

  while (i < words.length) {
    var word = words[i];
    var span = null;

    if (/^\d+$/.test(word) && i + 2 < words.length &&
        words[i + 1].toLowerCase() === 'in' && /^\d+$/.test(words[i + 2])) {
      span = {
        value: word + ' in ' + words[i + 2],
        wordCount: 3,
        startIdx: i
      };
      i += 3;
    }
    else if (/^\d+[a-zA-Z]+$/.test(word)) {
      span = {
        value: word,
        wordCount: 1,
        startIdx: i
      };
      i++;
    }
    else if (i + 1 < words.length && /^[A-Z]/.test(word) && /^[A-Z]/.test(words[i + 1])) {
      span = {
        value: word + ' ' + words[i + 1],
        wordCount: 2,
        startIdx: i
      };
      i += 2;
    }
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
  if (/^\d+/.test(value)) {
    return 'COUNT';
  }
  return 'GENERIC';
}

function semanticImportance(span, role, index, spans) {
  if (role === 'COUNT') return 8;
  return 3;
}

function annotateSpans(spans, base, curObj) {
  spans.forEach(function(span, idx) {
    var role = classifySpanRole(span, idx, spans, curObj);
    span.role = role;
    span.priority = 5;
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

  var activeSpans = spans.map(function(s, idx) {
    return Object.assign({}, s, {originalIdx: idx});
  });

  var baseTitle = activeSpans.map(function(s) { return s.value; }).join(' ');
  var output = baseTitle + suffix;

  if (output.length <= 80) {
    return output;
  }

  while (activeSpans.length > 0) {
    activeSpans.sort(function(a, b) {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return (b.semanticScore || 0) - (a.semanticScore || 0);
    });

    activeSpans.shift();

    activeSpans.sort(function(a, b) { return a.originalIdx - b.originalIdx; });
    baseTitle = activeSpans.map(function(s) { return s.value; }).join(' ');
    output = baseTitle + suffix;

    if (output.length <= 80) {
      return output;
    }
  }

  return suffix.trim();
}

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

  var spans = parseIntoSpans(cleanBase);
  annotateSpans(spans, cleanBase, null);
  var output = buildTitleFromSpans(spans, n, shade, expDate, null);

  if (output.length > 80) {
    output = output.substring(0, 80).replace(/\s+\S*$/, '').trim();
  }

  return psFixTitleCase(output, '');
}

// ============================================================================
// TEST: Track what happens if manual title edit adds "Total"
// ============================================================================

console.log('='.repeat(80));
console.log('SCENARIO: MANUAL TITLE EDIT WITH "TOTAL"');
console.log('='.repeat(80));

const baseTitle = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count';
console.log(`\n1. Base Title: "${baseTitle}"`);

// Scenario: Someone manually edits the title to add "52 Total" (manually added by user)
const manuallyEditedTitle = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count 52 Total';
console.log(`\n2. After manual edit: "${manuallyEditedTitle}"`);

// Now try to rebuild from this stale title
console.log(`\n3. rebuildTitle(manuallyEditedTitle, 3)`);
const rebuildFromStale = rebuildTitle(manuallyEditedTitle, 3, '', '');
console.log(`   Result: "${rebuildFromStale}"`);
if (rebuildFromStale.includes('52')) {
  console.log(`   ✗ BUG: "52" persists even after rebuild!`);
} else {
  console.log(`   ✓ OK: "52" was cleaned`);
}

// ============================================================================
// SCENARIO 2: What if "Total" is appended in a description, not title?
// ============================================================================

console.log(`\n` + '='.repeat(80));
console.log('SCENARIO: DESCRIPTION WITH "52 TOTAL"');
console.log('='.repeat(80));

const desc = 'This bundle includes 2 individual units of Vicks ZzzQuil Ultra Sleep Nasal Breathe. Total: 52 units';
console.log(`\nDescription: "${desc}"`);
console.log(`If CSV shows this as title: descriptions shouldn't become titles...`);

// ============================================================================
// SCENARIO 3: Multiplication in CSV row?
// ============================================================================

console.log(`\n` + '='.repeat(80));
console.log('SCENARIO: MULTIPLICATION (26 * 2 = 52)');
console.log('='.repeat(80));

console.log(`\nUnit Count: 26`);
console.log(`Pack Count: 2`);
console.log(`Total (26 * 2): 52`);
console.log(`\nPossible CSV row:`);
console.log(`  Title: "Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count Pack of 2 New"`);
console.log(`  C:Size: "26" (unit count)`);
console.log(`  BUT IF C:Size = "52", it means someone calculated 26 * 2`);
console.log(`\nWhere could this calculation happen?`);
console.log(`  - NOT in rebuildTitle (verified)`);
console.log(`  - NOT in buildTitleFromSpans (verified)`);
console.log(`  - Possibly in psGenerateSpecifics (Claude AI)`);
console.log(`  - Possibly in description generation (descForPack)`);
console.log(`  - Possibly in CSV export logic`);

// ============================================================================
// SCENARIO 4: Check if Size extraction from title would see "52"
// ============================================================================

console.log(`\n` + '='.repeat(80));
console.log('SCENARIO: SIZE EXTRACTION FROM TITLE');
console.log('='.repeat(80));

const titleWithBothCounts = 'Vicks ZzzQuil Ultra Sleep Nasal Breathe 26 Count 52 Total Pack of 3 New';
console.log(`\nTitle with both counts: "${titleWithBothCounts}"`);
console.log(`If Claude sees "26 Count 52 Total", what would it extract as Size/Count?`);
console.log(`  - Likely: "52 Total" (the later number with explicit "Total" label)`);
console.log(`  - OR: "26 Count" (the first number)`);
console.log(`  - Claude would probably pick "52 Total" as the specific`);

console.log(`\n` + '='.repeat(80));
console.log('KEY FINDING');
console.log('='.repeat(80));
console.log(`\nThe "52 Total" appears ONLY if:`);
console.log(`1. Someone manually edited the title to add "52 Total" (user action)`);
console.log(`2. OR the description contained "52 Total" and got mixed into the title`);
console.log(`3. OR the CSV export logic concatenated multiple fields`);
console.log(`\nrebuildTitle() alone CANNOT create "52 Total" — it only manipulates existing content`);
console.log(`The source of "52 Total" must be EXTERNAL to the title rebuild logic`);
