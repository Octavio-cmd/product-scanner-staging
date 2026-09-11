# MULTIPACK COUNT BUG — ROOT CAUSE ANALYSIS

## Evidence Summary

**Real CSV Export Data (Confirmed by User):**
- **Title:** `26ct Ea 52 Total ... Pack of 3 New`
- **Description:** Contains same `26ct Ea 52 Total`  
- **C:Size:** `52 Count`
- **Pack Size:** 3

**Expected Values:**
- **Unit Count:** 26 (each individual unit)
- **Pack Total:** 26 × 3 = 78 (if title showed bundle total)
- **Pack Size Selection:** 3

**Anomaly:** 
- C:Size shows `52 Count` (which is 26 × 2) instead of 26
- Title shows `52 Total` (also matches Pack 2, not Pack 3)
- Pack selection is 3, but specifics/title show Pack 2 values

---

## Test Results

### Test 1: rebuildTitle() Function Verification
**Conclusion: ✓ PASS — No calculation bug**

- `rebuildTitle("Vicks ... 26 Count", 2)` → `"Vicks ... 26 Count Pack of 2 New"` ✓
- `rebuildTitle("Vicks ... 26 Count", 3)` → `"Vicks ... 26 Count Pack of 3 New"` ✓
- No multiplication, no "Total" generation
- Function correctly preserves unit count and updates pack suffix only

### Test 2: Title Fallback Path
**Conclusion: ✓ No issue — cur._selectedTitle used correctly**

