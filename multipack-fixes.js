/**
 * MULTIPACK BUG FIXES — PRODUCTION IMPLEMENTATIONS (rev 2, pre-integration)
 *
 * Architectural invariants enforced here:
 *
 *   UNIT FACT     — a per-unit property that NEVER changes with pack size
 *                   ("26 Count", "16 oz"). Lives in _canonicalSpecifics.
 *   DERIVED TOTAL — unitCount x packSize ("78 Total"). Presentation only.
 *   PACK SIZE     — the bundle selection (1, 2, 3 ...).
 *
 * rev 2 corrections (pre-integration review):
 *   - restoreCanonicalSpecifics no longer guesses from regex shape. It never
 *     deletes. It restores ONLY on proof of pack-derivation. Fail safe = keep.
 *   - normalizeDuplicateNew now guarantees exactly ONE standalone condition
 *     "New", terminal, while protecting "New" inside a product identity.
 *   - psGetUnitNoun added; descriptions keep the real unit noun.
 *   - Titles are fitted with a strategy that can never truncate away
 *     "Pack of N", the expiration, or the terminal "New". NOTE: the local
 *     fitter (psFitTitleSemantic) is LAB SCAFFOLDING ONLY — production must
 *     delegate to parseIntoSpans()/buildTitleFromSpans(). See its banner.
 *   - psCanonicalProductName / psDisclaimerForPack are now resolved defensively
 *     so this module is safe to load outside app.js.
 */

var PS_MAX_TITLE_LEN = 80;

// Largest ratio still credible as a pack multiple. Beyond this a difference is
// far more likely to be a different product fact than a bundle total.
var PS_MAX_PACK_RATIO = 12;

// ============================================================================
// SHARED PARSING PRIMITIVES
// ============================================================================

// "26 Count" -> {num:26, unit:'count'}   "16 fl oz" -> {num:16, unit:'fl oz'}
// Returns null when the value is not a clean "<number> <unit>" measure.
function psParseMeasure(value) {
  if (value == null) return null;
  var s = String(value).trim();
  if (!s) return null;
  var m = s.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z. ]*)?$/);
  if (!m) return null;
  var num = parseFloat(m[1]);
  if (!(num > 0)) return null;
  return { num: num, unit: psNormalizeUnitToken(m[2] || ''), raw: s };
}

function psNormalizeUnitToken(unit) {
  var u = String(unit || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!u) return '';
  if (u === 'fl oz' || u === 'floz' || u === 'fluid ounce' || u === 'fluid ounces') return 'fl oz';
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return 'oz';
  // singularize a trailing plural so "counts"/"count" and "tablets"/"tablet" match
  if (/[^s]s$/.test(u)) u = u.slice(0, -1);
  return u;
}

// ============================================================================
// FIX 2 — CANONICAL UNIT COUNT HELPER
// ============================================================================
// The authoritative per-unit count. Only ever read from immutable sources; a
// string carrying " Total" is bundle-contaminated and is refused outright.

function psGetCanonicalUnitCount(cur) {
  if (!cur) return null;

  if (cur._countConfirmed && cur._countConfirmed > 0) {
    return cur._countConfirmed;
  }

  if (cur._canonicalSpecifics && cur._canonicalSpecifics['Size']) {
    var sizeVal = String(cur._canonicalSpecifics['Size']).trim();
    var sizeMatch = sizeVal.match(/^(\d+)/);
    if (sizeMatch) {
      var num = parseInt(sizeMatch[1], 10);
      if (num > 0 && num < 10000) return num;
    }
  }

  var COUNT_NOUNS = '(?:Count|Ct|Tablets?|Capsules?|Softgels?|Soft\\s?Gels?|Pellets?|Gumm(?:y|ies)|Strips?|Pads?|Packets?|Pieces?)';

  if (cur._canonicalProductName) {
    var canonical = String(cur._canonicalProductName);
    var countMatch = canonical.match(new RegExp('\\b(\\d{1,4})\\s+' + COUNT_NOUNS + '\\b', 'i'));
    if (countMatch) {
      var cnt = parseInt(countMatch[1], 10);
      if (cnt > 0 && cnt < 10000 && !/\bTotal\b/i.test(canonical)) return cnt;
    }
  }

  var baseTitle = cur.title || (cur.prod && cur.prod.title) || '';
  if (baseTitle) {
    var baseMatch = String(baseTitle).match(new RegExp('\\b(\\d{1,4})\\s+' + COUNT_NOUNS + '\\b', 'i'));
    if (baseMatch) {
      var baseCnt = parseInt(baseMatch[1], 10);
      if (baseCnt > 0 && baseCnt < 10000 && !/\bTotal\b/i.test(baseTitle)) return baseCnt;
    }
  }

  return null;
}

