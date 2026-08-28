import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(__dirname, '../app.js');
const appContent = fs.readFileSync(appPath, 'utf-8');

// ──────────────────────────────────────────────────────────────
// TEST 1: Backend SAVVY_API is staging URL
// ──────────────────────────────────────────────────────────────
test('Backend SAVVY_API uses staging URL exactly', () => {
  const stagingUrl = 'https://ample-imagination-clothing-staging.up.railway.app';
  assert(appContent.includes(`const SAVVY_API = '${stagingUrl}'`),
    'SAVVY_API must point to staging, not production');
});

// ──────────────────────────────────────────────────────────────
// TEST 2: No production backend URLs remain
// ──────────────────────────────────────────────────────────────
test('No production backend URLs in app.js', () => {
  const prodUrls = [
    'savvy-ebay-prices-production.up.railway.app',
    'savvy-config-production.up.railway.app',
    'savvy-rembg-production.up.railway.app',
  ];

  for (const url of prodUrls) {
    assert(!appContent.includes(url),
      `Production URL "${url}" must be removed from staging code`);
  }
});

// ──────────────────────────────────────────────────────────────
// TEST 3: SAVVY_CONFIG constant removed
// ──────────────────────────────────────────────────────────────
test('SAVVY_CONFIG constant removed', () => {
  assert(!appContent.includes("const SAVVY_CONFIG="),
    'SAVVY_CONFIG must be removed entirely');
});

// ──────────────────────────────────────────────────────────────
// TEST 4: Legacy /config fetch eliminated
// ──────────────────────────────────────────────────────────────
test('Legacy /config endpoint fetch removed', () => {
  assert(!appContent.includes("fetch(SAVVY_CONFIG + '/config')"),
    'Fetch to /config must be removed');
  assert(!appContent.includes("loadKeys()") || !appContent.includes("SAVVY_CONFIG"),
    'loadKeys IIFE must not reference SAVVY_CONFIG');
});

// ──────────────────────────────────────────────────────────────
// TEST 5: psAuthFetch helper exists
// ──────────────────────────────────────────────────────────────
test('psAuthFetch helper defined', () => {
  assert(appContent.includes("async function psAuthFetch(path, options)"),
    'psAuthFetch helper must be defined');
  assert(appContent.includes("psAuthFetch(") > 0,
    'psAuthFetch must be called in code');
});

// ──────────────────────────────────────────────────────────────
// TEST 6: Login endpoint uses /auth/login without Bearer
// ──────────────────────────────────────────────────────────────
test('Login uses POST /auth/login without Bearer', () => {
  assert(appContent.includes("SAVVY_API + '/auth/login'"),
    'Login must call /auth/login endpoint');
  assert(appContent.includes("method: 'POST'"),
    'Login must use POST method');
  // doLogin should NOT have Authorization header
  const doLoginStart = appContent.indexOf('async function doLogin()');
  const doLoginEnd = appContent.indexOf('}', doLoginStart + 200);
  const doLoginCode = appContent.substring(doLoginStart, doLoginEnd);
  assert(!doLoginCode.includes("'Authorization'"),
    'Login must NOT use Bearer token');
});

// ──────────────────────────────────────────────────────────────
// TEST 7: Session uses sessionStorage, not localStorage for token
// ──────────────────────────────────────────────────────────────
test('Session token stored in sessionStorage', () => {
  assert(appContent.includes("sessionStorage.getItem('savvy_session_token')"),
    'Must retrieve token from sessionStorage');
  assert(appContent.includes("sessionStorage.setItem('savvy_session_token'"),
    'Must store token in sessionStorage');
  assert(!appContent.includes("localStorage.getItem('savvy_session_token')"),
    'Token must NOT be stored in localStorage');
});

