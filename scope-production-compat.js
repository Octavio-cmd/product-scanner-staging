/**
 * Exact inverse of the Production-compatibility hardening edits in app.js
 * (Clothing Sheets URL from savvy-config, rembg warm-up, staging badge /
 * Home-link block removed), generated from the diff against Employee STAGING
 * de48e74. Older suites' "code unchanged" guards compare
 * undoProdCompat(appSrc) so that, apart from exactly these edits, app.js is
 * proven identical to de48e74.
 */
const PAIRS = [
  ["  _keysLoaded = true;\n})();\n// ── URL DE SHEETS PARA CLOTHING (compatibilidad con Producción) ──\n// Igual que Producción: se lee savvy-config /config al arrancar y, si trae\n// sheets_url, se guarda en cl_sheets_url (Clothing & Shoes la lee al usarla).\n// Solo se usa sheets_url (https); el resto de esa respuesta se ignora y no se\n// guarda. Sin respuesta, error o JSON inválido → no pasa nada (queda el valor\n// que ya hubiera). Solo lectura: un GET, sin sesión, sin reintentos.\nvar SAVVY_CONFIG_URL = 'https://savvy-config-production.up.railway.app';\n(function loadClothingSheetsUrl() {\n  try {\n    fetch(SAVVY_CONFIG_URL + '/config', { method: 'GET' })\n      .then(function(r){ return r && r.ok ? r.json() : null; })\n      .then(function(d){\n        var u = (d && typeof d.sheets_url === 'string') ? d.sheets_url.trim() : '';\n        if (/^https:\\/\\//i.test(u)) localStorage.setItem('cl_sheets_url', u);\n      })\n      .catch(function(){ console.warn('Could not load Clothing Sheets URL from savvy-config'); });\n  } catch(e) {}\n})();\n",
   "  _keysLoaded = true;\n})();\n"],
  ["window.addEventListener('load', checkLogin);\n\n",
   "window.addEventListener('load', checkLogin);\n\n// ── STAGING PILOT: Add visual mark and home link ──\nwindow.addEventListener('load', function() {\n  try {\n    // Add STAGING badge to header/title area if exists\n    var hdrLogo = document.querySelector('.hdr') || document.querySelector('[class*=\"header\"]') || document.body;\n    var badge = document.createElement('div');\n    badge.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(255,107,53,0.2);border:1px solid #FF6B35;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;color:#FF6B35;z-index:9999;';\n    badge.textContent = '🧪 STAGING';\n    document.body.appendChild(badge);\n\n    // Add link to Savvy Home staging (same tab)\n    var homeLink = document.createElement('a');\n    homeLink.href = 'https://octavio-cmd.github.io/savvy-home-staging/';\n    homeLink.style.cssText = 'position:fixed;top:50px;right:8px;background:#0d0d0d;border:1px solid #2e2e2e;border-radius:8px;padding:8px 12px;font-size:11px;color:#888;text-decoration:none;z-index:9998;';\n    homeLink.textContent = '← Volver a Home';\n    homeLink.onclick = function(e) {\n      // Same tab navigation, no target=_blank\n      window.location.href = homeLink.href;\n    };\n    document.body.appendChild(homeLink);\n  } catch(e) {\n    console.warn('Could not add staging UI marks:', e.message);\n  }\n});\n"],
  ["  if(!localStorage.getItem('savvy_ebay_id'))localStorage.setItem('savvy_ebay_id',DEF_EBAY);\n\n  // ── WARM-UP: despertar el servicio de quitar fondo al arrancar (igual que Producción) ──\n  // Un solo GET de /health, sin esperar la respuesta; si falla no pasa nada.\n  // No toca el POST real de /remove-bg ni el inventario ni las ventas.\n  try {\n    if (!window._psRembgWarmStarted) {\n      window._psRembgWarmStarted = true;\n      fetch('https://savvy-rembg-production.up.railway.app/health', { method: 'GET' })\n        .then(function(r){ return r.json(); })\n        .then(function(d){ console.log('rembg warm-up:', d && d.model_loaded ? 'ready' : 'not ready'); })\n        .catch(function(){ /* offline or asleep - not a problem */ });\n    }\n  } catch(e) {}\n",
   "  if(!localStorage.getItem('savvy_ebay_id'))localStorage.setItem('savvy_ebay_id',DEF_EBAY);\n\n  // ── WARM-UP DISABLED in staging ──\n  // The background-removal service is not available in staging, so warmup is skipped.\n  // This would normally wake the service on app start, but it only exists in production.\n"],
];

function undoProdCompat(src) {
  if (!appliedProdCompat(src)) return src;   // older sources: untouched
  for (let i = PAIRS.length - 1; i >= 0; i--) src = src.replace(PAIRS[i][0], () => PAIRS[i][1]);
  return src;
}
function appliedProdCompat(src) {
  return PAIRS.every(([n]) => src.split(n).length === 2);
}
module.exports = { undoProdCompat, appliedProdCompat, PAIRS };