// ============================================================================
// FIX 3 — TOTAL COUNT HELPER
// ============================================================================
// Bundle total = unit count x pack size, and only when the unit count is known.

function psGetPackTotalCount(cur, packSize) {
  var unitCount = psGetCanonicalUnitCount(cur);
  if (unitCount && unitCount > 0 && packSize && packSize > 0) {
    return unitCount * packSize;
  }
  return null;
}

// ============================================================================
// FIX 6 (rev 2) — UNIT NOUN RESOLUTION
// ============================================================================
// Conservative: the noun must be stated by the product's own form fields or
// canonical identity. Never invented. Returns null when uncertain so callers
// fall back to the neutral "N count each / N total" phrasing.

var PS_UNIT_NOUNS = [
  { key: 'tablet',  singular: 'tablet',  plural: 'tablets',  re: /\btablets?\b/i },
  { key: 'capsule', singular: 'capsule', plural: 'capsules', re: /\bcapsules?\b/i },
  { key: 'softgel', singular: 'softgel', plural: 'softgels', re: /\bsoft\s?gels?\b/i },
  { key: 'gummy',   singular: 'gummy',   plural: 'gummies',  re: /\bgumm(?:y|ies)\b/i },
  { key: 'pellet',  singular: 'pellet',  plural: 'pellets',  re: /\bpellets?\b/i },
  { key: 'strip',   singular: 'strip',   plural: 'strips',   re: /\bstrips?\b/i },
  { key: 'pad',     singular: 'pad',     plural: 'pads',     re: /\bpads?\b/i },
  { key: 'packet',  singular: 'packet',  plural: 'packets',  re: /\bpackets?\b/i },
  { key: 'piece',   singular: 'piece',   plural: 'pieces',   re: /\bpieces?\b/i },
  { key: 'unit',    singular: 'unit',    plural: 'units',    re: /\bunits?\b/i }
];

var PS_FORM_FIELDS = ['Item Form', 'Formulation', 'Dosage Form', 'Form'];

function psMatchUnitNoun(text) {
  if (!text) return null;
  for (var i = 0; i < PS_UNIT_NOUNS.length; i++) {
    if (PS_UNIT_NOUNS[i].re.test(String(text))) return PS_UNIT_NOUNS[i];
  }
  return null;
}

// Returns {key, singular, plural, source} or null when the form is unknown.
function psGetUnitNoun(cur) {
  if (!cur) return null;

  var sources = [];
  for (var i = 0; i < PS_FORM_FIELDS.length; i++) {
    var f = PS_FORM_FIELDS[i];
    if (cur._canonicalSpecifics && cur._canonicalSpecifics[f]) {
      sources.push({ text: cur._canonicalSpecifics[f], source: 'canonicalSpecifics.' + f });
    }
    if (cur._specifics && cur._specifics[f]) {
      sources.push({ text: cur._specifics[f], source: 'specifics.' + f });
    }
  }
  if (cur._canonicalSpecifics && cur._canonicalSpecifics['Size']) {
    sources.push({ text: cur._canonicalSpecifics['Size'], source: 'canonicalSpecifics.Size' });
  }
  if (cur._canonicalProductName) {
    sources.push({ text: cur._canonicalProductName, source: 'canonicalProductName' });
  }
  if (cur.title) sources.push({ text: cur.title, source: 'title' });

  for (var j = 0; j < sources.length; j++) {
    var hit = psMatchUnitNoun(sources[j].text);
    if (hit) {
      return { key: hit.key, singular: hit.singular, plural: hit.plural, source: sources[j].source };
    }
  }
  return null;
}

function psPluralizeUnitNoun(noun, count) {
  if (!noun) return '';
  return Number(count) === 1 ? noun.singular : noun.plural;
}