// ──────────────────────────────────────────────────────────────
// TEST 8: /resolve-url endpoint blocked in staging
// ──────────────────────────────────────────────────────────────
test('Endpoint /resolve-url blocked', () => {
  assert(!appContent.includes("/resolve-url?url=") || appContent.includes('todavía no está disponible'),
    '/resolve-url must be blocked with unavailable message');
});

// ──────────────────────────────────────────────────────────────
// TEST 9: /ebay-item endpoint blocked in staging
// ──────────────────────────────────────────────────────────────
test('Endpoint /ebay-item blocked', () => {
  assert(appContent.includes('todavía no está disponible') || !appContent.includes('/ebay-item?item_id='),
    '/ebay-item must be blocked with unavailable message');
});

// ──────────────────────────────────────────────────────────────
// TEST 10: /check-skus endpoint blocked in staging
// ──────────────────────────────────────────────────────────────
test('Endpoint /check-skus blocked', () => {
  assert(!appContent.includes('/check-skus') || appContent.includes('check-skus no disponible'),
    '/check-skus must be blocked or unavailable');
});

// ──────────────────────────────────────────────────────────────
// TEST 11: Image upload migrated to /api/img-upload
// ──────────────────────────────────────────────────────────────
test('Image upload uses /api/img-upload with Bearer', () => {
  assert(appContent.includes("psAuthFetch('/api/img-upload'"),
    'Must use psAuthFetch for /api/img-upload');
  assert(!appContent.includes("var SAVVY_BUCKET_UPLOAD = 'https://savvy-ebay-prices-production"),
    'Legacy SAVVY_BUCKET_UPLOAD must be removed');
});

// ──────────────────────────────────────────────────────────────
// TEST 12: WebP format blocked before upload
// ──────────────────────────────────────────────────────────────
test('WebP format blocked before upload', () => {
  const uploadFunc = appContent.substring(appContent.indexOf('async function _uploadToBucket'),
                                          appContent.indexOf('}', appContent.indexOf('async function _uploadToBucket') + 500));
  assert(uploadFunc.includes("image/webp") || uploadFunc.includes("WebP"),
    'WebP detection must be present');
  assert(uploadFunc.includes("Formato WebP") || uploadFunc.includes("pending"),
    'WebP must show user message before failing');
});

// ──────────────────────────────────────────────────────────────
// TEST 13: Search UPC uses psAuthFetch
// ──────────────────────────────────────────────────────────────
test('Search UPC uses psAuthFetch', () => {
  assert(appContent.includes("psAuthFetch('/search-upc"),
    '/search-upc must use psAuthFetch');
});

// ──────────────────────────────────────────────────────────────
// TEST 14: Inventory endpoints use psAuthFetch
// ──────────────────────────────────────────────────────────────
test('Inventory endpoints use psAuthFetch', () => {
  assert(appContent.includes("psAuthFetch('/ss/location'"),
    '/ss/location must use psAuthFetch');
  assert(appContent.includes("psAuthFetch('/sb/update-inventory'"),
    '/sb/update-inventory must use psAuthFetch');
  assert(appContent.includes("psAuthFetch('/ss/create-product'"),
    '/ss/create-product must use psAuthFetch');
});

// ──────────────────────────────────────────────────────────────
// TEST 15: Shopify endpoint uses psAuthFetch
// ──────────────────────────────────────────────────────────────
test('Shopify endpoint uses psAuthFetch', () => {
  assert(appContent.includes("psAuthFetch('/shopify-create-product'"),
    '/shopify-create-product must use psAuthFetch');
});

// ──────────────────────────────────────────────────────────────
// TEST 16: Leaf category endpoint uses psAuthFetch
// ──────────────────────────────────────────────────────────────
test('Leaf category endpoint uses psAuthFetch', () => {
  assert(appContent.includes("psAuthFetch('/leaf-category'"),
    '/leaf-category must use psAuthFetch');
});