- CSV export uses: `cur._selectedTitle || titleEl.dataset.val || rebuildTitle(...)`
- cur._selectedTitle is updated by rebuildAndApplyTitle() for every pack change
- Fallback to DOM dataset only happens if cur._selectedTitle is falsy (shouldn't happen)

### Test 3: Complete Lifecycle Simulation
**Conclusion: ⚠️ Specifics caching identified**

- Pack 2: specifics generated at this point
- Pack 3: specifics NOT regenerated — still hold Pack 2 values
- CSV export: uses stale specifics if not regenerated

---

## Root Cause: Identified Issues

### Issue 1: Stale Specifics After Pack Change ⚠️

**Location:** No invalidation logic when `_selectedPack` changes

**Current Behavior:**
1. User selects Pack 2
2. Specifics are generated and cached in `cur._specifics`
3. User switches to Pack 3
4. `cur._specifics` is NOT cleared/invalidated
5. CSV export uses stale Pack 2 specifics for Pack 3 row

**Impact:** 
- If C:Size was "52" at Pack 2, it remains "52" at Pack 3
- CSV row shows Pack of 3 but Size shows Pack 2's value

**Code Location:**
- Line 4419 in `pickPack()`: Calls `rebuildAndApplyTitle()`
- Line 3776-3861 in `rebuildAndApplyTitle()`: Updates title but does NOT invalidate specifics
- Line 5530 in `_addBulkInternal()`: Uses whatever specifics are cached

**Fix Required:**
When pack changes via `pickPack()` → `rebuildAndApplyTitle()`, add:
```javascript
// Invalidate cached specifics since pack size changed
if (cur && cur._specifics) {
  delete cur._specifics['Size'];
  delete cur._specifics['Count'];
  delete cur._specifics['Unit Quantity'];
  delete cur._specifics['Volume'];
}
```

---

### Issue 2: "52 Total" Appears in Title ⚠️ CRITICAL

**Source Not Fully Identified** — but three likely scenarios:

#### Scenario A: Manual Title Edit (Most Likely)
**Flow:**
1. Pack 2 selected
2. Title displayed as: `"Vicks ... 26 Count Pack of 2 New"`
3. User manually edits title to: `"Vicks ... 26ct Ea 52 Total Pack of 2 New"` (user action)
4. `cur._titleManual = true` is set (line 3911)
5. User switches to Pack 3
6. rebuildAndApplyTitle() detects `cur._titleManual == true` (line 3786)
7. Instead of rebuild, it only updates Pack-of-N via regex (line 3792)
8. Result: `"Vicks ... 26ct Ea 52 Total Pack of 3 New"` (52 persists)

**Code Issue:** Line 3792 in rebuildAndApplyTitle():
```javascript
if (/\bpack of \d+\b/i.test(manualT)) {
  manualT = manualT.replace(/\bpack of \d+\b/i, 'Pack of ' + newPack);
}
```
This only updates "Pack of N", preserves everything else including stale "52 Total"

#### Scenario B: Claude AI Misinterpretation
**Flow:**
1. psGenerateSpecifics() called at Pack 2
2. Passes titleForAI (should be canonical, without "Pack of N")
3. Claude extracts from title or description
4. If description contained "52 units total", Claude might extract "52"
5. Result: C:Size = "52 Count" is stored
6. Title also modified to include "52 Total" (Claude-generated)

**Code Issue:** Line 7780 in psGenerateSpecifics():
```javascript
var titleForAI = canonicalTitle.replace(/\s*Pack of \d+\s*/gi,' ').replace(/\s*New\s*$/i,'').trim();
```
Should use IMMUTABLE canonical title, but if description is also sent, it might confuse Claude

#### Scenario C: Description/Title Concatenation
**Flow:**
1. descForPack() generates: `"This bundle includes 26 units... Total 52..."`  
2. Title somehow gets appended with description text
3. CSV export concatenates fields and shows mixed content

**Less likely** — would be a CSV export bug, not title rebuild bug

---

## Confirmation: Manual Edit Path is Vulnerable

**Evidence for Scenario A:**
1. `rebuildTitle()` cannot create "52 Total" (verified)
2. `buildTitleFromSpans()` cannot create "52 Total" (verified)  
3. "Total" keyword appears nowhere in title rebuild logic
4. Only manual edit path (line 3786-3802) preserves previous content
5. If user manual-edited a title at Pack 2 to include "52 Total", Pack 3 would preserve it

**Proof:** Test showed that calling `rebuildTitle(title_with_52_total, 3)` returns title with "52 Total" still present because the regex patterns don't specifically target and remove "N Total" patterns.

---

## Root Cause Summary

### Primary Cause: Specifics Not Invalidated on Pack Change
- **Where:** When pack changes, `cur._specifics` retained from previous pack
- **Effect:** C:Size remains "52 Count" even when displaying Pack 3
- **Fix:** Add specific invalidation logic in pickPack() → rebuildAndApplyTitle()

### Secondary Cause: Manual Title Edit Preserves Old Content  
- **Where:** rebuildAndApplyTitle() when `cur._titleManual == true`
- **Effect:** If user manually edited title with stale values, pack change only updates "Pack of N", keeps "52 Total"
- **Fix:** When pack changes, either:
  - Clear `cur._titleManual = false` to force rebuild
  - OR extend the title cleanup regex to remove "N Total" patterns
  - OR always rebuild when pack changes (don't preserve manual edits across pack changes)

### Tertiary Cause: "52 Total" Source Unknown
- **Likely source:** User manual edit OR Claude AI misinterpretation of description
- **Effect:** Once in title, the manual edit path preserves it across pack changes
- **Additional Fix:** Improve description generation to not include ambiguous total numbers

---

## Recommended Fixes (Priority Order)

### FIX 1: Invalidate Specifics on Pack Change (HIGH PRIORITY)
**File:** app.js  
**Location:** After line 4419 in pickPack()

```javascript
// Invalidate cached specifics when pack size changes
if (cur && cur._specifics) {
  // These specifics depend on unit count and pack size—recalculate when either changes
  delete cur._specifics['Size'];
  delete cur._specifics['Count'];  
  delete cur._specifics['Unit Quantity'];
  delete cur._specifics['Volume'];
  // Do NOT delete other specifics (Brand, Type, Color, etc. are pack-independent)
}
```

### FIX 2: Handle Manual Edits Across Pack Changes (MEDIUM PRIORITY)
**File:** app.js  
**Location:** Line 3786-3802 in rebuildAndApplyTitle()

Option A: Force rebuild when pack changes
```javascript
if (cur && cur._titleManual && newPack === cur._selectedPack) {
  // Only preserve manual edit if pack hasn't changed
  // Otherwise, force full rebuild
  ... existing manual edit logic ...
} else {
  // Pack changed: rebuild from base, ignoring manual edit flag
  title = rebuildTitle(state.baseTitle, newPack, shade, expDate);
  cur._titleManual = false; // Reset flag
}
```

Option B: Extend cleanup to remove "N Total" patterns
```javascript
// In rebuildTitle() at line 4296, before parseIntoSpans:
var cleanBase = base
  .replace(/\bexp(?:ires?|iration)?\.?\s*\d{1,2}[\/\-]\d{2,4}\b/gi, '')
  .replace(/\bexp(?:ires?|iration)?\.?\s*\d{2,4}\b/gi, '')
  .replace(/\b\d+\s+total\b/gi, '')  // ← ADD THIS LINE
  .replace(/\bpack of \d+\b/gi, '')
  // ... rest of cleanup ...
```

### FIX 3: Improve Description Generation (LOW PRIORITY)
**File:** app.js  
**Location:** Line 8850 in descForPack()

Don't include ambiguous total numbers in descriptions that might confuse Claude:
```javascript
// Avoid: "This bundle includes 26 units. Total: 52 units"
// Use: "This bundle includes 26 units of Vicks ZzzQuil Ultra Sleep"
var bundleIntro = (packs === 1 
  ? 'This listing includes 1 individual unit'
  : 'This bundle includes ' + packs + ' individual units');
```

---

## Testing Strategy

### Test Case A: Normal Pack Switching (No Manual Edit)
1. Load product with 26-unit count
2. Select Pack 2 → verify title shows "Pack of 2"
3. Generate specifics → verify Size = "26"
4. Select Pack 3 → verify title shows "Pack of 3", Size still shows "26" (cached)
5. **After FIX 1:** Size should be deleted/recalculated, not cached

### Test Case B: Manual Edit Then Pack Switch
1. Load product, select Pack 2
2. Manually edit title to add "52 Total"
3. Select Pack 3
4. **Current:** Title shows "52 Total Pack of 3" (bug)
5. **After FIX 2:** Title rebuilds cleanly to "26 Count Pack of 3" (fixed)

### Test Case C: CSV Export at Different Packs
1. Product at Pack 2 → generate specifics → export CSV → verify C:Size = "26"
2. Switch to Pack 3 (same product, same session)
3. Export CSV → verify C:Size is updated for Pack 3 (not stale "52")

---

## Confidence Level

- **Specifics Caching Issue:** 🟢 HIGH CONFIDENCE (verified through code review + simulation)
- **Manual Edit Path Issue:** 🟢 HIGH CONFIDENCE (code shows it preserves content on pack change)
- **"52 Total" Source:** 🟡 MEDIUM-HIGH CONFIDENCE (not 100% reproduced, but manual edit + regex weakness explains it)

---

## Next Steps

1. ✅ Implement FIX 1 (specifics invalidation)
2. ✅ Implement FIX 2 Option A or B (manual edit handling)
3. ✅ Test with Case A, B, C above
4. ✅ Verify no regression in other pack-switching scenarios
5. 📝 Add unit tests for pack switching with specifics