// Titles render the noun in Title Case ("240 Pellets Each"); descriptions keep
// it lowercase ("240 pellets each").
function psTitleCaseNoun(word) {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ============================================================================
// FIX 7 (rev 2) — STANDALONE CONDITION "New" NORMALIZATION
// ============================================================================
// Invariant: exactly one standalone condition token "New", and it is terminal.
// "New" that belongs to a product identity ("New York", "New Balance") is not
// a condition marker and is left alone.

var PS_NEW_IDENTITY_FOLLOWERS = [
  'york', 'zealand', 'balance', 'england', 'jersey', 'orleans', 'hampshire',
  'mexico', 'delhi', 'age', 'era', 'wave', 'world'
];

function psIsIdentityNewAt(tokens, idx) {
  var next = tokens[idx + 1];
  if (!next) return false;
  var w = String(next).toLowerCase().replace(/[^a-z]/g, '');
  return PS_NEW_IDENTITY_FOLLOWERS.indexOf(w) !== -1;
}

// Counts only condition-marker "New" tokens (identity "New" is excluded).
function countStandaloneNewTokens(title) {
  if (!title) return 0;
  var tokens = String(title).trim().split(/\s+/);
  var n = 0;
  for (var i = 0; i < tokens.length; i++) {
    if (/^new$/i.test(tokens[i]) && !psIsIdentityNewAt(tokens, i)) n++;
  }
  return n;
}

function normalizeDuplicateNew(title) {
  if (!title) return title;

  var tokens = String(title).trim().split(/\s+/).filter(Boolean);
  var kept = [];
  for (var i = 0; i < tokens.length; i++) {
    if (/^new$/i.test(tokens[i]) && !psIsIdentityNewAt(tokens, i)) {
      continue; // drop every condition "New"; exactly one is re-appended below
    }
    kept.push(tokens[i]);
  }

  var out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/[·\-,]+\s*$/, '').trim();
  return (out ? out + ' New' : 'New');
}

// ============================================================================
// FIX 5 (rev 2) — SEMANTIC TITLE FITTING
// ============================================================================
// ###########################################################################
// ## LAB / TEST SCAFFOLDING ONLY — DO NOT INTEGRATE INTO PRODUCTION.       ##
// ##                                                                       ##
// ## This helper exists so the suite can prove the protected-tail contract ##
// ## in isolation. It trims base descriptor words POSITIONALLY (from the   ##
// ## end), which discards semantic priority and can drop brand or critical ##
// ## product identity ahead of filler.                                     ##
// ##                                                                       ##
// ## At app.js integration, title fitting MUST delegate to the existing    ##
// ## production semantic pipeline:                                         ##
// ##     parseIntoSpans()  ->  annotateSpans()  ->  buildTitleFromSpans()  ##
// ## which ranks spans by priority/semanticScore instead of position.      ##
// ##                                                                       ##
// ## Protected tokens in production remain: Brand, critical product        ##
// ## identity, unit count, total count, expiration, "Pack of N", terminal  ##
// ## "New".                                                                ##
// ###########################################################################
//
// Contract mirrored from buildTitleFromSpans(): the tail (expiration +
// "Pack of N" + "New") is inviolable. To fit 80 chars this drops base words
// from the end first, then optional derived segments in ascending
// dropPriority. The tail survives every path.
//
//   baseText          - product identity words (trimmed from the end if needed)
//   optionalSegments  - [{text:'26 Each', dropPriority:1}, {text:'78 Total', dropPriority:2}]
//                       lowest dropPriority is sacrificed first
//   protectedTail     - e.g. "Exp 03/27 Pack of 3 New" — never cut