// ──────────────────────────────────────────────────────────────
// TEST 17: Remove-bg service blocked
// ──────────────────────────────────────────────────────────────
test('Remove-bg service blocked in staging', () => {
  const removeFunction = appContent.substring(appContent.indexOf('function clRemoveBackground'),
                                              appContent.indexOf('}', appContent.indexOf('function clRemoveBackground') + 500));
  assert(removeFunction.includes('throw new Error') || removeFunction.includes('todavía no está disponible'),
    'Remove-bg must throw error or show unavailable message');
});

// ──────────────────────────────────────────────────────────────
// TEST 18: STAGING badge present
// ──────────────────────────────────────────────────────────────
test('STAGING visual badge added', () => {
  assert(appContent.includes("🧪 STAGING"),
    'STAGING badge must be visible');
  assert(appContent.includes("badge.textContent = '🧪 STAGING'") || appContent.includes("'STAGING'"),
    'STAGING mark must be added on load');
});

// ──────────────────────────────────────────────────────────────
// TEST 19: Link to Savvy Home staging
// ──────────────────────────────────────────────────────────────
test('Link to Savvy Home staging included', () => {
  assert(appContent.includes("https://octavio-cmd.github.io/savvy-home-staging/"),
    'Must link to Home staging');
  assert(!appContent.includes("target='_blank'") && !appContent.includes('window.open'),
    'Link must use same-tab navigation, not new window');
});

// ──────────────────────────────────────────────────────────────
// TEST 20: 401/403 handler clears session
// ──────────────────────────────────────────────────────────────
test('401/403 response clears session', () => {
  assert(appContent.includes("if (r.status === 401 || r.status === 403)"),
    'Must check for 401/403');
  assert(appContent.includes("savvySesionCaducada()"),
    'Must call savvySesionCaducada on auth failure');
});

// ──────────────────────────────────────────────────────────────
// TEST 21: No location.reload() used in logout
// ──────────────────────────────────────────────────────────────
test('Logout does not use location.reload()', () => {
  const logoutStart = appContent.indexOf('function doLogout()');
  const logoutEnd = appContent.indexOf('}', logoutStart + 200);
  const logoutCode = appContent.substring(logoutStart, logoutEnd);
  assert(!logoutCode.includes('location.reload()'),
    'Logout must not use reload()');
});

// ──────────────────────────────────────────────────────────────
// TEST 22: No legacy RAILWAY_URL constants hardcoded to production
// ──────────────────────────────────────────────────────────────
test('No RAILWAY_URL hardcoded to production', () => {
  assert(!appContent.includes("const RAILWAY_URL = 'https://savvy-ebay-prices-production"),
    'RAILWAY_URL must not point to production');
});

// ──────────────────────────────────────────────────────────────
// TEST 23: psAuthFetch validates origin
// ──────────────────────────────────────────────────────────────
test('psAuthFetch validates origin before fetch', () => {
  assert(appContent.includes("new URL(SAVVY_API).origin"),
    'Must extract origin from SAVVY_API');
  assert(appContent.includes("reqUrl.origin !== apiOrigin"),
    'Must validate request origin matches backend');
  assert(appContent.includes("URL externa no permitida"),
    'Must reject external URLs');
});

// ──────────────────────────────────────────────────────────────
// TEST 24: psAuthFetch requires token
// ──────────────────────────────────────────────────────────────
test('psAuthFetch requires valid token', () => {
  const psAuthFunc = appContent.substring(appContent.indexOf('async function psAuthFetch'),
                                          appContent.indexOf('}', appContent.indexOf('async function psAuthFetch') + 1000));
  assert(psAuthFunc.includes("savvyToken()"),
    'Must get token via savvyToken()');
  assert(psAuthFunc.includes("if (!token)"),
    'Must check token exists');
  assert(psAuthFunc.includes("savvySesionCaducada()"),
    'Must handle missing token');
});