function psFitTitleSemantic(baseText, optionalSegments, protectedTail, maxLen) {
  maxLen = maxLen || PS_MAX_TITLE_LEN;

  var baseWords = String(baseText || '').trim().split(/\s+/).filter(Boolean);
  var segs = (optionalSegments || []).slice().filter(function (s) { return s && s.text; });
  var tail = String(protectedTail || '').trim();

  function assemble() {
    var parts = [];
    if (baseWords.length) parts.push(baseWords.join(' '));
    segs.forEach(function (s) { parts.push(s.text); });
    if (tail) parts.push(tail);
    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  var out = assemble();
  if (out.length <= maxLen) return out;

  // 1) trim descriptor words from the end of the base (keep at least one)
  while (baseWords.length > 1 && assemble().length > maxLen) {
    baseWords.pop();
  }
  out = assemble();
  if (out.length <= maxLen) return out;

  // 2) sacrifice optional derived segments, cheapest first
  segs.sort(function (a, b) { return (a.dropPriority || 0) - (b.dropPriority || 0); });
  while (segs.length && assemble().length > maxLen) {
    segs.shift();
  }
  out = assemble();
  if (out.length <= maxLen) return out;

  // 3) last resort: shrink the final base word — never the protected tail
  while (baseWords.length && assemble().length > maxLen) {
    baseWords.pop();
  }
  return assemble();
}

// ============================================================================
// FIX 1 (rev 2) — MANUAL TITLE NORMALIZATION ON PACK CHANGE
// ============================================================================
// Preserves the operator's product wording, discards derived state that the
// previous pack size produced, and re-derives it for the new pack size.

// Derived count segments for the title, shared by the manual-edit path and the
// normal rebuild path so both emit one identical format:
//   "<unitCount> <Noun> Each <totalCount> Total"
// The noun rides the per-unit segment only; the total stays a bare number.
//
// dropPriority doubles as the span priority used by the production span
// fitter: "Each" (3) is sacrificed before "Total" (3.5), and both are
// sacrificed before brand / core identity (>=4) but after filler (2).
function psBuildCountSegments(cur, packSize, baseText) {
  var unitCount = psGetCanonicalUnitCount(cur);
  if (!unitCount) return [];
  var noun = psGetUnitNoun(cur);
  var totalCount = (Number(packSize) > 0) ? unitCount * Number(packSize) : null;

  var segments = [];

  // If the base title already states the per-unit count ("... Strips 26 Count"),
  // adding "26 Strips Each" would print the same number twice. The base is
  // already the per-unit statement, so only the derived total is appended.
  var baseStatesUnitCount = baseText &&
    new RegExp('\\b' + unitCount + '\\b').test(String(baseText));

  if (!baseStatesUnitCount) {
    segments.push({
      text: unitCount + (noun ? ' ' + psTitleCaseNoun(psPluralizeUnitNoun(noun, unitCount)) : '') + ' Each',
      dropPriority: 3
    });
  }
  if (totalCount && Number(packSize) >= 2) {
    segments.push({ text: totalCount + ' Total', dropPriority: 3.5 });
  }
  return segments;
}

// opts.fit lets production inject its own fitter. Production MUST pass one
// backed by parseIntoSpans()/annotateSpans()/buildTitleFromSpans(); the
// default below is the lab fitter and is not for production use.
//   opts.fit({ baseText, segments, packSize, maxLen }) -> string
function normalizeManualTitleForPackChange(manualTitle, cur, newPack, opts) {
  if (!manualTitle || !(Number(newPack) >= 1)) return manualTitle;

  var result = String(manualTitle);

  // Strip stale derived state: "52 Total", "52ct Total", "Total 52",
  // "26ct Ea", "26 Each", and the previous "Pack of N".
  result = result
    .replace(/\s*\b\d+\s*(?:ct|count)?\s*(?:Total)\b/gi, ' ')
    .replace(/\s*\bTotal\s+\d+\b/gi, ' ')
    .replace(/\s*\b\d+\s*(?:ct|count)?\s*(?:Ea|Each)\b/gi, ' ')
    .replace(/\s*\bpack of \d+\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  var unitCount = psGetCanonicalUnitCount(cur);
  var totalCount = (unitCount && Number(newPack) > 0) ? unitCount * Number(newPack) : null;
  var noun = psGetUnitNoun(cur);

  // Protected tail — expiration (if the caller already embedded it), pack, New.
  var tail = '';
  if (Number(newPack) >= 2) tail += 'Pack of ' + Number(newPack) + ' ';
  tail += 'New';

  var segments = psBuildCountSegments(cur, newPack, result);

  // Remove any condition "New" left inside the operator's wording before fitting.
  var baseTokens = result.split(/\s+/).filter(Boolean).filter(function (t, i, arr) {
    return !(/^new$/i.test(t) && !psIsIdentityNewAt(arr, i));
  });

  var fitted;
  if (opts && typeof opts.fit === 'function') {
    fitted = opts.fit({
      baseText: baseTokens.join(' '),
      segments: segments,
      packSize: Number(newPack),
      maxLen: PS_MAX_TITLE_LEN
    });
  } else {
    fitted = psFitTitleSemantic(baseTokens.join(' '), segments, tail, PS_MAX_TITLE_LEN);
  }
  return normalizeDuplicateNew(fitted);
}

// ============================================================================
// FIX 4 (rev 2) — DESCRIPTION GENERATION
// ============================================================================

function psCanonicalProductNameSafe(title) {
  if (typeof psCanonicalProductName === 'function') {
    return psCanonicalProductName(title);
  }
  if (!title) return title;
  return String(title).trim()
    .replace(/\s+(?:Pack of \d+\s+)?(New|Used|Refurbished|Open Box)\s*$/i, '')
    .replace(/\s+Pack of \d+\s*$/i, '')
    .trim();
}

function psDisclaimerForPackSafe(disclaimer, packs) {
  if (typeof psDisclaimerForPack === 'function') {
    return psDisclaimerForPack(disclaimer, packs);
  }
  return disclaimer;
}

function descForPackFixed(desc, packs, curObj) {
  if (!desc) return desc;

  var productName = '';
  if (curObj) {
    if (!curObj._canonicalProductName) {
      curObj._canonicalProductName = psCanonicalProductNameSafe(
        (curObj.prod && curObj.prod.title) || curObj.title || ''
      );
    }
    productName = curObj._canonicalProductName;
  }

  var unitCount = psGetCanonicalUnitCount(curObj);
  var totalCount = unitCount ? (unitCount * packs) : null;
  var noun = psGetUnitNoun(curObj);

  var bundleIntro = (packs === 1
    ? 'This listing includes 1 individual unit'
    : 'This bundle includes ' + packs + ' individual units');

  if (productName) bundleIntro += ' of ' + productName;

  if (unitCount) {
    if (noun) {
      bundleIntro += ', ' + unitCount + ' ' + psPluralizeUnitNoun(noun, unitCount) + ' each';
      if (totalCount && packs > 1) {
        bundleIntro += ', ' + totalCount + ' ' + psPluralizeUnitNoun(noun, totalCount) + ' total';
      }
    } else {
      bundleIntro += ', ' + unitCount + ' count each';
      if (totalCount && packs > 1) bundleIntro += ', ' + totalCount + ' total';
    }
  }

  bundleIntro += '.';

  if (typeof desc === 'string') return bundleIntro + ' ' + desc;

  if (typeof desc === 'object') {
    return {
      intro: desc.intro || '',
      benefits: desc.benefits || [],
      package_contents: bundleIntro + ' ' + (desc.package_contents || ''),
      disclaimer: psDisclaimerForPackSafe(desc.disclaimer || '', packs)
    };
  }

  return bundleIntro;
}

// ============================================================================
// FIX 5 + 6 (rev 2) — FAIL-SAFE CANONICAL SPECIFICS RESTORATION
// ============================================================================
// A value is treated as pack-derived ONLY when an authoritative canonical
// per-unit value exists AND the presentation value is that canonical value
// multiplied by a credible integer pack factor, in the same unit.
//
// No regex shape heuristics. No deletions. Missing canonical evidence => keep
// whatever is there ("120 Count" with no canonical peer stays "120 Count").
//
// Returns an audit trail: [{field, action, reason, from, to}]
//   action: 'restored' | 'preserved' | 'filled' | 'unchanged'

function psIsProvenPackDerived(canonicalValue, currentValue, cur) {
  var c = psParseMeasure(canonicalValue);
  var p = psParseMeasure(currentValue);

  if (!c || !p) return { proven: false, reason: 'value not a parseable measure' };
  if (c.unit !== p.unit) return { proven: false, reason: 'unit mismatch (' + (c.unit || '-') + ' vs ' + (p.unit || '-') + ')' };
  if (p.num === c.num) return { proven: false, reason: 'identical to canonical' };
  if (p.num < c.num) return { proven: false, reason: 'smaller than canonical — not a bundle total' };

  var ratio = p.num / c.num;
  if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
    return { proven: false, reason: 'ratio ' + ratio.toFixed(3) + ' is not an integer pack multiple' };
  }
  ratio = Math.round(ratio);
  if (ratio < 2 || ratio > PS_MAX_PACK_RATIO) {
    return { proven: false, reason: 'ratio x' + ratio + ' outside credible pack range' };
  }
  if (cur && Array.isArray(cur._knownPackSizes) && cur._knownPackSizes.length &&
      cur._knownPackSizes.indexOf(ratio) === -1) {
    return { proven: false, reason: 'ratio x' + ratio + ' is not a pack size this product offers' };
  }

  return { proven: true, ratio: ratio, reason: 'current = canonical x ' + ratio + ' (proven pack multiple)' };
}

function restoreCanonicalSpecifics(cur, fieldNames) {
  var audit = [];
  if (!cur) return audit;

  fieldNames = fieldNames || ['Size', 'Count', 'Unit Quantity', 'Volume'];
  var canon = cur._canonicalSpecifics || {};
  if (!cur._specifics) cur._specifics = {};

  fieldNames.forEach(function (field) {
    var canonicalValue = (canon[field] != null) ? String(canon[field]).trim() : '';
    var currentValue = (cur._specifics[field] != null) ? String(cur._specifics[field]).trim() : '';

    // (A) No canonical evidence -> FAIL SAFE. Never delete, never guess.
    if (!canonicalValue) {
      audit.push({
        field: field, action: 'preserved', from: currentValue || null, to: currentValue || null,
        reason: 'no canonical per-unit value — data preserved, no inference made'
      });
      return;
    }

    if (!currentValue) {
      cur._specifics[field] = canonicalValue;
      audit.push({
        field: field, action: 'filled', from: null, to: canonicalValue,
        reason: 'no presentation value; seeded from canonical'
      });
      return;
    }

    if (currentValue.toLowerCase() === canonicalValue.toLowerCase()) {
      audit.push({
        field: field, action: 'unchanged', from: currentValue, to: currentValue,
        reason: 'already canonical'
      });
      return;
    }

    // (B) Differs — restore only on proof of pack-derivation.
    var proof = psIsProvenPackDerived(canonicalValue, currentValue, cur);
    if (proof.proven) {
      cur._specifics[field] = canonicalValue;
      audit.push({
        field: field, action: 'restored', from: currentValue, to: canonicalValue,
        ratio: proof.ratio, reason: proof.reason
      });
    } else {
      audit.push({
        field: field, action: 'preserved', from: currentValue, to: currentValue,
        reason: 'differs from canonical but not provably pack-derived (' + proof.reason + ')'
      });
    }
  });

  return audit;
}

// ============================================================================
// EXPORT
// ============================================================================

var PS_MULTIPACK_API = {
  psGetCanonicalUnitCount: psGetCanonicalUnitCount,
  psGetPackTotalCount: psGetPackTotalCount,
  psGetUnitNoun: psGetUnitNoun,
  psPluralizeUnitNoun: psPluralizeUnitNoun,
  psTitleCaseNoun: psTitleCaseNoun,
  psParseMeasure: psParseMeasure,
  psIsProvenPackDerived: psIsProvenPackDerived,
  psBuildCountSegments: psBuildCountSegments,
  countStandaloneNewTokens: countStandaloneNewTokens,
  normalizeManualTitleForPackChange: normalizeManualTitleForPackChange,
  descForPackFixed: descForPackFixed,
  restoreCanonicalSpecifics: restoreCanonicalSpecifics,
  normalizeDuplicateNew: normalizeDuplicateNew,
  PS_MAX_TITLE_LEN: PS_MAX_TITLE_LEN
};

// Browser: publish onto window so app.js (a plain script) can call these.
// NOTE: psFitTitleSemantic is intentionally left OUT of this map, but being a
// top-level function declaration in a classic script it is a global anyway.
// The enforceable invariant is therefore "production never CALLS it", which
// test-multipack-integration.js asserts against the app.js source text.
if (typeof window !== 'undefined') {
  for (var _psKey in PS_MULTIPACK_API) {
    if (PS_MULTIPACK_API.hasOwnProperty(_psKey)) window[_psKey] = PS_MULTIPACK_API[_psKey];
  }
  window.PS_MULTIPACK_API = PS_MULTIPACK_API;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    psGetCanonicalUnitCount: psGetCanonicalUnitCount,
    psGetPackTotalCount: psGetPackTotalCount,
    psGetUnitNoun: psGetUnitNoun,
    psPluralizeUnitNoun: psPluralizeUnitNoun,
    psTitleCaseNoun: psTitleCaseNoun,
    psParseMeasure: psParseMeasure,
    psIsProvenPackDerived: psIsProvenPackDerived,
    psFitTitleSemantic: psFitTitleSemantic, // lab/test only — never in production
    psBuildCountSegments: psBuildCountSegments,
    countStandaloneNewTokens: countStandaloneNewTokens,
    normalizeManualTitleForPackChange: normalizeManualTitleForPackChange,
    descForPackFixed: descForPackFixed,
    restoreCanonicalSpecifics: restoreCanonicalSpecifics,
    normalizeDuplicateNew: normalizeDuplicateNew,
    PS_MAX_TITLE_LEN: PS_MAX_TITLE_LEN
  };
}