// ──────────────────────────────────────────────────────────────
// TEST 25: External services are preserved but don't receive Savvy Bearer tokens
// ──────────────────────────────────────────────────────────────
test('Third-party services preserved but not authenticated', () => {
  // UPCitemdb should exist as fallback (external service preserved)
  assert(appContent.includes("fetch('https://api.upcitemdb.com"),
    'UPCitemdb external API must be preserved as fallback');

  // OpenFoodFacts should exist as fallback
  assert(appContent.includes("fetch('https://world.openfoodfacts.org"),
    'OpenFoodFacts external API must be preserved as fallback');

  // ImgBB fallback should exist (after psAuthFetch /api/img-upload fails)
  assert(appContent.includes("fetch('https://api.imgbb.com"),
    'ImgBB fallback must be preserved');

  // Verify external services are not called with psAuthFetch (no Bearer tokens)
  const upcitemdbFunc = appContent.substring(appContent.indexOf('async function lookupUPCitemdb'),
                                             appContent.indexOf('}', appContent.indexOf('async function lookupUPCitemdb') + 500));
  assert(!upcitemdbFunc.includes('psAuthFetch'),
    'UPCitemdb must use direct fetch, not psAuthFetch');
  assert(!upcitemdbFunc.includes('Authorization') && !upcitemdbFunc.includes('Bearer'),
    'UPCitemdb must not include Bearer token headers');
});

// ──────────────────────────────────────────────────────────────
// TEST 26-34: All 9 Savvy routes use psAuthFetch
// ──────────────────────────────────────────────────────────────
test('All Savvy routes use psAuthFetch', () => {
  const savvyRoutes = [
    '/api/claude',
    '/search-upc',
    '/sb/search',
    '/ss/location',
    '/sb/update-inventory',
    '/ss/create-product',
    '/shopify-create-product',
    '/leaf-category',
    '/api/img-upload'
  ];

  for (const route of savvyRoutes) {
    assert(appContent.includes("psAuthFetch('" + route + "'"),
      `Route ${route} must use psAuthFetch for authentication`);
  }
});

// ──────────────────────────────────────────────────────────────
// TEST 35: /resolve-url blocks remote but preserves local parsing
// ──────────────────────────────────────────────────────────────
test('Endpoint /resolve-url preserves local URL parsing', () => {
  const analyzeFunc = appContent.substring(appContent.indexOf('async function analyzeEbayUrl'),
                                           appContent.indexOf('}', appContent.indexOf('async function analyzeEbayUrl') + 2000));
  // Must preserve regex parsing for item ID extraction
  assert(analyzeFunc.includes('/itm/') || analyzeFunc.includes('match(/'),
    'Must preserve URL parsing regex');
  // Must block remote /resolve-url endpoint
  assert(analyzeFunc.includes('todavía no está disponible') || analyzeFunc.includes('staging not available'),
    'Must show staging unavailable message');
});

// ──────────────────────────────────────────────────────────────
// TEST 36: /ebay-item blocks remote but preserves flow
// ──────────────────────────────────────────────────────────────
test('Endpoint /ebay-item is blocked gracefully', () => {
  const analyzeFunc = appContent.substring(appContent.indexOf('async function analyzeEbayUrl'),
                                           appContent.indexOf('}', appContent.indexOf('async function analyzeEbayUrl') + 2000));
  // Must block remote call
  assert(analyzeFunc.includes('todavía no está disponible'),
    'Must show staging unavailable message for /ebay-item');
});

// ──────────────────────────────────────────────────────────────
// TEST 37: /check-skus is skipped but doesn't block export
// ──────────────────────────────────────────────────────────────
test('Endpoint /check-skus is safely skipped in staging', () => {
  // Must log that it's unavailable
  assert(appContent.includes("check-skus no disponible en staging"),
    'Must indicate check-skus is unavailable in staging');
  // Must not have try/catch that blocks export
  assert(appContent.includes('console.warn') && appContent.includes('continuando'),
    'Must log and continue with export');
});

console.log('\n✅ All staging auth tests completed!');
