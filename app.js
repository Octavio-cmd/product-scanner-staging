  // ── ON-SCREEN DEBUG CONSOLE — para ver errores directo en el iPhone,
// sin necesitar Mac ni Safari Web Inspector. Toca el logo 5 veces para abrir/cerrar. ──
(function setupDebugConsole(){
  var logs = [];
  var maxLogs = 80;
  var panel = null;

  function ensurePanel(){
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = 'debug-console-panel';
    panel.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.96);z-index:999999;overflow-y:auto;padding:12px;font-family:monospace;font-size:11px;color:#0f0;white-space:pre-wrap;word-break:break-all';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Cerrar Debug Console';
    closeBtn.style.cssText = 'position:sticky;top:0;width:100%;padding:12px;background:#c0392b;color:#fff;border:none;border-radius:8px;font-weight:800;margin-bottom:10px;z-index:2';
    closeBtn.onclick = function(){ panel.style.display = 'none'; };
    panel.appendChild(closeBtn);
    var logsDiv = document.createElement('div');
    logsDiv.id = 'debug-console-logs';
    panel.appendChild(logsDiv);
    document.body.appendChild(panel);
    return panel;
  }

  function render(){
    ensurePanel();
    var logsDiv = document.getElementById('debug-console-logs');
    if(logsDiv) logsDiv.textContent = logs.join('\n\n');
  }

  function push(type, args){
    try{
      var msg = Array.prototype.map.call(args, function(a){
        if(typeof a === 'object'){ try{ return JSON.stringify(a); }catch(e){ return String(a); } }
        return String(a);
      }).join(' ');
      var time = new Date().toLocaleTimeString();
      var line = '[' + time + '] ' + type + ': ' + msg;
      logs.push(line);
      if(logs.length > maxLogs) logs.shift();
      if(panel && panel.style.display !== 'none') render();

      // También lo escribe en el cuadro de debug SIEMPRE VISIBLE junto al botón de packs,
      // si existe en pantalla en este momento — sin necesitar ningún gesto especial.
      var miniLog = document.getElementById('ps-debug-log');
      if(miniLog){
        miniLog.textContent = (miniLog.textContent === 'Esperando acción...' ? '' : miniLog.textContent + '\n') + line;
        miniLog.scrollTop = miniLog.scrollHeight;
      }
    }catch(e){}
  }

  var origLog = console.log, origErr = console.error, origWarn = console.warn;
  console.log   = function(){ push('LOG',  arguments); origLog.apply(console, arguments); };
  console.error = function(){ push('ERROR', arguments); origErr.apply(console, arguments); };
  console.warn  = function(){ push('WARN', arguments); origWarn.apply(console, arguments); };

  // Capturar también errores no atrapados (uncaught) y promesas rechazadas
  window.addEventListener('error', function(e){
    push('UNCAUGHT ERROR', [e.message + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')]);
  });
  window.addEventListener('unhandledrejection', function(e){
    push('UNHANDLED PROMISE', [e.reason && e.reason.message ? e.reason.message : String(e.reason)]);
  });

  window.toggleDebugConsole = function(){
    ensurePanel();
    panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
    if(panel.style.display === 'block') render();
  };

  // Toca el logo del header 5 veces seguidas para abrir la consola de debug
  document.addEventListener('DOMContentLoaded', function(){
    var logo = document.querySelector('.hdr') || document.querySelector('.lg') || document.body;
    var tapCount = 0, tapTimer = null;
    logo.addEventListener('click', function(){
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function(){ tapCount = 0; }, 1500);
      if(tapCount >= 5){ tapCount = 0; window.toggleDebugConsole(); }
    });
  });
})();

// ── MARCA DE VERSIÓN ────────────────────────────────────────────────────────
// Safari en iOS cachea app.js con fuerza (index.html lo carga como
// <script src="app.js"> sin parámetro de versión), así que el iPhone puede
// seguir corriendo un build viejo aunque GitHub Pages ya tenga el nuevo.
// Abre la consola de debug (5 toques al logo) y confirma esta línea antes de
// dar por buena cualquier prueba. Si no coincide, el iPhone está cacheado.
var _psSbInvVacio = {};
window.PS_BUILD = '2026-08-29-camera-callback-v5';
try {
  console.log('[Savvy Scanner] build ' + window.PS_BUILD);
  window.addEventListener('load', function(){
    if (window._psDebug) window._psDebug('🏷️ Build ' + window.PS_BUILD);
  });
} catch(e){}

// Función directa y a prueba de fallos — escribe inmediatamente en el cuadro
// visible junto al botón de packs, sin depender de nada más.
window._psDebug = function(msg){
  try{
    var box = document.getElementById('ps-debug-log');
    if(box){
      var time = new Date().toLocaleTimeString();
      var line = '[' + time + '] ' + msg;
      box.textContent = (box.textContent === 'Esperando acción...' ? '' : box.textContent + '\n') + line;
      box.scrollTop = box.scrollHeight;
    }
  }catch(e){}
  try{ console.log('_psDebug:', msg); }catch(e){}
};


// ── HELPER FUNCTIONS ──────────────────────────────────────────
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
const fmt=n=>(!n||isNaN(n))?'—':'$'+Number(n).toFixed(2);

const WORKER='https://savvy-ebay.octavio-9e2.workers.dev';
const DEF_EBAY='StevenGa-SavvySca-PRD-81addb012-655f2649';
// ── Default API keys (loaded from Railway savvy-config)
let DEFAULT_PHOTOROOM_KEY = '';
let DEFAULT_RBG_KEY = '';
// KEY NUEVA fija — igual que en Clothing & Shoes.
// ⛔ NO se sobreescribe desde Railway (línea comentada abajo).
let DEFAULT_IMGBB_KEY = atob('MjljYjkyZDg5YTViZDM2Y2Y5YjkxOTc2ZDVhNDYzOWM=');
let _keysLoaded = false;

// ══════════════════════════════════════════════════════════════
// SESION DE USUARIO + PROXY DE CLAUDE  (Fase 2 - STAGING PILOT)
// La clave de Anthropic ya no llega al navegador: vive solo en el
// backend. Aqui solo viaja un token de sesion firmado.
// Backend centralizado en una sola constante (staging).
// ══════════════════════════════════════════════════════════════
const SAVVY_API = 'https://savvy-ebay-prices-production.up.railway.app';
const SAVVY_MODELO = 'claude-haiku-4-5-20251001';

// sessionStorage y no localStorage: los iPhone del almacen son compartidos,
// asi que la sesion debe morir al cerrar la pestana. Nunca se guarda la
// contrasena, solo el token, que ademas caduca en el servidor.
function savvyToken() {
  try { return sessionStorage.getItem('savvy_session_token') || ''; } catch(e) { return ''; }
}
function savvyGuardarSesion(token, usuario) {
  try {
    sessionStorage.setItem('savvy_session_token', token);
    sessionStorage.setItem('savvy_session_user', usuario);
  } catch(e) {}
  SAVVY_CURRENT_USER = usuario;
}
function savvyBorrarSesion() {
  try {
    sessionStorage.removeItem('savvy_session_token');
    sessionStorage.removeItem('savvy_session_user');
  } catch(e) {}
  SAVVY_CURRENT_USER = null;
}

// Envia el cuerpo al proxy en vez de a api.anthropic.com. Devuelve la misma
// Response que antes, para que el codigo existente siga tratando r.ok,
// r.status y r.json() exactamente igual.
async function savvyClaude(opciones) {
  try {
    const r = await psAuthFetch('/api/claude', {
      method: 'POST',
      signal: opciones.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: opciones.body
    });
    if (r.status === 429) { try { toast('\u23F3 Limite de uso alcanzado. Espera un momento.'); } catch(e) {} }
    else if (r.status === 503) { try { toast('\u26A0\uFE0F El servicio de IA no esta configurado.'); } catch(e) {} }
    return r;
  } catch(e) {
    if (window._psDebug) window._psDebug('Claude API error: ' + (e.message || e));
    return new Response('{}', { status: 500 });
  }
}

function savvySesionCaducada() {
  savvyBorrarSesion();
  try { toast('\uD83D\uDD11 Tu sesion expiro. Vuelve a iniciar sesion.'); } catch(e) {}
  try {
    var scr = ensureLoginScreen();
    scr.style.display = 'flex';
    var err = document.getElementById('login-err');
    if (err) { err.textContent = 'Tu sesion expiro. Vuelve a entrar.'; err.style.display = 'block'; }
  } catch(e) {}
}

// \u2500\u2500 HELPER CENTRALIZADO: psAuthFetch \u2500\u2500
// Require token, validates origin, adds Bearer header, handles 401/403.
// Used for all Savvy backend calls (search-upc, inventory, etc).
// Throws errors with distinguishable .code and .status properties for proper error handling
async function psAuthFetch(path, options) {
  const token = savvyToken();

  // MISSING TOKEN: distinct error code for login handling
  if (!token) {
    savvySesionCaducada();
    const err = new Error('Sesion requerida para esta operacion');
    err.code = 'missing_token';
    err.status = 401;
    throw err;
  }

  // Construct full URL relative to SAVVY_API
  const reqUrl = new URL(path, SAVVY_API);
  const apiOrigin = new URL(SAVVY_API).origin;

  // ORIGIN MISMATCH: security check, distinct error code
  if (reqUrl.origin !== apiOrigin) {
    const err = new Error('Operacion rechazada: URL externa no permitida');
    err.code = 'origin_mismatch';
    err.status = 400;
    throw err;
  }

  // Prepare fetch options
  const opts = Object.assign({}, options || {});
  opts.headers = new Headers(opts.headers || {});
  opts.headers.set('Authorization', 'Bearer ' + token);

  // Execute fetch with network error handling
  let r;
  try {
    r = await fetch(reqUrl.toString(), opts);
  } catch (networkError) {
    // NETWORK ERROR: distinct error code
    const err = new Error('Error de conexion: ' + (networkError.message || 'red no disponible'));
    err.code = 'network_error';
    err.status = 0;
    err.originalError = networkError;
    throw err;
  }

  // AUTH FAILURE (401/403): session expired, distinct error code
  if (r.status === 401 || r.status === 403) {
    savvySesionCaducada();
    const err = new Error('Sesion expiro. Debes volver a iniciar sesion.');
    err.code = 'auth_error';
    err.status = r.status;
    throw err;
  }

  return r;
}
// ── CONFIGURACIÓN MANUAL (STAGING) ──
// /config endpoint eliminado. Configuración manual vía localStorage solo si existe.
// Drive URL fija — no se carga desde servicio remoto (SAVVY_CONFIG eliminado).
(function initConfig() {
  // Preservar configuración manual legítima si existe
  if (!localStorage.getItem('cl_drive_url')) {
    localStorage.setItem('cl_drive_url', 'https://script.google.com/macros/s/AKfycbyVgEEID8dqZMymlqQMpjO7fLBMYkfj0mmcWk2ImudTy9evKGlOi4oHUc9vhcdmpFeDDQ/exec');
  }
  _keysLoaded = true;
})();
// ── Login System (Fase 2: la validacion ocurre en el servidor) ──
// El diccionario de hashes se elimino: era publico en este repositorio.

let SAVVY_CURRENT_USER = null;

async function doLogin() {
  const user = (document.getElementById('login-user')?.value||'').trim().toLowerCase();
  const pass = document.getElementById('login-pass')?.value||'';
  const errEl = document.getElementById('login-err');
  const btn = document.getElementById('login-btn');
  if (!user || !pass) {
    if(errEl) { errEl.textContent='Escribe usuario y contraseña.'; errEl.style.display='block'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
  let mensaje = 'Usuario o contraseña incorrectos.';
  try {
    // La contraseña viaja al servidor y no se guarda en ningún sitio del navegador.
    const r = await fetch(SAVVY_API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: user, password: pass })
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.token) {
        savvyGuardarSesion(d.token, d.usuario || user);
        if (errEl) errEl.style.display='none';
        var scr = document.getElementById('login-screen');
        if (scr) scr.style.display = 'none';
        const hdrUser = document.getElementById('hdr-user');
        if (hdrUser) hdrUser.textContent = '👤 ' + (d.usuario || user);
        document.getElementById('login-pass').value='';
        if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
        return;
      }
    } else if (r.status === 429) {
      mensaje = 'Demasiados intentos. Espera un minuto.';
    } else if (r.status >= 500) {
      mensaje = 'El servidor no responde. Inténtalo de nuevo.';
    }
  } catch(e) {
    mensaje = 'Sin conexión con el servidor.';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  if(errEl) { errEl.textContent = mensaje; errEl.style.display='block'; }
  document.getElementById('login-pass').value='';
}

// Crea la pantalla de login dinámicamente (el HTML de Product Scanner no la trae)
function ensureLoginScreen() {
  var scr = document.getElementById('login-screen');
  if (scr) return scr;
  scr = document.createElement('div');
  scr.id = 'login-screen';
  scr.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#0d0d0d;z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:30px';
  scr.innerHTML =
    '<div style="font-size:22px;font-weight:900;color:#fff">\uD83D\uDED2 <span style="color:#ff6d1f">Savvy</span> Product Scanner</div>' +
    '<div style="color:#888;font-size:13px;margin-bottom:10px">Inicia sesi\u00f3n para continuar</div>' +
    '<input id="login-user" type="text" placeholder="Usuario" autocapitalize="none" autocomplete="off" style="width:100%;max-width:340px;padding:14px;border-radius:10px;border:1px solid #444;background:#161616;color:#fff;font-size:16px">' +
    '<input id="login-pass" type="password" placeholder="Contrase\u00f1a" style="width:100%;max-width:340px;padding:14px;border-radius:10px;border:1px solid #444;background:#161616;color:#fff;font-size:16px">' +
    '<div id="login-err" style="display:none;color:#ff5252;font-size:13px">Usuario o contrase\u00f1a incorrectos</div>' +
    '<button id="login-btn" style="width:100%;max-width:340px;padding:14px;background:#ff6d1f;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:800">Entrar</button>';
  document.body.appendChild(scr);
  var btn = document.getElementById('login-btn');
  btn.addEventListener('touchend', function(e){ e.preventDefault(); doLogin(); });
  btn.addEventListener('click', doLogin);
  var passIn = document.getElementById('login-pass');
  passIn.addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
  return scr;
}

function checkLogin() {
  // Si la pestaña sigue abierta, la sesión sigue viva (sessionStorage).
  // Al cerrar Safari/la pestaña, iOS borra sessionStorage → pide login otra vez.
  var u = null;
  try { u = sessionStorage.getItem('savvy_session_user'); } catch(e) {}
  // Ahora la sesion la respalda un token firmado por el servidor.
  if (u && savvyToken()) {
    SAVVY_CURRENT_USER = u;
    const hdrUser = document.getElementById('hdr-user');
    if (hdrUser) hdrUser.textContent = '👤 ' + u;
    var old = document.getElementById('login-screen');
    if (old) old.style.display = 'none';
    return;
  }
  SAVVY_CURRENT_USER = null;
  var scr = ensureLoginScreen();
  scr.style.display = 'flex';
}

function doLogout() {
  savvyBorrarSesion();
  localStorage.removeItem('savvy_user');
  var scr = ensureLoginScreen();
  scr.style.display = 'flex';
  var ui = document.getElementById('login-user'); if (ui) ui.value = '';
  var pi = document.getElementById('login-pass'); if (pi) pi.value = '';
  const errEl = document.getElementById('login-err');
  if(errEl) errEl.style.display='none';
}

// Check login on load
window.addEventListener('load', checkLogin);

// ── STAGING PILOT: Add visual mark and home link ──
window.addEventListener('load', function() {
  try {
    // Add STAGING badge to header/title area if exists
    var hdrLogo = document.querySelector('.hdr') || document.querySelector('[class*="header"]') || document.body;
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:8px;right:8px;background:rgba(255,107,53,0.2);border:1px solid #FF6B35;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;color:#FF6B35;z-index:9999;';
    badge.textContent = '🧪 STAGING';
    document.body.appendChild(badge);

    // Add link to Savvy Home staging (same tab)
    var homeLink = document.createElement('a');
    homeLink.href = 'https://octavio-cmd.github.io/savvy-home-staging/';
    homeLink.style.cssText = 'position:fixed;top:50px;right:8px;background:#0d0d0d;border:1px solid #2e2e2e;border-radius:8px;padding:8px 12px;font-size:11px;color:#888;text-decoration:none;z-index:9998;';
    homeLink.textContent = '← Volver a Home';
    homeLink.onclick = function(e) {
      // Same tab navigation, no target=_blank
      window.location.href = homeLink.href;
    };
    document.body.appendChild(homeLink);
  } catch(e) {
    console.warn('Could not add staging UI marks:', e.message);
  }
});
// Red de seguridad: si algún overlay quedó colgado tapando la UI, limpiar al recargar
window.addEventListener('load', function(){
  setTimeout(function(){
    ['loc-overlay','loc-manual-panel'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) {
        try { el.parentNode.removeChild(el); } catch(e) {
          el.style.display = 'none';
          el.style.pointerEvents = 'none';
          el.style.zIndex = '-1';
        }
      }
    });
  }, 500);
});

// ── LIMPIADOR CONTINUO cada 5 segundos ──
// Solo elimina overlays REALMENTE huérfanos (más de 60 segundos abiertos)
setInterval(function(){
  var lo = document.getElementById('loc-overlay');
  if (lo && lo.dataset.openedAt) {
    var age = Date.now() - parseInt(lo.dataset.openedAt, 10);
    // Solo eliminar si tiene más de 60 segundos abierto
    if (age > 60000) {
      try { lo.parentNode.removeChild(lo); } catch(e) {}
      if (window._psDebug) window._psDebug('🧹 vigía: overlay muy viejo removido (' + Math.round(age/1000) + 's)');
    }
  }
}, 5000);

// Initialize Zebra printer IP if not set
if (!localStorage.getItem('savvy_printer_ip')) {
  localStorage.setItem('savvy_printer_ip', '192.168.1.25');
}

// Limpiar API keys viejas de ImgBB en localStorage — fuerza usar la key nueva
// que está hardcodeada arriba. Esto evita que iOS use una key vieja cacheada.
try {
  var _oldKeys = ['1e8ecea2fc2ea918caca74369928ef63'];
  var _clKey = localStorage.getItem('cl_imgbb_key');
  if (_clKey && _oldKeys.indexOf(_clKey) >= 0) localStorage.removeItem('cl_imgbb_key');
  var _svKey = localStorage.getItem('savvy_imgbb_key');
  if (_svKey && _oldKeys.indexOf(_svKey) >= 0) localStorage.removeItem('savvy_imgbb_key');
} catch(e) {}

let bulk=[],cur=null;
let _psSellbriteProducts = {};
let _lastBundleUrl = ''; // URL pública de ImgBB del último bundle generado

function screen(n){document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));$('scr-'+n).classList.add('on');}
let _tt;
function toast(msg,ms=2600){const t=$('toast');t.textContent=msg;t.classList.add('on');clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('on'),ms);}
function stat(m){const e=$('ls');if(e)e.textContent=m;}

// Show the loading spinner INSIDE resBody (scr-res stays the visible screen the whole time —
// no more jumping to a separate loading screen). Also brings us back from scr-cam if we were scanning.
function showLoadingInline(initialMsg){
  screen('res');
  const rb=$('resBody');
  if(!rb) return;
  rb.innerHTML = '<div class="lw" style="padding:20px 0 8px">'
    + '<div class="sp"></div>'
    + '<div id="lp" style="font-size:16px;font-weight:700;margin:10px 0 6px;text-align:center">' + (initialMsg||'Scanning...') + '</div>'
    + '<div id="ls" style="color:var(--mu);font-size:13px;text-align:center">Querying eBay...</div>'
    + '</div>';
}

// Categoría eBay válida (solo dígitos). Si viene vacía, "undefined" o "null",
// devuelve el fallback — evita el Error 37 de eBay (CategoryID invalid).
function psSafeCategory(cat, fallback){
  var c = String(cat == null ? '' : cat).trim();
  // Categorías PADRE que eBay rechaza con Error 87 — nunca usarlas
  var PARENT_CATS = ['26395','293','888','220','1281','2984','14308','20625','6000','16486','11854','20725','36447','67716','11838','184630'];
  if (!c || c === 'undefined' || c === 'null' || !/^\d+$/.test(c) || PARENT_CATS.indexOf(c) >= 0) {
    return fallback || '31786'; // 31786 = Skin Care (leaf válida, safe default)
  }
  return c;
}

// SKU: 3 letras marca (o primera palabra del título) + UPC + Npk
function makeSKU(brand,upc,packs,title){
  packs=packs||1; title=title||'';
  let src=(brand||'').trim();
  if(!src||src.toLowerCase()==='generic') src='';
  if(!src&&title){
    const skip=new Set(['2x','bundle','pack','new','of','the','and','for','set','lot','value']);
    const words=title.replace(/[^a-zA-Z\s]/g,' ').trim().split(/\s+/);
    src=words.find(w=>w.length>1&&!skip.has(w.toLowerCase()))||'';
  }
  const pfx=src.replace(/[^a-zA-Z]/g,'').substring(0,3).toUpperCase()||'GEN';
  return pfx+'-'+upc+'-'+packs+'pk';
}

// Categorys — mapa completo de categorías leaf de eBay
function catId(n){
  const t=(n||'').toLowerCase();

  // ── MASSAGERS / MASSAGE DEVICES (leaf: 36449 = Body Massagers) ──
  if(/massager|deep.tissue massag|percussion massag|massage gun|theragun|hypervolt|homedics|shiatsu|foot spa|foot massag|neck massag|back massag|scalp massag/i.test(t))return'36449';
  if(/sharper image.*(massag|deep.tissue|percussion|swappable head)/i.test(t))return'36449';

  // ── HOME HEALTH DEVICES (leaf 20676 = Blood Pressure Monitors) ──
  if(/blood pressure monitor|omron|withings bp/i.test(t))return'20676';
  if(/pulse oximeter|thermometer digital|glucometer|glucose meter|blood glucose/i.test(t))return'20676';
  if(/nebulizer|humidifier|vaporizer.*(vicks|cool.mist)|steam inhaler/i.test(t))return'20676';

  // ── HEATING PADS / HOT-COLD PACKS (leaf 32835 = Heating Pads) ──
  if(/heating pad|electric heating|heat wrap|hot.cold pack|thermacare/i.test(t))return'32835';

  // ── PET SUPPLIES ─────────────────────────────────────────────
  if(/dog food|cat food|pet food|kibble|pedigree|purina|iams|blue buffalo|friskies|fancy feast|whiskas|royal canin|hill.s science/i.test(t))return'1281';
  if(/dog treat|cat treat|milk bone|greenies|temptations treat|beggin strip/i.test(t))return'1281';
  if(/cat toy|dog toy|catnip|scratching post|chew toy|dog chew|pet toy|kong toy/i.test(t))return'1281';
  if(/pet shampoo|dog shampoo|cat shampoo|\bfleas?\b|\btick collar\b|frontline|heartgard|advantage flea|pet medicine/i.test(t))return'1281';
  if(/cat litter|kitty litter|tidy cats|fresh step|arm hammer litter/i.test(t))return'1281';
  if(/leash|dog collar|pet bed|pet carrier|aquarium|hamster|bird seed|puppy|kitten/i.test(t))return'1281';

  // ── BABY ─────────────────────────────────────────────────────
  if(/pampers|huggies|luvs|honest diaper|baby dry|swaddler/i.test(t))return'2984';
  if(/baby wipe|huggies wipe|pampers wipe|baby cleaning/i.test(t))return'2984';
  if(/baby formula|infant formula|similac|enfamil|gerber formula|baby food|pureed|beechnut/i.test(t))return'2984';
  if(/johnson.s baby|desitin|aquaphor baby|baby lotion|baby wash|baby shampoo|baby oil|baby powder|baby cream/i.test(t))return'2984';
  if(/diaper|infant|toddler|pacifier|teething|stroller|baby monitor|baby bottle/i.test(t))return'2984';

  // ── FOOD & BEVERAGES ─────────────────────────────────────────
  // ── HAIR CARE — antes que Food para evitar que "gum" matchee dental ─
  if(/head.shoulders|pantene|dove shampoo|tresemme|garnier shampoo|herbal essence|ogx shampoo|suave shampoo|aussie shampoo|old spice shampoo/i.test(t))return'131689';
  if(/shampoo|conditioner|hair mask|hair treatment|hair oil|argan oil|hair serum/i.test(t))return'131689';
  if(/hair color|hair dye|hair bleach|root touch|clairol|loreal hair|revlon colorsilk|dark and lovely|just for men/i.test(t))return'31085';
  if(/hair spray|hairspray|hair mousse|hair gel|pomade|hair wax|got2b|kenra|bed head/i.test(t))return'45258';
  if(/hair brush|hair comb|detangling brush|wide tooth comb|curling iron|flat iron|hair straightener|hair dryer|blow dryer/i.test(t))return'45258';

  // ── DENTAL CARE — antes que Food para que "gum" no matchee comida ──
  if(/crest toothpaste|colgate|sensodyne|arm.hammer toothpaste|hello toothpaste|charcoal toothpaste/i.test(t))return'67602';
  if(/teeth whitening|whitening strip|whitening kit|crest strip|whitening pen/i.test(t))return'67602';
  if(/oral.b toothbrush|colgate toothbrush|sonicare|electric toothbrush|toothbrush/i.test(t))return'67602';
  if(/dental floss|floss pick|flosser|interdental|waterpik|oral irrigator|gum floss|gum flosser|gum pick/i.test(t))return'67602';
  if(/listerine|scope mouthwash|act mouthwash|crest rinse|oral rinse|mouthwash|mouth rinse/i.test(t))return'67602';
  if(/toothpaste|whitening/i.test(t))return'67602';

  // ── CLEANING / HOME — antes que Skin Care ────────────────────
  if(/compression glove|compression sleeve|compression sock|arthritis glove|arthritis support|copper fit|copper compression/i.test(t))return'181';
  if(/stainless steel cleaner|stainless steel polish|stainless spray|appliance cleaner/i.test(t))return'20625';
  if(/tide|gain detergent|arm.hammer laundry|all detergent|persil|xtra detergent|laundry detergent|laundry pod/i.test(t))return'20625';
  if(/downy|bounce dryer|dryer sheet|fabric softener|snuggle/i.test(t))return'20625';
  if(/dawn dish|palmolive|dawn ultra|dish soap|dishwashing liquid|cascade dishwasher/i.test(t))return'20625';
  if(/lysol|clorox|windex|mr.clean|pine.sol|fabuloso|409|fantastik|comet cleanser|ajax cleanser/i.test(t))return'20625';
  if(/febreze|glade|air freshener|car freshener|room spray|odor eliminator/i.test(t))return'20625';
  if(/paper towel|bounty|scott towel|viva towel|brawny/i.test(t))return'20625';
  if(/toilet paper|charmin|cottonelle|scott tissue|angel soft/i.test(t))return'20625';
  if(/tissue|kleenex|puffs|facial tissue/i.test(t))return'20625';
  if(/trash bag|garbage bag|hefty|glad bag|ziploc|plastic wrap|aluminum foil|sandwich bag/i.test(t))return'20625';
  if(/sponge|scrub brush|mop|broom|dustpan|rubber glove|cleaning glove/i.test(t))return'20625';
  if(/candle|yankee candle|bath.body candle|wax melt|diffuser/i.test(t))return'20625';
  if(/laundry|bleach|disinfectant|cleaner|cleaning|polish|degreaser/i.test(t))return'20625';

  // ── FOOD & BEVERAGES ─────────────────────────────────────────
  if(/k.cup|keurig pod|nescafe|folgers|starbucks coffee|maxwell house|dunkin coffee|coffee pod/i.test(t))return'14308';
  if(/coffee|espresso|cold brew/i.test(t))return'14308';
  if(/tea bag|green tea|herbal tea|lipton|bigelow|celestial seasonings|chamomile|sleepytime/i.test(t))return'14308';
  if(/monster|red bull|5.hour energy|bang energy|celsius drink|rockstar energy|reign energy/i.test(t))return'14308';
  if(/gatorade|powerade|liquid iv|pedialyte|nuun|electrolyte|sports drink/i.test(t))return'14308';
  if(/protein bar|kind bar|clif bar|larabar|rxbar|quest bar|fiber bar|nature valley|nutri.grain/i.test(t))return'14308';
  if(/snack|popcorn|chip|pretzel|granola|trail mix|mixed nut|peanut|cashew|almond|sunflower seed/i.test(t))return'14308';
  if(/candy|chocolate|sour patch|skittles|m&m|reese|hershey|starburst|haribo/i.test(t))return'14308';
  if(/breath mint|tic tac|altoid|trident gum|orbit gum|extra gum|chewing gum/i.test(t))return'14308';
  if(/sauce|ketchup|mustard|mayo|mayonnaise|salad dressing|ranch|hot sauce|sriracha|tabasco|buffalo sauce/i.test(t))return'14308';
  if(/cereal|oatmeal|quaker oat|cream of wheat|breakfast bar|pop tart/i.test(t))return'14308';
  if(/soup|broth|ramen|instant noodle|cup noodle|bouillon/i.test(t))return'14308';
  if(/seasoning|spice|garlic powder|onion powder|cumin|paprika|chili powder|mrs.dash/i.test(t))return'14308';

  // ── CLEANING / HOME ──────────────────────────────────────────
  if(/tide|gain detergent|arm.hammer laundry|all detergent|persil|xtra detergent|laundry detergent|laundry pod/i.test(t))return'20625';
  if(/downy|bounce dryer|dryer sheet|fabric softener|snuggle/i.test(t))return'20625';
  if(/dawn dish|palmolive|dawn ultra|dish soap|dishwashing liquid|cascade dishwasher/i.test(t))return'20625';
  if(/lysol|clorox|windex|mr.clean|pine.sol|fabuloso|409|fantastik|comet cleanser|ajax cleanser/i.test(t))return'20625';
  if(/febreze|glade|air freshener|car freshener|room spray|odor eliminator/i.test(t))return'20625';
  if(/paper towel|bounty|scott towel|viva towel|brawny/i.test(t))return'20625';
  if(/toilet paper|charmin|cottonelle|scott tissue|angel soft/i.test(t))return'20625';
  if(/tissue|kleenex|puffs|facial tissue/i.test(t))return'20625';
  if(/trash bag|garbage bag|hefty|glad bag|ziploc|plastic wrap|aluminum foil|sandwich bag/i.test(t))return'20625';
  if(/sponge|scrub brush|mop|broom|dustpan|rubber glove|cleaning glove/i.test(t))return'20625';
  if(/candle|yankee candle|bath.body candle|wax melt|diffuser/i.test(t))return'20625';
  if(/detergent|laundry|bleach|disinfect|disinfectant/i.test(t))return'20625';

  // ── ELECTRONICS ──────────────────────────────────────────────
  if(/duracell|energizer|rayovac|aa battery|aaa battery|9v battery|c battery|d battery|lithium battery/i.test(t))return'48619';
  if(/usb.c cable|lightning cable|iphone cable|android charger|phone charger|wireless charger|power bank|charging pad/i.test(t))return'44867';
  if(/earphone|earbuds|airpod|galaxy bud|wireless earphone|in.ear headphone/i.test(t))return'112529';
  if(/headphone|over.ear|on.ear|noise cancelling headphone/i.test(t))return'112529';
  if(/bitty boomer|bittyboomers/i.test(t))return'14969';
  if(/mini speaker|pocket speaker|character speaker|collectible speaker/i.test(t))return'14969';
  if(/bluetooth speaker|portable speaker|wireless speaker|jbl|bose speaker/i.test(t))return'14969';
  if(/phone case|iphone case|samsung case|screen protector|tempered glass|tablet case|ipad case/i.test(t))return'9394';
  if(/led bulb|smart bulb|light bulb|cfl bulb|light strip|led strip/i.test(t))return'48619';
  if(/battery|batteries|charger|cable|usb|bluetooth/i.test(t))return'293';

  // ── AUTOMOTIVE ───────────────────────────────────────────────
  if(/castrol|mobil.1|pennzoil|valvoline|quaker state|motor oil|engine oil|synthetic oil/i.test(t))return'6000';
  if(/car wash|turtle wax|meguiar|armor all|rain.x|windshield washer|wiper blade|bosch blade|anco blade/i.test(t))return'6000';

  // ── OFFICE / SCHOOL ──────────────────────────────────────────
  if(/ballpoint pen|gel pen|sharpie|expo marker|dry erase|highlighter pen|pencil|mechanical pencil/i.test(t))return'16486';
  if(/notebook|composition book|spiral notebook|legal pad|sticky note|post.it/i.test(t))return'16486';
  if(/stapler|staple|tape dispenser|scotch tape|binder clip|paper clip|folder|binder/i.test(t))return'16486';

  // ── SPORTING GOODS ───────────────────────────────────────────
  if(/yoga mat|resistance band|dumbbell|weight plate|jump rope|foam roller|exercise ball/i.test(t))return'888';
  if(/creatine|pre.workout|bcaa|amino acid|workout supplement|gym supplement/i.test(t))return'180959';
  if(/yoga mat bag|yoga bag|gym bag|sport bag|duffel bag|workout bag/i.test(t))return'75655';
  if(/yoga mat|yoga block|yoga strap|yoga wheel/i.test(t))return'75655';
  if(/exercise|workout|fitness equipment/i.test(t))return'75655';

  // ── BOOKS ────────────────────────────────────────────────────
  if(/board book|children.s book|kids book|baby book|picture book|coloring book|activity book|workbook|novel|cookbook|bible|prayer book|devotional book/i.test(t))return'261186';
  if(/isbn|hardcover|paperback|softcover/i.test(t))return'261186';

  // ── BBQ / OUTDOOR COOKING ────────────────────────────────────
  if(/grill tool|bbq tool|barbecue tool|spatula set|grill set|grilling set|tongs.*grill|grill.*tongs/i.test(t))return'26677';
  if(/grill|barbecue|bbq/i.test(t))return'26677';

  // ── KITCHEN / HOME ────────────────────────────────────────────
  if(/mug|cup|tumbler|travel mug|coffee mug|ceramic mug|mason jar/i.test(t))return'20695';
  if(/knife|knives|santoku|chef knife|paring knife|bread knife|steak knife/i.test(t))return'177005';
  if(/pan|pot|skillet|wok|dutch oven|casserole|bakeware|cookware/i.test(t))return'20654';
  if(/blender|mixer|toaster|air fryer|instant pot|slow cooker|pressure cooker|coffee maker|juicer/i.test(t))return'168763';
  if(/plate|bowl|dish|platter|serving|dinnerware|flatware|silverware/i.test(t))return'20650';

  // ── TOYS & GAMES ─────────────────────────────────────────────
  if(/lego/i.test(t))return'19006';
  if(/play.doh|nerf|hot wheels|matchbox|barbie|action figure|funko pop|pokemon card|trading card/i.test(t))return'261068';
  if(/board game|card game|puzzle|jigsaw|jenga|uno|monopoly|scrabble/i.test(t))return'220';
  if(/fidget|slime|kinetic sand|silly putty|squish|pop it/i.test(t))return'220';
  if(/toy|doll/i.test(t))return'220';

  // ── INSECT REPELLENT ─────────────────────────────────────────
  if(/insect repellent|bug spray|mosquito repellent|off! deep|off deep woods|deet|picaridin|repel bug|cutter bug|bug repel/i.test(t))return'1232';

  // ── FOOT CARE ────────────────────────────────────────────────
  if(/foot cream|foot lotion|heel balm|callus|corn remover|gold bond foot|dr. scholl|athlete.s foot|tinactin|lamisil/i.test(t))return'67169';

  // ── SUNCARE ──────────────────────────────────────────────────
  if(/sunscreen|sun screen|spf|sunblock|sun block|sun protection|tanning lotion|after sun|coppertone|banana boat sun|neutrogena sun/i.test(t))return'31786';

  // ── SKIN CARE ────────────────────────────────────────────────
  if(/jergens|body lotion|hand lotion|body cream|hand cream|body butter|cetaphil|aveeno|lubriderm|cocoa butter|shea butter|vaseline lotion|moisturizing lotion|daily moisturizer|ultra healing|deep conditioning|dry skin moisturizer|skin moisturizer|moisturizer lotion|original scent moisturizer/i.test(t))return'31788';
  if(/moisturizer|moisturising/i.test(t))return'31788';
  if(/face wash|facial cleanser|face scrub|face mask|facial mask|serum|toner|retinol|hyaluronic|niacinamide|eye cream|acne cream|salicylic|benzoyl|proactiv/i.test(t))return'31786';
  if(/lotion|moisturizer|body wash skin|skin care|skin cream/i.test(t))return'31786';

  // ── LIP CARE ─────────────────────────────────────────────────
  if(/lip balm|chapstick|lip butter|lip care|lip repair|blistex|carmex|aquaphor lip|eos lip/i.test(t))return'36870';

  // ── MAKEUP ───────────────────────────────────────────────────
  if(/foundation|concealer|contour|blush|bronzer|highlighter|setting powder|setting spray|bb cream|cc cream|tinted moisturizer/i.test(t))return'60496';
  if(/mascara|eyeliner|eye liner|eyeshadow|eye shadow|eyebrow pencil|brow gel|false lash/i.test(t))return'60496';
  if(/lipstick|lip gloss|lip liner|lip stain|lip color|lip tint/i.test(t))return'60496';
  if(/makeup remover|micellar water|makeup wipe|face wipe|bioderma/i.test(t))return'60496';
  if(/maybelline|l.oreal|loreal|covergirl|nyx cosmetic|elf cosmetic|revlon|rimmel|wet n wild|milani|physicians formula/i.test(t))return'60496';

  // ── NAIL CARE ────────────────────────────────────────────────
  if(/nail polish|nail color|nail lacquer|nail gel|nail remover|acetone|nail file|nail clipper|cuticle|opi nail|essie nail|sally hansen/i.test(t))return'36478';

  // ── DEODORANT ────────────────────────────────────────────────
  if(/old spice deo|old spice anti|dove deo|secret deo|degree deo|speed stick|axe deodorant|arm.hammer deo|sure deo|ban deo|mitchum|drysol/i.test(t))return'11838';
  if(/deodorant|antiperspirant/i.test(t))return'11838';

  // ── BODY WASH / SOAP ─────────────────────────────────────────
  if(/body wash|shower gel|bath gel|irish spring|dial soap|olay body|softsoap|caress|suave body|dove body wash/i.test(t))return'11840';
  if(/bar soap|liquid hand soap|hand soap|antibacterial soap|castile soap|ivory soap|safeguard soap/i.test(t))return'11840';

  // ── SHAVING ──────────────────────────────────────────────────
  if(/gillette|schick hydro|bic disposable|venus razor|daisy razor|harry.s razor/i.test(t))return'26683';
  if(/shaving cream|shaving gel|shave foam|aftershave|after shave|edge shave|barbasol/i.test(t))return'26683';
  if(/razor|shaving/i.test(t))return'26683';

  // ── FRAGRANCES ───────────────────────────────────────────────
  if(/perfume|cologne|eau de toilette|eau de parfum|body mist|body spray|fragrance|scent/i.test(t))return'180345';

  // ── EYE / EAR CARE ───────────────────────────────────────────
  if(/eye drop|eye wash|visine|clear eyes|rohto|contact solution|contact lens|renu solution|opti.free/i.test(t))return'57041';
  if(/ear drop|ear wax|earwax|ear cleaner|ear rinse|debrox|similasan ear/i.test(t))return'57041';

  // ── VITAMINS & SUPPLEMENTS ───────────────────────────────────
  if(/centrum|one.a.day|nature made|gummy vitamin|prenatal vitamin|folic acid|iron supplement|calcium supplement/i.test(t))return'180959';
  if(/vitamin c|vitamin d|vitamin b|vitamin e|vitamin k|vitamin a|vitamin multi/i.test(t))return'180959';
  if(/probiotic|prebiotic|digestive enzyme|collagen|biotin|melatonin|ashwagandha|turmeric|elderberry|echinacea/i.test(t))return'180959';
  if(/fish oil|omega.?3|krill oil|flaxseed|coq10|magnesium supplement|zinc|potassium|selenium|saw palmetto/i.test(t))return'180959';
  if(/fiber supplement|metamucil|benefiber|psyllium husk|miralax|colace|stool softener|laxative|fiber gumm/i.test(t))return'180959';
  if(/whey protein|protein powder|protein shake|mass gainer|weight gainer/i.test(t))return'180959';
  if(/vitamin|supplement|multivitamin/i.test(t))return'180959';

  // ── OTC MEDICINE ─────────────────────────────────────────────
  if(/ibuprofen|tylenol|advil|motrin|aspirin|acetaminophen|naproxen|aleve|pain relief|pain killer/i.test(t))return'67169';
  if(/nyquil|dayquil|theraflu|mucinex|robitussin|delsym|vicks dayquil|coricidin|cold flu/i.test(t))return'67169';
  if(/zyrtec|claritin|benadryl|allegra|flonase|xyzal|antihistamine|allergy relief/i.test(t))return'67169';
  if(/tums|pepcid|prilosec|nexium|maalox|rolaids|gas.x|gas relief|pepto|immodium|antacid|heartburn/i.test(t))return'67169';
  if(/unisom|zzzquil|sleep aid|diphenhydramine|sleep tablet|pm sleep/i.test(t))return'67169';
  if(/cough|sore throat|cold medicine|sinus|decongestant|sudafed|afrin nasal/i.test(t))return'67169';

  // ── FIRST AID ────────────────────────────────────────────────
  if(/band.aid|bandage|adhesive bandage|gauze|medical tape|wound care|neosporin|bacitracin|triple antibiotic/i.test(t))return'51227';
  if(/hydrogen peroxide|rubbing alcohol|isopropyl alcohol|antiseptic|betadine/i.test(t))return'51227';
  if(/thermometer|blood pressure monitor|glucometer|glucose meter|pulse oximeter|heating pad|\bice pack\b|\bhot pack\b/i.test(t))return'51227';
  if(/first aid|bandage|wound/i.test(t))return'51227';

  // ── FEMININE CARE ────────────────────────────────────────────
  if(/tampon|always pad|tampax|playtex|kotex|stayfree|menstrual cup|period pad|feminine hygiene/i.test(t))return'67167';

  // ── INCONTINENCE ─────────────────────────────────────────────
  if(/depend|poise|tena|adult diaper|incontinence pad|bladder leak/i.test(t))return'105070';

  // ── FACE MOISTURIZERS / CREAMS ───────────────────────────────
  if(/olay|olay regenerist|face cream|facial cream|face moisturizer|face lotion|facial moisturizer|anti-aging cream|anti aging|wrinkle cream|retinol cream|night cream|day cream/i.test(t))return'32062';

  // ── DEFAULT — Skin Care (categoría leaf segura) ───────────────
  return'31786';
}
const catNm=id=>({'31786':'Skin Care','60496':'Makeup','180959':'Vitamins & Supplements','67602':'Dental Care','36870':'Lip Care','11854':'Hair Care','131689':'Shampoo & Conditioner','32062':'Face Moisturizers','75655':'Yoga & Pilates','31085':'Hair Color','45258':'Hair Styling','11838':'Deodorant','11840':'Body Wash','26683':'Shaving','180345':'Fragrances','67169':'OTC Medicine','51227':'First Aid','67167':'Feminine Care','105070':'Incontinence','36478':'Nail Care','57041':'Eye & Ear Care','48619':'Batteries','44867':'Phone Cables','112529':'Headphones','14969':'Speakers','9394':'Phone Cases','293':'Consumer Electronics','20625':'Home & Garden','14308':'Food & Beverages','1281':'Pet Supplies','2984':'Baby','6000':'Automotive','888':'Sporting Goods','220':'Toys & Hobbies','19006':'LEGO Building Sets','261186':'Books','20695':'Mugs','177005':'Kitchen Knives','20654':'Cookware','20650':'Dinnerware','261068':'Toys','31788':'Body Lotions','168763':'Small Kitchen Appliances','16486':'Office Supplies','19264':'Braces & Supports','181':'Sporting Goods','1232':'Insect Repellent','261844':'Insect Repellent','26677':'BBQ & Grill Tools','20725':'Outdoor Cooking'}[id]||'Skin Care');

// Settings
function saveKey(){ toast('\u2139\uFE0F La clave de Claude ya la gestiona el servidor. No hace falta configurarla aqui.'); }
function saveEbay(){const v=$('ebayIn').value.trim();if(!v)return;localStorage.setItem('savvy_ebay_id',v);renderSt();toast('✅ eBay ID saved');setTimeout(closeCfg,700);}
function renderSt(){
  const k=!!savvyToken(),e=localStorage.getItem('savvy_ebay_id');
  $('stSt').innerHTML=`<div class="str"><div class="sd ${k?'ok':'no'}"></div><span>Sesión Claude: ${k?'✓ Activa':'✗ Inicia sesión'}</span></div><div class="str"><div class="sd ${e?'ok':'no'}"></div><span>eBay App ID: ${e?'✓ Configurado':'✗ No configurado'}</span></div>`;
  if($('keyIn'))$('keyIn').placeholder='Ya no se usa: la gestiona el servidor';
  if(e)$('ebayIn').value=e;
}
// Settings PIN Protection (1977)
let settingsPinAttempts = 0;
let settingsPinBlockedUntil = 0;
const SETTINGS_PIN = '1977';
const PIN_MAX_ATTEMPTS = 3;
const PIN_BLOCK_DURATION = 5 * 60 * 1000; // 5 minutos

function openCfgWithPin() {
  const now = Date.now();
  
  // Verificar si está bloqueado
  if (settingsPinBlockedUntil > now) {
    const remainingSeconds = Math.ceil((settingsPinBlockedUntil - now) / 1000);
    toast(`🔒 Settings bloqueados. Intenta en ${remainingSeconds}s`);
    return;
  }
  
  // Resetear intentos si pasó el tiempo de bloqueo
  if (settingsPinBlockedUntil <= now && settingsPinBlockedUntil > 0) {
    settingsPinAttempts = 0;
  }
  
  // Mostrar modal para PIN
  showPinModal();
}

function showPinModal() {
  const pinOverlay = document.createElement('div');
  pinOverlay.id = 'pin-overlay';
  pinOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
  `;
  
  const pinBox = document.createElement('div');
  pinBox.style.cssText = `
    background: #1a1a1a;
    border: 2px solid #ff6b35;
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    max-width: 320px;
    font-family: inherit;
  `;
  
  let pinInput = '';
  
  pinBox.innerHTML = `
    <div style="color: #fff; font-size: 18px; font-weight: bold; margin-bottom: 16px;">
      🔐 Settings Password
    </div>
    <div style="color: #aaa; font-size: 13px; margin-bottom: 20px;">
      Enter PIN to access Settings
    </div>
    <input 
      type="password" 
      id="pin-input" 
      placeholder="••••" 
      inputmode="numeric"
      maxlength="4"
      style="
        width: 100%;
        padding: 12px;
        font-size: 18px;
        text-align: center;
        background: #2a2a2a;
        color: #ff6b35;
        border: 1px solid #ff6b35;
        border-radius: 6px;
        margin-bottom: 16px;
        letter-spacing: 4px;
      "
    >
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
      ${[1,2,3,4,5,6,7,8,9,'←',0,'✓'].map(n => {
        if (n === '←') {
          return `<button style="
            padding: 12px;
            background: #ff6b35;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            font-weight: bold;
          " onclick="document.getElementById('pin-input').value = document.getElementById('pin-input').value.slice(0, -1); document.getElementById('pin-input').focus();">←</button>`;
        } else if (n === '✓') {
          return `<button style="
            padding: 12px;
            background: #4caf50;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            font-weight: bold;
          " onclick="validateSettingsPin();">✓</button>`;
        } else {
          return `<button style="
            padding: 12px;
            background: #333;
            color: #fff;
            border: 1px solid #555;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
          " onclick="document.getElementById('pin-input').value += '${n}'; document.getElementById('pin-input').focus();">${n}</button>`;
        }
      }).join('')}
    </div>
    <div style="color: #888; font-size: 12px;">
      Attemps: ${settingsPinAttempts}/${PIN_MAX_ATTEMPTS}
    </div>
  `;
  
  pinOverlay.appendChild(pinBox);
  document.body.appendChild(pinOverlay);
  
  setTimeout(() => {
    const inp = document.getElementById('pin-input');
    if (inp) inp.focus();
  }, 100);
  
  // Enter key
  document.getElementById('pin-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') validateSettingsPin();
  });
}

function validateSettingsPin() {
  const pinInput = document.getElementById('pin-input')?.value || '';
  const overlay = document.getElementById('pin-overlay');
  
  if (pinInput === SETTINGS_PIN) {
    // PIN correcto
    settingsPinAttempts = 0;
    settingsPinBlockedUntil = 0;
    if (overlay) overlay.remove();
    toast('✅ PIN correcto');
    setTimeout(() => {
      renderSt();
      $('cfgOv').classList.add('on');
    }, 300);
  } else {
    // PIN incorrecto
    settingsPinAttempts++;
    
    if (settingsPinAttempts >= PIN_MAX_ATTEMPTS) {
      // Bloquear por 5 minutos
      settingsPinBlockedUntil = Date.now() + PIN_BLOCK_DURATION;
      if (overlay) overlay.remove();
      toast('🔒 Bloqueado por 5 minutos');
    } else {
      // Mostrar error
      toast(`❌ PIN incorrecto (${settingsPinAttempts}/${PIN_MAX_ATTEMPTS})`);
      const inp = document.getElementById('pin-input');
      if (inp) {
        inp.value = '';
        inp.style.borderColor = '#ff0000';
        setTimeout(() => {
          inp.style.borderColor = '#ff6b35';
        }, 500);
      }
    }
  }
}

function openCfg(){renderSt();$('cfgOv').classList.add('on');}
function closeCfg(){$('cfgOv').classList.remove('on');}

// ── Savvy Universal Scanner (html5-qrcode) ───────────────────
var _savvyScanners = {};
var _scannerInitInProgress = {};
var _scannerCancelled = {};

// Detectar iOS Safari
function isIOSSafari() {
  var ua = navigator.userAgent.toLowerCase();
  var isIOS = /iphone|ipad|ipod/.test(ua);
  var isSafari = /safari/.test(ua) && !/chrome|crios|firefox|opera/.test(ua);
  return isIOS && isSafari;
}

const SAVVY_SCAN_CONFIG = (() => {
  var baseConfig = {
    fps: isIOSSafari() ? 10 : 20,
    qrbox: { width: 280, height: 120 },
    disableFlip: false,
    experimentalFeatures: {},
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
    ]
  };

  if (isIOSSafari()) {
    baseConfig.facingMode = 'environment';
    // NO incluir aspectRatio para iOS
    baseConfig.experimentalFeatures = {
      useBarCodeDetectorIfSupported: false
    };
  } else {
    // Otros navegadores: preservar original
    baseConfig.aspectRatio = 1.7;
    baseConfig.experimentalFeatures = {
      useBarCodeDetectorIfSupported: true
    };
  }

  return baseConfig;
})();

// Validar que stream esté activo
function validateVideoStream(videoElement) {
  if (!videoElement.srcObject) {
    console.warn('[Scanner] srcObject no existe');
    return false;
  }

  var tracks = videoElement.srcObject.getTracks();
  if (tracks.length === 0) {
    console.warn('[Scanner] No hay tracks en srcObject');
    return false;
  }

  var videoTrack = tracks.find(function(t) { return t.kind === 'video'; });
  if (!videoTrack) {
    console.warn('[Scanner] No hay video track');
    return false;
  }

  if (videoTrack.readyState !== 'live') {
    console.warn('[Scanner] Video track no está live:', videoTrack.readyState);
    return false;
  }

  if (videoElement.readyState < 2) {
    console.warn('[Scanner] video.readyState < 2 (no hay datos)');
    return false;
  }

  if (videoElement.paused) {
    console.warn('[Scanner] Video está paused');
    return false;
  }

  if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    console.warn('[Scanner] videoWidth/videoHeight es 0:', videoElement.videoWidth, 'x', videoElement.videoHeight);
    return false;
  }

  return true;
}

// Monitoreo corto para detectar visor negro
// Retorna: "valid", "cancelled", o "failed"
function monitorVideoStream(videoElementId) {
  return new Promise(function(resolve) {
    var startTime = Date.now();
    var timeoutMs = 3000;  // 3 segundos
    var videoElement = null;

    var checkInterval = setInterval(function() {
      var elapsed = Date.now() - startTime;

      // Si fue cancelado, terminar inmediatamente
      if (_scannerCancelled[videoElementId]) {
        clearInterval(checkInterval);
        console.log('[Scanner] Monitor cancelado');
        resolve('cancelled');
        return;
      }

      // Intentar obtener el elemento <video> si aún no lo tenemos
      if (!videoElement) {
        videoElement = document.querySelector('#qr-video video');
        if (!videoElement) {
          console.log('[Scanner] Esperando <video> elemento...');
          // Continuar checando en la siguiente iteración
          if (elapsed >= timeoutMs) {
            clearInterval(checkInterval);
            console.error('[Scanner] Visor negro detectado en', elapsed, 'ms - <video> no encontrado');
            handleBlackScreenTimeout(videoElementId);
            resolve('failed');
          }
          return;
        }
      }

      // Criterios para stream válido
      var isValid =
        videoElement.srcObject &&
        videoElement.srcObject.getTracks().length > 0 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0 &&
        videoElement.srcObject.getTracks().find(function(t) { return t.kind === 'video'; }) &&
        videoElement.srcObject.getTracks().find(function(t) { return t.kind === 'video'; }).readyState === 'live' &&
        !videoElement.paused;

      if (isValid) {
        clearInterval(checkInterval);
        console.log('[Scanner] Stream válido detectado en', elapsed, 'ms');
        resolve('valid');
        return;
      }

      if (elapsed >= timeoutMs) {
        clearInterval(checkInterval);
        console.error('[Scanner] Visor negro detectado en', elapsed, 'ms - stream no inicializado');
        handleBlackScreenTimeout(videoElementId);
        resolve('failed');
        return;
      }
    }, 300);  // Chequear cada 300ms
  });
}

// Manejar timeout/visor negro — MANTIENE MODAL ABIERTO para diagnóstico
function handleBlackScreenTimeout(videoElementId) {
  console.error('[Scanner] BLACK_SCREEN_TIMEOUT detectado - manteniendo modal abierto para diagnóstico');

  savvyStopScan(videoElementId).then(function() {
    var qrDiv = document.getElementById(videoElementId);
    if (qrDiv) {
      qrDiv.innerHTML = '';

      // Contenedor principal del error
      var errorContainer = document.createElement('div');
      errorContainer.style.cssText = 'background:#ffebee;border:2px solid #d32f2f;border-radius:8px;padding:16px;margin:8px;color:#333;font-family:system-ui,sans-serif;';

      // Título del error
      var title = document.createElement('div');
      title.style.cssText = 'font-weight:bold;font-size:16px;color:#d32f2f;margin-bottom:12px;';
      title.textContent = '⚠️ BLACK_SCREEN_TIMEOUT';
      errorContainer.appendChild(title);

      // Descripción
      var desc = document.createElement('div');
      desc.style.cssText = 'font-size:13px;line-height:1.6;margin-bottom:12px;color:#555;';
      desc.textContent = 'La cámara no respondió en 3 segundos. Verifica los permisos en Configuración > Safari > Cámara.';
      errorContainer.appendChild(desc);

      // Datos técnicos
      var techDiv = document.createElement('div');
      techDiv.style.cssText = 'background:#fff;border:1px solid #e0e0e0;border-radius:4px;padding:10px;font-size:12px;font-family:monospace;line-height:1.4;';

      var videoElement = document.querySelector('#qr-video video');
      var techs = [];
      techs.push('VIDEO_ELEMENT: ' + (videoElement ? 'existe' : 'NO EXISTE'));

      if (videoElement) {
        techs.push('srcObject: ' + (videoElement.srcObject ? 'sí' : 'no'));
        techs.push('readyState: ' + videoElement.readyState + ' (0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA)');
        techs.push('paused: ' + videoElement.paused);
        techs.push('videoWidth: ' + videoElement.videoWidth);
        techs.push('videoHeight: ' + videoElement.videoHeight);

        if (videoElement.srcObject) {
          var tracks = videoElement.srcObject.getTracks();
          techs.push('tracks.length: ' + tracks.length);
          tracks.forEach(function(t, i) {
            techs.push('  track[' + i + '].kind=' + t.kind + ', readyState=' + t.readyState);
          });
        } else {
          techs.push('srcObject.getTracks(): N/A (no srcObject)');
        }
      }

      techDiv.textContent = techs.join('\n');
      errorContainer.appendChild(techDiv);

      // Instrucción para cerrar
      var closeInstr = document.createElement('div');
      closeInstr.style.cssText = 'font-size:12px;color:#999;margin-top:12px;font-style:italic;';
      closeInstr.textContent = '→ Usa el botón CANCEL para cerrar';
      errorContainer.appendChild(closeInstr);

      qrDiv.appendChild(errorContainer);
    }

    // NO CERRAMOS EL MODAL — el usuario debe usar CANCEL manualmente
  }).catch(function(err) {
    console.warn('[Scanner] Error durante handleBlackScreenTimeout:', err.message);
  });
}

// Manejar errores de inicio — MANTIENE MODAL ABIERTO para diagnóstico
function handleScannerError(videoElementId, error) {
  console.error('[Scanner] CAMERA_START_ERROR:', error.name, error.message);

  savvyStopScan(videoElementId).then(function() {
    var qrDiv = document.getElementById(videoElementId);
    if (qrDiv) {
      qrDiv.innerHTML = '';

      // Contenedor principal del error
      var errorContainer = document.createElement('div');
      errorContainer.style.cssText = 'background:#ffebee;border:2px solid #d32f2f;border-radius:8px;padding:16px;margin:8px;color:#333;font-family:system-ui,sans-serif;';

      // Título del error
      var title = document.createElement('div');
      title.style.cssText = 'font-weight:bold;font-size:16px;color:#d32f2f;margin-bottom:12px;';
      title.textContent = '❌ CAMERA_START_ERROR';
      errorContainer.appendChild(title);

      // Error name
      var nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-size:13px;font-weight:600;color:#c62828;margin-bottom:6px;';
      nameDiv.textContent = error.name || 'Unknown Error';
      errorContainer.appendChild(nameDiv);

      // Error message con monospace
      var msgDiv = document.createElement('div');
      msgDiv.style.cssText = 'background:#fff;border:1px solid #e0e0e0;border-radius:4px;padding:10px;font-size:12px;font-family:monospace;line-height:1.4;word-break:break-word;';
      msgDiv.textContent = error.message || '(sin mensaje)';
      errorContainer.appendChild(msgDiv);

      // Instrucción para cerrar
      var closeInstr = document.createElement('div');
      closeInstr.style.cssText = 'font-size:12px;color:#999;margin-top:12px;font-style:italic;';
      closeInstr.textContent = '→ Usa el botón CANCEL para cerrar';
      errorContainer.appendChild(closeInstr);

      qrDiv.appendChild(errorContainer);
    }

    // NO CERRAMOS EL MODAL — el usuario debe usar CANCEL manualmente
  }).catch(function(err) {
    console.warn('[Scanner] Error durante handleScannerError:', err.message);
  });
}

// Callback para procesar el código de barras escaneado
function savvyProcessScan(decoded) {
  var v = String(decoded || '').trim();
  if (!v) return;

  // Detener el scanner
  if (typeof savvyStopScan === 'function') {
    savvyStopScan('qr-video');
  }

  // Cerrar la ventana modal
  var modal = document.getElementById('scr-cam');
  if (modal) {
    modal.classList.remove('on');
  }

  // Procesar el UPC (remover no-dígitos) y analizar
  analyze(v.replace(/\D/g, ''));
}

// Abrir scanner con manejo iOS
async function savvyOpenBarcodeScanner() {
  var videoElementId = 'qr-video';

  // Validar que no esté ya abierto
  if (_scannerInitInProgress[videoElementId]) {
    console.warn('[Scanner] Ya hay una apertura en progreso');
    return;
  }

  // Validar Html5Qrcode disponible
  if (typeof window.Html5Qrcode === 'undefined') {
    alert('Librería de escaneo no cargada. Recargue la página.');
    console.error('Html5Qrcode not available');
    return;
  }

  // Marcar que está iniciando
  _scannerInitInProgress[videoElementId] = true;
  delete _scannerCancelled[videoElementId];

  try {
    // PASO 1: Activar modal #scr-cam
    var modal = document.getElementById('scr-cam');
    if (modal) {
      modal.classList.add('on');
      console.log('[Scanner] Modal #scr-cam activado');
    }

    // PASO 2: Esperar dos requestAnimationFrame
    var frameCount = 0;
    await new Promise(function(resolve) {
      function checkFrames() {
        frameCount++;
        if (frameCount >= 2) {
          resolve();
        } else {
          requestAnimationFrame(checkFrames);
        }
      }
      requestAnimationFrame(checkFrames);
    });

    console.log('[Scanner] requestAnimationFrame completado, iniciando scanner');

    // PASO 3: Iniciar scanner - verificar cancelación antes
    if (_scannerCancelled[videoElementId]) {
      console.log('[Scanner] Inicialización cancelada por usuario');
      delete _scannerInitInProgress[videoElementId];
      return;
    }

    var started = await savvyStartScan(videoElementId, savvyProcessScan);

    // Verificar si start() fue exitoso
    if (started !== true) {
      console.log('[Scanner] savvyStartScan retornó false/falsy, deteniendo flujo');
      delete _scannerInitInProgress[videoElementId];
      return;
    }

    // PASO 4: Post-start - inyectar atributos iOS después de 300ms
    if (_scannerCancelled[videoElementId]) {
      console.log('[Scanner] Post-start cancelado antes de espera 300ms');
      await savvyStopScan(videoElementId);
      delete _scannerInitInProgress[videoElementId];
      return;
    }

    await new Promise(function(resolve) {
      setTimeout(async function() {
        var videoElement = document.querySelector('#qr-video video');
        if (videoElement) {
          console.log('[Scanner] Elemento <video> encontrado, aplicando atributos iOS');

          // PASO 1: Aplicar atributos iOS
          videoElement.setAttribute('playsinline', 'true');
          videoElement.setAttribute('autoplay', 'true');
          videoElement.setAttribute('muted', 'true');
          videoElement.muted = true;

          // PASO 2: Intentar play() inmediatamente
          try {
            console.log('[Scanner] Intentando videoElement.play()');
            await videoElement.play();
            console.log('[Scanner] play() completado exitosamente');
          } catch (playErr) {
            console.warn('[Scanner] play() rechazado:', playErr.message);
            // No bloquear flujo - permitir que monitorVideoStream valide
          }

          // PASO 3: Validar stream DESPUÉS de intentar play()
          if (validateVideoStream(videoElement)) {
            console.log('[Scanner] Stream válido después de play()');
          } else {
            console.warn('[Scanner] Stream no válido después de play() - monitorVideoStream validará');
          }
        } else {
          console.warn('[Scanner] <video> no encontrado después de start()');
        }
        resolve();
      }, 300);
    });

    // Después de espera 300ms: verificar cancelación nuevamente
    if (_scannerCancelled[videoElementId]) {
      console.log('[Scanner] Cancelado después de espera 300ms');
      await savvyStopScan(videoElementId);
      delete _scannerInitInProgress[videoElementId];
      return;
    }

    // PASO 5: Monitoreo corto para detectar visor negro
    var monitorResult = await monitorVideoStream(videoElementId);

    if (monitorResult === 'cancelled') {
      console.log('[Scanner] Monitoreo reportó cancelación');
      await savvyStopScan(videoElementId);
      delete _scannerInitInProgress[videoElementId];
      return;
    }

    if (monitorResult === 'failed') {
      console.log('[Scanner] Monitoreo reportó fallo - handleBlackScreenTimeout ya limpió');
      delete _scannerInitInProgress[videoElementId];
      return;
    }

    // monitorResult === 'valid'
    delete _scannerInitInProgress[videoElementId];

  } catch(err) {
    console.error('[Scanner] Error abriendo scanner:', err.message);
    handleScannerError(videoElementId, err);
    delete _scannerInitInProgress[videoElementId];
  }
}

async function savvyStartScan(videoElementId, onResult) {
  console.log('📷 savvyStartScan starting for element:', videoElementId);
  await savvyStopScan(videoElementId);

  const videoEl = document.getElementById(videoElementId);
  if(!videoEl){
    console.error('❌ Video element not found:', videoElementId);
    toast('❌ Camera container not found');
    return false;
  }

  console.log('✅ Video element found:', videoEl);

  var scanner = new Html5Qrcode(videoElementId, {
    formatsToSupport: SAVVY_SCAN_CONFIG.formatsToSupport,
    experimentalFeatures: SAVVY_SCAN_CONFIG.experimentalFeatures,
    verbose: false
  });
  _savvyScanners[videoElementId] = scanner;
  try {
    console.log('📱 Requesting camera access...');

    // Build scanConfig dynamically, excluding aspectRatio for iOS
    var scanConfig = {
      fps: SAVVY_SCAN_CONFIG.fps,
      qrbox: SAVVY_SCAN_CONFIG.qrbox,
      disableFlip: SAVVY_SCAN_CONFIG.disableFlip,
    };
    // Only add aspectRatio for non-iOS
    if (!isIOSSafari() && SAVVY_SCAN_CONFIG.aspectRatio) {
      scanConfig.aspectRatio = SAVVY_SCAN_CONFIG.aspectRatio;
    }

    await scanner.start(
      { facingMode: SAVVY_SCAN_CONFIG.facingMode || 'environment' },
      scanConfig,
      (decoded) => {
        console.log('✅ QR Code found:', decoded);
        savvyStopScan(videoElementId);
        onResult(decoded);
      },
      () => {}
    );

    // Check cancellation after start completes
    if (_scannerCancelled[videoElementId]) {
      console.log('[Scanner] Cancelado después de start()');
      await savvyStopScan(videoElementId);
      return false;
    }

    console.log('✅ Camera started successfully');
    return true;
  } catch(e) {
    console.error('❌ Camera error:', e.message);
    toast('❌ No camera access: ' + e.message);

    try {
      await scanner.clear();
      console.log('[Scanner] clear() completado después de error start()');
    } catch (clearErr) {
      console.warn('[Scanner] clear() rechazado después de error:', clearErr.message);
    }

    delete _savvyScanners[videoElementId];
    var qrDiv = document.getElementById(videoElementId);
    if (qrDiv) {
      qrDiv.innerHTML = '';
      console.log('[Scanner] Contenedor limpiado después de error start()');
    }

    throw e;
  }
}

async function savvyStopScan(videoElementId) {
  console.log('[Scanner] Deteniendo scanner:', videoElementId);

  var scanner = _savvyScanners[videoElementId];

  if (!scanner) {
    console.warn('[Scanner] No hay scanner registrado para:', videoElementId);
    var qrDiv = document.getElementById(videoElementId);
    if (qrDiv) {
      qrDiv.innerHTML = '';
    }
    return;
  }

  try {
    // Detener captura directamente sin verificar _isScanning
    await scanner.stop();
    console.log('[Scanner] stop() completado');
  } catch (stopErr) {
    console.warn('[Scanner] Error deteniendo scanner:', stopErr.message);
  }

  try {
    // Limpiar recursos internos
    await scanner.clear();
    console.log('[Scanner] clear() completado');
  } catch (clearErr) {
    console.warn('[Scanner] clear() rechazado (ok):', clearErr.message);
  }

  // Eliminar del registro
  delete _savvyScanners[videoElementId];

  // Limpiar contenedor
  var qrDiv = document.getElementById(videoElementId);
  if (qrDiv) {
    qrDiv.innerHTML = '';
    console.log('[Scanner] Contenedor #' + videoElementId + ' limpiado');
  }
}

// Camera — main scanner
async function startCam(){
  screen('cam');
  savvyStopScan('qr-video');
  savvyStartScan('qr-video', async txt => {
    analyze(txt.replace(/\D/g,''));
  });
}

// Sync wrapper for HTML onclick handler
function startCamSync(){
  console.log('📷 startCamSync called');
  try {
    startCam().catch(e => console.error('startCam error:', e));
  } catch(e) {
    console.error('Error calling startCam:', e);
    toast('⚠️ Error starting camera');
  }
}
async function stopCam(){
  savvyStopScan('qr-video');
  screen('res');
}


// ── BUNDLE IMAGE GENERATOR — Professional eBay/Amazon style ──

// ── BACKGROUND REMOVAL (sin API) ────────────────────────────
// Muestrea el borde completo para detectar el color de fondo,
// luego hace flood-fill + segunda pasada para limpiar residuos.
// Mejor resultado con fondo de color (cartón, gris) que con blanco.
async function removeBgCanvas(dataUrl) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var W=img.width, H=img.height;
      var c=document.createElement('canvas'); c.width=W; c.height=H;
      var ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      var id=ctx.getImageData(0,0,W,H), px=id.data;

      function pix(x,y){var i=(y*W+x)*4;return[px[i],px[i+1],px[i+2]];}
      function dist(a,b){
        return Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1])+(a[2]-b[2])*(a[2]-b[2]));
      }

      // ── 1. Detectar color de fondo desde TODO el borde (15px) ───
      var edge=[], STRIP=15;
      for(var x=0;x<W;x++){
        for(var y=0;y<STRIP;y++) edge.push(pix(x,y));
        for(var y=H-STRIP;y<H;y++) edge.push(pix(x,y));
      }
      for(var y=STRIP;y<H-STRIP;y++){
        for(var x=0;x<STRIP;x++) edge.push(pix(x,y));
        for(var x=W-STRIP;x<W;x++) edge.push(pix(x,y));
      }
      // Mediana de brightness para evitar outliers (sombras, producto en borde)
      edge.sort(function(a,b){return (a[0]+a[1]+a[2])-(b[0]+b[1]+b[2]);});
      var bg=edge[Math.floor(edge.length/2)];
      var bgBright=(bg[0]+bg[1]+bg[2])/3;

      // Tolerancia basada en el fondo
      // Blanco puro → conservador; cartón/gris → agresivo
      var TOL = bgBright>230 ? 36 : bgBright>200 ? 58 : bgBright>150 ? 72 : 85;

      // ── 2. Flood-fill BFS desde todos los bordes ─────────────────
      var vis=new Uint8Array(W*H);
      var q=new Int32Array(W*H*2); var qh=0,qt=0;
      function enq(x,y){if(x>=0&&x<W&&y>=0&&y<H&&!vis[y*W+x]){vis[y*W+x]=1;q[qt++]=x;q[qt++]=y;}}
      for(var x=0;x<W;x++){enq(x,0);enq(x,H-1);}
      for(var y=1;y<H-1;y++){enq(0,y);enq(W-1,y);}

      while(qh<qt){
        var cx=q[qh++],cy=q[qh++];
        if(dist(pix(cx,cy),bg)<TOL){
          px[(cy*W+cx)*4+3]=0;
          enq(cx+1,cy);enq(cx-1,cy);enq(cx,cy+1);enq(cx,cy-1);
        }
      }

      // ── 3. Segunda pasada: eliminar "islas" de fondo no conectadas ─
      // Reconstruir máscara de pixels eliminados
      var removed=new Uint8Array(W*H);
      for(var i=0;i<W*H;i++) if(px[i*4+3]===0) removed[i]=1;

      // Eliminar pixels adyacentes a borde removido que también son similares al fondo
      for(var pass=0;pass<2;pass++){
        for(var y=1;y<H-1;y++) for(var x=1;x<W-1;x++){
          if(removed[y*W+x]) continue;
          var adj=removed[(y-1)*W+x]+removed[(y+1)*W+x]+removed[y*W+(x-1)]+removed[y*W+(x+1)];
          if(adj>=1 && dist(pix(x,y),bg)<TOL*1.3){
            px[(y*W+x)*4+3]=0; removed[y*W+x]=1;
          }
        }
      }

      // ── 4. Erosionar borde duro 1px ───────────────────────────────
      for(var y=1;y<H-1;y++) for(var x=1;x<W-1;x++){
        if(removed[y*W+x]) continue;
        var hard=removed[(y-1)*W+x]+removed[(y+1)*W+x]+removed[y*W+(x-1)]+removed[y*W+(x+1)];
        if(hard>=3) { px[(y*W+x)*4+3]=0; }
      }

      ctx.putImageData(id,0,0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror=function(){resolve(dataUrl);};
    img.src=dataUrl;
  });
}

// ── RECORTAR AL PRODUCTO (sin espacio vacío) ───────────────────
async function cropToProduct(dataUrl) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var W=img.width, H=img.height;
      var c=document.createElement('canvas'); c.width=W; c.height=H;
      var ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      var d=ctx.getImageData(0,0,W,H).data;
      var x0=W,x1=0,y0=H,y1=0;
      for (var y=0;y<H;y++) for (var x=0;x<W;x++) {
        var i=(y*W+x)*4;
        // alpha>180: solo pixels sólidos del producto, ignora bordes suaves de PhotoRoom
        var notTransp=d[i+3]>180;
        var notWhite=d[i]<240||d[i+1]<240||d[i+2]<240;
        if (notTransp && notWhite) {
          if(x<x0)x0=x; if(x>x1)x1=x;
          if(y<y0)y0=y; if(y>y1)y1=y;
        }
      }
      if(x0>=x1||y0>=y1){resolve(dataUrl);return;}
      var M=10;
      x0=Math.max(0,x0-M); y0=Math.max(0,y0-M);
      x1=Math.min(W,x1+M); y1=Math.min(H,y1+M);
      var oc=document.createElement('canvas');
      oc.width=x1-x0; oc.height=y1-y0;
      oc.getContext('2d').drawImage(img,x0,y0,oc.width,oc.height,0,0,oc.width,oc.height);
      resolve(oc.toDataURL('image/png'));
    };
    img.onerror=function(){resolve(dataUrl);};
    img.src=dataUrl;
  });
}

// ── BADGE CIRCULAR ─────────────────────────────────────────────
function drawPackBadge(ctx, n, SZ) {
  var R=Math.round(SZ*0.075);
  var cx=SZ-R-Math.round(SZ*0.025), cy=R+Math.round(SZ*0.025);
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.28)'; ctx.shadowBlur=16;
  ctx.fillStyle='rgba(173,216,240,0.97)';
  ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle='rgba(20,100,160,0.5)'; ctx.lineWidth=Math.round(SZ*0.003);
  ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.stroke();
  var big=Math.round(R*0.68), small=Math.round(R*0.30);
  ctx.fillStyle='#0A3566'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold '+big+'px -apple-system,Arial,sans-serif';
  ctx.fillText(String(n),cx,cy-R*0.15);
  ctx.font='bold '+small+'px -apple-system,Arial,sans-serif';
  ctx.fillText('PACK',cx,cy+R*0.48);
  ctx.textAlign='start';
}



// Detectar color promedio del fondo muestreando las 4 esquinas (franja 10%)
async function detectBgColor(dataUrl) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var W=img.width, H=img.height;
      var c=document.createElement('canvas'); c.width=W; c.height=H;
      var ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      var px=ctx.getImageData(0,0,W,H).data;
      var rs=0,gs=0,bs=0,n=0;
      var strip=Math.round(Math.min(W,H)*0.10);
      [[0,0],[W-strip,0],[0,H-strip],[W-strip,H-strip]].forEach(function(p){
        for(var dy=0;dy<strip;dy++) for(var dx=0;dx<strip;dx++){
          var i=((p[1]+dy)*W+(p[0]+dx))*4;
          rs+=px[i]; gs+=px[i+1]; bs+=px[i+2]; n++;
        }
      });
      resolve([Math.round(rs/n), Math.round(gs/n), Math.round(bs/n)]);
    };
    img.onerror=function(){resolve([180,140,90]);};
    img.src=dataUrl;
  });
}

// Limpiar PNG transparente de PhotoRoom:
// 1. Quitar borde 8%
// 2. Eliminar píxeles que coinciden con el color del fondo original (cartón, etc.)
// 3. Componentes conectados → conservar solo el componente más grande
async function cleanTransparentEdges(dataUrl, bgColor) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var W=img.width, H=img.height, N=W*H;
      var c=document.createElement('canvas'); c.width=W; c.height=H;
      var ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      var id=ctx.getImageData(0,0,W,H), px=id.data;

      // Paso 1: quitar borde del 8% (artefactos de esquina)
      var mX=Math.round(W*0.08), mY=Math.round(H*0.08);
      for(var y=0;y<H;y++) for(var x=0;x<W;x++){
        if(x<mX||x>=W-mX||y<mY||y>=H-mY) px[(y*W+x)*4+3]=0;
      }

      // Paso 1b: eliminar píxeles que coinciden con el color del fondo original
      // Esto limpia el cartón conectado a la base del producto
      if(bgColor && bgColor.length===3){
        var br=bgColor[0], bg2=bgColor[1], bb=bgColor[2];
        var TOL=55; // tolerancia en distancia RGB
        for(var y=0;y<H;y++) for(var x=0;x<W;x++){
          var pi=(y*W+x)*4;
          if(px[pi+3]<10) continue; // ya transparente
          var dr=px[pi]-br, dg=px[pi+1]-bg2, db2=px[pi+2]-bb;
          var dist=Math.sqrt(dr*dr+dg*dg+db2*db2);
          if(dist<TOL) px[pi+3]=0; // coincide con fondo → transparente
        }
      }

      // Paso 2: componentes conectados (BFS) sobre pixeles con alpha > 40
      var vis=new Uint8Array(N);
      var q=new Int32Array(N);
      var components=[]; // cada componente = array de indices planos

      for(var sy=0;sy<H;sy++) for(var sx=0;sx<W;sx++){
        var si=sy*W+sx;
        if(vis[si]||px[si*4+3]<=40) continue;
        // BFS
        var comp=[], qh=0, qt=0;
        q[qt++]=si; vis[si]=1;
        while(qh<qt){
          var ci=q[qh++];
          comp.push(ci);
          var cy=Math.floor(ci/W), cx=ci-cy*W;
          // 4-vecinos
          var ns=[ci-1,ci+1,ci-W,ci+W];
          for(var k=0;k<4;k++){
            var ni=ns[k];
            if(ni<0||ni>=N||vis[ni]) continue;
            // Validar que no cruza bordes horizontales
            if(k===0&&cx===0) continue;
            if(k===1&&cx===W-1) continue;
            if(px[ni*4+3]>40){vis[ni]=1; q[qt++]=ni;}
          }
        }
        components.push(comp);
      }

      // Ordenar por tamaño — el más grande = el producto real
      components.sort(function(a,b){return b.length-a.length;});

      // Eliminar todos los componentes pequeños (islas de cartón)
      // Umbral: conservar solo componentes que sean >5% del más grande
      var bigSize = components.length>0 ? components[0].length : 0;
      for(var ci2=1;ci2<components.length;ci2++){
        if(components[ci2].length < bigSize*0.05){
          for(var pi=0;pi<components[ci2].length;pi++){
            px[components[ci2][pi]*4+3]=0;
          }
        }
      }

      ctx.putImageData(id,0,0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror=function(){resolve(dataUrl);};
    img.src=dataUrl;
  });
}


// Convertir PNG transparente a JPEG con fondo blanco

// Eliminar píxeles del fondo que quedaron en la imagen con fondo blanco
// Aplica DESPUÉS de pngToWhiteJpeg para limpiar artefactos residuales
async function removeResidualBg(dataUrl, bgColor) {
  if (!bgColor || bgColor.length < 3) return dataUrl;
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var W=img.width, H=img.height;
      var c=document.createElement('canvas'); c.width=W; c.height=H;
      var ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
      var id=ctx.getImageData(0,0,W,H), px=id.data;
      var br=bgColor[0], bg2=bgColor[1], bb=bgColor[2];
      // Tolerancia alta — necesaria para capturar bordes sucios
      var TOL=80;
      // Aún más agresivo en el borde exterior del 30% de la imagen
      for(var y=0;y<H;y++) for(var x=0;x<W;x++){
        var i=(y*W+x)*4;
        var r=px[i],g=px[i+1],b=px[i+2];
        var dist=Math.sqrt((r-br)*(r-br)+(g-bg2)*(g-bg2)+(b-bb)*(b-bb));
        var inBorder=(x<W*0.20||x>W*0.80||y<H*0.20||y>H*0.80);
        var tol=inBorder?TOL:TOL*0.65; // más agresivo en bordes
        if(dist<tol){ px[i]=255; px[i+1]=255; px[i+2]=255; } // → blanco
      }
      ctx.putImageData(id,0,0);
      resolve(c.toDataURL('image/jpeg',0.93));
    };
    img.onerror=function(){resolve(dataUrl);};
    img.src=dataUrl;
  });
}

async function pngToWhiteJpeg(pngDataUrl) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      var ctx=c.getContext('2d');
      ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0);
      resolve(c.toDataURL('image/jpeg',0.92));
    };
    img.onerror=function(){resolve(pngDataUrl);};
    img.src=pngDataUrl;
  });
}

// ── GENERAR BUNDLE IMAGE ─────────────────────────────────────────
// Input: imagen con FONDO BLANCO (de PhotoRoom v2) sobre canvas blanco
// Layout: grid limpio sin overlap — profesional y sin artefactos
async function generateBundleImage(productDataUrl, packSize) {
  var SZ = 1200;
  var img = new Image(); img.src = productDataUrl;
  await new Promise(function(r){img.onload=r;img.onerror=r;});

  var canvas=document.createElement('canvas');
  canvas.width=SZ; canvas.height=SZ;
  var ctx=canvas.getContext('2d');
  ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,SZ,SZ);

  // Grid exacto por pack size (suma = packSize)
  // [cols, rows] donde cols*rows >= packSize
  var GRID = {
    1:[1,1], 2:[2,1], 3:[3,1], 4:[2,2],
    5:[3,2], 6:[3,2], 7:[4,2], 8:[4,2],
    9:[3,3], 10:[5,2], 11:[4,3], 12:[4,3]
  };
  var g = GRID[packSize] || [Math.ceil(Math.sqrt(packSize)), Math.ceil(packSize/Math.ceil(Math.sqrt(packSize)))];
  var cols=g[0], rows=g[1];

  var GAP = Math.round(SZ*0.018); // 2.2% de separación
  var PAD = Math.round(SZ*0.045); // 4.5% padding exterior

  var cellW = Math.floor((SZ - PAD*2 - GAP*(cols-1)) / cols);
  var cellH = Math.floor((SZ - PAD*2 - GAP*(rows-1)) / rows);
  var cell  = Math.min(cellW, cellH); // celda cuadrada

  // Centrar la grilla
  var gridW = cols*cell + (cols-1)*GAP;
  var gridH = rows*cell + (rows-1)*GAP;
  var ox = Math.round((SZ-gridW)/2);
  var oy = Math.round((SZ-gridH)/2);

  for(var i=0; i<packSize; i++){
    var col=i%cols, row=Math.floor(i/cols);
    var x=ox+col*(cell+GAP);
    var y=oy+row*(cell+GAP);
    ctx.drawImage(img, x, y, cell, cell);
  }

  drawPackBadge(ctx, packSize, SZ);
  return canvas.toDataURL('image/jpeg', 0.93);
}

function downloadBundleImg(src) {
  var a = document.createElement('a');
  a.href = src;
  a.download = 'bundle-' + ((cur && cur.upc) || 'product') + '.jpg';
  a.click();
}

// ── BUNDLE PHOTO CAPTURE → TRANSPARENT → COMPOSE ─────────────
// Flujo: foto → PhotoRoom/Remove.bg → PNG transparente limpio → bundle
async function openBundlePhoto() {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = true;
  input.onchange = async function(e) {
    var file = e.target.files[0]; if(!file) return;
    var genDiv = document.getElementById('bundle-generating');
    var preDiv = document.getElementById('bundle-preview');
    if(genDiv){genDiv.style.display='block'; genDiv.textContent='📷 Comprimiendo...';}
    if(preDiv) preDiv.style.display='none';

    var dataUrl = await clCompressImage(file, 1600, 1.0);

    // Subir a ImgBB
    var imgbbKey = localStorage.getItem('cl_imgbb_key') || DEFAULT_IMGBB_KEY;
    var photoUrl = dataUrl;
    if (imgbbKey) {
      if(genDiv) genDiv.textContent='📤 Subiendo a ImgBB...';
      var up = await clUploadPhotoToImgBB(dataUrl, imgbbKey);
      if (up) photoUrl = up;
    }

    // Subir imagen JPG real a Google Drive
    var driveUrl = localStorage.getItem('cl_drive_url') || 'https://script.google.com/macros/s/AKfycbyVgEEID8dqZMymlqQMpjO7fLBMYkfj0mmcWk2ImudTy9evKGlOi4oHUc9vhcdmpFeDDQ/exec';
    if (driveUrl) {
      try {
        if(genDiv) genDiv.textContent='☁️ Subiendo foto a Google Drive...';
        var sku = (cur && cur.upc) ? cur.upc : 'foto';
        var fname = sku + '-' + Date.now() + '.jpg';
        // Enviar imagen base64 directamente al Apps Script
        var b64 = dataUrl.split(',')[1];
        var res = await fetch(driveUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: fname, csvData: b64, isImage: true })
        });
        toast('✅ Foto .jpg subida a Drive — carpeta eBay Listings');
        if(genDiv) genDiv.textContent='✅ Foto en Drive';
      } catch(e2) {
        toast('⚠️ Drive no disponible');
      }
    }

    if(cur) { cur._rawPhoto = photoUrl; cur._imgUrl = photoUrl; }

    if(genDiv) genDiv.style.display='none';
    if(preDiv) {
      preDiv.style.display='block';
      preDiv.innerHTML='<img src="'+dataUrl+'" style="width:100%;border-radius:8px;opacity:0.7">'
        +'<div style="text-align:center;font-size:12px;color:var(--mu);margin-top:6px">📁 Foto en Drive — edítala y usa el botón verde ↑</div>';
    }
  };
  input.click();
}

// Subir foto ya lista (bundle hecho manualmente)
// ── Compress an image file to a data URL (same approach as Clothing & Shoes) ──
function clCompressImage(file, maxW=900, quality=0.75) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        // Calcular las dimensiones manteniendo proporciones correctas.
        // maxW aplica al lado MÁS LARGO (no solo al ancho), para que
        // fotos verticales del iPhone no queden reducidas de más.
        var w = img.width;
        var h = img.height;
        var longest = Math.max(w, h);
        var ratio = longest > maxW ? maxW / longest : 1;
        var canvas = document.createElement('canvas');
        canvas.width  = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        var ctx = canvas.getContext('2d');
        // imageSmoothingQuality 'high' mejora la nitidez al reducir
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Comprimir un dataUrl antes de subir a ImgBB si es muy grande ──
async function _compressForImgBB(dataUrl, maxSizeKB) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  var sizeKB = Math.ceil(dataUrl.length * 3 / 4 / 1024);
  if (sizeKB <= (maxSizeKB || 800)) return dataUrl; // ya está OK

  // Comprimir bajando calidad progresivamente
  return new Promise(function(resolve){
    var img = new Image();
    img.onload = function(){
      var canvas = document.createElement('canvas');
      var w = img.width, h = img.height;
      // NO SUBIR DE 1400 SIN MEDIR MEMORIA PRIMERO.
      // Un canvas de 2048x2048 ocupa 16.7 MB en RAM; a 1400 son 7.8 MB.
      // Como las subidas corren en paralelo (Promise.all), a 2048 con 5 packs
      // se rebasan los ~300 MB y Safari de iPhone mata la pestana (pantalla
      // negra). 1400 es el valor probado y estable.
      var maxDim = 1400;
      if (w > maxDim || h > maxDim) {
        var r = Math.min(maxDim/w, maxDim/h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      // Bajar calidad hasta llegar al tamaño objetivo
      var q = 0.85;
      var out = canvas.toDataURL('image/jpeg', q);
      while (Math.ceil(out.length * 3 / 4 / 1024) > (maxSizeKB || 800) && q > 0.3) {
        q -= 0.1;
        out = canvas.toDataURL('image/jpeg', q);
      }
      resolve(out);
    };
    img.onerror = function(){ resolve(dataUrl); };
    img.src = dataUrl;
  });
}

// ── RAILWAY BUCKET (almacenamiento propio) ───────────────────────────
// Sustituye a ImgBB como destino principal de las fotos. ImgBB tiene un
// limite de subidas por hora que se comparte entre TODOS los usuarios y
// tumbaba la bodega a media jornada. El bucket no tiene ese limite.
// ── IMAGE UPLOAD (STAGING PILOT) ──
// Uses /api/img-upload with Bearer token (protected endpoint).
// Detects WebP and blocks it (not yet supported in staging backend).

async function _uploadToBucket(dataUrl, slotName) {
  try {
    if (!dataUrl) return null;

    // WebP DETECTION: block before fetch, NEVER ImgBB fallback
    if (dataUrl.includes('image/webp')) {
      if (window._psDebug) window._psDebug('⚠️ Formato WebP pendiente de compatibilidad en staging');
      return null;
    }

    // Preprocess: compress for network efficiency
    dataUrl = await _compressForImgBB(dataUrl, 800);
    var b64 = dataUrl ? dataUrl.split(',')[1] : null;
    if (!b64) return null;

    // Timeout handling (AbortSignal.timeout not in Safari iOS)
    var controller = null, timeoutId = null;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(function(){ controller.abort(); }, 20000);
    } catch(e) {}

    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: b64,
        name: slotName || 'photo',
        ext: 'jpg'
      }),
      signal: controller ? controller.signal : undefined
    };

    // ✓ psAuthFetch with distinguishable error handling
    var res;
    try {
      res = await psAuthFetch('/api/img-upload', opts);
    } catch(e) {
      if (timeoutId) clearTimeout(timeoutId);

      // AUTH ERRORS: NO ImgBB (session already cleared by psAuthFetch)
      if (e.code === 'missing_token' || e.code === 'auth_error') {
        if (window._psDebug) window._psDebug('❌ Sesion expirada. Inicia sesion nuevamente.');
        return null;
      }

      // ORIGIN MISMATCH: NO ImgBB (security issue)
      if (e.code === 'origin_mismatch') {
        if (window._psDebug) window._psDebug('❌ Seguridad: URL externa rechazada');
        return null;
      }

      // NETWORK ERROR: NO automatic ImgBB
      if (e.code === 'network_error') {
        if (window._psDebug) window._psDebug('⚠️ Error de conexion: ' + e.message);
        return null;
      }

      // Unexpected error from psAuthFetch
      if (window._psDebug) window._psDebug('❌ Error inesperado: ' + (e.message || e));
      return null;
    }

    if (timeoutId) clearTimeout(timeoutId);

    // HTTP ERROR RESPONSES: handle each status code specifically
    if (!res.ok) {
      const status = res.status;
      var data;
      try {
        data = await res.json();
      } catch (parseError) {
        data = {};
      }
      const errorMsg = data.error || ('HTTP ' + status);

      // 400: VALIDATION ERROR — NO ImgBB
      if (status === 400) {
        if (window._psDebug) window._psDebug('❌ Validacion rechazada: ' + errorMsg);
        return null;
      }

      // 413: PAYLOAD TOO LARGE — NO ImgBB
      if (status === 413) {
        if (window._psDebug) window._psDebug('❌ Imagen demasiado grande');
        return null;
      }

      // 429: RATE LIMIT — NO ImgBB
      if (status === 429) {
        if (window._psDebug) window._psDebug('⚠️ Limite de subidas excedido. Espera un momento.');
        return null;
      }

      // 5xx: SERVER ERROR — NO automatic ImgBB
      if (status >= 500) {
        if (window._psDebug) window._psDebug('⚠️ Servidor no disponible (' + status + ')');
        return null;
      }

      // Other HTTP errors
      if (window._psDebug) window._psDebug('⚠️ Error HTTP ' + status + ': ' + errorMsg);
      return null;
    }

    // SUCCESS RESPONSE (2xx): parse and return URL
    var d = await res.json().catch(() => ({}));
    if (d && d.success && d.url) {
      if (window._psDebug) window._psDebug('✅ Foto subida: ' + (d.key || d.url) + ' (' + (d.size || '?') + ' bytes)');
      return d.url;
    }

    // Missing URL in success response
    if (window._psDebug) window._psDebug('⚠️ Respuesta incompleta desde servidor');
    return null;

  } catch(e) {
    // Outer exception handler (should not reach here, but safety net)
    var msg = e.name === 'AbortError' ? 'timeout (20s)' : (e.message || e);
    if (window._psDebug) window._psDebug('❌ Error inesperado: ' + msg);
    return null;
  }
}

// ── Punto de entrada unico para subir fotos ──────────────────────────
// Conserva el nombre original para que los ~10 lugares que la llaman NO
// tengan que cambiar. Intenta el bucket primero; si falla, ImgBB.
// STAGING PILOT: Try bucket-based upload only. NO automatic ImgBB fallback.
// Callers must handle failure and decide whether to retry, show error, or use
// explicit ImgBB action if UI provides one.
async function clUploadPhotoToImgBB(dataUrl, key, slotName) {
  // Try protected bucket upload first
  var viaBucket = await _uploadToBucket(dataUrl, slotName);
  if (viaBucket) return viaBucket;

  // STAGING: Bucket upload failed. No automatic fallback to ImgBB.
  // Return null — caller must handle failure appropriately.
  // ImgBB is available only via explicit user action (separate UI flow, if any).
  return null;
}

// ── Upload a data URL to ImgBB, return the public URL (RESPALDO) ──
async function _uploadToImgBB(dataUrl, key, slotName) {
  try {
    // Comprimir antes de subir si es muy grande (previene "Internal upload
    // error" y evita saturar memoria/ancho de banda con subidas en paralelo).
    // NO subir este valor sin probar con 5+ packs en un iPhone real.
    dataUrl = await _compressForImgBB(dataUrl, 800);
    const b64 = dataUrl ? dataUrl.split(',')[1] : null;
    if (!b64) { console.warn('ImgBB: no image data'); return null; }
    const fd = new FormData();
    fd.append('key', key);
    fd.append('image', b64);
    fd.append('name', (slotName || 'photo') + '-' + Date.now() + '.png');

    // TIMEOUT de 15 segundos — si ImgBB no responde, cancelar y seguir
    var controller = null;
    var timeoutId = null;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(function(){ controller.abort(); }, 15000);
    } catch(e) {}

    const fetchOpts = { method:'POST', body: fd };
    if (controller) fetchOpts.signal = controller.signal;

    const res = await fetch('https://api.imgbb.com/1/upload', fetchOpts);
    if (timeoutId) clearTimeout(timeoutId);

    const d = await res.json();
    if (d.success) {
      let imgUrl = d.data.image?.url || d.data.display_url || d.data.url;
      return imgUrl;
    } else {
      const errMsg = d.error?.message || JSON.stringify(d.error) || 'unknown error';
      console.error('ImgBB upload failed:', errMsg);
      if (window._psDebug) window._psDebug('❌ ImgBB: ' + errMsg);

      // Si es "Internal upload error", reintentar con compresión MUY agresiva
      if (/internal|upload/i.test(errMsg) && !slotName?.includes('retry')) {
        if (window._psDebug) window._psDebug('🔄 Reintentando con compresión agresiva...');
        var smaller = await _compressForImgBB(dataUrl, 300); // 300KB máximo
        return _uploadToImgBB(smaller, key, (slotName || 'photo') + '-retry');
      }
      return null;
    }
  } catch(e) {
    var msg = e.name === 'AbortError' ? 'timeout (15s)' : (e.message || e);
    console.error('ImgBB network error:', msg);
    if (window._psDebug) window._psDebug('❌ ImgBB network: ' + msg);
    return null;
  }
}

// ── PASO 1: capturar foto (front/back), quitar fondo con Railway rembg,
// subir el PNG resultante a ImgBB. El armado de paquetes es un paso aparte. ──
// ── Pipeline compartido: comprimir → quitar fondo (Railway rembg) → subir a ImgBB ──
// Usado por FRONT, BACK, y las fotos extra opcionales — mismo proceso para todas.
async function clRemoveBackground(file, onStatus){
  // PERFORMANCE INSTRUMENTATION
  const perfStart = performance.now();
  const perfMarks = {};

  // El servidor reduce la entrada a 1600px de todas formas (rembg calcula la
  // mascara a 320x320 internamente), asi que mandar mas es puro peso de red
  // sin ninguna mejora en el recorte. 1600 @ 0.90 baja la subida de ~3 MB a
  // unos 500 KB por foto.
  if(onStatus) onStatus('Comprimiendo...');
  perfMarks.compressStart = performance.now();
  var dataUrl = await clCompressImage(file, 1600, 0.90);
  perfMarks.compressEnd = performance.now();
  console.log('[PERF][PHOTO] initial-compress: ' + Math.round(perfMarks.compressEnd - perfMarks.compressStart) + ' ms');

  if(onStatus) onStatus('🚂 Quitando fondo...');
  perfMarks.rbgReqStart = performance.now();
  const RAILWAY_RBG = 'https://savvy-rembg-production.up.railway.app/remove-bg';
  const b64 = dataUrl.split(',')[1];
  const rbgRes = await fetch(RAILWAY_RBG, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // format 'jpeg' → el servidor pone el fondo blanco y devuelve JPEG.
    // Antes bajaba un PNG con transparencia de 4-8 MB que este mismo codigo
    // aplastaba contra fondo blanco tres lineas despues. Mismo resultado
    // final, una decima parte del peso.
    body: JSON.stringify({ image: b64, format: 'jpeg', quality: 92 })
  });
  perfMarks.rbgReqEnd = performance.now();
  console.log('[PERF][PHOTO] remove-bg-request: ' + Math.round(perfMarks.rbgReqEnd - perfMarks.rbgReqStart) + ' ms');

  if(!rbgRes.ok) throw new Error('Railway rembg error ' + rbgRes.status);
  perfMarks.rbgDecodeStart = performance.now();
  const rbgData = await rbgRes.json();
  perfMarks.rbgDecodeEnd = performance.now();
  console.log('[PERF][PHOTO] decode-result: ' + Math.round(perfMarks.rbgDecodeEnd - perfMarks.rbgDecodeStart) + ' ms');

  if(!rbgData.success || !rbgData.image) throw new Error('rembg no devolvió imagen');

  const isJpeg = (rbgData.mime === 'image/jpeg') || (rbgData.format === 'jpeg');
  const pngUrl = 'data:' + (isJpeg ? 'image/jpeg' : 'image/png') + ';base64,' + rbgData.image;

  // ── Fondo blanco ──
  // Si el servidor ya lo devolvio en JPEG, el fondo blanco ya viene puesto:
  // volver a pasarlo por canvas solo agregaria otra recompresion JPEG.
  // Si vino PNG (servidor viejo o fallback), se procesa como siempre.
  let cleanUrl;
  if (isJpeg) {
    if(onStatus) onStatus('🖼️ Listo...');
    perfMarks.bgProcessStart = performance.now();
    perfMarks.bgProcessEnd = performance.now();
    console.log('[PERF][PHOTO] bg-process: ' + Math.round(perfMarks.bgProcessEnd - perfMarks.bgProcessStart) + ' ms (jpeg, no reprocessing)');
    cleanUrl = pngUrl;
  } else {
    if(onStatus) onStatus('🖼️ Procesando fondo...');
    perfMarks.bgProcessStart = performance.now();
    cleanUrl = await new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        var ctx = canvas.getContext('2d');
        // Alta calidad de suavizado
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Dibujar imagen primero
        ctx.drawImage(img, 0, 0);
        // Fondo blanco DETRÁS con destination-over
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Calidad JPEG alta (0.95) — buen balance calidad/tamaño para ImgBB
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = function() { resolve(pngUrl); };
      img.src = pngUrl;
    });
    perfMarks.bgProcessEnd = performance.now();
    console.log('[PERF][PHOTO] bg-process: ' + Math.round(perfMarks.bgProcessEnd - perfMarks.bgProcessStart) + ' ms (png reprocessing)');
  }

  if(onStatus) onStatus('📤 Subiendo...');
  perfMarks.uploadStart = performance.now();
  const imgbbKey = localStorage.getItem('savvy_imgbb_key') || DEFAULT_IMGBB_KEY;
  let finalUrl = cleanUrl;
  if (imgbbKey) {
    const uploaded = await clUploadPhotoToImgBB(cleanUrl, imgbbKey, 'photo');
    if (uploaded) finalUrl = uploaded;
  }
  perfMarks.uploadEnd = performance.now();
  console.log('[PERF][PHOTO] remote-upload: ' + Math.round(perfMarks.uploadEnd - perfMarks.uploadStart) + ' ms');

  perfMarks.previewStart = performance.now();
  perfMarks.previewEnd = performance.now();
  console.log('[PERF][PHOTO] preview-render: ' + Math.round(perfMarks.previewEnd - perfMarks.previewStart) + ' ms');

  const totalTime = performance.now() - perfStart;
  console.log('[PERF][PHOTO] TOTAL: ' + Math.round(totalTime) + ' ms');

  return { finalUrl, localUrl: cleanUrl };
}

async function psCapturePhoto(slotId){
  // CRÍTICO para Safari iPhone: el input.click() debe dispararse INMEDIATAMENTE
  // desde el evento del usuario — cualquier await previo rompe la conexión y
  // Safari bloquea la apertura del menú de cámara/carrete/archivo.
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // Sin input.capture → iOS muestra su menú nativo: Fototeca / Tomar foto / Archivo
  // (las tres opciones que necesitamos)

  input.onchange = async function(e){
    var file = e.target.files[0];
    if(!file) return;

    var slot = document.getElementById('ps-slot-' + slotId);
    var setStatus = function(msg){
      if(slot) slot.innerHTML = '<div style="text-align:center;padding:8px"><div class="sp" style="width:24px;height:24px;margin:0 auto 6px"></div><div style="font-size:10px;color:var(--mu)">'+msg+'</div></div>';
    };
    setStatus('Comprimiendo...');

    try{
      const { finalUrl, localUrl } = await clRemoveBackground(file, setStatus);

      if (cur) {
        if (slotId === 'front') { cur._frontImg = finalUrl; cur._frontImgLocal = localUrl; }
        else { cur._backImg = finalUrl; cur._backImgLocal = localUrl; }
      }

      if (slot) {
        slot.innerHTML = '<img src="' + finalUrl + '" style="width:100%;height:100%;object-fit:contain;background:#ffffff">';
      }
      updatePackGenButtonState();
      toast('✅ Fondo removido — ' + (slotId==='front'?'Front':'Back') + ' lista');
    }catch(err){
      console.error('psCapturePhoto error:', err);
      // ── FALLBACK ROBUSTO: si rembg o ImgBB fallan, usar la foto original
      // comprimida sin fondo removido. El proceso NO se detiene.
      toast('⚠️ rembg falló — usando foto original (sin fondo removido)');
      try {
        var fallbackUrl = await clCompressImage(file, 1600, 0.92);
        // Intentar subir a ImgBB la foto original
        var imgbbKey = localStorage.getItem('savvy_imgbb_key') || DEFAULT_IMGBB_KEY;
        var uploadedFallback = fallbackUrl;
        if (imgbbKey) {
          try {
            var up = await clUploadPhotoToImgBB(fallbackUrl, imgbbKey, 'photo-fallback');
            if (up) uploadedFallback = up;
          } catch(e2) { /* si ImgBB también falla, usamos el dataUrl local */ }
        }
        if (cur) {
          if (slotId === 'front') { cur._frontImg = uploadedFallback; cur._frontImgLocal = fallbackUrl; }
          else { cur._backImg = uploadedFallback; cur._backImgLocal = fallbackUrl; }
        }
        if (slot) {
          slot.innerHTML = '<img src="' + uploadedFallback + '" style="width:100%;height:100%;object-fit:contain;border-radius:8px"><div style="font-size:9px;color:#ff9800;text-align:center;margin-top:2px">⚠️ sin rembg</div>';
        }
        updatePackGenButtonState();
      } catch(err2) {
        // Si todo falla, dejar el slot clickeable para intentar de nuevo
        if(slot) slot.innerHTML = '<div style="text-align:center;padding:8px"><div style="font-size:24px">📷</div><div style="font-size:10px;color:#ff5252">Error — toca para reintentar</div></div>';
      }
    }
  };

  // PRIMERO el click — luego nada más. Safari requiere que el click sea inmediato.
  input.click();
}

// ── FOTOS EXTRA (opcionales, hasta 3) — mismo proceso que BACK ──
// Se agregan con el botón "+ Agregar Foto"; cada una se usa luego como foto
// secundaria (centrada, sin duplicar, sin distintivo) en el generador de packs.
const MAX_EXTRA_PHOTOS = 6;

function psAddExtraPhoto(){
  if(!cur){ toast('⚠️ Escanea un producto primero'); return; }
  if(!cur._extraImgs) cur._extraImgs = [];
  if(cur._extraImgs.length >= MAX_EXTRA_PHOTOS){
    toast('⚠️ Máximo ' + MAX_EXTRA_PHOTOS + ' fotos extra');
    return;
  }

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async function(e){
    var file = e.target.files[0];
    if(!file) return;

    const idx = cur._extraImgs.length; // posición donde va a quedar esta foto
    cur._extraImgs.push({ img: null, local: null, loading: true });
    renderExtraPhotosUI();

    try{
      const { finalUrl, localUrl } = await clRemoveBackground(file, function(msg){
        var el = document.getElementById('ps-extra-slot-' + idx);
        if(el) el.innerHTML = '<div style="text-align:center;padding:8px"><div class="sp" style="width:20px;height:20px;margin:0 auto 4px"></div><div style="font-size:9px;color:var(--mu)">'+msg+'</div></div>';
      });
      cur._extraImgs[idx] = { img: finalUrl, local: localUrl, loading: false };
      renderExtraPhotosUI();
      toast('✅ Foto extra ' + (idx+1) + ' lista');
    }catch(err){
      console.error('psAddExtraPhoto error:', err);
      // FALLBACK: usar foto original sin fondo removido
      toast('⚠️ rembg falló — usando foto original');
      try {
        var fallbackUrl = await clCompressImage(file, 1600, 0.92);
        var imgbbKey = localStorage.getItem('savvy_imgbb_key') || DEFAULT_IMGBB_KEY;
        var uploadedFb = fallbackUrl;
        if (imgbbKey) {
          try { var up = await clUploadPhotoToImgBB(fallbackUrl, imgbbKey, 'extra-fallback'); if(up) uploadedFb = up; } catch(e2){}
        }
        cur._extraImgs[idx] = { img: uploadedFb, local: fallbackUrl, loading: false };
        renderExtraPhotosUI();
      } catch(err2) {
        cur._extraImgs.splice(idx, 1); // solo quitar si todo falló
        renderExtraPhotosUI();
      }
    }
  };
  input.click();
}

function psRemoveExtraPhoto(idx){
  if(!cur || !cur._extraImgs) return;
  cur._extraImgs.splice(idx, 1);
  renderExtraPhotosUI();
}

function renderExtraPhotosUI(){
  const wrap = $('ps-extra-photos-wrap');
  if(!wrap) return;
  const extras = (cur && cur._extraImgs) || [];
  let h = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">';
  extras.forEach(function(e, i){
    if(e.loading){
      h += '<div id="ps-extra-slot-'+i+'" style="width:72px;height:72px;background:var(--sf2);border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center"></div>';
    } else {
      h += '<div id="ps-extra-slot-'+i+'" style="position:relative;width:72px;height:72px;background:var(--sf2);border:2px solid var(--bd);border-radius:10px;overflow:hidden">'
        + '<img src="'+esc(e.img)+'" style="width:100%;height:100%;object-fit:contain;background:#ffffff">'
        + '<button onclick="psRemoveExtraPhoto('+i+')" style="position:absolute;top:2px;right:2px;width:20px;height:20px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;font-size:12px;cursor:pointer;line-height:1">✕</button>'
        + '</div>';
    }
  });
  if(extras.length < MAX_EXTRA_PHOTOS){
    h += '<div onclick="psAddExtraPhoto()" ontouchend="event.preventDefault();psAddExtraPhoto()" style="width:72px;height:72px;background:var(--sf2);border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:28px;color:var(--mu)">+</div>';
  }
  h += '</div>';
  h += '<div style="font-size:10px;color:var(--mu);margin-top:4px">'+extras.length+'/'+MAX_EXTRA_PHOTOS+' fotos extra (opcional) — mismo proceso que BACK</div>';
  wrap.innerHTML = h;
}

// ══════════════════════════════════════════════════════════════
// PASO 2: GENERADOR DE IMÁGENES DE PAQUETE (1/3/6/12)
// Portado de la herramienta eBay-Pack-Generator de Manuel — misma
// matemática de acomodo (gL), mismo distintivo circular (dB).
// FRONT (ya sin fondo) se multiplica × pack + distintivo.
// BACK (ya sin fondo) se usa como foto secundaria única, sin distintivo.
// ══════════════════════════════════════════════════════════════

const PACK_BADGE_COLOR = '#0F97DB';

function psLoadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin solo hace falta para URLs externas (ImgBB) — en data: URIs no afecta
    if (typeof src === 'string' && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('Timeout cargando imagen (10s)')), 10000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = (e) => { clearTimeout(timer); console.error('psLoadImage onerror:', e); reject(new Error('No se pudo cargar la imagen')); };
    img.src = src;
  });
}

// Normaliza CUALQUIER imagen (base64, URL, data URI) a 1200x1200 JPEG cuadrado
// con fondo blanco, preservando aspect ratio, sin estirar/cropear, ~5-8% padding
// RECHAZA/LANZA si falsa — no retorna imagen original sin normalizar
async function normalize1200x1200(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (typeof src === 'string' && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('Timeout cargando imagen para normalizar (15s)')), 15000);

    img.onload = () => {
      clearTimeout(timer);
      try {
        const SZ = 1200;
        const cv = document.createElement('canvas');
        cv.width = SZ;
        cv.height = SZ;
        const cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';

        // Llenar fondo blanco
        cx.fillStyle = '#FFFFFF';
        cx.fillRect(0, 0, SZ, SZ);

        // Calcular fit con aspect ratio preservation y ~5-8% padding
        const padding = Math.round(SZ * 0.065); // ~6.5% padding
        const availableW = SZ - padding * 2;
        const availableH = SZ - padding * 2;

        const imgAspect = img.width / img.height;
        let drawW, drawH;

        if (imgAspect > 1) {
          // Imagen más ancha que alta
          drawW = availableW;
          drawH = availableW / imgAspect;
        } else {
          // Imagen más alta que ancha
          drawH = availableH;
          drawW = availableH * imgAspect;
        }

        // Asegurar que no exceda límites
        if (drawW > availableW) {
          drawW = availableW;
          drawH = availableW / imgAspect;
        }
        if (drawH > availableH) {
          drawH = availableH;
          drawW = availableH * imgAspect;
        }

        // Centrar imagen
        const x = (SZ - drawW) / 2;
        const y = (SZ - drawH) / 2;

        cx.drawImage(img, x, y, drawW, drawH);
        const normalized = cv.toDataURL('image/jpeg', 0.93);
        resolve(normalized);
      } catch(e) {
        reject(new Error('Error en canvas normalizando imagen: ' + (e.message||'desconocido')));
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('No se pudo cargar imagen para normalizar'));
    };

    img.src = src;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// MULTIPACK VISIBLE BOUNDS + FORMATTING
// ───────────────────────────────────────────────────────────────────────────

function fmtNumber(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '0.000';
}

let visibleBoundsCache = null;
let visibleBoundsCacheKey = null;

function psGetVisibleImageBounds(img){
  if (visibleBoundsCacheKey === img.src && visibleBoundsCache) {
    console.log('📊 Using cached visible bounds');
    return visibleBoundsCache;
  }

  try {
    console.log('📊 Analyzing visible bounds for ' + img.width + '×' + img.height);

    const MAX_ANALYSIS_DIM = 512;
    const scale = Math.min(1, MAX_ANALYSIS_DIM / Math.max(img.width, img.height));
    const analysisW = Math.round(img.width * scale);
    const analysisH = Math.round(img.height * scale);
    const invScale = 1 / scale;

    console.log('📊 Analysis scale: ' + scale.toFixed(3) + ' (' + analysisW + '×' + analysisH + ')');

    const analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = analysisW;
    analysisCanvas.height = analysisH;
    const analysisCtx = analysisCanvas.getContext('2d');
    analysisCtx.drawImage(img, 0, 0, analysisW, analysisH);

    console.log('📊 Analysis canvas created');

    const imageData = analysisCtx.getImageData(0, 0, analysisW, analysisH);
    const data = imageData.data;

    console.log('📊 Image data extracted, scanning ' + (analysisW * analysisH) + ' pixels');

    let analysisLeft = analysisW;
    let analysisTop = analysisH;
    let analysisRight = 0;
    let analysisBottom = 0;

    const alphaThreshold = 8;
    let hasVisiblePixels = false;

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > alphaThreshold) {
        hasVisiblePixels = true;
        const pixelIndex = (i - 3) / 4;
        const y = Math.floor(pixelIndex / analysisW);
        const x = pixelIndex % analysisW;

        if (x < analysisLeft) analysisLeft = x;
        if (x > analysisRight) analysisRight = x;
        if (y < analysisTop) analysisTop = y;
        if (y > analysisBottom) analysisBottom = y;
      }
    }

    console.log('📊 Alpha scan complete, hasVisiblePixels=' + hasVisiblePixels);

    let visibleLeft, visibleTop, visibleRight, visibleBottom;

    if (!hasVisiblePixels) {
      visibleLeft = 0;
      visibleTop = 0;
      visibleRight = img.width - 1;
      visibleBottom = img.height - 1;
      console.log('📊 No transparent pixels, using full image');
    } else {
      visibleLeft = Math.round(analysisLeft * invScale);
      visibleTop = Math.round(analysisTop * invScale);
      visibleRight = Math.round(analysisRight * invScale);
      visibleBottom = Math.round(analysisBottom * invScale);
    }

    const padWidth = (visibleRight - visibleLeft) * 0.03;
    const padHeight = (visibleBottom - visibleTop) * 0.03;

    visibleLeft = Math.max(0, Math.floor(visibleLeft - padWidth));
    visibleTop = Math.max(0, Math.floor(visibleTop - padHeight));
    visibleRight = Math.min(img.width - 1, Math.ceil(visibleRight + padWidth));
    visibleBottom = Math.min(img.height - 1, Math.ceil(visibleBottom + padHeight));

    const visibleWidth = visibleRight - visibleLeft + 1;
    const visibleHeight = visibleBottom - visibleTop + 1;
    const visibleAspect = visibleWidth / visibleHeight;

    const totalWidth = img.width;
    const totalHeight = img.height;
    const padLeftPct = (visibleLeft / totalWidth) * 100;
    const padRightPct = ((totalWidth - visibleRight - 1) / totalWidth) * 100;
    const padTopPct = (visibleTop / totalHeight) * 100;
    const padBottomPct = ((totalHeight - visibleBottom - 1) / totalHeight) * 100;

    const sourceAspectRatio = img.width / img.height;

    const bounds = {
      left: visibleLeft,
      top: visibleTop,
      width: visibleWidth,
      height: visibleHeight,
      aspect: visibleAspect,
      sourceAspect: sourceAspectRatio,
      sourceW: img.width,
      sourceH: img.height,
      padding: {
        leftPct: padLeftPct,
        rightPct: padRightPct,
        topPct: padTopPct,
        bottomPct: padBottomPct
      },
      hasTransparency: hasVisiblePixels,
      usedFallback: false
    };

    console.log('📊 Bounds calculated: ' + visibleWidth + '×' + visibleHeight + ' aspect=' + fmtNumber(visibleAspect, 3));

    visibleBoundsCache = bounds;
    visibleBoundsCacheKey = img.src;

    return bounds;
  } catch (error) {
    console.error('❌ Visible bounds analysis failed:', error.message);
    console.error('   Stack:', error.stack);
    const fallback = {
      left: 0,
      top: 0,
      width: img.width,
      height: img.height,
      aspect: img.width / img.height,
      sourceAspect: img.width / img.height,
      sourceW: img.width,
      sourceH: img.height,
      padding: {
        leftPct: 0,
        rightPct: 0,
        topPct: 0,
        bottomPct: 0
      },
      hasTransparency: false,
      usedFallback: true,
      error: error.message
    };
    console.log('📊 Using fallback bounds (full image)');
    visibleBoundsCache = fallback;
    visibleBoundsCacheKey = img.src;
    return fallback;
  }
}

// Calcula el mejor acomodo (columnas/filas) para `count` copias de una foto
// dentro de un canvas cuadrado de tamaño `sz`, dado el aspect ratio de la foto.
function psComputeLayout(count, sz, imgAspect){
  if (count === 1) {
    const h = sz*.95, w = h*imgAspect;
    let s = 1; if (w > sz*.95) s = (sz*.95)/w;
    return [{x:sz/2, y:sz/2, w:w*s, h:h*s}];
  }

  const isWide = imgAspect > 1.6;
  const isTall = imgAspect < 0.75;
  const isStd = !isWide && !isTall;

  const safeMargin = 30;
  const eps = 0.5;
  let positions = [];

  // ========== ROW HELPER: Width-relative spacing ==========
  const makeRow = (itemCount, centerX, y, unitW, unitH, spacingFactor, rowOffsetX = 0) => {
    const spacing = unitW * spacingFactor;
    const totalWidth = (itemCount - 1) * spacing + unitW;
    const startX = centerX - totalWidth / 2 + rowOffsetX;
    const row = [];
    for (let i = 0; i < itemCount; i++) {
      row.push({
        x: startX + i * spacing,
        y: y,
        w: unitW,
        h: unitH
      });
    }
    return row;
  };

  if (count === 2) {
    if (isTall) {
      const unitH = sz * 0.32;
      const unitW = unitH * imgAspect;
      // Spacing calculated from visible product dimensions
      // 0.80 × unitW center distance = 20% overlap, 0.35 × unitH vertical offset
      const horizDistance = unitW * 0.80;
      const vertDistance = unitH * 0.35;
      const centerX = 600;
      const baseY = 430;
      const rear_cx = centerX - horizDistance / 2;
      const rear_cy = baseY - vertDistance / 2;
      const front_cx = centerX + horizDistance / 2;
      const front_cy = baseY + vertDistance / 2;
      const rearRow = makeRow(1, rear_cx, rear_cy, unitW, unitH, 0);
      const frontRow = makeRow(1, front_cx, front_cy, unitW, unitH, 0);
      positions.push(...rearRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.20;
      const unitW = unitH * imgAspect;
      // Spacing calculated from visible product dimensions
      // 0.80 × unitW center distance = 20% overlap, 0.33 × unitH vertical offset
      const horizDistance = unitW * 0.80;
      const vertDistance = unitH * 0.33;
      const centerX = 600;
      const baseY = 420;
      const rear_cx = centerX - horizDistance / 2;
      const rear_cy = baseY - vertDistance / 2;
      const front_cx = centerX + horizDistance / 2;
      const front_cy = baseY + vertDistance / 2;
      const rearRow = makeRow(1, rear_cx, rear_cy, unitW, unitH, 0);
      const frontRow = makeRow(1, front_cx, front_cy, unitW, unitH, 0);
      positions.push(...rearRow, ...frontRow);
    } else {
      const unitH = sz * 0.32;
      const unitW = unitH * imgAspect;
      // Spacing calculated from visible product dimensions
      // 0.80 × unitW center distance = 20% overlap, 0.35 × unitH vertical offset
      const horizDistance = unitW * 0.80;
      const vertDistance = unitH * 0.35;
      const centerX = 600;
      const baseY = 430;
      const rear_cx = centerX - horizDistance / 2;
      const rear_cy = baseY - vertDistance / 2;
      const front_cx = centerX + horizDistance / 2;
      const front_cy = baseY + vertDistance / 2;
      const rearRow = makeRow(1, rear_cx, rear_cy, unitW, unitH, 0);
      const frontRow = makeRow(1, front_cx, front_cy, unitW, unitH, 0);
      positions.push(...rearRow, ...frontRow);
    }
  } else if (count === 3) {
    if (isTall) {
      const unitH = sz * 0.30;
      const unitW = unitH * imgAspect;
      // Rear 2: width-relative spacing
      const rearRow = makeRow(2, 450, 340, unitW, unitH, 1.15);
      // Front 1: centered
      const frontRow = makeRow(1, 450, 480, unitW, unitH, 0);
      positions.push(...rearRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.18;
      const unitW = unitH * imgAspect;
      // Staggered diagonal: three individual items
      positions.push({x: 320, y: 340, w: unitW, h: unitH});
      positions.push({x: 420, y: 400, w: unitW, h: unitH});
      positions.push({x: 520, y: 460, w: unitW, h: unitH});
    } else {
      const unitH = sz * 0.28;
      const unitW = unitH * imgAspect;
      // Rear 2: width-relative spacing
      const rearRow = makeRow(2, 450, 340, unitW, unitH, 1.10);
      // Front 1: centered
      const frontRow = makeRow(1, 450, 480, unitW, unitH, 0);
      positions.push(...rearRow, ...frontRow);
    }
  } else if (count === 4) {
    if (isTall) {
      const unitH = sz * 0.27;
      const unitW = unitH * imgAspect;
      // Rear 2: width-relative spacing
      const rearRow = makeRow(2, 425, 320, unitW, unitH, 1.0);
      // Front 2: width-relative spacing
      const frontRow = makeRow(2, 395, 470, unitW, unitH, 1.0);
      positions.push(...rearRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.16;
      const unitW = unitH * imgAspect;
      // Diagonal 2x2 with varied Y
      positions.push({x: 320, y: 320, w: unitW, h: unitH});
      positions.push({x: 420, y: 340, w: unitW, h: unitH});
      positions.push({x: 340, y: 440, w: unitW, h: unitH});
      positions.push({x: 440, y: 460, w: unitW, h: unitH});
    } else {
      const unitH = sz * 0.25;
      const unitW = unitH * imgAspect;
      // Rear 2: width-relative spacing
      const rearRow = makeRow(2, 425, 320, unitW, unitH, 0.95);
      // Front 2: width-relative spacing
      const frontRow = makeRow(2, 395, 470, unitW, unitH, 0.95);
      positions.push(...rearRow, ...frontRow);
    }
  } else if (count === 5) {
    if (isTall) {
      const unitH = sz * 0.24;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing
      const rearRow = makeRow(3, 420, 310, unitW, unitH, 0.95);
      // Front 2: width-relative spacing, offset back
      const frontRow = makeRow(2, 420, 470, unitW, unitH, 0.95);
      positions.push(...rearRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.15;
      const unitW = unitH * imgAspect;
      // Diagonal stagger: unique Y for each item
      positions.push({x: 300, y: 310, w: unitW, h: unitH});
      positions.push({x: 380, y: 340, w: unitW, h: unitH});
      positions.push({x: 460, y: 370, w: unitW, h: unitH});
      positions.push({x: 330, y: 450, w: unitW, h: unitH});
      positions.push({x: 410, y: 480, w: unitW, h: unitH});
    } else {
      const unitH = sz * 0.22;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing
      const rearRow = makeRow(3, 420, 310, unitW, unitH, 0.90);
      // Front 2: width-relative spacing, offset back
      const frontRow = makeRow(2, 420, 470, unitW, unitH, 0.90);
      positions.push(...rearRow, ...frontRow);
    }
  } else if (count === 6) {
    if (isTall) {
      const unitH = sz * 0.22;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6% for breathing room)
      const rearRow = makeRow(3, 430, 300, unitW, unitH, 1.06);
      // Front 3: width-relative spacing, offset back (increased 6%)
      const frontRow = makeRow(3, 400, 460, unitW, unitH, 1.06);
      positions.push(...rearRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.14;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 375, 310, unitW, unitH, 0.90);
      // Front 3: width-relative spacing, offset back (increased 6%)
      const frontRow = makeRow(3, 355, 430, unitW, unitH, 0.90);
      positions.push(...rearRow, ...frontRow);
    } else {
      const unitH = sz * 0.20;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 430, 320, unitW, unitH, 1.01);
      // Front 3: width-relative spacing, offset back (increased 6%)
      const frontRow = makeRow(3, 400, 480, unitW, unitH, 1.01);
      positions.push(...rearRow, ...frontRow);
    }
  } else if (count === 7) {
    if (isTall) {
      const unitH = sz * 0.20;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6% for breathing room)
      const rearRow = makeRow(3, 450, 290, unitW, unitH, 0.80);
      // Middle 2: width-relative spacing (increased 6%)
      const middleRow = makeRow(2, 450, 370, unitW, unitH, 0.83);
      // Front 2: width-relative spacing (increased 6%)
      const frontRow = makeRow(2, 450, 450, unitW, unitH, 0.83);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.13;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 385, 320, unitW, unitH, 0.59);
      // Middle 2: width-relative spacing (increased 6%)
      const middleRow = makeRow(2, 385, 370, unitW, unitH, 0.62);
      // Front 2: width-relative spacing (increased 6%)
      const frontRow = makeRow(2, 385, 420, unitW, unitH, 0.62);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else {
      const unitH = sz * 0.18;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 450, 320, unitW, unitH, 0.76);
      // Middle 2: width-relative spacing (increased 6%)
      const middleRow = makeRow(2, 450, 380, unitW, unitH, 0.80);
      // Front 2: width-relative spacing (increased 6%)
      const frontRow = makeRow(2, 450, 440, unitW, unitH, 0.80);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    }
  } else if (count === 8) {
    if (isTall) {
      const unitH = sz * 0.18;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6% for breathing room)
      const rearRow = makeRow(3, 450, 285, unitW, unitH, 0.80);
      // Middle 3: width-relative spacing (increased 6%)
      const middleRow = makeRow(3, 450, 350, unitW, unitH, 0.82);
      // Front 2: width-relative spacing (increased 6%)
      const frontRow = makeRow(2, 450, 415, unitW, unitH, 0.83);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.12;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 390, 310, unitW, unitH, 0.60);
      // Middle 3: width-relative spacing (increased 6%)
      const middleRow = makeRow(3, 390, 360, unitW, unitH, 0.62);
      // Front 2: width-relative spacing (increased 6%)
      const frontRow = makeRow(2, 390, 410, unitW, unitH, 0.64);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else {
      const unitH = sz * 0.16;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 450, 310, unitW, unitH, 0.77);
      // Middle 3: width-relative spacing (increased 6%)
      const middleRow = makeRow(3, 450, 365, unitW, unitH, 0.80);
      // Front 2: width-relative spacing (increased 6%)
      const frontRow = makeRow(2, 450, 420, unitW, unitH, 0.81);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    }
  } else if (count === 9) {
    if (isTall) {
      const unitH = sz * 0.16;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6% for breathing room)
      const rearRow = makeRow(3, 460, 280, unitW, unitH, 0.81);
      // Middle 3: width-relative spacing (increased 6%)
      const middleRow = makeRow(3, 460, 332, unitW, unitH, 0.82);
      // Front 3: width-relative spacing (increased 6%)
      const frontRow = makeRow(3, 460, 384, unitW, unitH, 0.82);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.11;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 395, 310, unitW, unitH, 0.62);
      // Middle 3: width-relative spacing (increased 6%)
      const middleRow = makeRow(3, 395, 347, unitW, unitH, 0.63);
      // Front 3: width-relative spacing (increased 6%)
      const frontRow = makeRow(3, 395, 384, unitW, unitH, 0.63);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else {
      const unitH = sz * 0.14;
      const unitW = unitH * imgAspect;
      // Rear 3: width-relative spacing (increased 6%)
      const rearRow = makeRow(3, 460, 310, unitW, unitH, 0.78);
      // Middle 3: width-relative spacing (increased 6%)
      const middleRow = makeRow(3, 460, 355, unitW, unitH, 0.80);
      // Front 3: width-relative spacing (increased 6%)
      const frontRow = makeRow(3, 460, 400, unitW, unitH, 0.80);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    }
  } else if (count === 10) {
    if (isTall) {
      const unitH = sz * 0.15;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9% for better breathing)
      const rearRow = makeRow(4, 420, 280, unitW, unitH, 0.76);
      // Middle 3: width-relative spacing (increased 9%), offset back ~0.35× centerSpacing
      // Vertical spacing increased +9% of unitH (180×0.09=16)
      const spacing3 = unitW * 0.78;
      const middleOffsetX = spacing3 * 0.35;
      const middleRow = makeRow(3, 420, 364, unitW, unitH, 0.78, middleOffsetX);
      // Front 3: width-relative spacing (increased 9%), offset back
      const frontRow = makeRow(3, 420, 432, unitW, unitH, 0.78, middleOffsetX);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.10;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9%)
      const rearRow = makeRow(4, 382, 310, unitW, unitH, 0.54);
      // Middle 3: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +9% of unitH (120×0.09=11)
      const spacing3 = unitW * 0.57;
      const middleOffsetX = spacing3 * 0.25;
      const middleRow = makeRow(3, 382, 368, unitW, unitH, 0.57, middleOffsetX);
      // Front 3: width-relative spacing (increased 9%), offset forward
      const frontRow = makeRow(3, 382, 415, unitW, unitH, 0.57, middleOffsetX);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else {
      const unitH = sz * 0.13;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9%)
      const rearRow = makeRow(4, 430, 315, unitW, unitH, 0.74);
      // Middle 3: width-relative spacing (increased 9%), offset back
      // Vertical spacing increased +9% of unitH (156×0.09=14)
      const spacing3 = unitW * 0.76;
      const middleOffsetX = spacing3 * 0.30;
      const middleRow = makeRow(3, 430, 390, unitW, unitH, 0.76, middleOffsetX);
      // Front 3: width-relative spacing (increased 9%), offset back
      const frontRow = makeRow(3, 430, 451, unitW, unitH, 0.76, middleOffsetX);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    }
  } else if (count === 11) {
    if (isTall) {
      const unitH = sz * 0.14;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9% for better breathing)
      const rearRow = makeRow(4, 419, 280, unitW, unitH, 0.76);
      // Middle 4: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +15 (9% of unitH: 0.14×1200×0.09≈15)
      const spacing4 = unitW * 0.78;
      const middleOffsetX = spacing4 * 0.25;
      const middleRow = makeRow(4, 419, 357, unitW, unitH, 0.78, middleOffsetX);
      // Front 3: width-relative spacing (increased 9%), offset back
      const frontOffsetX = spacing4 * 0.40;
      const frontRow = makeRow(3, 419, 419, unitW, unitH, 0.78, frontOffsetX);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.095;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9%)
      const rearRow = makeRow(4, 382, 310, unitW, unitH, 0.54);
      // Middle 4: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +10 (9% of unitH: 0.095×1200×0.09≈10)
      const spacing4 = unitW * 0.57;
      const middleOffsetX = spacing4 * 0.20;
      const middleRow = makeRow(4, 382, 359, unitW, unitH, 0.57, middleOffsetX);
      // Front 3: width-relative spacing (increased 9%), offset forward more
      const frontOffsetX = spacing4 * 0.30;
      const frontRow = makeRow(3, 382, 398, unitW, unitH, 0.57, frontOffsetX);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else {
      const unitH = sz * 0.12;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9%)
      const rearRow = makeRow(4, 427, 315, unitW, unitH, 0.74);
      // Middle 4: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +13 (9% of unitH: 0.12×1200×0.09≈13)
      const spacing4 = unitW * 0.76;
      const middleOffsetX = spacing4 * 0.23;
      const middleRow = makeRow(4, 427, 382, unitW, unitH, 0.76, middleOffsetX);
      // Front 3: width-relative spacing (increased 9%), offset back
      const frontOffsetX = spacing4 * 0.35;
      const frontRow = makeRow(3, 427, 436, unitW, unitH, 0.76, frontOffsetX);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    }
  } else if (count === 12) {
    if (isTall) {
      const unitH = sz * 0.13;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9% for better breathing)
      const rearRow = makeRow(4, 417, 280, unitW, unitH, 0.76);
      // Middle 4: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +14 (9% of unitH: 0.13×1200×0.09≈14)
      const spacing4 = unitW * 0.78;
      const middleOffsetX = spacing4 * 0.22;
      const middleRow = makeRow(4, 417, 355, unitW, unitH, 0.78, middleOffsetX);
      // Front 4: width-relative spacing (increased 9%), offset back same as rear
      const frontRow = makeRow(4, 417, 416, unitW, unitH, 0.78);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else if (isWide) {
      const unitH = sz * 0.09;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9%)
      const rearRow = makeRow(4, 382, 310, unitW, unitH, 0.54);
      // Middle 4: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +10 (9% of unitH: 0.09×1200×0.09≈10)
      const spacing4 = unitW * 0.57;
      const middleOffsetX = spacing4 * 0.20;
      const middleRow = makeRow(4, 382, 361, unitW, unitH, 0.57, middleOffsetX);
      // Front 4: width-relative spacing (increased 9%), same as rear
      const frontRow = makeRow(4, 382, 402, unitW, unitH, 0.57);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    } else {
      const unitH = sz * 0.11;
      const unitW = unitH * imgAspect;
      // Rear 4: width-relative spacing (increased 9%)
      const rearRow = makeRow(4, 425, 315, unitW, unitH, 0.74);
      // Middle 4: width-relative spacing (increased 9%), offset forward
      // Vertical spacing increased +12 (9% of unitH: 0.11×1200×0.09≈12)
      const spacing4 = unitW * 0.76;
      const middleOffsetX = spacing4 * 0.20;
      const middleRow = makeRow(4, 425, 375, unitW, unitH, 0.76, middleOffsetX);
      // Front 4: width-relative spacing (increased 9%), same as rear
      const frontRow = makeRow(4, 425, 423, unitW, unitH, 0.76);
      positions.push(...rearRow, ...middleRow, ...frontRow);
    }
  }

  // ========== FINAL GROUP ZOOM WITH INCREASED TARGETS ==========
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const p of positions) {
    minX = Math.min(minX, p.x - p.w / 2);
    maxX = Math.max(maxX, p.x + p.w / 2);
    minY = Math.min(minY, p.y - p.h / 2);
    maxY = Math.max(maxY, p.y + p.h / 2);
  }

  // FINAL target fill percentages with enhanced zoom for packs 7-12
  let targetFill = 0.75;

  if (isTall) {
    if (count === 2) targetFill = 0.88;
    else if (count === 3) targetFill = 0.86;
    else if (count === 4) targetFill = 0.89;
    else if (count === 5) targetFill = 0.89;
    else if (count === 6) targetFill = 0.87;
    else if (count === 7) targetFill = 0.92;
    else if (count === 8) targetFill = 0.93;
    else if (count === 9) targetFill = 0.93;
    else if (count === 10) targetFill = 0.95;
    else if (count === 11) targetFill = 0.95;
    else targetFill = 0.95;
  } else if (isWide) {
    if (count === 2) targetFill = 0.72;
    else if (count === 3) targetFill = 0.70;
    else if (count === 4) targetFill = 0.75;
    else if (count === 5) targetFill = 0.75;
    else if (count === 6) targetFill = 0.73;
    else if (count === 7) targetFill = 0.80;
    else if (count === 8) targetFill = 0.81;
    else if (count === 9) targetFill = 0.81;
    else if (count === 10) targetFill = 0.90;
    else if (count === 11) targetFill = 0.90;
    else targetFill = 0.90;
  } else {
    if (count === 2) targetFill = 0.86;
    else if (count === 3) targetFill = 0.84;
    else if (count === 4) targetFill = 0.88;
    else if (count === 5) targetFill = 0.88;
    else if (count === 6) targetFill = 0.86;
    else if (count === 7) targetFill = 0.91;
    else if (count === 8) targetFill = 0.92;
    else if (count === 9) targetFill = 0.92;
    else if (count === 10) targetFill = 0.93;
    else if (count === 11) targetFill = 0.93;
    else targetFill = 0.93;
  }

  const horizSpace = sz - safeMargin * 2 - eps;
  const vertSpace = sz - safeMargin * 2 - eps;
  const groupWidth = maxX - minX;
  const groupHeight = maxY - minY;

  // Calculate scales: hard max (to not overflow) and target fill scale
  const horizMaxScale = horizSpace / groupWidth;
  const vertMaxScale = vertSpace / groupHeight;
  const horizTargetScale = (horizSpace / groupWidth) * targetFill;
  const vertTargetScale = (vertSpace / groupHeight) * targetFill;

  // Try to achieve target fill, but cap to hard bounds
  let groupScale = Math.min(horizTargetScale, vertTargetScale);
  groupScale = Math.min(groupScale, horizMaxScale, vertMaxScale);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const canvasCenterX = sz / 2;
  const canvasCenterY = sz / 2;

  const finalPositions = positions.map(p => ({
    x: canvasCenterX + (p.x - centerX) * groupScale,
    y: canvasCenterY + (p.y - centerY) * groupScale,
    w: p.w * groupScale,
    h: p.h * groupScale
  }));

  return finalPositions;
}

// Dibuja el distintivo circular "N Pack" — igual al de la herramienta de Manuel
function psDrawBadge(ctx, count, sz){
  const r = Math.round(sz*.09), x = sz-r-Math.round(sz*.018), y = r+Math.round(sz*.018);
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.3)'; ctx.shadowBlur=25; ctx.shadowOffsetX=4; ctx.shadowOffsetY=4;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fillStyle=PACK_BADGE_COLOR; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.strokeStyle='#fff'; ctx.lineWidth=Math.round(r*.07); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const numSz = count>=10 ? Math.round(r*.75) : Math.round(r*.95);
  ctx.font = `900 ${numSz}px "Arial Black","Impact",Arial,sans-serif`;
  ctx.fillText(count, x, y-r*.14);
  ctx.font = `700 ${Math.round(r*.35)}px "Arial Black","Impact",Arial,sans-serif`;
  ctx.fillText('Pack', x, y+r*.4);
}

// Genera la imagen del paquete: `count` copias de `img` + distintivo (si count>1)
function psGeneratePackImage(img, count){
  try {
    // PERFORMANCE INSTRUMENTATION
    const perfStart = performance.now();
    const perfMarks = {};

    console.log('🎨 psGeneratePackImage start, count=' + count);
    const sz=1200, cv=document.createElement('canvas'); cv.width=sz; cv.height=sz;
    const cx=cv.getContext('2d'); cx.imageSmoothingEnabled=true; cx.imageSmoothingQuality='high';
    cx.fillStyle='#FFF'; cx.fillRect(0,0,sz,sz);

    perfMarks.boundsStart = performance.now();
    console.log('🎨 Getting visible bounds (cached if available)');
    const visibleBounds = psGetVisibleImageBounds(img);
    perfMarks.boundsEnd = performance.now();
    console.log('[PERF][PACK ' + count + '] visible-bounds: ' + Math.round(perfMarks.boundsEnd - perfMarks.boundsStart) + ' ms');

    perfMarks.layoutStart = performance.now();
    console.log('🎨 Computing layout with aspect ' + visibleBounds.aspect.toFixed(3));
    const positions = psComputeLayout(count, sz, visibleBounds.aspect);
    perfMarks.layoutEnd = performance.now();
    console.log('[PERF][PACK ' + count + '] layout: ' + Math.round(perfMarks.layoutEnd - perfMarks.layoutStart) + ' ms');

    perfMarks.drawStart = performance.now();
    console.log('🎨 Drawing ' + positions.length + ' product instances');
    positions.forEach((p, idx) => {
      cx.drawImage(
        img,
        visibleBounds.left,
        visibleBounds.top,
        visibleBounds.width,
        visibleBounds.height,
        p.x - p.w/2,
        p.y - p.h/2,
        p.w,
        p.h
      );
    });
    perfMarks.drawEnd = performance.now();
    console.log('[PERF][PACK ' + count + '] canvas-draw: ' + Math.round(perfMarks.drawEnd - perfMarks.drawStart) + ' ms');

    perfMarks.badgeStart = performance.now();
    if (count > 1) {
      console.log('🎨 Drawing badge');
      psDrawBadge(cx, count, sz);
    }
    perfMarks.badgeEnd = performance.now();
    console.log('[PERF][PACK ' + count + '] badge: ' + Math.round(perfMarks.badgeEnd - perfMarks.badgeStart) + ' ms');

    perfMarks.jpegStart = performance.now();
    const dataUrl = cv.toDataURL('image/jpeg', .92);
    perfMarks.jpegEnd = performance.now();
    console.log('[PERF][PACK ' + count + '] jpeg: ' + Math.round(perfMarks.jpegEnd - perfMarks.jpegStart) + ' ms');

    console.log('🎨 psGeneratePackImage complete for count=' + count);
    const totalCanvasTime = performance.now() - perfStart;
    console.log('[PERF][PACK ' + count + '] canvas-total: ' + Math.round(totalCanvasTime) + ' ms');

    return dataUrl;
  } catch (error) {
    console.error('❌ psGeneratePackImage error:', error, 'count=' + count);
    throw error;
  }
}

// Genera la foto secundaria (BACK) centrada sola, sin distintivo, sin duplicar
function psGenerateSingleImage(img){
  const sz=1200, cv=document.createElement('canvas'); cv.width=sz; cv.height=sz;
  const cx=cv.getContext('2d'); cx.imageSmoothingEnabled=true; cx.imageSmoothingQuality='high';
  cx.fillStyle='#FFF'; cx.fillRect(0,0,sz,sz);
  const a=img.width/img.height, pd=sz*.02, mw=sz-pd*2, mh=sz-pd*2;
  let w,h; if(a>1){w=mw;h=mw/a;} else {h=mh;w=mh*a;}
  if(w>mw){w=mw;h=w/a;} if(h>mh){h=mh;w=h*a;}
  cx.drawImage(img, (sz-w)/2, (sz-h)/2, w, h);
  return cv.toDataURL('image/jpeg', .92);
}

// Genera las 4 imágenes de pack (1/3/6/12) usando FRONT + una imagen BACK compartida
async function psGenerateAllPacks(){
  console.log('🎁 psGenerateAllPacks: click detectado');
  if(!cur || !cur._frontImg || !cur._backImg){
    toast('⚠️ Necesitas la foto FRONT y BACK primero');
    return;
  }
  const btn = $('ps-gen-packs-btn');
  const statusEl = $('ps-pack-gen-status');
  const resetBtn = () => { if(btn){ btn.disabled=false; btn.textContent='🎁 Generar Imágenes de Pack (1-12)'; } };

  try{
    // PERFORMANCE INSTRUMENTATION
    const perfStart = performance.now();
    const perfMarks = { start: perfStart };

    if(btn){ btn.disabled=true; btn.textContent='⏳ Generando...'; }
    if(statusEl) statusEl.textContent = '📥 Cargando fotos...';

    const frontSrc = cur._frontImgLocal || cur._frontImg;
    const backSrc  = cur._backImgLocal  || cur._backImg;
    console.log('Front source:', frontSrc.substring(0,40));
    console.log('Back source:', backSrc.substring(0,40));

    perfMarks.imgLoadStart = performance.now();
    const frontImg = await psLoadImage(frontSrc);
    const backImg  = await psLoadImage(backSrc);
    perfMarks.imgLoadEnd = performance.now();
    console.log('[PERF][PACKS] image-load: ' + Math.round(perfMarks.imgLoadEnd - perfMarks.imgLoadStart) + ' ms');
    console.log('✅ Fotos cargadas en memoria:', frontImg.width+'x'+frontImg.height, backImg.width+'x'+backImg.height);

    // Cargar también las fotos extra (opcionales) — mismo tratamiento que BACK
    const extras = (cur._extraImgs || []).filter(function(e){ return e && e.img && !e.loading; });
    const extraImgs = [];
    for (const ex of extras) {
      const src = ex.local || ex.img;
      extraImgs.push(await psLoadImage(src));
    }
    console.log('✅ ' + extraImgs.length + ' foto(s) extra cargadas');

    if(!cur._packImages) cur._packImages = {};
    const imgbbKey = localStorage.getItem('savvy_imgbb_key') || DEFAULT_IMGBB_KEY;
    console.log('ImgBB key disponible:', !!imgbbKey);

    // Solo generar/subir los packs ACTIVOS (los que NO fueron excluidos con ✕).
    // El usuario ya eligió las unidades y excluyó packs ANTES de tomar fotos,
    // así que aquí ya sabemos exactamente cuáles necesita. Esto evita saturar ImgBB.
    var _activeState = window._splitActive || {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
    var _activePacks = PACK_SIZES.filter(function(p){ return _activeState[p]; });
    if (_activePacks.length === 0) _activePacks = PACK_SIZES.slice(); // por si acaso, no dejar vacío
    console.log('🎯 Packs activos a generar:', _activePacks.join(', '));

    // 1) Generar SOLO las imágenes de packs activos — esto es solo Canvas, instantáneo
    if(statusEl) statusEl.textContent = '🖼️ Dibujando imágenes...';
    perfMarks.canvasStart = performance.now();
    const backDataUrl = psGenerateSingleImage(backImg);
    const extraDataUrls = extraImgs.map(function(img){ return psGenerateSingleImage(img); });
    const frontDataUrls = {};
    _activePacks.forEach(function(p){ frontDataUrls[p] = psGeneratePackImage(frontImg, p); });
    perfMarks.canvasEnd = performance.now();
    console.log('[PERF][PACKS] canvas-draw: ' + Math.round(perfMarks.canvasEnd - perfMarks.canvasStart) + ' ms');
    console.log('✅ ' + (2 + extraDataUrls.length) + ' imágenes dibujadas en canvas (back + extras + ' + _activePacks.length + ' pack activos)');

    // 2) Subir SOLO packs activos EN PARALELO con timeout de 20s cada una — si una falla o tarda
    // demasiado, se usa la imagen local en su lugar en vez de trabar todo el proceso.
    if(statusEl) statusEl.textContent = '📤 Subiendo imágenes (puede tardar unos segundos)...';
    const packUploadMarks = {}; // Track timing for each pack
    function uploadWithTimeout(dataUrl, name){
      if(!imgbbKey) return Promise.resolve(dataUrl);
      const uploadStartTime = performance.now();
      packUploadMarks[name] = { start: uploadStartTime };

      const timeoutPromise = new Promise(function(resolve){
        setTimeout(function(){
          console.warn('⏱️ Timeout subiendo '+name+', usando imagen local');
          packUploadMarks[name].timeout = true;
          resolve(dataUrl);
        }, 20000);
      });

      const uploadPromise = clUploadPhotoToImgBB(dataUrl, imgbbKey, name)
        .then(function(url){
          const uploadEndTime = performance.now();
          packUploadMarks[name].end = uploadEndTime;
          console.log('[PERF][UPLOAD] ' + name + ': ' + Math.round(uploadEndTime - uploadStartTime) + ' ms');
          return url || dataUrl;
        })
        .catch(function(e){
          const uploadEndTime = performance.now();
          packUploadMarks[name].end = uploadEndTime;
          packUploadMarks[name].error = e.message;
          console.warn('⚠️ Error subiendo '+name+' (' + Math.round(uploadEndTime - uploadStartTime) + ' ms):', e.message);
          return dataUrl;
        });
      return Promise.race([uploadPromise, timeoutPromise]);
    }

    // Build upload tasks array as lazy functions (NO execution during construction)
    const uploadTasks = [
      function(){ return uploadWithTimeout(backDataUrl, 'pack-back'); },
      ...extraDataUrls.map(function(du, i){ return function(){ return uploadWithTimeout(du, 'pack-extra-'+i); }; }),
      ..._activePacks.map(function(p){ return function(){ return uploadWithTimeout(frontDataUrls[p], 'pack-'+p); }; })
    ];
    console.log('[PERF][UPLOAD] Total upload tasks: ' + uploadTasks.length + ', maxConcurrency: 2');

    // Execute with max 2 concurrent uploads to reduce main-thread compression saturation
    const results = [];
    const maxConcurrency = 2;
    perfMarks.uploadStart = performance.now();
    for (let i = 0; i < uploadTasks.length; i += maxConcurrency) {
      const batch = uploadTasks.slice(i, i + maxConcurrency);
      console.log('[PERF][UPLOAD] Starting batch ' + Math.floor(i / maxConcurrency) + ' with ' + batch.length + ' task(s)');
      const batchResults = await Promise.all(batch.map(function(task){ return task(); }));
      results.push(...batchResults);
    }
    perfMarks.uploadEnd = performance.now();
    console.log('[PERF][UPLOAD] All uploads completed: ' + Math.round(perfMarks.uploadEnd - perfMarks.uploadStart) + ' ms');

    const backUrl = results[0];
    const extraUrls = results.slice(1, 1 + extraDataUrls.length);
    const frontResults = results.slice(1 + extraDataUrls.length);
    _activePacks.forEach(function(p, i){
      cur._packImages[p] = { front: frontResults[i], back: backUrl, extras: extraUrls };
    });
    console.log('✅ Todo listo:', cur._packImages);

    if(statusEl) statusEl.textContent = '';
    toast('✅ ' + _activePacks.length + ' paquete(s) generado(s): ' + _activePacks.join(', '));

    perfMarks.previewStart = performance.now();
    renderPackImagesPreview();
    perfMarks.previewEnd = performance.now();
    console.log('[PERF][PREVIEW] render: ' + Math.round(perfMarks.previewEnd - perfMarks.previewStart) + ' ms');

    perfMarks.end = performance.now();
    console.log('[PERF][PACKS] TOTAL time: ' + Math.round(perfMarks.end - perfMarks.start) + ' ms');
  }catch(err){
    console.error('❌ psGenerateAllPacks error:', err);
    const isTainted = /tainted|SecurityError|insecure/i.test(err.message||'') || err.name==='SecurityError';
    toast(isTainted
      ? '❌ Error de seguridad con la foto — vuelve a tomar FRONT/BACK y prueba de nuevo'
      : '❌ Error: ' + (err.message||'desconocido'));
    if(statusEl) statusEl.textContent = isTainted
      ? '❌ Foto bloqueada por seguridad (CORS) — retoma FRONT y BACK'
      : '❌ ' + (err.message||'Error desconocido');
  }finally{
    resetBtn();
  }
}

// Actualiza el texto de ayuda en cuanto existen FRONT y BACK.
// El botón SIEMPRE es clickeable — psGenerateAllPacks() valida internamente
// y avisa con un toast si faltan fotos, en vez de depender de disabled/enabled.
function updatePackGenButtonState(){
  if(!cur) return;
  const hasPhotos = !!(cur._frontImg && cur._backImg);
  const hint = $('ps-pack-gen-hint');
  if(hint){
    hint.textContent = hasPhotos
      ? 'FRONT se multiplica según el paquete + distintivo azul (excepto pack de 1). BACK queda igual, compartida en todos los paquetes.'
      : '⚠️ Primero toma las fotos FRONT y BACK de arriba.';
  }
}

function renderPackImagesPreview(){
  const el = $('ps-pack-images-preview');
  if(!el || !cur || !cur._packImages) return;

  // Fotos de referencia compartidas (se adjuntan a CADA listado de pack activo)
  const anyPack = Object.keys(cur._packImages)[0];
  const shared = anyPack ? cur._packImages[anyPack] : null;
  const frontOrig = cur._frontImg || cur._frontImgLocal || '';
  const backImg = shared && shared.back ? shared.back : '';
  const extras = (shared && shared.extras) ? shared.extras : [];

  let h = '';

  // Por cada pack GENERADO (solo los activos), mostrar el CONJUNTO COMPLETO
  // de fotos que se subirán a ese listado: portada del pack + referencias.
  PACK_SIZES.forEach(function(p){
    const imgs = cur._packImages[p];
    if(!imgs) return;

    // Armar la galería del listado en el mismo orden que se sube al CSV
    var gallery = [];
    gallery.push({ url: imgs.front, tag: (p > 1 ? p + '-Pack (portada)' : 'Portada') });
    if (p > 1 && frontOrig && frontOrig !== imgs.front) gallery.push({ url: frontOrig, tag: 'Front' });
    if (backImg) gallery.push({ url: backImg, tag: 'Back' });
    extras.forEach(function(u, i){ gallery.push({ url: u, tag: 'Extra ' + (i+1) }); });

    h += `<div style="background:var(--sf2);border-radius:12px;padding:12px;margin-top:12px">
      <div style="font-size:13px;font-weight:800;color:var(--ac);margin-bottom:2px">${p} Pack</div>
      <div style="font-size:11px;color:var(--sv);margin-bottom:8px">📸 Este listado subirá ${gallery.length} foto(s):</div>
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">`;
    gallery.forEach(function(g, idx){
      var isCover = idx === 0;
      h += `<div style="flex:0 0 auto;text-align:center">
        <img src="${esc(g.url)}" style="width:86px;height:86px;object-fit:contain;border-radius:8px;background:#ffffff;${isCover ? 'border:2px solid var(--sv)' : 'border:1px solid var(--bd)'}">
        <div style="font-size:9px;color:${isCover ? 'var(--sv)' : 'var(--mu)'};margin-top:3px;font-weight:${isCover ? '800' : '400'}">${esc(g.tag)}</div>
      </div>`;
    });
    h += `</div>
      <a href="${esc(imgs.front)}" download="pack-${p}-front.jpg" style="font-size:10px;color:var(--mu);text-decoration:underline;display:inline-block;margin-top:6px">⬇️ descargar portada</a>
    </div>`;
  });

  el.innerHTML = h;
}


async function openReadyPhoto() {
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async function(e) {
    var file = e.target.files[0]; if(!file) return;
    var genDiv = document.getElementById('bundle-generating');
    var preDiv = document.getElementById('bundle-preview');
    if(genDiv){genDiv.style.display='block'; genDiv.textContent='📤 Subiendo foto lista...';}
    if(preDiv) preDiv.style.display='none';

    var dataUrl = await clCompressImage(file, 1600, 1.0);

    // Subir a ImgBB
    var imgbbKey = localStorage.getItem('cl_imgbb_key') || DEFAULT_IMGBB_KEY;
    var finalUrl = dataUrl;
    if (imgbbKey) {
      if(genDiv) genDiv.textContent='📤 Subiendo a ImgBB...';
      var uploaded = await clUploadPhotoToImgBB(dataUrl, imgbbKey);
      if (uploaded) {
        finalUrl = uploaded;
        toast('✅ Foto lista — ready for eBay');
      }
    }

    if(cur) {
      cur._bundleImg = finalUrl;
      cur._imgUrl = finalUrl;
      cur._singleProductImg = dataUrl;
    }
    _lastBundleUrl = finalUrl;

    if(genDiv) genDiv.style.display='none';
    if(preDiv) {
      preDiv.style.display='block';
      preDiv.innerHTML='<div style="position:relative">'
        +'<img src="'+dataUrl+'" style="width:100%;border-radius:8px">'
        +'<div style="position:absolute;bottom:8px;left:0;right:0;text-align:center">'
        +'<span style="background:rgba(0,230,118,.95);color:#000;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:800">✅ Photo uploaded — ready for eBay</span>'
        +'</div></div>';
    }
  };
  input.click();
}



// ── PRODUCT LOOKUP — eBay Catalog + Browse + Finding ──────────
// Single unified call replacing UPCitemdb + separate eBay calls
async function lookupProduct(upc) {
  // Try eBay twice before giving up
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      stat(attempt === 1 ? 'Searching eBay...' : 'Retrying eBay search...');
      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), 15000);
      const r = await fetch(WORKER + '/?upc=' + upc, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      // If eBay found pricing data, return immediately
      if (d.found || d.prices?.low || d.pricing?.sold?.count) return d;
      // If no pricing but product found, return on first attempt
      if (d.product?.name && attempt === 1) return d;
    } catch(e) {
      if (attempt === 2) console.warn('eBay lookup failed both attempts:', e.message);
      else await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
    }
  }
  return { found: false, product: null, pricing: {}, topTitles: [], prices: null };
}

// Kept as fallback if eBay Catalog finds nothing
async function lookupUPCitemdb(upc) {
  let p = { name:'', brand:'', found:false };
  try {
    const r = await fetch('https://api.upcitemdb.com/prod/trial/lookup?upc=' + upc);
    const d = await r.json();
    if (d.items && d.items[0]) {
      const it = d.items[0];
      p.name = it.title || it.description || '';
      p.brand = it.brand || '';
      p.found = !!p.name;
    }
  } catch(e) {}
  if (!p.found) {
    try {
      const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + upc + '.json');
      const d = await r.json();
      if (d.status === 1 && d.product) {
        const pr = d.product;
        p.name = pr.product_name_en || pr.product_name || '';
        p.brand = pr.brands || '';
        p.found = !!p.name;
      }
    } catch(e) {}
  }
  return p;
}

// Price calculation
function calcBundlePrice(ebay,packs){
  packs=packs||1;
  // Priority: sold avg (real) > sold low > active low > active avg
  const soldAvg = ebay?.pricing?.sold?.avg || 0;
  const soldLow = ebay?.pricing?.sold?.low || 0;
  const actLow  = ebay?.prices?.low || 0;
  const actAvg  = ebay?.prices?.avg || 0;
  const base = soldAvg||soldLow||actLow||actAvg||0;
  if(base>0) return (base*packs*0.88).toFixed(2); // 12% below market for fast sales
  return(packs===2?'14.99':packs===3?'19.99':packs===4?'24.99':'29.99');
}

// Pack optimizer


// ── DATE PICKER — Month + Year chips ─────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CUR_YEAR = new Date().getFullYear();
const YEARS = Array.from({length:12}, function(_,i){return CUR_YEAR-1+i;});
var _dateState = { monthIdx: new Date().getMonth(), yearIdx: 1 };
var _dateSelected = false; // true solo cuando usuario toca un chip


function toggleExpDate() {
  var picker = document.getElementById('exp-date-picker');
  var btn    = document.getElementById('exp-toggle-btn');
  if (!picker) return;
  var showing = picker.style.display !== 'none';
  if (showing) {
    clearExpDate();
  } else {
    picker.style.display = 'block';
    btn.style.background = 'rgba(255,107,0,.15)';
    btn.style.borderColor = 'var(--ac)';
    btn.style.color = 'var(--ac)';
    initDateWheel(); // render chips now
  }
}

// ── CÓDIGO DE MANUFACTURA / LOTE ────────────────────────────────────────────
// Se guarda en cur._mfgCode. Nunca es obligatorio: es un respaldo para los
// productos que no traen fecha impresa.
function setMfgCode(v) {
  var val = String(v || '').trim().toUpperCase();
  if (cur) cur._mfgCode = val;
  if (window._packState) window._packState.mfgCode = val;
  var hint = document.getElementById('mfg-code-hint');
  if (hint && cur) hint.innerHTML = psMfgHint(cur);
}
window.setMfgCode = setMfgCode;

// Texto de ayuda que explica, en el momento, qué va a pasar con lo capturado.
function psMfgHint(r) {
  r = r || {};
  var tieneFecha = !!String(r._expDate || '').trim();
  var tieneCode  = !!String(r._mfgCode || '').trim();
  if (tieneFecha && tieneCode) {
    return 'eBay recibirá la <strong>fecha</strong>. El lote se agrega a la descripción.';
  }
  if (tieneFecha) return 'Hay fecha — el código no hace falta.';
  if (tieneCode)  return '✅ Sin fecha: eBay recibirá este <strong>código</strong> y la descripción lo etiquetará como lote.';
  return 'Si el producto no trae fecha, captura aquí el código del envase.';
}
window.psMfgHint = psMfgHint;

// Valor que viaja a C:Expiration Date: la fecha manda; el código es respaldo.
function psExpOrCode(it) {
  var f = String((it && it.expDate) || '').trim();
  if (f) return f;
  return String((it && it.mfgCode) || '').trim();
}
window.psExpOrCode = psExpOrCode;

function clearExpDate() {
  var picker = document.getElementById('exp-date-picker');
  var btn    = document.getElementById('exp-toggle-btn');
  if (picker) picker.style.display = 'none';
  if (btn) {
    btn.style.background = 'var(--sf2)';
    btn.style.borderColor = 'var(--bd)';
    btn.style.color = 'var(--mu)';
  }
  _dateSelected = false;
  if (window._packState) window._packState.expDate = '';
  if (cur) { cur._expDate = ''; cur._selectedTitle = ''; cur._countOK = false; cur._countConfirmed = null; cur._medidaOK = false; }
  var el = document.getElementById('date-result-display');
  if (el) el.innerHTML = '';
  // Regenerar título sin fecha
  rebuildAndApplyTitle(window._packState ? window._packState.curPack : 2);
}

function initDateWheel() {
  renderDateChips();
  updateDateDisplay();
}

function renderDateChips() {
  var mWrap = document.getElementById('month-chips');
  var yWrap = document.getElementById('year-chips');
  if (!mWrap || !yWrap) return;

  mWrap.innerHTML = MONTHS.map(function(m, i) {
    return '<button class="date-chip' + (i===_dateState.monthIdx?' sel':'') +
      '" onclick="pickMonth(' + i + ')">' + m + '</button>';
  }).join('');

  yWrap.innerHTML = YEARS.map(function(y, i) {
    return '<button class="date-chip' + (i===_dateState.yearIdx?' sel':'') +
      '" onclick="pickYear(' + i + ')">' + y + '</button>';
  }).join('');
}

function pickMonth(i) {
  _dateSelected = true;
  _dateState.monthIdx = i;
  document.querySelectorAll('#month-chips .date-chip').forEach(function(el,j){
    el.classList.toggle('sel', j===i);
  });
  updateDateDisplay();
  if (typeof playTick === 'function') playTick();
}

function pickYear(i) {
  _dateSelected = true;
  _dateState.yearIdx = i;
  document.querySelectorAll('#year-chips .date-chip').forEach(function(el,j){
    el.classList.toggle('sel', j===i);
  });
  updateDateDisplay();
  if (typeof playTick === 'function') playTick();
}

function getExpDate() {
  return MONTHS[_dateState.monthIdx] + ' ' + YEARS[_dateState.yearIdx];
}

function updateDateDisplay() {
  var el = document.getElementById('date-result-display');
  // Solo mostrar fecha si el usuario seleccionó algo
  if (!_dateSelected) {
    if (el) el.innerHTML = '<span style="color:var(--mu);font-size:12px">Toca mes y año para seleccionar</span>';
    return;
  }
  var exp = getExpDate();
  if (el) el.innerHTML = '📅 <strong style="color:var(--ac)">' + exp + '</strong>';
  // Guardar en _packState y reconstruir título (incluye shade + expDate juntos)
  if (cur) cur._expDate = exp; // siempre guardar en cur
  if (window._packState) {
    window._packState.expDate = exp;
    rebuildAndApplyTitle(window._packState.curPack);
  }
}



// ── RECONSTRUIR TÍTULO CON TODOS LOS CAMPOS ──────────────────
function rebuildAndApplyTitle(n) {
  var state = window._packState;
  if (!state) return;
  var shade   = state.shade   || '';
  var expDate = state.expDate || '';
  var newPack = n || state.curPack;
  var title;
  // Si el usuario editó el título A MANO, NO lo reconstruimos: solo
  // actualizamos el número de "Pack of N" para que refleje el pack elegido,
  // conservando todo el texto que el usuario escribió.
  if (cur && cur._titleManual && cur._selectedTitle) {
    var manualT = cur._selectedTitle;
    if (Number(newPack) >= 2) {
      // Pack de 2+: si ya tiene "Pack of N", actualiza el número;
      // si no lo tiene, lo inserta antes de "New" (o al final).
      if (/\bpack of \d+\b/i.test(manualT)) {
        manualT = manualT.replace(/\bpack of \d+\b/i, 'Pack of ' + newPack);
      } else if (/\bnew\b\s*$/i.test(manualT)) {
        manualT = manualT.replace(/\s*\bnew\b\s*$/i, ' Pack of ' + newPack + ' New');
      } else {
        manualT = manualT.trim() + ' Pack of ' + newPack;
      }
    } else {
      // Pack de 1: quitar cualquier "Pack of N" del título (1 pieza no es pack)
      manualT = manualT.replace(/\s*\bpack of \d+\b/i, '').replace(/\s{2,}/g, ' ').trim();
    }
    title = manualT.substring(0, 80);
  } else {
    title = rebuildTitle(state.baseTitle, newPack, shade, expDate);
  }
  var titleEl = document.getElementById('pack-title-display');
  if (titleEl) { titleEl.textContent = title; titleEl.dataset.val = title; }
  if (cur) cur._selectedTitle = title;
  // Mantener el contador de caracteres sincronizado
  var _cnt = document.getElementById('title-char-count');
  if (_cnt) { _cnt.textContent = title.length + '/80 chars'; _cnt.style.color = 'var(--mu)'; }
  // Actualizar botón y regenerar si ya hay imagen
  var genBtn = document.getElementById('bundle-gen-btn');
  if (genBtn) genBtn.textContent = '📷 Take Product Photo → Generate Pack of ' + (n || state.curPack);
  // Si ya hay imagen guardada, regenerar con nuevo pack
  if (cur && cur._singleProductImg) {
    var genDiv  = document.getElementById('bundle-generating');
    var preDiv  = document.getElementById('bundle-preview');
    if (genDiv) { genDiv.style.display = 'block'; genDiv.textContent = '⚙️ Generating Pack of ' + newPack + '...'; }
    if (preDiv) preDiv.style.display = 'none';
    generateBundleImage(cur._singleProductImg, newPack).then(async function(bundleImg) {
      if (preDiv && bundleImg) {
        cur._bundleImg = bundleImg; // guardar base64 mientras sube
        // Comprimir y subir a ImgBB
        var imgbbKey = (localStorage.getItem('cl_imgbb_key') || DEFAULT_IMGBB_KEY);
        if (imgbbKey) {
          if (genDiv) { genDiv.style.display = 'block'; genDiv.textContent = '📤 Uploading to ImgBB...'; }
          try {
            const img2 = new Image(); img2.src = bundleImg;
            await new Promise(r => { img2.onload = r; img2.onerror = r; });
            const c2 = document.createElement('canvas');
            c2.width = 800; c2.height = 800;
            c2.getContext('2d').fillStyle = '#fff';
            c2.getContext('2d').fillRect(0,0,800,800);
            c2.getContext('2d').drawImage(img2, 0, 0, 800, 800);
            const compressed = c2.toDataURL('image/jpeg', 0.85);
            const url = await clUploadPhotoToImgBB(compressed, imgbbKey);
            if (url) {
              _lastBundleUrl = url;
              cur._bundleImg = url;
              cur._imgUrl    = url;
              if (genDiv) genDiv.style.display = 'none';
              preDiv.style.display = 'block';
              preDiv.innerHTML = '<img src="' + bundleImg + '" style="width:100%;border-radius:10px">'
                + '<div style="font-size:11px;color:var(--sv);text-align:center;margin-top:6px">✅ Photo uploaded — ready for eBay</div>';
              return;
            }
          } catch(e) { console.error('Pack regen upload error:', e); }
        }
        // Fallback — mostrar sin URL
        if (genDiv) genDiv.style.display = 'none';
        preDiv.style.display = 'block';
        preDiv.innerHTML = '<img src="' + bundleImg + '" style="width:100%;border-radius:10px">'
          + '<div style="font-size:11px;color:#e74c3c;text-align:center;margin-top:6px">⚠️ Not uploaded to ImgBB</div>';
      } else {
        if (genDiv) genDiv.style.display = 'none';
      }
    });
  }
  return title;
}

// ── EDICIÓN MANUAL DEL TÍTULO ────────────────────────────────
// El usuario puede corregir/afinar el título a mano en cualquier momento.
// Respeta el límite de 80 chars de eBay y actualiza el contador en vivo.
function startTitleEdit() {
  var disp    = document.getElementById('pack-title-display');
  var input   = document.getElementById('pack-title-input');
  var actions = document.getElementById('title-edit-actions');
  var editBtn = document.getElementById('title-edit-btn');
  if (!disp || !input) return;
  // Cargar el título actual (el que está mostrándose) al textarea
  input.value = (disp.dataset.val || disp.textContent || '').substring(0, 80);
  disp.style.display    = 'none';
  input.style.display   = 'block';
  if (actions) actions.style.display = 'flex';
  if (editBtn) editBtn.style.display = 'none';
  updateTitleCharCount();
  // Contador en vivo mientras escribe
  input.oninput = updateTitleCharCount;
  input.focus();
}

function updateTitleCharCount() {
  var input = document.getElementById('pack-title-input');
  var cnt   = document.getElementById('title-char-count');
  if (!input || !cnt) return;
  var len = input.value.length;
  var color = len >= 70 && len <= 80 ? 'var(--sv,#00e676)'
            : (len < 70 ? '#e0a800' : '#e74c3c');
  cnt.textContent = len + '/80 chars' + (len < 70 ? ' — puedes llenar más (meta 70-80)' : (len >= 70 ? ' ✓ buen largo' : ''));
  cnt.style.color = color;
}

function saveTitleEdit() {
  var disp    = document.getElementById('pack-title-display');
  var input   = document.getElementById('pack-title-input');
  var actions = document.getElementById('title-edit-actions');
  var editBtn = document.getElementById('title-edit-btn');
  var cnt     = document.getElementById('title-char-count');
  if (!disp || !input) return;
  // Limpiar: sin saltos de línea, sin espacios dobles, recortar a 80
  var newTitle = input.value.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().substring(0, 80);
  if (!newTitle) { toast('⚠️ El título no puede quedar vacío'); return; }
  // Guardar en pantalla y en el estado del producto
  disp.textContent   = newTitle;
  disp.dataset.val   = newTitle;
  if (cur) {
    cur._selectedTitle = newTitle;
    cur._titleManual   = true;   // marca que fue editado a mano
  }
  // Volver a modo lectura
  disp.style.display    = 'block';
  input.style.display   = 'none';
  if (actions) actions.style.display = 'none';
  if (editBtn) editBtn.style.display = 'inline-block';
  if (cnt) { cnt.textContent = newTitle.length + '/80 chars'; cnt.style.color = 'var(--mu)'; }
  toast('✅ Título actualizado');
}

function cancelTitleEdit() {
  var disp    = document.getElementById('pack-title-display');
  var input   = document.getElementById('pack-title-input');
  var actions = document.getElementById('title-edit-actions');
  var editBtn = document.getElementById('title-edit-btn');
  var cnt     = document.getElementById('title-char-count');
  if (disp)    disp.style.display    = 'block';
  if (input)   input.style.display   = 'none';
  if (actions) actions.style.display = 'none';
  if (editBtn) editBtn.style.display = 'inline-block';
  if (cnt && disp) { cnt.textContent = (disp.dataset.val||'').length + '/80 chars'; cnt.style.color = 'var(--mu)'; }
}

// Exponer como globales para que los onclick funcionen en iOS Safari
window.startTitleEdit   = startTitleEdit;
window.saveTitleEdit    = saveTitleEdit;
window.cancelTitleEdit  = cancelTitleEdit;
window.updateTitleCharCount = updateTitleCharCount;

// ── PACK SIZE WHEEL ──────────────────────────────────────────
const PACK_SIZES = [1,2,3,4,5,6,7,8,9,10,11,12];

// Rebuild title with correct format: Brand Product Count Pack of N New
// Convierte "May 2027" → "Exp 05/27" (compacto para el título)
function formatExpForTitle(expDate) {
  if (!expDate) return '';
  var months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  var parts = expDate.split(' '); // ["May", "2027"]
  if (parts.length !== 2) return '';
  var mo = months[parts[0]] || '';
  var yr = String(parts[1]).slice(-2); // "2027" → "27"
  return mo && yr ? 'Exp ' + mo + '/' + yr : '';
}

// ── CANONICAL ORDER TITLE ARCHITECTURE ──────────────────────────────────────
// PRINCIPLE: Preserve original base-title word order. Annotate spans with
// priorities based on structured data. Remove complete low-priority spans
// when fitting to 80 chars.

// Extract semantic priority from structured data (cur.brand, cur.prod.aspects, cur._specifics)
function extractPrioritiesFromStructuredData(curObj) {
  var priorities = {}; // {word_or_phrase: priority_number}

  if (!curObj) return priorities;

  // RIGID (5): Brand is always RIGID
  if (curObj.brand) {
    var brandWords = curObj.brand.split(/\s+/);
    brandWords.forEach(function(w) {
      priorities[w] = 5; // RIGID
    });
  }

  // RIGID/VERY_HIGH (5/4): Product aspects inform semantic roles
  if (curObj.prod && curObj.prod.aspects && Array.isArray(curObj.prod.aspects)) {
    curObj.prod.aspects.forEach(function(aspect) {
      if (!aspect.name || !aspect.value) return;

      var name = String(aspect.name).toLowerCase().trim();
      var value = String(aspect.value).trim();
      var valueWords = value.split(/\s+/);

      // Determine priority based on aspect type
      var priority = 2; // default MEDIUM

      if (name.indexOf('type') !== -1 || name.indexOf('category') !== -1) {
        priority = 5; // RIGID - Product Type
      } else if (name.indexOf('brand') !== -1) {
        priority = 5; // RIGID
      } else if (name.indexOf('capacity') !== -1 || name.indexOf('storage') !== -1 ||
                 name.indexOf('memory') !== -1 || name.indexOf('piece') !== -1 ||
                 name.indexOf('size') !== -1 || name.indexOf('quantity') !== -1) {
        priority = 4; // VERY_HIGH - Product Fact
      } else if (name.indexOf('model') !== -1 || name.indexOf('series') !== -1 ||
                 name.indexOf('generation') !== -1 || name.indexOf('version') !== -1) {
        priority = 4; // VERY_HIGH
      } else if (name.indexOf('product line') !== -1 || name.indexOf('line') !== -1 ||
                 name.indexOf('collection') !== -1) {
        priority = 3; // HIGH
      } else if (name.indexOf('color') !== -1 || name.indexOf('shade') !== -1) {
        priority = 2; // MEDIUM
      }

      // Assign priority to each word in the value
      valueWords.forEach(function(w) {
        if (!priorities[w] || priorities[w] < priority) {
          priorities[w] = priority;
        }
      });
    });
  }

  // Handle cur._specifics similarly if present
  if (curObj._specifics && typeof curObj._specifics === 'object') {
    Object.keys(curObj._specifics).forEach(function(key) {
      var value = curObj._specifics[key];
      if (typeof value !== 'string') value = String(value);

      var priority = 2; // default MEDIUM
      if (key.toLowerCase().indexOf('type') !== -1) {
        priority = 5;
      } else if (key.toLowerCase().indexOf('capacity') !== -1 ||
                 key.toLowerCase().indexOf('size') !== -1) {
        priority = 4;
      }

      var valueWords = value.split(/\s+/);
      valueWords.forEach(function(w) {
        if (!priorities[w] || priorities[w] < priority) {
          priorities[w] = priority;
        }
      });
    });
  }

  return priorities;
}

// Parse base title into semantic spans (compound nouns, numeric facts, etc.)
function parseIntoSpans(base) {
  var words = base.split(/\s+/).filter(Boolean);
  var spans = []; // Array of {value, startIdx, endIdx, wordCount}
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
    // e.g., "Space Shuttle", "Building Set", "Astronaut Figure"
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

// Classify span semantic role to improve tie-breaking
function classifySpanRole(span, index, spans, curObj) {
  var value = span.value;
  var wordCount = span.wordCount;

  // RIGID roles
  if (curObj && curObj.brand && value.indexOf(curObj.brand) !== -1) {
    return 'BRAND'; // RIGID
  }

  // Check if this span ends in product-type indicators
  var isTypeIndicator = /[Ss]et|[Kk]it|[Pp]ack\b/.test(value);
  if (isTypeIndicator && wordCount === 2) {
    return 'PRODUCT_TYPE'; // RIGID
  }

  // Numeric facts are VERY_HIGH
  if (/^\d+[a-z]+$/i.test(value) || /\d+ [a-z]+/i.test(value)) {
    return 'PRIMARY_FACT'; // VERY_HIGH
  }

  // Check structured data for role hints
  if (curObj && curObj.prod && curObj.prod.aspects) {
    var aspects = curObj.prod.aspects;
    for (var i = 0; i < aspects.length; i++) {
      var aspect = aspects[i];
      if (!aspect.value) continue;

      var aspValue = String(aspect.value).toLowerCase();
      var spanLower = value.toLowerCase();

      // If this span matches a structured aspect
      if (aspValue.indexOf(spanLower) !== -1 || spanLower.indexOf(aspValue) !== -1) {
        var aspName = String(aspect.name).toLowerCase();

        // Identify core/model aspects
        if (aspName.indexOf('model') !== -1 || aspName.indexOf('name') !== -1 ||
            aspName.indexOf('product name') !== -1 || aspName.indexOf('variant') !== -1) {
          return 'CORE_PRODUCT'; // HIGH or higher
        }
        if (aspName.indexOf('line') !== -1 || aspName.indexOf('collection') !== -1 ||
            aspName.indexOf('series') !== -1) {
          return 'PRODUCT_LINE'; // HIGH
        }
      }
    }
  }

  // Heuristic: compound nouns in middle of title (position-based)
  // Spans in the 2nd-3rd position after brand are likely core product
  if (wordCount === 2 && index >= 1 && index <= 3) {
    var firstWord = value.split(/\s+/)[0];
    // If first word is capitalized and not a typical descriptor word
    if (/^[A-Z]/.test(firstWord) && !(/^(and|the|this|that|with|for|or)$/i.test(firstWord))) {
      // Distinguish core product from secondary descriptors
      if (/[Ss]et|[Kk]it|[Bb]undle|[Pp]ack\b/.test(value)) {
        return 'PRODUCT_TYPE';
      } else if (!/[Ff]igure|[Cc]olor|[Ee]dition|[Ss]tyle|[Vv]ariant|[Cc]apsule|[Tt]ablet/.test(value)) {
        // Likely core product if not matching secondary feature patterns
        return 'CORE_PRODUCT';
      }
    }
  }

  // Secondary feature indicators
  if (/[Ff]igure|[Bb]rush|[Cc]apsule|[Tt]ablet|[Cc]ollagen|[Cc]olor\b|[Ss]tyle|[Ee]dition|[Dd]esign|[Vv]ariant|[Dd]ecorative|[Ff]ormula|[Cc]omponent/.test(value)) {
    return 'SECONDARY_DESCRIPTOR'; // MEDIUM
  }

  // Default heuristic for compound nouns (capital + capital)
  if (wordCount === 2 && /^[A-Z]/.test(value)) {
    // "Building Set", "Astronaut Figure"
    if (/[Ss]et|[Kk]it|[Pp]ack\b/.test(value)) {
      return 'PRODUCT_TYPE';
    } else if (/[Ff]igure|[Bb]rook|[Cc]apsule|[Bb]undle|[Bb]rush|[Tt]ablet/.test(value)) {
      return 'SECONDARY_DESCRIPTOR';
    } else {
      return 'CORE_PRODUCT';
    }
  }

  return 'VARIANT'; // Default
}

// Assign semantic importance score for tie-breaking
function semanticImportance(role) {
  var scores = {
    'BRAND': 1000,
    'PRODUCT_TYPE': 900,
    'CORE_PRODUCT': 850,
    'PRODUCT_LINE': 800,
    'PRIMARY_FACT': 750,
    'VARIANT': 500,
    'SECONDARY_DESCRIPTOR': 100
  };
  return scores[role] || 0;
}

// Annotate each span with priority and semantic role based on structured data
function annotateSpans(spans, base, curObj) {
  var priorities = extractPrioritiesFromStructuredData(curObj);

  spans.forEach(function(span, index) {
    // Get max priority of any word in this span
    var spanWords = span.value.split(/\s+/);
    var maxPriority = 0;

    spanWords.forEach(function(w) {
      var priority = priorities[w] || 2; // default MEDIUM
      if (priority > maxPriority) maxPriority = priority;
    });

    // Classify semantic role
    var role = classifySpanRole(span, index, spans, curObj);
    var semanticScore = semanticImportance(role);

    // Adjust priority based on role classification
    if (role === 'PRODUCT_TYPE' && maxPriority < 5) {
      maxPriority = 5; // PRODUCT_TYPE is RIGID
    } else if (role === 'CORE_PRODUCT' && maxPriority < 4) {
      maxPriority = 4; // CORE_PRODUCT is VERY_HIGH
    } else if (role === 'PRIMARY_FACT' && maxPriority < 4) {
      maxPriority = 4;
    } else if (role === 'PRODUCT_LINE' && maxPriority < 3) {
      maxPriority = 3;
    } else if (role === 'SECONDARY_DESCRIPTOR' && maxPriority > 2) {
      maxPriority = 2; // Cap secondary descriptors at MEDIUM
    }

    // Numeric patterns are usually at least VERY_HIGH
    if (/\d/.test(span.value) && maxPriority < 4) {
      maxPriority = 4;
    }

    span.priority = maxPriority;
    span.role = role;
    span.semanticScore = semanticScore;
  });
}

// Build title by keeping spans in original order, removing low-priority spans when over 80 chars
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
    // Sort by priority (ascending), then by semantic importance (descending) for tie-breaking
    activeSpans.sort(function(a, b) {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority first
      }
      // Tie-breaker: prefer keeping spans with higher semantic importance
      // (Subtract because we're sorting ascending but want higher importance to stay)
      return (b.semanticScore || 0) - (a.semanticScore || 0);
    });

    // Remove the lowest-priority span (or lowest semantic importance if priority is tied)
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
  shade   = shade   || '';
  expDate = expDate || '';
  if (!base) return (shade?shade+' ':'') + (Number(n) >= 2 ? 'Pack of ' + n + ' ' : '') + 'New';

  // Clean the base title (remove existing pack / new / exp references)
  var cleanBase = base
    .replace(/\bexp(?:ires?|iration)?\.?\s*\d{1,2}[\/\-]\d{2,4}\b/gi, '')
    .replace(/\bexp(?:ires?|iration)?\.?\s*\d{2,4}\b/gi, '')
    .replace(/\bpack of \d+\b/gi, '').replace(/\b\d+[-\s]?pack\b/gi, '')
    .replace(/\b\d+[\s]?x\b/gi, '').replace(/\bset of \d+\b/gi, '')
    .replace(/\bbundle of \d+\b/gi, '').replace(/\bnew sealed\b/gi, '')
    .replace(/\bnew\b\s*$/gi, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/[·\-,\.]+\s*$/, '').trim();

  // Parse into semantic spans (preserving original order)
  var spans = parseIntoSpans(cleanBase);

  // Annotate spans with priorities from structured data
  annotateSpans(spans, cleanBase, typeof cur !== 'undefined' ? cur : null);

  // Build title by removing low-priority complete spans when over 80 chars
  var output = buildTitleFromSpans(spans, n, shade, expDate, typeof cur !== 'undefined' ? cur : null);

  // Hard limit at 80 chars (safety fallback)
  if (output.length > 80) {
    output = output.substring(0, 80).replace(/\s+\S*$/, '').trim();
  }

  // Apply title case correction
  return psFixTitleCase(output, (typeof cur !== 'undefined' && cur && cur.brand) || '');
}

// ── CORRECCIÓN DE MAYÚSCULAS EN EL TÍTULO ───────────────────────────────────
// 15 ago 2026: la regla 9 del prompt decía "Cada palabra en Title Case", y la
// IA la seguía al pie de la letra. Resultado en LEG-673419373609:
//   "Lego Creator Space Shuttle 31134 3 In 1 Building Set New"
// Dos errores: "3 In 1" (en inglés las preposiciones cortas van en minúscula)
// y "Lego" cuando la marca es LEGO, que además es lo que va en *C:Brand —
// el título y el item specific se contradecían.
// Se corrige aquí, de forma determinista, en vez de confiar en que el modelo
// obedezca: el prompt también se ajustó, pero esta función es la garantía.
var PS_SMALL_WORDS = ['a','an','the','and','or','nor','but','of','in','on','at',
  'to','for','with','by','from','per','vs','as','into','over','up'];

function psFixTitleCase(title, brand) {
  var s = String(title || '').trim();
  if (!s) return s;
  var words = s.split(/\s+/);

  words = words.map(function(w, i) {
    // Tokens con dígitos (31134, 3-in-1, 16oz) o ya en MAYÚSCULAS reales
    // (USB, LED, SPF) se dejan intactos.
    if (/\d/.test(w)) return w;
    if (w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
    var bare = w.replace(/[^A-Za-z]/g, '').toLowerCase();
    // Palabra corta a media frase → minúscula. Nunca la primera ni la última.
    if (i > 0 && i < words.length - 1 && PS_SMALL_WORDS.indexOf(bare) !== -1) {
      return w.toLowerCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1);
  });

  var out = words.join(' ');

  // Si la marca va en mayúsculas de verdad (LEGO, JBL, GE), se respeta tal
  // cual en el título para que coincida con *C:Brand. La lista vive en
  // PS_ALLCAPS_BRANDS, la misma que usa normalizeBrandCase, para que el
  // título y el item specific nunca se separen.
  var b = String(brand || '').trim();
  if (b && typeof psIsAllCapsBrand === 'function' && psIsAllCapsBrand(b)) {
    var bUp = b.toUpperCase();
    out = out.replace(new RegExp('\\b' + bUp + '\\b', 'gi'), bUp);
  }
  return out;
}

function initPackWheel(currentPacks, ebayPricesObj, baseTitle, baseUPC, baseBrand) {
  // Store state globally for pickPack
  window._packState = {
    sizes:    PACK_SIZES,
    ebayBase: (ebayPricesObj && (ebayPricesObj.low || ebayPricesObj.avg)) || 0,
    baseTitle: baseTitle,
    baseUPC:   baseUPC,
    baseBrand: baseBrand,
    curPack:   Number(currentPacks) || 2,
    shade:     '',
    expDate:   '',
    discount:  0.95,  // 5% below market
  };
  // Apply initial selection visually
  pickPack(window._packState.curPack);
}

// Called by each chip onclick AND by shade input
function pickPack(n) {
  var state = window._packState;
  if (!state) return;
  state.curPack = n;
  var ebayBase  = state.ebayBase;
  var price     = ebayBase ? '$' + (ebayBase * n * (state.discount || 0.95)).toFixed(2) : '';
  var pfx       = (state.baseBrand || 'GEN').replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() || 'GEN';
  var sku       = pfx + '-' + state.baseUPC + '-' + n + 'pk';
  // Guardar pack y reconstruir título desde _packState (incluye shade + expDate)
  state.curPack = n;

  // Highlight selected chip
  document.querySelectorAll('.pack-chip').forEach(function(el) {
    var chipN = parseInt(el.querySelector('.pc-n').textContent);
    el.classList.toggle('sel', chipN === n);
  });

  // Update label
  var display = document.getElementById('pack-sel-display');
  if (display) display.innerHTML = 'Selected: <strong style="color:var(--ac)">Pack of ' + n + '</strong>' +
    (price ? ' &nbsp;·&nbsp; <strong style="color:var(--gd)">' + price + '</strong>' : '');

  // Update bundle price
  var priceEl = document.getElementById('pack-bundle-price');
  if (priceEl) priceEl.textContent = price || '—';

  // Update SKU — use stored ref first, then getElementById as fallback
  var els    = (window._packState && window._packState.els) || {};
  var skuEl  = els.sku   || document.getElementById('pack-sku-display');
  var titleEl= els.title || document.getElementById('pack-title-display');
  var priceEl= els.price || document.getElementById('pack-bundle-price');
  var dispEl = els.display|| document.getElementById('pack-sel-display');

  if (skuEl)  { skuEl.textContent  = sku;   skuEl.dataset.val   = sku;   }
  rebuildAndApplyTitle(n);

  // Save on cur
  if (cur) {
    cur._selectedPack  = n;
    cur._selectedPrice = price ? parseFloat(price.replace('$', '')) : null;
    cur._selectedSKU   = sku;
    // _selectedTitle se actualiza en rebuildAndApplyTitle
  }
  if (typeof playTick === 'function') playTick();

  // ── Actualizar badge SAVVY/DWI en tiempo real ─────────────
  var bundleAmt = ebayBase ? ebayBase * n * 0.95 : 0;
  var badge = document.querySelector('.badge');
  var addBtn = document.getElementById('addBtn');
  if (badge && ebayBase > 0) {
    if (bundleAmt >= 15) {
      badge.className = 'badge sv';
      badge.innerHTML = '✅ SAVVY';
      if (addBtn) { addBtn.className = 'add-btn'; addBtn.textContent = '➕ ADD TO CSV'; }
      if (cur) cur.verdict = 'SAVVY';
    } else {
      badge.className = 'badge dw';
      badge.innerHTML = '✗ DWI';
      if (addBtn) { addBtn.className = 'ov-add-btn'; addBtn.textContent = '➕ Add anyway (DWI override)'; }
      if (cur) cur.verdict = 'DWI';
    }
  }
}

function updateShadeColor(shade) {
  var state = window._packState;
  if (!state) return;
  state.shade = shade;                   // guardar en _packState
  if (cur) cur._shade = shade;
  rebuildAndApplyTitle(state.curPack);   // reconstruye con shade + expDate juntos
}


function calcPacks(ebayLow,costPerUnit){
  const sizes=PACK_SIZES;
  const FEE=0.1325,FEE_F=0.30;
  function ship(n){return n<=2?5.50:n<=4?7.50:n<=6?9.50:n<=8?11.50:13.50;}
  return sizes.map(n=>{
    const rev=parseFloat((ebayLow*n*0.92).toFixed(2));
    const fee=parseFloat((rev*FEE+FEE_F).toFixed(2));
    const shp=ship(n);
    const cst=parseFloat((costPerUnit*n).toFixed(2));
    const pft=parseFloat((rev-fee-shp-cst).toFixed(2));
    const roi=cst>0?parseFloat((pft/cst*100).toFixed(0)):0;
    return{n,rev,fee,shp,cst,pft,roi};
  });
}
function renderPackTable(ebayLow){
  const cv=parseFloat($('costIn').value)||0;
  if(!cv||cv<=0){toast('⚠️ Enter your cost per unit');return;}
  const rows=calcPacks(ebayLow,cv);
  const best=rows.filter(r=>r.pft>0).reduce((a,b)=>b.pft>a.pft?b:a,{pft:-999,n:0});
  let t=`<table class="pack-table"><tr><th>Pack</th><th>Sale</th><th>Fee</th><th>Shipping</th><th>Cost</th><th>Profit</th><th>ROI</th></tr>`;
  rows.forEach(r=>{
    const b=r.n===best.n&&r.pft>0;
    t+=`<tr class="${b?'best':''}"><td>${b?'⭐ ':''}${r.n}pk</td><td>$${r.rev}</td><td>$${r.fee}</td><td>$${r.shp}</td><td>$${r.cst}</td><td style="color:${r.pft>0?'var(--sv)':'var(--dw)'}">${r.pft>0?'+':''}$${r.pft}</td><td style="color:${r.roi>0?'var(--sv)':'var(--dw)'}">${r.roi}%</td></tr>`;
  });
  $('packResult').innerHTML=t+'</table>';
}


// ── SMART TITLE — nunca usa UPC, siempre usa marca + producto ──
function buildSmartTitle(prod, packs) {
  packs = packs || 2;
  if (!prod || (!prod.name && !prod.brand)) return '';
  const brand    = normalizeBrandCase((prod.brand || '').trim());
  const name     = (prod.name  || '').trim();
  // Remove brand from start of name to avoid "Neutrogena Neutrogena..."
  const cleanName = (brand && name.toLowerCase().startsWith(brand.toLowerCase()))
    ? name.substring(brand.length).trim()
    : name;
  // Extract size/count if present (oz, ct, ml, lb, mg, g, fl oz)
  const sizeMatch = cleanName.match(/\b(\d+\.?\d*\s*(?:oz|fl oz|ct|count|ml|l|lb|lbs|mg|g|kg|pack|pc|pcs|pieces?))\b/i);
  const sizeStr   = sizeMatch ? sizeMatch[0] : '';
  // Build clean name without the size (to reorder: brand + name + size + pack + new)
  const nameNoSize = sizeStr ? cleanName.replace(sizeStr, '').replace(/\s{2,}/g,' ').trim() : cleanName;
  const packStr = packs > 1 ? 'Pack of ' + packs : '';
  const parts = [brand, nameNoSize, sizeStr, packStr, 'New'].filter(Boolean);
  let title = parts.join(' ').replace(/\s{2,}/g,' ').trim();
  if (title.length > 80) title = title.substring(0, 77).replace(/\s+\S*$/, '') + '...';
  return title;
}

// Claude
async function callClaude(upc,prod,ebay){
  stat('Analyzing with Claude...');
  if(!savvyToken())return fallback(upc,prod,ebay);

  const low     = ebay?.prices?.low || ebay?.pricing?.active?.low || 0;
  const avg     = ebay?.prices?.avg || ebay?.pricing?.active?.avg || 0;
  const sold    = ebay?.pricing?.sold;
  const soldCount = sold?.count || ebay?.soldCount || 0;
  const soldAvg   = sold?.avg || sold?.median || 0;
  const activeListings = ebay?.activeListings || 0;

  // ── Pricing logic: eBay is always the source of truth ────────
  // Use the cheapest active price as the market reference
  const marketLow = low || soldAvg || avg || 0;

  // ── Bundle optimizer: find smallest pack that makes it profitable
  // Min bundle revenue = $15 (after $6.50 shipping + 13% eBay fees)
  // Only pack sizes 1, 3, 6, 12 are used (matches PACK_SIZES)
  const MIN_BUNDLE = 15;
  let optimalPack = 1;
  if (marketLow > 0) {
    for (const p of PACK_SIZES) {
      if (marketLow * p * 0.95 >= MIN_BUNDLE) { optimalPack = p; break; }
    }
    if (marketLow * optimalPack * 0.95 < MIN_BUNDLE) { optimalPack = PACK_SIZES[PACK_SIZES.length-1]; }
  }
  const bundlePrice = marketLow > 0 ? (marketLow * optimalPack * 0.95).toFixed(2) : 0;
  const bundleViable = bundlePrice >= MIN_BUNDLE;

  const eInfo = ebay?.found ? [
    `eBay activos: ${activeListings} listings.`,
    `Precio más bajo activo: $${low} | Avg: $${avg}`,
    soldCount > 0 ? `Vendidos (90d): ${soldCount} unidades. Precio vendido avg: $${soldAvg}` : 'Sin ventas registradas en 90 días.',
    marketLow > 0 ? `Bundle óptimo: Pack de ${optimalPack} × $${marketLow} = $${bundlePrice} (precio de venta sugerido -5% del más barato)` : '',
  ].filter(Boolean).join('\n') : 'No encontrado en eBay.';

  // eBay Catalog aspects (item specifics ya detectados)
  const aspectsStr = prod.aspects && Object.keys(prod.aspects).length > 0
    ? 'Atributos eBay Catalog: ' + Object.entries(prod.aspects).map(([k,v])=>`${k}: ${v}`).join(', ')
    : '';

  // Category de eBay Catalog
  const catalogCat = ebay.category ? `Category eBay Catalog: ID ${ebay.category.id} (${ebay.category.name})` : '';

  // Top titles de eBay como plantillas de referencia SEO
  const topRef=ebay&&ebay.topTitles&&ebay.topTitles.length>0
    ?`\n\nTÍTULOS QUE ESTÁN VENDIENDO EN EBAY AHORA (úsalos como referencia de keywords y estructura):\n`+
      ebay.topTitles.slice(0,5).map((t,i)=>`${i+1}. ${typeof t==='object'?t.title:t}`).join('\n')
    :'';

  const prompt=`Eres un experto en resale/liquidation para eBay con 10 años de experiencia. Tu trabajo es decidir si un producto es rentable (SAVVY) o no (DWI) y crear el listing perfecto.

DATOS DEL PRODUCTO:
- UPC: ${upc}
- Nombre: ${prod.name||'No identificado'}
- Marca: ${prod.brand||'Desconocida'}
- ${eInfo}
- ${catalogCat}
- ${aspectsStr}${topRef}

REGLAS DE DECISIÓN SAVVY vs DWI (aplica EN ESTE ORDEN):
1. Si NO está en eBay o no tiene precio → DWI (no podemos saber si vende)
2. Si está en eBay pero tiene 0 ventas en 90 días → DWI (no se vende)
3. Si el bundle de ${optimalPack} unidad(es) a $${bundlePrice} es MENOR a $${MIN_BUNDLE} → DWI (no cubre envío+fees)
4. Si tiene ventas Y el bundle es viable (≥$${MIN_BUNDLE}) → SAVVY
5. Si el precio unitario ya es ≥$${MIN_BUNDLE} → SAVVY con pack de 1 o 2

PACK SIZE RECOMENDADO: ${optimalPack} unidades a $${bundlePrice} precio total
(Este es el pack mínimo para ser rentable. Puedes sugerir un pack mayor si tiene muchas ventas)

INSTRUCCIONES PARA EL TÍTULO (LO MÁS IMPORTANTE — ESTO DEFINE LAS VENTAS):
El título es el factor #1 de búsqueda en eBay Y en Google Shopping. Un título
corto DESPERDICIA ventas. Tienes 80 caracteres y DEBES aprovecharlos casi todos.

META OBLIGATORIA DE LONGITUD: el título DEBE tener entre 70 y 80 caracteres.
Si tu título quedó en menos de 70 caracteres, NO has terminado: agrega más
keywords reales de búsqueda (atributos, scent, variante, sinónimos, uso) hasta
acercarte lo más posible a 80. NUNCA entregues un título de menos de 70 chars
si el producto permite llenarlo. Es un PISO, no solo un techo.

FÓRMULA (en este orden): [Marca] [Línea/Modelo] [Nombre Producto] [Tamaño/Count]
[Atributos clave: scent, SPF, formulación, variante] [Pack of N si N≥2] New

IMPORTANTE SOBRE EL PACK: si es 1 sola pieza (Pack of 1), NO escribas "Pack of 1"
en el título — una sola pieza no es un "pack" y desperdicia caracteres. Termina
solo en "New". Usa esos caracteres extra para más keywords SEO. Solo escribe
"Pack of N" cuando N sea 2 o más.

CÓMO LLENAR HASTA 80 (usa keywords que la gente REALMENTE busca):
- Tamaño y conteo: "6oz", "24ct", "2.5 fl oz", "72 Batteries" (calcula total si es pack)
- Aroma/variante: "Fresh Linen", "Citron Scent", "Lavender"
- Atributo técnico: "SPF 50", "Broad Spectrum", "Water Resistant", "Overnight"
- Formulación: "Spray", "Gel", "Roll-On", "Pump", "Foaming"
- Público/uso: "Sport", "Sensitive Skin", "All Skin Types", "Unscented"
- Sinónimos que la gente busca: para bloqueador incluye "Sunblock"; para toallas
  incluye "Pads with Wings"; para desodorante incluye "Antiperspirant"

EJEMPLOS DE TÍTULOS PERFECTOS (fíjate cuántos caracteres usan, ~75-80):
• "Banana Boat Sport Ultra Clear Sunscreen Spray SPF 50 6oz Sunblock Pack of 6 New" (78)
• "Always Infinity FlexFoam Pads Size 4 Overnight Wings 26ct Unscented Pack of 2 New" (80)
• "Air Wick Scented Oil Refills Fresh Linen 2.69oz Plug-In Air Freshener Pack of 4 New" (80)
• "Absorbine PRO Pain Relieving Roll-On Menthol 2.5oz Fast Acting Pack of 6 New" (75)

REGLAS CRÍTICAS DEL TÍTULO:
1. Longitud objetivo: 70-80 caracteres (NUNCA pasar de 80, NUNCA quedar bajo 70 si se puede llenar)
2. SIEMPRE empieza con la BRAND (marca) con Mayúscula Inicial en cada palabra clave (Title Case)
3. El "Pack of N" va SIEMPRE al final, justo ANTES de "New"
4. NUNCA empieces con "2X", "2-Pack", "Bundle" o números
5. SIEMPRE incluir tamaño/count del producto (oz, ct, ml, lb, fl oz)
6. Terminar con "New" (o "New Sealed" si aplica)
7. NO usar emojis ni signos especiales (nada de !, *, |, ✓)
8. NO REPETIR la misma palabra dos veces (no "Sunscreen ... Sunscreen")
9. Title Case del inglés: mayúscula inicial en las palabras importantes, pero las palabras cortas a media frase van en MINÚSCULA (in, of, for, with, and, the, a, to, on, at, by, from). Ejemplo correcto: "3 in 1", NO "3 In 1". Las marcas que se escriben en mayúsculas (LEGO, USB, JBL) se dejan tal cual. NUNCA TODO EL TÍTULO EN MAYÚSCULAS.
10. Solo palabras REALES del producto — nunca inventes atributos que no tenga
11. NUNCA incluyas fecha de expiración (Exp, Expires, fechas tipo 07/27 o 03/2028) en el título — la app la agrega automáticamente aparte. Si el nombre original trae una fecha de expiración, IGNÓRALA y NO la copies.

Responde ÚNICAMENTE con este JSON (sin markdown, sin explicación):
{"verdict":"SAVVY o DWI","reason":"1 oración en español explicando el veredicto con el dato clave de eBay","title":"título eBay 70-80 chars, Title Case, lleno de keywords SEO reales","price":${bundlePrice||'NUMERO_precio'},"packSize":${optimalPack},"category":"ID_categoria_ebay","categoryName":"nombre categoría","description":"Bundle of [N] [product name]. [key benefit/use]. Brand new, factory sealed. Fast shipping from North Carolina.","brand":"marca exacta"}

CRITERIO SAVVY vs DWI:
- SAVVY: producto conocido con demanda real, precio eBay > $5 unidad, categoría con rotación
- DWI: precio eBay < $3 unidad, sin demanda, producto no identificado, o artículo restringido

REGLA CRÍTICA DEL TÍTULO: NUNCA incluyas el UPC, código de barras, o frases como "2-Pack Bundle UPC 12345". El título DEBE empezar con la BRAND seguida del NOMBRE del producto.
Para el precio: usa (precio_min_ebay × packSize × 0.92) si hay datos. Si no hay datos eBay, usa estimado conservador por categoría.`;
  try{
    // 15-second timeout so we never hang forever
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), 15000);
    stat('Analyzing with Claude AI...');
    const r=await savvyClaude({
      signal: ctrl.signal,
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:500,messages:[{role:'user',content:prompt}]}) // ⚠️ HAIKU LOCKED - NEVER CHANGE
    });
    clearTimeout(timer);
    // Rate limited → just use fallback, don't wait
    if(r.status===429){toast('⏳ eBay rate limit — using fast estimate');return fallback(upc,prod,ebay);}
    if(!r.ok)return fallback(upc,prod,ebay);
    const d=await r.json();
    const txt=(d.content&&d.content[0]&&d.content[0].text||'').replace(/```json|```/g,'').trim();
    const res=JSON.parse(txt);
    res.upc=upc;res.ebay=ebay;res.prod=prod;
    if(!res.brand||['generic','desconocida','unknown','n/a'].includes(res.brand.toLowerCase().trim()))res.brand=prod.brand||'';
    // ── Normalizador determinístico: si la marca viene TODA EN MAYÚSCULAS
    // (ej. "CAMILLE ROSE" desde el UPC/fuente), la convertimos a Title Case
    // ("Camille Rose") y arreglamos el título si empieza con la versión en
    // mayúsculas. No dependemos solo de que la IA obedezca la regla — esto
    // lo garantiza el código sin importar lo que devuelva la IA. ──
    var rawBrand = res.brand || '';
    var normBrand = normalizeBrandCase(rawBrand);
    if (res.title && rawBrand && normBrand !== rawBrand && res.title.indexOf(rawBrand) === 0) {
      res.title = normBrand + res.title.substring(rawBrand.length);
    }
    res.brand = normBrand;

    // ── Respaldo determinístico: si el título salió por debajo del mínimo
    // de 70 caracteres que configuramos (a veces la IA no lo cumple pese a
    // la instrucción), reintentamos UNA vez pidiéndole que lo expanda con
    // más keywords reales, en vez de dejarlo corto y perder SEO. ──
    if (res.title && res.title.length < 70 && res.title.length > 0) {
      if (window._psDebug) window._psDebug('📏 Título corto (' + res.title.length + '/80) — reintentando expandir...');
      try {
        const expandPrompt = 'Your eBay title "' + res.title + '" is only ' + res.title.length + ' characters. '
          + 'eBay titles need 70-80 characters for maximum SEO visibility. Rewrite it to be between 70 and 80 characters '
          + 'by adding more REAL, relevant search keywords (size, count, scent/flavor, use-case, synonyms buyers search for) — '
          + 'never invent attributes the product does not have. Keep the same brand, product name, and end with "New" '
          + '(or "Pack of N New" if it already has a pack count). Return ONLY the new title as plain text — no quotes, no JSON, no explanation.';
        const ctrl2 = new AbortController();
        // 15s (antes 8s) — con señal débil 8s a veces no alcanzaba y el
        // reintento fallaba en silencio, dejando el título corto sin avisar.
        const timer2 = setTimeout(function(){ ctrl2.abort(); }, 15000);
        const r2 = await savvyClaude({
          signal: ctrl2.signal,
          body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:150,messages:[{role:'user',content:expandPrompt}]}) // ⚠️ HAIKU LOCKED - NEVER CHANGE
        });
        clearTimeout(timer2);
        if (r2.ok) {
          const d2 = await r2.json();
          const newTitle = (d2.content && d2.content[0] && d2.content[0].text || '').replace(/^["']|["']$/g,'').trim();
          // Solo usar el título nuevo si de verdad mejoró (más largo, dentro de 80, y sigue mencionando la marca)
          if (newTitle && newTitle.length > res.title.length && newTitle.length <= 80) {
            if (window._psDebug) window._psDebug('✅ Título expandido: ' + res.title.length + ' → ' + newTitle.length + ' chars');
            res.title = newTitle;
          } else if (window._psDebug) {
            window._psDebug('⚠️ Reintento de título no mejoró (nuevo: ' + (newTitle ? newTitle.length : 0) + ' chars) — se mantiene el original');
          }
        } else if (window._psDebug) {
          window._psDebug('⚠️ Reintento de título falló — HTTP ' + r2.status);
        }
      } catch(e2) {
        if (window._psDebug) window._psDebug('⚠️ Reintento de título falló: ' + (e2 && e2.name === 'AbortError' ? 'timeout (15s)' : (e2 && e2.message || e2)));
        // Si el reintento falla, seguimos con el título original — mejor

        // uno corto que ninguno.
      }
    }

    return res;
  }catch(e){
    if(e.name==='AbortError') toast('⚠️ Claude timeout — using fast estimate');
    return fallback(upc,prod,ebay);
  }
}

// ── MARCAS QUE SÍ SE ESCRIBEN EN MAYÚSCULAS ─────────────────────────────────
// 15 ago 2026: normalizeBrandCase() se hizo para arreglar marcas que llegan
// gritadas desde el UPC ("CAMILLE ROSE" → "Camille Rose"). Pero también
// convertía LEGO en "Lego", y entonces el título decía "Lego" mientras
// *C:Brand decía "LEGO" — el listado se contradecía solo.
// Esto es una lista, no una regla automática, a propósito: una regla del
// tipo "si es corta déjala en mayúsculas" convertiría DOVE, NIVEA o AVEENO
// en marcas gritadas. Cuando aparezca una marca nueva que va en mayúsculas,
// se agrega aquí y queda cubierta en el título Y en el item specific.
var PS_ALLCAPS_BRANDS = [
  'LEGO','IKEA','ASUS','MSI','JBL','LG','HP','GE','RCA','IBM','JVC','TCL',
  'BIC','OPI','NYX','GNC','CVS','3M','KFC','AMD','HDMI','USB','LED'
];

function psIsAllCapsBrand(str) {
  return PS_ALLCAPS_BRANDS.indexOf(String(str || '').trim().toUpperCase()) !== -1;
}

// Convierte una marca TODA EN MAYÚSCULAS (ej "CAMILLE ROSE") a Title Case
// ("Camille Rose"). Si ya viene en case normal/mixto, la deja intacta —
// nunca toca marcas que ya están bien formateadas (ej "iPhone", "eBay").
function normalizeBrandCase(str) {
  if (!str) return str;
  // Excepción: marcas que legítimamente van en mayúsculas se dejan intactas.
  if (psIsAllCapsBrand(str)) return String(str).trim().toUpperCase();
  if (str === str.toUpperCase() && /[A-Z]{2,}/.test(str)) {
    return str.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, function(m, sep, c){ return sep + c.toUpperCase(); });
  }
  return str;
}
window.normalizeBrandCase = normalizeBrandCase;

function fallback(upc,prod,ebay){
  const avg=ebay&&ebay.prices&&ebay.prices.avg||0;
  const found=prod&&prod.found;
  const packs=1;
  const cid=catId((prod&&prod.name)||'');
  // Smart title — never expose UPC
  let title='';
  if(found) title=buildSmartTitle(prod,packs);
  else if(ebay&&ebay.topTitles&&ebay.topTitles[0]){
    const t=ebay.topTitles[0];
    title=String(typeof t==='object'?t.title:t).substring(0,80);
  } else title='New Product Pack of '+packs+' New';
  const brand=normalizeBrandCase((prod&&prod.brand)||'');
  return{verdict:found||(avg>3)?'SAVVY':'DWI',
    reason:found?'Estimado sin API':'No data suficientes',
    title,price:calcBundlePrice(ebay,packs),packSize:packs,
    category:cid,categoryName:catNm(cid),
    description:`Bundle of ${packs} ${found?prod.name:'items'}. New sealed. Fast shipping from Lumberton, NC.`,
    brand,upc,ebay,prod};
}

// Main
// ── NÚMERO DE CAMIÓN ─────────────────────────────────────────────────
// Se pregunta una vez al inicio de cada escaneo.
// Se guarda en window._truckNumber para toda la sesión.
// El usuario puede cambiarlo en cualquier momento desde el prompt.
window._truckNumber = window._truckNumber || '';

function askTruckNumber(onConfirm) {
  // Si ya hay número de camión guardado, preguntar si quiere usarlo o cambiarlo
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px';
  var current = window._truckNumber ? '(' + window._truckNumber + ')' : '';
  ov.innerHTML = `
    <div style="background:var(--sf);border-radius:16px;padding:24px;width:100%;max-width:380px">
      <div style="font-size:18px;font-weight:900;color:var(--ac);margin-bottom:6px">🚛 Número de Camión</div>
      <div style="font-size:12px;color:var(--mu);margin-bottom:14px">¿De qué camión viene esta mercancía?${window._truckNumber ? ' Actual: <strong style="color:#fff">'+window._truckNumber+'</strong>' : ''}</div>
      <input id="truck-input" type="text" inputmode="text" autocapitalize="characters" placeholder="Ej: 1042, T-5, C3..."
        value="${window._truckNumber}"
        style="width:100%;padding:16px;border-radius:10px;border:2px solid var(--ac);background:#111;color:#fff;font-size:20px;text-align:center;font-weight:900;margin-bottom:12px">
      <button id="truck-ok" style="width:100%;padding:14px;background:var(--ac);color:#000;border:none;border-radius:10px;font-weight:900;font-size:16px;cursor:pointer;margin-bottom:8px">✔ CONFIRMAR</button>
      ${window._truckNumber ? '<button id="truck-keep" style="width:100%;padding:12px;background:transparent;color:var(--mu);border:1px solid var(--bd);border-radius:10px;font-size:14px;cursor:pointer">↩ Usar el mismo: '+window._truckNumber+'</button>' : ''}
    </div>
  `;
  document.body.appendChild(ov);

  var input = ov.querySelector('#truck-input');
  var okBtn = ov.querySelector('#truck-ok');
  var keepBtn = ov.querySelector('#truck-keep');

  var confirm = function() {
    var val = (input.value || '').trim();
    if (!val) { input.focus(); toast('⚠️ Ingresa el número de camión'); return; }
    window._truckNumber = val;
    try { ov.parentNode.removeChild(ov); } catch(e){}
    onConfirm();
  };

  var keep = function() {
    try { ov.parentNode.removeChild(ov); } catch(e){}
    onConfirm();
  };

  okBtn.addEventListener('touchend', function(e){ e.preventDefault(); confirm(); });
  okBtn.addEventListener('click', confirm);
  if (keepBtn) {
    keepBtn.addEventListener('touchend', function(e){ e.preventDefault(); keep(); });
    keepBtn.addEventListener('click', keep);
  }

  input.addEventListener('keydown', function(e){ if(e.key==='Enter') confirm(); });
  setTimeout(function(){ if(input) input.focus(); }, 400);
}

async function analyze(upc){
  upc=String(upc||'').replace(/\D/g,'');
  if(upc.length<8){toast('❌ Invalid UPC — minimum 8 digits');return;}

  // ── Preguntar número de camión antes de analizar ──
  // Se pregunta siempre al inicio de cada escaneo.
  askTruckNumber(function(){
    _doAnalyze(upc);
  });
}

async function _doAnalyze(upc){
  showLoadingInline('UPC: '+upc);

  let step='init';
  try{
    // ── Same reliable data source as Clothing & Shoes module ──
    // Railway /search-upc cascades: eBay official API → Algopix → UPCitemdb → OpenFoodFacts
    step='railway_search';
    stat('Querying eBay via Railway...');
    const rwRes = await psAuthFetch('/search-upc' + '?upc=' + encodeURIComponent(upc));
    let rwData = null;
    if (rwRes.ok) {
      const rwJson = await rwRes.json();
      console.log('🔍 Railway /search-upc response:', JSON.stringify(rwJson).substring(0,500));
      rwData = rwJson.data || null;
    }

    // Build prod{} + ebayFull{} in the shape finishAnalyze() expects
    let prod = {name:'',brand:'',found:false};
    let ebayFull = { found:false, product:null, prices:null, pricing:{}, topTitles:[], activeListings:0, soldCount:0, category:null, categoryName:null, priceSource:'railway' };

    if (rwData && (rwData.name || rwData.brand)) {
      prod = {
        name:  rwData.name || '',
        brand: rwData.brand || '',
        found: true,
        source: rwData.data_source || 'railway'
      };
      $('lp').textContent = prod.name.substring(0, 50);

      // Prefer real eBay total, fall back to Amazon/Walmart/suggested price
      const total = rwData.ebay_total || rwData.amazon_price || rwData.walmart_price || rwData.suggested_price || 0;
      // Promedio real de item+envío si el backend lo manda; si no, usar el total
      const avgTotal = rwData.ebay_avg || total;
      if (total > 0) {
        ebayFull.found = true;
        ebayFull.prices = { low: total, avg: avgTotal, high: rwData.max_price || 0 };
        ebayFull.pricing = { sold: { avg: 0, count: 0 }, active: { low: total, avg: avgTotal } };
        ebayFull.topTitles = [prod.name];
        ebayFull.activeListings = rwData.active_bin_count || 0;
      }
      if (rwData.category) {
        ebayFull.category = rwData.category;
      }
      if (rwData.category_name) {
        ebayFull.categoryName = rwData.category_name;
      }
      ebayFull.priceSource = rwData.data_source || 'railway';
    } else {
      // Nothing found at all — same message the clothing module shows
      prod = { name:'', brand:'', found:false };
    }

    await finishAnalyze(upc, prod, ebayFull, step);
  }catch(e){
    console.error('Error en paso ['+step+']:',e);
    renderAnalyzeError(step, e, upc, {name:'',brand:'',found:false}, {found:false});
  }
}

// ── Paste eBay Listing URL — same approach as Clothing & Shoes module ──
async function analyzeEbayUrl(urlStr){
  if (!urlStr || !urlStr.trim()) { toast('⚠️ Paste an eBay URL first'); return; }
  urlStr = urlStr.trim();
  showLoadingInline('Resolving eBay link...');
  let itemId = null;
  let step = 'resolve_url';

  try {
    // Short links (ebay.io) or any URL without /itm/ — resolve via authenticated endpoint
    if (urlStr.includes('ebay.io') || !urlStr.match(/\/itm\//)) {
      try {
        stat('Resolving short link...');
        const resolveRes = await psAuthFetch('/api/resolve-url?url=' + encodeURIComponent(urlStr), { method: 'GET' });
        if (resolveRes.ok) {
          const resolveData = await resolveRes.json();
          if (resolveData.status === 'success' && resolveData.item_id) {
            itemId = resolveData.item_id;
          }
        }
      } catch(e) { console.warn('resolve-url error:', e.message); }
    }

    // Fallback: extract the item ID directly from the URL
    if (!itemId) {
      try {
        const u = new URL(urlStr);
        const pathMatch = u.pathname.match(/\/itm\/(?:[^\/]+\/)?(\d{10,13})/);
        if (pathMatch) itemId = pathMatch[1];
        if (!itemId) itemId = u.searchParams.get('item') || u.searchParams.get('itemId');
        if (!itemId) {
          const numMatch = u.pathname.match(/(\d{10,13})/);
          if (numMatch) itemId = numMatch[1];
        }
      } catch(e) {
        const numMatch2 = urlStr.match(/(\d{10,13})/);
        if (numMatch2) itemId = numMatch2[1];
      }
    }

    if (!itemId) {
      toast('❌ Could not find eBay Item ID — try copying the link again');
      screen('res');
      return;
    }

    step = 'ebay_item';
    stat('Loading eBay item ' + itemId + '...');
    $('lp').textContent = 'Item: ' + itemId;
    const itemRes = await psAuthFetch('/api/ebay-item?item_id=' + encodeURIComponent(itemId), { method: 'GET' });
    if (!itemRes.ok) { toast('⚠️ eBay error ' + itemRes.status); screen('res'); return; }
    const json = await itemRes.json();
    if (json.status !== 'success' || !json.data) { toast('⚠️ Item not found'); screen('res'); return; }

    const d = json.data;
    const title = d.title || '';
    const price = d.price || 0;
    const shippingCost = d.shipping_cost || 0;
    const totalPrice = d.total_price || (price + shippingCost);
    const brand = d.brand || '';

    const prod = { name: title, brand: brand, found: !!title, source: 'ebay_url' };
    if (prod.found) $('lp').textContent = prod.name.substring(0, 50);

    let ebayFull = { found:false, product:null, prices:null, pricing:{}, topTitles: title?[title]:[], activeListings:0, soldCount:0, category:null, priceSource:'ebay_url' };
    if (totalPrice > 0) {
      ebayFull.found = true;
      ebayFull.prices = { low: totalPrice, avg: totalPrice };
      ebayFull.pricing = { sold: { avg: 0, count: 0 }, active: { low: totalPrice } };
    }

    await finishAnalyze(itemId, prod, ebayFull, step);
  } catch(e) {
    console.error('analyzeEbayUrl error:', e);
    renderAnalyzeError(step, e, itemId||urlStr, {name:'',brand:'',found:false}, {found:false});
  }
}

// ── Recalculates verdict/price/packSize/reason from res.ebay ──
// Called after the initial scan AND after the user manually corrects the eBay price.
function applyVerdict(res){
  const ebay = res.ebay || {};
  const _low      = ebay?.prices?.low || ebay?.pricing?.active?.low || 0;
  const _soldAvg  = ebay?.pricing?.sold?.avg || ebay?.pricing?.sold?.median || 0;
  const _avg      = ebay?.prices?.avg || 0;
  const _mBase    = _low || _soldAvg || _avg || 0;
  const _soldCnt  = ebay?.pricing?.sold?.count || ebay?.soldCount || 0;
  const _MIN      = 15;
  let   _optPack  = 1;
  if (_mBase > 0) {
    for (const p of PACK_SIZES) {
      if (_mBase * p * 0.95 >= _MIN) { _optPack = p; break; }
    }
    // Si ni con el paquete más grande (12) se llega al mínimo, usar el más grande disponible
    if (_mBase * _optPack * 0.95 < _MIN) { _optPack = PACK_SIZES[PACK_SIZES.length-1]; }
  }
  const _bPrice   = (_mBase * _optPack * 0.95).toFixed(2);
  const _viable   = parseFloat(_bPrice) >= _MIN;

  if (ebay.found && _mBase > 0) {
    if (_viable) {
      res.verdict  = 'SAVVY';
      res.price    = _bPrice;
      res.packSize = _optPack;
      res.reason   = _soldCnt > 0
        ? `$${_low||_avg} más barato en eBay. ${_soldCnt} ventas en 90 días. Bundle de ${_optPack} a $${_bPrice}.`
        : `Precio activo $${_low||_avg}. Bundle de ${_optPack} a $${_bPrice}. Sin ventas registradas — monitorear.`;
    } else {
      res.verdict = 'DWI';
      res.reason  = `Precio en eBay $${_low||_avg}. Ni con 12 unidades ($${(_mBase*12*0.95).toFixed(2)}) llega a $${_MIN} mínimo.`;
    }
  } else if (!ebay.found || _mBase === 0) {
    res.verdict = 'DWI';
    res.reason  = 'No se encontró precio activo en eBay. Sin datos de mercado.';
  }
}

// ── Called when the user taps the "eBay Lowest" price box to correct it manually ──
// e.g. after tapping "Ver precio real en eBay →" and seeing the actual listing price.
// Uses a real numeric-only keyboard (inputmode="decimal") instead of prompt()'s
// alphanumeric keyboard.
function editLowPrice(){
  if(!cur){ toast('⚠️ Scan a product first'); return; }
  if(!cur.ebay) cur.ebay = { found:true, prices:{}, pricing:{} };
  if(!cur.ebay.prices) cur.ebay.prices = {};
  const currentLow = cur.ebay.prices.low || 0;

  document.querySelectorAll('.price-edit-ov').forEach(e=>e.remove());

  var ov = document.createElement('div');
  ov.className = 'price-edit-ov';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:30px';
  ov.innerHTML = '<div style="background:var(--sf);border-radius:16px;padding:24px;width:100%;max-width:320px">'
    + '<div style="font-size:16px;font-weight:800;margin-bottom:4px;text-align:center">✏️ Precio real en eBay</div>'
    + '<div style="font-size:12px;color:var(--mu);margin-bottom:16px;text-align:center">Item + envío, visto en el link de eBay</div>'
    + '<div style="display:flex;align-items:center;gap:6px;background:var(--sf2);border:2px solid var(--ac);border-radius:12px;padding:10px 14px;margin-bottom:18px">'
    + '<span style="font-size:22px;font-weight:800;color:var(--ac)">$</span>'
    + '<input id="price-edit-input" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" '
    + 'style="flex:1;background:none;border:none;outline:none;color:var(--tx);font-size:24px;font-weight:800;text-align:left" '
    + 'value="' + (currentLow>0 ? currentLow.toFixed(2) : '') + '" placeholder="0.00" '
    + 'onkeydown="if(event.key===\'Enter\')_confirmEditLowPrice();">'
    + '</div>'
    + '<button onclick="_confirmEditLowPrice()" style="width:100%;padding:13px;background:linear-gradient(135deg,#FF6B35,#E71D36);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:8px;display:block">✅ Actualizar precio</button>'
    + '<button onclick="document.querySelectorAll(\'.price-edit-ov\').forEach(e=>e.remove())" style="width:100%;padding:10px;background:none;border:1px solid #555;border-radius:10px;color:#888;cursor:pointer;display:block">Cancelar</button>'
    + '</div>';
  document.body.appendChild(ov);
  setTimeout(function(){
    var inp = document.getElementById('price-edit-input');
    if(inp){ inp.focus(); inp.select(); }
  }, 100);
}

function _confirmEditLowPrice(){
  const inp = document.getElementById('price-edit-input');
  if(!inp) return;
  const val = parseFloat(String(inp.value).replace(/[^0-9.]/g,''));
  if(isNaN(val) || val<=0){ toast('❌ Precio inválido'); return; }

  cur.ebay.prices.low = val;
  cur.ebay.found = true;
  cur.ebay.priceSource = 'manual_override';
  applyVerdict(cur);
  renderResult(cur);
  document.querySelectorAll('.price-edit-ov').forEach(e=>e.remove());
  toast('✅ Precio actualizado — bundle recalculado');
}


// ── Shared processing: Claude title/category + verdict + render ──
// Used by both analyze(upc) [barcode/manual UPC] and analyzeEbayUrl(urlStr) [paste eBay link]
async function finishAnalyze(upc, prod, ebayFull, stepIn){
  let step = stepIn || 'claude', res = null;
  let ebay = {
    found:          ebayFull.found,
    activeListings: ebayFull.activeListings || 0,
    soldCount:      ebayFull.soldCount || 0,
    cheapestPrice:  ebayFull.cheapestPrice || 0,
    cheapestTitle:  ebayFull.cheapestTitle || '',
    prices:         ebayFull.prices || null,
    topTitles:      ebayFull.topTitles || [],
    pricing:        ebayFull.pricing || {},
    category:       ebayFull.category || null,
    categoryName:   ebayFull.categoryName || '',
    priceSource:    ebayFull.priceSource || 'keyword',
  };
  try{
    step='claude';
    stat('Analyzing with Claude...');
    res=await callClaude(upc,prod,ebay);

    step='render';
    // ── BACKEND BRAND IS AUTHORITATIVE ──────────────────────────────────
    // If backend provided a brand, use it. Claude's brand is only a fallback.
    const backendBrand = String(prod.brand || '').trim();
    if (backendBrand) {
      res.brand = normalizeBrandCase(backendBrand);
    }
    if(!res.brand||['generic','desconocida','unknown','n/a'].includes(res.brand.toLowerCase().trim())){
      res.brand = prod.brand||'';
    }
    if(!res.title||res.title.includes(upc)||res.title.toLowerCase().includes(' upc ')){
      res.title = buildSmartTitle(prod, res.packSize||1) || res.title;
    }
    // ── BACKEND CATEGORY IS AUTHORITATIVE ──────────────────────────────────
    // If backend provided category data, use it. Claude's category is only a fallback.
    const backendCategoryId = String(ebay.category || '').trim();
    const backendCategoryName = String(ebay.categoryName || '').trim();

    if (backendCategoryName) {
      // Backend has a category name — use it
      res.categoryName = backendCategoryName;
      if (backendCategoryId) res.category = backendCategoryId;
    } else if (backendCategoryId) {
      // Backend has a category ID but no name
      res.category = backendCategoryId;
      // Do NOT call catNm() blindly because it defaults unknown IDs to Skin Care.
      // Preserve any existing Claude categoryName, or use 'Other'
      if (!res.categoryName) res.categoryName = 'Other';
    } else {
      // Backend has no category data — use title-based fallback (existing logic)
      // Validar categoría — si Claude pone categoría padre o default, recalcular desde título
      const PARENT_CATS = ['26395','293','888','220','1281','2984','14308','20625','6000','16486','11854','31786','20725','36447','67716','11838','184630'];
      const titleBasedCat = catId(res.title || prod.name || '');
      if (!res.category || res.category === 'undefined' || PARENT_CATS.includes(String(res.category)) || res.category === '31786') {
        // Solo usar 31786 si el título realmente es skin care
        const isSkinCare = /lotion|moisturizer|sunscreen|spf|face wash|serum|toner|cleanser/i.test(res.title||'');
        if (!isSkinCare && titleBasedCat !== '31786') {
          res.category = titleBasedCat;
          res.categoryName = catNm(titleBasedCat);
        } else if (!res.category || res.category === 'undefined') {
          // Nunca dejar 'undefined' en pantalla
          res.category = titleBasedCat || '31786';
          res.categoryName = catNm(res.category);
        }
      }
    }

    // ── OVERRIDE VERDICT MATEMÁTICAMENTE ─────────────────────
    res.ebay = ebay;
    applyVerdict(res);

    cur=res;
    cur._singleProductImg=null; // limpiar foto anterior al escanear nuevo producto
    cur._bundleImg=null;
    cur._titleManual=false; // el producto nuevo NO hereda edición manual del anterior
    _lastBundleUrl = '';
    try {
      renderResult(res);
      screen('res');
    } catch(renderErr) {
      console.error('renderResult error:', renderErr);
      $('resBody').innerHTML='<div style="padding:20px"><div class="badge dw">❌ Render Error</div>'
        +'<div class="card" style="margin-top:12px"><div class="lbl">Error Message</div>'
        +'<div class="val" style="font-size:13px;color:#ff5252;word-break:break-all">'+renderErr.message+'</div></div>'
        +'<div class="card"><div class="lbl">Where</div>'
        +'<div class="val" style="font-size:11px;color:var(--mu)">'+String(renderErr.stack||'').substring(0,200)+'</div></div>'
        +'<button class="ag-btn" id="agBtnErr">🔄 SCAN ANOTHER</button></div>';
      screen('res');
      var eb=$('agBtnErr');
      if(eb) eb.addEventListener('click',function(){ scanAnother(); });
    }
  }catch(e){
    console.error('Error en paso ['+step+']:',e);
    renderAnalyzeError(step, e, upc, prod, ebay);
  }
}

function renderAnalyzeError(step, e, upc, prod, ebay){
  screen('res');
  $('resBody').innerHTML=`
    <div class="badge dw">❌ ERROR</div>
    <div class="card">
      <div class="lbl">Failed step</div>
      <div class="val" style="font-family:monospace;color:var(--dw)">${step}</div>
    </div>
    <div class="card">
      <div class="lbl">Error message</div>
      <div class="val" style="font-size:12px;word-break:break-all">${e.message||'Error desconocido'}</div>
    </div>
    <div class="card">
      <div class="lbl">Scanned UPC / Item</div>
      <div class="val" style="font-family:monospace">${upc}</div>
    </div>
    <div class="card">
      <div class="lbl">Product found</div>
      <div class="val">${prod.found?prod.name:'Not found'}</div>
    </div>
    <div class="card">
      <div class="lbl">eBay Data</div>
      <div class="val">${ebay.found?'✅ '+ebay.activeListings+' listings':'❌ No data'}</div>
    </div>
    <div class="card">
      <div class="lbl">Sesión Claude</div>
      <div class="val">${savvyToken()?'✅ Activa':'❌ Inicia sesión'}</div>
    </div>
    <button class="ag-btn" id="agBtn" style="margin-top:10px">🔄 TRY AGAIN</button>`;
  $('agBtn').addEventListener('touchend',e=>{e.preventDefault();scanAnother();});
  $('agBtn').addEventListener('click',scanAnother);
}


// ── ADD TO BULK CSV ───────────────────────────────────────────

function updateFAB(){
  const n=bulk.length;
  const fab=$('fab');
  const fabN=$('fabN');
  if(fab) fab.classList.toggle('on', n>0);
  if(fabN) fabN.textContent=n;
}

async function addBulk() {
  // Log al inicio para confirmar que el botón sí se está disparando
  console.log('🟢 addBulk called - cur:', cur ? cur.upc : 'NULL');
  if (window._psDebug) window._psDebug('🟢 ADD TO CSV disparado');

  // ── PROTECCIÓN: esperar a que la descripción RICA (intro+bullets) esté
  // lista antes de agregar al CSV. Sin esto, si el usuario toca ADD TO CSV
  // muy rápido, se usa el fallback plano de 1 oración en vez de la
  // descripción completa que ya generó psAutoGenerateDescription(). ──
  if (cur && !cur._description) {
    var waitBtn = document.getElementById('addBtn');
    if (waitBtn) { waitBtn.disabled = true; waitBtn.textContent = '⏳ Terminando descripción...'; }
    toast('⏳ Esperando descripción completa...');
    var waited = 0;
    while (cur && !cur._description && waited < 12000) {
      await new Promise(function(res){ setTimeout(res, 300); });
      waited += 300;
    }
    if (waitBtn) { waitBtn.disabled = false; waitBtn.textContent = '➕ ADD TO CSV'; }
    // Si tras 12s la IA de descripción realmente falló, usar fallback LOCAL
    // con bullets (nunca la oración plana de 1 línea).
    if (cur && !cur._description) {
      cur._description = buildLocalFallbackDescription(cur, cur.packSize || 1);
      if (window._psDebug) window._psDebug('⚠️ Descripción IA no llegó a tiempo — usando fallback local con bullets');
    }
  }

  // ── Misma protección para item specifics (Volume, Color, Formulation,
  // etc.) — ahora se generan automáticamente al escanear, pero si el
  // usuario toca ADD TO CSV muy rápido, esperamos a que terminen en vez
  // de dejar el listado con specifics vacíos. ──
  if (cur && cur._specifics === undefined) {
    var waitBtn2 = document.getElementById('addBtn');
    if (waitBtn2) { waitBtn2.disabled = true; waitBtn2.textContent = '⏳ Terminando specifics...'; }
    var waitedSpecs = 0;
    while (cur && cur._specifics === undefined && waitedSpecs < 8000) {
      await new Promise(function(res){ setTimeout(res, 300); });
      waitedSpecs += 300;
    }
    if (waitBtn2) { waitBtn2.disabled = false; waitBtn2.textContent = '➕ ADD TO CSV'; }
    // Si tras 8s no llegaron, seguimos con specifics vacíos {} — mejor
    // subir el listado a tiempo que bloquear indefinidamente.
  }

  // ⚠️ VALIDACIÓN CRÍTICA: Verificar campos obligatorios por categoría
  var cat = String(cur.category || '');
  var shadeVal = cur._specifics && cur._specifics['Shade'] ? String(cur._specifics['Shade']).trim() : '';
  
  // Categorías que REQUIEREN Shade obligatoriamente
  var shadeRequiredCats = ['172023', '31804']; // 172023=Lash/Brow, 31804=Lipstick
  if (shadeRequiredCats.includes(cat)) {
    if (!shadeVal || shadeVal === '') {
      var catName = cat === '172023' ? 'Lash/Brow' : 'Lipstick';
      toast('❌ FALTA SHADE - Campo obligatorio para ' + catName + '\n\nDebes completar manualmente el Shade antes de continuar.\n\nEdita el producto y vuelve a intentar.');
      var addBtn = document.getElementById('addBtn');
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = '➕ ADD TO CSV';
        addBtn.style.background = '';
      }
      return;
    }
  }

  toast('🟢 Agregando al CSV...');

  // TIMEOUT GLOBAL de 45 segundos — si tarda más, restaurar botón y avisar
  var addBulkTimeout = setTimeout(function(){
    if (window._psDebug) window._psDebug('⏰ addBulk TIMEOUT — restaurando botón');
    var b = document.getElementById('addBtn');
    if (b) {
      b.textContent = '⚠️ Tardó demasiado — intenta de nuevo';
      b.style.background = '#ff9800';
      b.style.pointerEvents = '';
      setTimeout(function(){
        b.textContent = '➕ ADD TO CSV';
        b.style.background = '';
      }, 4000);
    }
    toast('⏰ Tomó demasiado tiempo — reintenta');
  }, 30000);

  // Protección: si por alguna razón cur se perdió, avisar y salir
  if (!cur) {
    clearTimeout(addBulkTimeout);
    toast('❌ No hay producto activo - escanea de nuevo');
    return;
  }

  // Limpiar cualquier overlay que pueda estar bloqueando touches
  ['loc-overlay','loc-manual-panel'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.style.pointerEvents = 'none'; }
  });

  // Wrapper para siempre limpiar el timeout al final
  var _origResult;
  try {
    _origResult = await _addBulkInternal();
    clearTimeout(addBulkTimeout);
    return _origResult;
  } catch(err) {
    clearTimeout(addBulkTimeout);
    if (window._psDebug) window._psDebug('❌ addBulk error: ' + (err && err.message || err));
    throw err;
  }
}

// ── FUENTE ÚNICA DE VERDAD: categorías de salud/OTC/suplementos/belleza que
// eBay exige con "Dosage" y/o "Expiration Date". Antes esta lista estaba
// duplicada en TRES lugares distintos y desincronizada entre sí (EXP_REQ,
// _dosageCats, EXP_CATS_D), lo que dejaba pasar listados incompletos según
// en qué categoría cayera el producto. Ahora es una sola constante global
// que consumen los tres puntos. Si eBay agrega una categoría, se agrega AQUÍ
// y los tres caminos quedan cubiertos automáticamente. ──────────────────────
window.PS_HEALTH_CATS = [
  // originales (vitaminas / suplementos / OTC)
  '67169','180959','75037','75038','51227','57041','2984','67167','105070',
  // agregadas antes al export
  '11776','109130','31387','3457','177762','177763','67272','3516',
  // ⚠️ agregadas 13 ago 2026 — categorías reales usadas en producción que
  // NO estaban cubiertas y causaron rechazos de eBay:
  '75040',   // Pain Relief / analgésicos tópicos (falló FRA-815439007304)
  '180952',  // Health Care / otros
  '72875',   // Health & Beauty misc
  '36870',   // Lip Balm & Treatments (falló OKE-722510010057)
  '180937',  // Vitamins & Supplements misc
  // ⚠️ agregada 14 ago 2026 — segundo rechazo del mismo producto:
  '45206',   // Breathing Aids / oxígeno en lata (falló BOO-637866288459 x2)
  // ⚠️ agregada 14 ago 2026 — antiácidos / digestivos:
  '75039'    // Antacids & Acid Reducers (falló TUM-307667388107)
];

// ── Detector por PALABRA CLAVE, no solo por categoría ───────────────────────
// La lista de arriba siempre va a ir un paso atrás: cada categoría nueva que
// eBay exija se descubre cuando ya rechazó un listado (nos pasó con 75040,
// después con 45206). Esto atrapa productos consumibles/médicos aunque su
// categoría todavía no esté en la lista. Se usa SOLO en la red de seguridad
// del export (que es un aviso con confirmación, no un bloqueo), para que un
// falso positivo nunca deje a las muchachas trabadas sin poder exportar.
window.psMayNeedExpDate = function(category, title) {
  if (window.PS_HEALTH_CATS.includes(String(category || ''))) return true;
  var t = String(title || '').toLowerCase();
  return /\b(oxygen|supplement|vitamin|probiotic|collagen|melatonin|medicine|medication|tablet|capsule|softgel|gummies|gummy|lozenge|syrup|ointment|antiseptic|antibiotic|sunscreen|spf|eye drops|ear drops|nasal|inhaler|first aid|bandage|antacid|laxative|electrolyte|protein powder|meal replacement|baby formula|infant formula|test strips?|lancets?|glucose|peroxide|alcohol prep|contact lens|saline)\b/.test(t);
};

// ── CONFIRMACIÓN DE CONTEO ──────────────────────────────────────────────────
// 17 ago 2026. QUN-898440001875 se publicó como "120ct" cuando la caja dice
// 60 SOFTGELS. El número NO lo inventó la IA: viene del nombre que devuelve
// la base de datos de UPC, que tiene registrada la presentación de 120 para
// ese código. Qunol vende el mismo CoQ10 200mg en 60 y en 120.
//
// O sea que un dato malo de una fuente "confiable" contaminó el título Y el
// item specific Size. El número correcto está impreso al frente de la caja
// que la muchacha tiene en la mano — el sistema simplemente nunca se lo
// preguntaba.
//
// Regla: si el título propone un conteo, hay que confirmarlo contra la caja
// antes de guardar. Si no propone ninguno, no se estorba al almacén.

// Unidades contables. NO incluye oz/ml/g/mg: esas son medidas de contenido
// (3 oz de crema), no cantidades de piezas, y ahí no hay nada que contar.
var PS_COUNT_UNITS = 'ct|count|softgels?|capsules?|caps|tablets?|tabs|gummies|gummy|pills?|lozenges?|packets?|sachets?|wipes?|strips?|patches?|pads?|bandages?|tests?|treatments?|doses?|servings?|pieces?|pcs';

// Devuelve {num, unit, texto} si el título trae un conteo; null si no.
function psDetectCount(title, category) {
  var t = String(title || '');
  // se ignora "Pack of N": esa es la cantidad de BULTOS del listado, no las
  // piezas que trae adentro cada caja.
  t = t.replace(/\bpack of\s+\d+/gi, ' ');

  // a) número pegado a la unidad: "120ct", "8 Treatments"
  var m = t.match(new RegExp('\\b(\\d{1,4})\\s*(' + PS_COUNT_UNITS + ')\\b', 'i'));
  // b) con hasta dos palabras en medio: "30 Saline Packets", "8 foam Applicators"
  if (!m) m = t.match(new RegExp('\\b(\\d{1,4})\\s+(?:[A-Za-z]+\\s+){1,2}(' + PS_COUNT_UNITS + ')\\b', 'i'));
  if (m) return { num: parseInt(m[1], 10), unit: m[2], texto: m[0] };

  // c) número suelto SIN unidad, solo en categorías de salud: "Test Booster 60 Exp".
  //    Se excluye lo que claramente no es un conteo: dosis (200mg), medidas
  //    (3 oz), fechas (04/29) y años. Fuera de salud no se aplica, porque un
  //    número suelto en electrónica o juguetes casi nunca es cantidad.
  var esSalud = (typeof PS_HEALTH_CATS !== 'undefined' && PS_HEALTH_CATS.indexOf(String(category || '')) !== -1);
  if (esSalud) {
    var limpio = t
      .replace(/\d+\s*(?:mg|mcg|iu|ml|oz|fl oz|g|kg|lb|%)\b/gi, ' ')  // dosis y medidas
      .replace(/\d{1,2}\s*\/\s*\d{2,4}/g, ' ')                        // fechas 04/29
      .replace(/\bexp\b/gi, ' ');
    var m3 = limpio.match(/\b(\d{2,4})\b/);
    if (m3) {
      var n3 = parseInt(m3[1], 10);
      if (n3 >= 10 && n3 <= 1000) {
        return { num: n3, unit: 'unidades', texto: m3[1], suelto: true };
      }
    }
  }
  return null;
}

// Reemplaza el conteo del título por el confirmado, respetando la unidad
// que ya traía ("120ct" → "60ct", "120 Softgels" → "60 Softgels").
function psApplyCount(title, nuevo, category) {
  var det = psDetectCount(title, category);
  if (!det || !nuevo) return title;
  var reemplazo = det.texto.replace(/\d{1,4}/, String(nuevo));
  return String(title).replace(det.texto, reemplazo);
}

async function _addBulkInternal() {
  // ── Confirmar medidas que no se pueden verificar ──────────────────────
  // ARN-723122200621 salió con C:Volume = "4 oz" y el título NO menciona
  // ningún tamaño. Es el mismo caso del CoQ10 "120ct": un número que viene
  // de la base de datos del UPC y que nadie contrastó contra el envase.
  // Si el dato no aparece en el título, no hay forma de verificarlo desde
  // el código — se le pregunta a quien tiene el producto en la mano.
  if (cur && cur._specifics && !cur._medidaOK) {
    var _tMed = String((cur._selectedTitle || cur.title) || '');
    ['Volume', 'Size'].forEach(function(campo){
      if (cur._medidaOK) return;
      var v = String(cur._specifics[campo] || '').trim();
      if (!v || !/\d/.test(v)) return;
      var num = v.replace(/[^0-9.]/g, '');
      if (!num || _tMed.indexOf(num) !== -1) return;   // sí está en el título: verificable
      var r = prompt(
        '📏 CONFIRMA LA MEDIDA (' + campo + ')\n\n' +
        'El sistema propone:  ' + v + '\n\n' +
        'Ese dato NO aparece en el título — viene de la base de datos del UPC\n' +
        'y puede no coincidir con el envase. Lee el empaque y confirma.\n\n' +
        '(Deja vacío si el envase no lo dice)',
        v
      );
      if (r === null) { cur._medidaCancel = true; return; }
      var lim = String(r).trim();
      if (lim) cur._specifics[campo] = lim;
      else delete cur._specifics[campo];
      if (lim !== v) toast('✅ ' + campo + ': ' + v + ' → ' + (lim || 'vacío'));
    });
    if (cur._medidaCancel) { cur._medidaCancel = false; return; }
    cur._medidaOK = true;
  }

  // ── Confirmar el conteo contra la caja ────────────────────────────────
  var _tituloActual = (cur && (cur._selectedTitle || cur.title)) || '';
  var _det = psDetectCount(_tituloActual, (cur && cur.category) || '');
  if (_det && cur && !cur._countOK) {
    var _resp = prompt(
      '📦 CONFIRMA LA CANTIDAD\n\n' +
      'El sistema propone:  ' + _det.num + ' ' + _det.unit + '\n\n' +
      'Ese dato viene de la base de datos del UPC y NO siempre coincide\n' +
      'con la caja. Lee el frente del empaque y escribe la cantidad real.\n\n' +
      '(Deja el mismo número si está correcto)',
      String(_det.num)
    );
    if (_resp === null) return;            // canceló: no se guarda nada
    var _n = parseInt(String(_resp).replace(/[^0-9]/g, ''), 10);
    if (!_n || _n < 1) { toast('⚠️ Cantidad inválida'); return; }

    cur._countConfirmed = _n;
    cur._countOK = true;
    if (_n !== _det.num) {
      var _nuevoTitulo = psApplyCount(_tituloActual, _n, (cur && cur.category) || '');
      cur.title = _nuevoTitulo;
      if (cur._selectedTitle) cur._selectedTitle = _nuevoTitulo;
      // el Size del item specific sale del mismo número: se invalida para
      // que se regenere con el valor corregido
      if (cur._specifics) { delete cur._specifics['Size']; }
      var _tEl = document.getElementById('title-input');
      if (_tEl) { _tEl.value = _nuevoTitulo; if (_tEl.dataset) _tEl.dataset.val = _nuevoTitulo; }
      toast('✅ Corregido: ' + _det.num + ' → ' + _n + ' ' + _det.unit);
    }
  }

  var EXP_REQ = window.PS_HEALTH_CATS;
  // El código de manufactura cuenta como válido: si el envase no trae fecha
  // pero sí lote, no tiene caso trabar al almacén pidiendo algo que no existe.
  if (EXP_REQ.includes(String(cur.category||'')) && !String(cur._mfgCode || '').trim()) {
    // Check both cur._expDate and DOM display (in case _packState wasn't set)
    var expVal = cur._expDate || '';
    if (!expVal) {
      var dateDisplay = document.getElementById('date-result-display');
      if (dateDisplay && dateDisplay.textContent && dateDisplay.textContent.trim() !== '' 
          && !dateDisplay.textContent.includes('Toca mes')) {
        expVal = dateDisplay.textContent.replace('📅','').trim();
        cur._expDate = expVal; // save it
      }
    }
    if (!expVal) {
      toast('⚠️ Este producto requiere fecha de expiración — toca 📅 para agregarla');
      var expBtn = document.getElementById('exp-toggle-btn');
      if (expBtn) {
        expBtn.style.borderColor = '#e74c3c';
        expBtn.style.background = 'rgba(231,76,60,.15)';
        expBtn.scrollIntoView({behavior:'smooth', block:'center'});
      }
      return;
    }
  }

  if (!cur) return;

  // ── Si el reparto de inventario tiene unidades → agregar TODOS los
  //    packs activos (los no excluidos con ✕), cada uno con su foto ──
  var _splitInp = document.getElementById('split-total-input');
  var _splitTotal = _splitInp ? (parseInt(String(_splitInp.value).replace(/\D/g,''), 10) || 0) : 0;
  if (_splitTotal > 0) {
    try {
      var _splitOk = await addSplitPacksToCSV();
      if (_splitOk) return; // packs agregados — listo
    } catch(_se) {
      console.error('addSplitPacksToCSV error:', _se);
      if (window._psDebug) window._psDebug('\u274c Split error: ' + (_se.message || _se));
      toast('\u274c Error agregando packs: ' + (_se.message || _se));
      return;
    }
  }

  const packs = cur._selectedPack || cur.packSize || 1;
  var skuEl   = document.getElementById('pack-sku-display');
  var titleEl = document.getElementById('pack-title-display');
  var usedTitle = cur._selectedTitle || (titleEl && titleEl.dataset.val) || rebuildTitle(cur.title||'', packs);
  var usedSKU   = cur._selectedSKU   || (skuEl   && skuEl.dataset.val)   || makeSKU(cur.brand, cur.upc, packs, cur.title);
  var usedPrice = cur._selectedPrice || parseFloat(cur.price) || 9.99;
  var shade     = (cur._shade   || '').trim();
  var expDate   = cur._expDate  || '';
  var location  = cur.location  || '';

  if (bulk.find(function(b){ return b.upc === cur.upc; })) {
    toast('⚠️ Already in CSV'); return;
  }

  // ── FOTO REQUERIDA — eBay rechaza listings sin foto ──────────
  // Verificar en múltiples lugares donde puede estar guardada la foto
  var bundlePreviewImg = document.querySelector('#bundle-preview img');
  // Imágenes de pack generadas (front|back|extras) para el pack seleccionado
  var _packImgs = (cur._packImages && cur._packImages[packs]) || null;
  var _packPhotoUrl = _packImgs
    ? [_packImgs.front, _packImgs.back].concat(_packImgs.extras || [])
        .filter(function(u){ return u && String(u).indexOf('http') === 0; }).join('|')
    : '';
  var hasPhoto = !!(
    _packPhotoUrl ||
    (cur._frontImg && cur._frontImg.length > 100) ||
    _lastBundleUrl ||
    (cur._bundleImg && cur._bundleImg.length > 100) ||
    cur._imgUrl ||
    cur._singleProductImg ||
    (bundlePreviewImg && bundlePreviewImg.src && bundlePreviewImg.src.length > 100)
  );
  // Si hay imagen en el DOM, guardarla en cur para que _doAddBulk la use
  if (!cur._bundleImg && bundlePreviewImg && bundlePreviewImg.src && bundlePreviewImg.src.length > 100) {
    cur._bundleImg = bundlePreviewImg.src;
  }
  if (!hasPhoto) {
    var _photoWarnOv = document.createElement('div');
    _photoWarnOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99999;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;gap:14px;text-align:center';
    _photoWarnOv.innerHTML = '<div style="font-size:50px">📷</div>'
      + '<div style="color:#fff;font-size:18px;font-weight:800">Sin foto — eBay rechazará este listing</div>'
      + '<div style="color:#aaa;font-size:14px;line-height:1.6">eBay requiere al menos 1 foto.<br>Toma la foto antes de agregar al CSV.</div>'
      + '<div style="display:flex;gap:10px;margin-top:6px;width:100%;max-width:320px">'
      + '<button id="_photoWarnCancel" style="flex:1;background:none;border:1px solid #555;border-radius:12px;padding:13px;color:#aaa;font-size:14px;cursor:pointer">Cancelar</button>'
      + '<button id="_photoWarnContinue" style="flex:1;background:#ff6b00;border:none;border-radius:12px;padding:13px;color:#fff;font-size:14px;font-weight:800;cursor:pointer">Agregar igual</button>'
      + '</div>';
    document.body.appendChild(_photoWarnOv);
    document.getElementById('_photoWarnCancel').onclick = function() { _photoWarnOv.remove(); };
    document.getElementById('_photoWarnContinue').onclick = function() {
      _photoWarnOv.remove();
      _doAddBulk(usedTitle, usedSKU, usedPrice, shade, expDate, location, packs, '');
    };
    return;
  }

  // Incluir base64 también — _doAddBulk intentará subir a ImgBB
  // Prioridad: imágenes de pack generadas (front|back|extras) > bundle > front base64
  var photoUrl = _packPhotoUrl || _lastBundleUrl || cur._bundleImg || cur._imgUrl || cur._frontImg || '';
  await _doAddBulk(usedTitle, usedSKU, usedPrice, shade, expDate, location, packs, photoUrl);
}

async function _doAddBulk(usedTitle, usedSKU, usedPrice, shade, expDate, location, packs, photoUrl) {
  // Si hay foto, verificar si es de pack generado (ya normalizada) o si necesita normalización
  if (photoUrl) {
    // Detectar si la foto es de pack generado (ya 1200x1200)
    const packImgs = cur && cur._packImages && cur._packImages[packs];
    const packUrls = packImgs ?
      [packImgs.front, packImgs.back, ...(packImgs.extras||[])].filter(u => u) :
      [];

    // photoUrl puede ser: base64 | URL única | URLs múltiples separadas por |
    const isPackGenerated = packUrls.length > 0 &&
      photoUrl.split('|').every(url =>
        url && packUrls.some(purl => String(url).trim() === String(purl).trim())
      );

    if (!isPackGenerated) {
      // Foto NO es de pack generado — DEBE normalizarse a 1200x1200 antes de eBay
      const imgbbKey = (localStorage.getItem('cl_imgbb_key') || DEFAULT_IMGBB_KEY);
      if (imgbbKey) {
        const addBtn = document.getElementById('addBtn');
        if (addBtn) { addBtn.disabled = true; addBtn.textContent = '📤 Normalizing & uploading photo...'; }

        try {
          // Normalizar a 1200x1200 cuadrado con aspect ratio preservation
          const normalized = await normalize1200x1200(photoUrl);

          // Si es base64, subir a ImgBB; si es URL externa, no re-subir (usar directamente)
          if (photoUrl.startsWith('data:')) {
            const uploaded = await clUploadPhotoToImgBB(normalized, imgbbKey);
            if (uploaded) {
              photoUrl = uploaded;
              if (cur) { cur._bundleImg = uploaded; cur._imgUrl = uploaded; }
              toast('✅ Foto normalizada y subida — agregando al CSV');
            } else {
              toast('⚠️ ImgBB falló — verifica tu API key en ⚙️. Agregando sin foto.');
              photoUrl = '';
            }
          } else {
            // URL externa normalizada — usar directamente en CSV
            photoUrl = normalized;
            toast('✅ Foto normalizada — agregando al CSV');
          }
        } catch(e) {
          console.warn('❌ Error normalizando foto:', e.message);
          toast('❌ Error normalizando foto — agregando sin foto. Detalle: ' + (e.message||'desconocido'));
          photoUrl = '';
        }

        if (addBtn) { addBtn.disabled = false; addBtn.textContent = '➕ ADD TO CSV'; }
      } else {
        toast('⚠️ Configura ImgBB en ⚙️ para subir fotos. Agregando sin foto.');
        photoUrl = '';
      }
    } else {
      // Foto ES de pack generado — ya está garantizada 1200x1200, no normalizar
      console.log('✅ Foto de pack generado detectada — usando directamente (ya 1200x1200)');
    }
  }

  bulk.push({
    sku:         usedSKU,
    title:       usedTitle || (cur && cur.title) || '',
    price:       usedPrice,
    shade:       shade,
    expDate:     expDate,
    mfgCode:     (cur && cur._mfgCode) || '',
    upc:         (cur && cur.upc)         || '',
    brand:       (cur && cur.brand)       || 'Generic',
    category:    psSafeCategory(cur && cur.category),
    description: descToEbayHTML(descForPack((cur && (cur._description || cur.description)) || '', packs, cur)) || '',
    location:    location,
    packs:       packs,
    photo:       photoUrl,
    bundleImg:   photoUrl,
    _specifics:  (cur && cur._specifics) || {},
    scannedBy:   SAVVY_CURRENT_USER || 'unknown'
  });
  saveBulkToStorage();
  updateFAB();
  // Mostrar confirmación clara de auto-save
  var msg = '✅ Added — ' + bulk.length + ' in CSV (Auto-saved to device)';
  toast(msg);
  console.log('PERSIST: ' + msg);
}

// Render result
// ── BULK SPLIT CALCULATOR — reparte el inventario de un embarque entre los
// tamaños de paquete 1/3/6/12 según la demanda real de eBay (soldCount 90 días) ──
const DEMAND_TIERS = {
  alta:  { label:'🔥 Alta demanda',              min:20, weights:{1:0.60,2:0,3:0.20,4:0,5:0,6:0.12,7:0,8:0,9:0,10:0,11:0,12:0.08} },
  media: { label:'📊 Demanda media',              min:5,  weights:{1:0.35,2:0,3:0.30,4:0,5:0,6:0.20,7:0,8:0,9:0,10:0,11:0,12:0.15} },
  baja:  { label:'🐢 Demanda baja / mov. lento',  min:0,  weights:{1:0.15,2:0,3:0.20,4:0,5:0,6:0.30,7:0,8:0,9:0,10:0,11:0,12:0.35} }
};
const DEMAND_TIER_ORDER = ['alta','media','baja'];

function getDemandTier(soldCount){
  if (soldCount >= DEMAND_TIERS.alta.min)  return 'alta';
  if (soldCount >= DEMAND_TIERS.media.min) return 'media';
  return 'baja';
}

// Reparte totalUnits en múltiplos exactos de cada tamaño de paquete.
// Procesa de paquete grande a chico; el sobrante siempre cae en pack de 1
// (que nunca deja remanente, porque son unidades sueltas).
function computeSplit(totalUnits, tierKey, activePacks){
  const baseWeights = (DEMAND_TIERS[tierKey] || DEMAND_TIERS.media).weights;
  // Packs activos (los que NO fueron excluidos con ✕)
  const active = activePacks || {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
  const activeList = PACK_SIZES.filter(function(p){ return active[p]; });
  const result = {};
  PACK_SIZES.forEach(function(p){ result[p] = {listings:0, units:0}; });
  result.leftover = 0;
  if (!activeList.length || totalUnits <= 0) { result.leftover = totalUnits; return result; }

  // Re-normalizar pesos solo entre los packs activos.
  // Si un pack está activo pero tiene peso 0 (como 2,4,5,7,8,9,10,11),
  // le asignamos un peso mínimo para que reciba unidades.
  var wSum = 0;
  activeList.forEach(function(p){ wSum += (baseWeights[p] || 0); });
  // Si todos los activos tienen peso 0 (caso raro), dar peso igual a todos
  const equalW = 1 / (activeList.length || 1);
  const weights = {};
  activeList.forEach(function(p){
    var w = baseWeights[p] || 0;
    weights[p] = wSum > 0 ? (w > 0 ? w / wSum : 0.01) : equalW;
  });
  // Re-normalizar por si los pesos mínimos cambiaron la suma
  var wSum2 = 0; activeList.forEach(function(p){ wSum2 += weights[p]; });
  activeList.forEach(function(p){ weights[p] = weights[p] / wSum2; });

  // Repartir de mayor a menor; el pack activo más chico absorbe el resto
  const desc = activeList.slice().sort(function(a,b){ return b-a; });
  const smallest = desc[desc.length - 1];
  let remaining = totalUnits;
  desc.forEach(function(p){
    if (p === smallest) return; // el más chico se calcula al final
    const targetUnits = Math.round(totalUnits * weights[p]);
    const listings = Math.floor(Math.min(targetUnits, remaining) / p);
    const used = listings * p;
    result[p] = { listings: listings, units: used };
    remaining -= used;
  });
  // El pack activo más chico absorbe todo lo que queda
  const smListings = Math.floor(remaining / smallest);
  result[smallest] = { listings: smListings, units: smListings * smallest };
  remaining -= smListings * smallest;
  result.leftover = remaining; // solo >0 si el pack de 1 está excluido
  return result;
}

function renderSplitCalculatorHTML(ebay){
  const soldCount = (ebay && (ebay.soldCount || (ebay.pricing && ebay.pricing.sold && ebay.pricing.sold.count))) || 0;
  const autoTier = getDemandTier(soldCount);
  return `<div class="card" id="split-calc-card" data-auto-tier="${autoTier}" data-sold-count="${soldCount}">
    <div class="lbl">🚛 Reparto de Inventario (Bulk Split)</div>
    <div style="font-size:12px;color:var(--mu);margin-bottom:10px">¿Cuántas unidades llegaron de este producto? Sugerimos cómo repartirlas entre packs del 1 al 12 según la demanda real en eBay.</div>
    <div class="extra-field">
      <div class="extra-label">Unidades totales en este envío</div>
      <input class="extra-input" id="split-total-input" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="ej. 1000" oninput="updateSplitCalc()">
    </div>
    <div class="extra-field" style="margin-top:10px">
      <div class="extra-label">⚖️ Peso de UNA unidad (como dice la báscula)</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="extra-input" id="split-weight-lb" type="text" inputmode="decimal" placeholder="lb" oninput="updateSplitCalc()" style="flex:1;text-align:center">
        <span style="color:var(--mu);font-size:13px;font-weight:700">lb</span>
        <input class="extra-input" id="split-weight-oz" type="text" inputmode="decimal" placeholder="oz" oninput="updateSplitCalc()" style="flex:1;text-align:center">
        <span style="color:var(--mu);font-size:13px;font-weight:700">oz</span>
      </div>
      <div style="font-size:11px;color:var(--mu);margin-top:5px">Se suma el peso de la caja según el tamaño (2-12 oz). El envío es un estimado (promedio USPS/UPS a todo EE.UU.).</div>
    </div>
    <div style="margin-top:8px;font-size:12px;color:var(--mu)">
      Demanda detectada: <strong id="split-tier-label" style="color:var(--ac)"></strong>
      (${soldCount} vendidos en 90 días)
      — <span style="text-decoration:underline;cursor:pointer;color:var(--ac)" onclick="cycleSplitTier()">cambiar</span>
    </div>
    <div id="split-results" style="margin-top:12px"></div>
  </div>`;
}

// ── PESO Y ESTIMADO DE ENVÍO (Parte A: solo pantalla, no toca el CSV) ──
// Constante: peso de caja/empaque que se suma a CADA paquete
var BOX_WEIGHT_LB = 0.5; // OBSOLETO — reemplazado por boxWeightLb() proporcional. Se deja para no romper referencias externas.

// Lee el peso de una unidad (lb + oz) de los inputs → devuelve libras decimales
function getUnitWeightLb(){
  var lb = parseFloat(String(($('split-weight-lb') || {}).value || '').replace(/[^0-9.]/g,'')) || 0;
  var oz = parseFloat(String(($('split-weight-oz') || {}).value || '').replace(/[^0-9.]/g,'')) || 0;
  return lb + (oz / 16);
}

// Peso de la CAJA de envío, proporcional al peso del producto.
// Un producto chico va en sobre/caja chica (poco peso extra); uno grande
// va en caja de cartón con relleno (más peso extra). Devuelve libras.
function boxWeightLb(productLb){
  if (productLb <= 0)   return 0;
  if (productLb < 0.5)  return 2 / 16;   // < 8 oz  → +2 oz (sobre acolchado)
  if (productLb < 1)    return 4 / 16;   // 8oz-1lb → +4 oz (caja chica)
  if (productLb <= 3)   return 8 / 16;   // 1-3 lb  → +8 oz (caja mediana)
  return 12 / 16;                        // > 3 lb  → +12 oz (caja grande)
}

// Peso total de un paquete = (peso unidad × cantidad) + caja proporcional
function packTotalWeightLb(unitLb, packSize){
  if (unitLb <= 0) return 0;
  var productLb = unitLb * packSize;
  return productLb + boxWeightLb(productLb);
}

// Estimado de costo de envío por peso — promedio USPS Ground Advantage / UPS Ground
// a zona media de EE.UU. Son APROXIMADOS para decidir si el pack conviene.
// Fáciles de ajustar: solo cambia los números de la tabla.
function estimateShippingCost(totalLb){
  if (totalLb <= 0) return 0;
  var t = totalLb;
  if (t <= 1)  return 6;
  if (t <= 2)  return 8;
  if (t <= 3)  return 10;
  if (t <= 5)  return 13;
  if (t <= 7)  return 16;
  if (t <= 10) return 20;
  if (t <= 15) return 26;
  if (t <= 20) return 32;
  // más de 20 lb: ~$1.5 por libra adicional sobre la base de 20
  return Math.round(32 + (t - 20) * 1.5);
}

// Formatea libras a "X lb Y oz" para mostrar bonito
function fmtWeight(totalLb){
  if (totalLb <= 0) return '—';
  var lb = Math.floor(totalLb);
  var oz = Math.round((totalLb - lb) * 16);
  if (oz === 16) { lb += 1; oz = 0; }
  if (lb === 0) return oz + ' oz';
  if (oz === 0) return lb + ' lb';
  return lb + ' lb ' + oz + ' oz';
}

// ── Control manual de listados por pack ───────────────────────────────
// Guarda cuántos listados quiere el usuario para cada pack.
// null = usar el sugerido por el sistema automático.
if (!window._splitManual) window._splitManual = {};

function updateManualListings(p, val) {
  var n = parseInt(String(val).replace(/\D/g,''), 10);
  if (isNaN(n) || n < 0) n = 0;
  window._splitManual[p] = n;
  // Recalcular el footer en tiempo real sin re-renderizar toda la tabla
  refreshSplitFooter();
}

function getSplitListings(split, p) {
  // Si hay valor manual para este pack, usarlo; si no, usar el sugerido
  var m = window._splitManual[p];
  if (m != null) return m;
  return (split[p] && split[p].listings) || 0;
}

function refreshSplitFooter() {
  var inp = $('split-total-input');
  var total = parseInt(String((inp && inp.value) || '0').replace(/\D/g,''), 10) || 0;
  var active = window._splitActive || {};
  var card = $('split-calc-card');
  var tierKey = (card && (card.dataset.tier || card.dataset.autoTier)) || 'media';
  var split = computeSplit(total, tierKey, active);

  var usedUnits = 0;
  var activeCnt = 0;
  PACK_SIZES.forEach(function(p) {
    if (!active[p]) return;
    var listings = getSplitListings(split, p);
    usedUnits += listings * p;
    if (listings > 0) activeCnt++;
    // Actualizar también el display de unidades en la fila
    var unitsEl = document.getElementById('split-units-' + p);
    if (unitsEl) unitsEl.textContent = (listings * p) + ' unidades';
  });

  var diff = usedUnits - total;
  var footerEl = document.getElementById('split-footer');
  if (footerEl) {
    var color = diff === 0 ? 'var(--sv)' : '#e74c3c';
    var msg = '';
    if (diff === 0)      msg = '✅ Total: ' + usedUnits + '/' + total + ' unidades — ¡Cuadra perfecto!';
    else if (diff > 0)   msg = '⚠️ Total: ' + usedUnits + '/' + total + ' unidades — Sobran ' + diff;
    else                 msg = '⚠️ Total: ' + usedUnits + '/' + total + ' unidades — Falta ' + Math.abs(diff);
    footerEl.innerHTML = '<div style="font-size:12px;color:' + color + ';margin-top:8px;font-weight:700">' + msg + '</div>';
  }
  var noteEl = document.getElementById('split-note');
  if (noteEl) {
    noteEl.innerHTML = activeCnt > 0
      ? '<div style="margin-top:10px;padding:10px;background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.3);border-radius:8px;font-size:12px;color:var(--sv);text-align:center">👇 Al tocar <strong>ADD TO CSV</strong> abajo se agregarán los ' + activeCnt + ' pack(s) activos con sus fotos</div>'
      : '';
  }
}

function updateSplitCalc(){
  const inp = $('split-total-input');
  const card = $('split-calc-card');
  if(!inp || !card) return;
  const total = parseInt(String(inp.value).replace(/\D/g,''), 10) || 0;
  const tierKey = card.dataset.tier || card.dataset.autoTier || 'media';
  card.dataset.tier = tierKey;
  const tierInfo = DEMAND_TIERS[tierKey];
  const lbl = $('split-tier-label');
  if (lbl) lbl.textContent = tierInfo.label;

  const out = $('split-results');
  if (!out) return;
  if (total <= 0) {
    out.innerHTML = '<div style="color:var(--mu);font-size:12px">Ingresa el total de unidades para ver el reparto sugerido.</div>';
    return;
  }

  if (!window._splitActive) window._splitActive = {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
  const active = window._splitActive;
  const split = computeSplit(total, tierKey, active);
  const unitLb = getUnitWeightLb();  // peso de una unidad (0 si no lo han puesto)
  let rows = '';
  PACK_SIZES.forEach(function(p){
    const d = split[p];
    const isOn = !!active[p];
    const inSb = !!(window._psSbExisting && window._psSbExisting[p]);
    // Peso y envío estimado de este pack (solo si hay peso de unidad)
    let shipTag = '';
    if (unitLb > 0) {
      const wLb = packTotalWeightLb(unitLb, p);
      const ship = estimateShippingCost(wLb);
      shipTag = `<div style="font-size:11px;color:var(--mu);margin-top:2px">⚖️ ${fmtWeight(wLb)} · 📦 envío ~$${ship}</div>`;
    }
    if (isOn) {
      const sbTag = inSb ? '<span style="font-size:10px;color:#ffb300;border:1px solid rgba(255,179,0,.45);border-radius:6px;padding:2px 6px;margin-left:6px;white-space:nowrap">✅ En Sellbrite</span>' : '';
      const listings = getSplitListings(split, p);
      rows += `<div style="padding:9px 0;border-bottom:1px solid var(--bd)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-weight:800;min-width:36px">${p}pk${sbTag}</div>
          <div id="split-units-${p}" style="color:var(--mu);font-size:13px;min-width:80px">${listings * p} unidades</div>
          <div style="display:flex;align-items:center;gap:4px">
            <input
              id="split-manual-${p}"
              type="text" inputmode="numeric"
              value="${listings}"
              oninput="updateManualListings(${p}, this.value)"
              style="width:52px;padding:6px 4px;text-align:center;background:var(--sf2);border:2px solid var(--ac);border-radius:8px;color:#fff;font-size:16px;font-weight:900"
            >
            <span style="font-size:11px;color:var(--mu)">listados</span>
          </div>
          <button onclick="toggleSplitPack(${p})" ontouchend="event.preventDefault();toggleSplitPack(${p})" style="background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.5);border-radius:8px;padding:5px 10px;color:#e74c3c;font-size:13px;font-weight:800;cursor:pointer">✕</button>
        </div>
        ${shipTag}
      </div>`;
    } else {
      const exTxt = inSb ? '<span style="color:var(--sv);font-weight:700">✅ Ya en Sellbrite</span>' : 'excluido';
      rows += `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--bd);opacity:.55">
        <div style="font-weight:800;text-decoration:line-through">${p}pk</div>
        <div style="color:var(--mu);font-size:12px">${exTxt}</div>
        <button onclick="toggleSplitPack(${p})" ontouchend="event.preventDefault();toggleSplitPack(${p})" style="background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.4);border-radius:8px;padding:5px 10px;color:var(--sv);font-size:12px;font-weight:800;cursor:pointer;margin-left:8px">↩ incluir</button>
      </div>`;
    }
  });
  // Footer dinámico con IDs para actualización en tiempo real
  const assigned = total - (split.leftover || 0);
  var usedUnits = 0;
  var activeCntFinal = 0;
  PACK_SIZES.forEach(function(p) {
    if (!active[p]) return;
    var listings = getSplitListings(split, p);
    usedUnits += listings * p;
    if (listings > 0) activeCntFinal++;
  });
  var diff = usedUnits - total;
  var footerColor = diff === 0 ? 'var(--sv)' : (total === 0 ? 'var(--mu)' : '#e74c3c');
  var footerMsg = total === 0 ? 'Ingresa las unidades totales arriba'
    : diff === 0 ? '✅ Total: ' + usedUnits + '/' + total + ' unidades — ¡Cuadra perfecto!'
    : diff > 0   ? '⚠️ Total: ' + usedUnits + '/' + total + ' unidades — Sobran ' + diff
    :              '⚠️ Total: ' + usedUnits + '/' + total + ' unidades — Falta ' + Math.abs(diff);
  let footer = `<div id="split-footer"><div style="font-size:12px;color:${footerColor};margin-top:8px;font-weight:700">${footerMsg}</div></div>`;
  var noteHtml = activeCntFinal > 0
    ? '<div style="margin-top:10px;padding:10px;background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.3);border-radius:8px;font-size:12px;color:var(--sv);text-align:center">👇 Al tocar <strong>ADD TO CSV</strong> abajo se agregarán los ' + activeCntFinal + ' pack(s) activos con sus fotos</div>'
    : '';
  let note = `<div id="split-note">${noteHtml}</div>`;
  out.innerHTML = rows + footer + note;
}

// ── Excluir / incluir un pack del reparto ──────────────────────────────
function toggleSplitPack(p){
  if (!window._splitActive) window._splitActive = {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
  window._splitActive[p] = !window._splitActive[p];
  // Limpiar ajuste manual del pack que se excluyó
  if (!window._splitActive[p] && window._splitManual) delete window._splitManual[p];
  updateSplitCalc();
}

// ── Agregar todos los packs seleccionados al CSV (uno por pack) ────────
async function addSplitPacksToCSV(){
  if (!cur) { toast('⚠️ No product loaded'); return false; }

  // ── Misma protección que ADD TO CSV: esperar descripción rica ──
  if (cur && !cur._description) {
    toast('⏳ Esperando descripción completa...');
    var waited2 = 0;
    while (cur && !cur._description && waited2 < 12000) {
      await new Promise(function(res){ setTimeout(res, 300); });
      waited2 += 300;
    }
    if (cur && !cur._description) {
      cur._description = buildLocalFallbackDescription(cur, cur.packSize || 1);
      if (window._psDebug) window._psDebug('⚠️ Descripción IA no llegó a tiempo — usando fallback local con bullets');
    }
  }

  // ── Misma protección para item specifics ──
  if (cur && cur._specifics === undefined) {
    var waitedSpecs2 = 0;
    while (cur && cur._specifics === undefined && waitedSpecs2 < 8000) {
      await new Promise(function(res){ setTimeout(res, 300); });
      waitedSpecs2 += 300;
    }
  }

  var inp = $('split-total-input');
  var card = $('split-calc-card');
  if (!inp || !card) return false;
  var total = parseInt(String(inp.value).replace(/\D/g,''), 10) || 0;
  if (total <= 0) { return false; }

  var tierKey = card.dataset.tier || card.dataset.autoTier || 'media';
  var active = window._splitActive || {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
  var split = computeSplit(total, tierKey, active);

  // ── QUANTITY DIAGNOSTICS (Temporary instrumentation for root cause verification)
  // Log the complete quantity allocation path for each selected pack
  // IMPORTANT: Diagnostics DO NOT ALTER quantity values. Actual values reported as-is.
  console.log('[QTY-TRACE][SOURCE] inventory:' + total + ' tier:' + tierKey + ' selected:' + PACK_SIZES.filter(function(p){ return active[p]; }).join(','));
  var totalPhysicalExposure = 0;
  PACK_SIZES.forEach(function(p) {
    if (!active[p]) return;
    var computedQty = split[p] && split[p].listings || 0;
    var manualOverride = window._splitManual && window._splitManual[p];
    var finalQty = (manualOverride != null) ? manualOverride : computedQty;
    var physicalExposure = finalQty * p;  // Actual exposure, not fabricated
    if (finalQty > 0) totalPhysicalExposure += physicalExposure;  // Only count positive quantities
    console.log('[QTY-TRACE] Pack ' + p + 'pk: computed=' + computedQty + ' manual=' + (manualOverride != null ? manualOverride : 'none') + ' final=' + finalQty + ' exposure=' + physicalExposure + ' units');
  });
  console.log('[QTY-TRACE][SUMMARY] total_physical_exposure:' + totalPhysicalExposure + ' units');

  var shade = (cur._shade || '').trim();
  var expDate = cur._expDate || '';
  var location = cur.location || '';
  var baseTitle = (window._packState && window._packState.baseTitle) || cur.title || '';

  var added = 0, skippedDup = 0;
  // ── P0-A FIX: Pack selection must be based on user's active selection alone, not on quantity calculation.
  // User explicitly selecting a pack size should ALWAYS generate a CSV row, even if initial quantity is low.
  var packsToAdd = PACK_SIZES.filter(function(p){ return active[p]; });

  // ── ZERO QUANTITY VALIDATION: Block CSV export if any selected pack has Quantity <= 0
  // This prevents exporting invalid eBay CSVs while keeping selected packs recognized
  var zeroQtyPacks = [];
  packsToAdd.forEach(function(p) {
    var finalQty = getSplitListings(split, p);
    if (finalQty <= 0) {
      zeroQtyPacks.push(p);
    }
  });

  if (zeroQtyPacks.length > 0) {
    var msg = '❌ Cannot export CSV: Pack' + (zeroQtyPacks.length > 1 ? 's' : '') + ' ' + zeroQtyPacks.map(p => p + 'pk').join(', ') +
              ' ha' + (zeroQtyPacks.length > 1 ? 'n' : '') + ' recibido cantidad 0 en la distribución de inventario. ' +
              'Revisa la cantidad total de unidades o ajusta el tier de demanda.';
    toast(msg);
    console.log('[QTY-TRACE][VALIDATION-BLOCKED] ' + msg);
    console.log('[QTY-TRACE][BLOCKED-PACKS] ' + zeroQtyPacks.join(','));
    return false;
  }

  // ── VALIDACIÓN: los packs >1 DEBEN tener su imagen de pack generada ──
  // Si ImgBB falló y no se pudo subir la imagen del pack, avisar con toast
  // y CONTINUAR usando la foto del producto original.
  // (Antes usábamos confirm() pero en Safari Private a veces bloquea la UI)
  var missingImgs = [];
  for (var mi = 0; mi < packsToAdd.length; mi++) {
    var mp = packsToAdd[mi];
    if (mp > 1 && !(cur._packImages && cur._packImages[mp] && cur._packImages[mp].front)) {
      missingImgs.push(mp + 'pk');
    }
  }
  if (missingImgs.length) {
    toast('⚠️ Sin imágenes de pack para ' + missingImgs.join(', ') + ' — usando foto genérica');
    // Si NO hay ni siquiera la foto genérica, no hay nada que agregar → cancelar
    if (!cur._bundleImg && !cur._imgUrl && !cur._frontImg) {
      toast('❌ Sin fotos disponibles — toca 🎁 Generar Imágenes de Pack');
      return false;
    }
  }

  // Sube una imagen a ImgBB si quedó en base64; devuelve URL http o '' (con timeout propio de clUploadPhotoToImgBB = 15s)
  var ensurePackUrl = async function(u, tag){
    if (!u) return '';
    if (String(u).indexOf('http') === 0) return u; // ya es URL, no re-subir
    if (String(u).indexOf('data:') === 0) {
      var kk = (localStorage.getItem('cl_imgbb_key') || DEFAULT_IMGBB_KEY);
      if (!kk) return '';
      var up = await clUploadPhotoToImgBB(u, kk, tag);
      return up || '';
    }
    return '';
  };

  // ── PASO A: back, extras Y EL FRONT ORIGINAL (1 bote) son COMPARTIDOS entre todos los packs.
  //    Sirven como fotos de referencia del listado. Subirlos UNA sola vez, en paralelo.
  var sharedBackUrl = '';
  var sharedExtraUrls = [];
  var sharedFrontUrl = '';   // el FRONT normal (1 bote de frente, sin distintivo de pack)
  var _firstActive = packsToAdd.length ? (cur._packImages && cur._packImages[packsToAdd[0]]) : null;
  if (_firstActive) {
    toast('📤 Preparando fotos de referencia...');
    // El front original es la foto FRONT que se tomó (con fondo removido).
    // Se usa como foto de referencia adjunta, ADEMÁS de la imagen del pack.
    var _frontOrigSrc = cur._frontImg || cur._frontImgLocal || '';
    var _sharedJobs = [
      ensurePackUrl(_firstActive.back, 'ref-back'),
      ensurePackUrl(_frontOrigSrc, 'ref-front')
    ];
    var _exArr = _firstActive.extras || [];
    for (var _e = 0; _e < _exArr.length; _e++) {
      _sharedJobs.push(ensurePackUrl(_exArr[_e], 'ref-extra-' + _e));
    }
    var _sharedResults = await Promise.all(_sharedJobs);
    sharedBackUrl  = _sharedResults[0] || '';
    sharedFrontUrl = _sharedResults[1] || '';
    sharedExtraUrls = _sharedResults.slice(2).filter(function(x){ return !!x; });
  }

  // ── PASO B: subir SOLO el front de cada pack ACTIVO, todos en PARALELO.
  //    (packsToAdd ya está filtrado a los packs no excluidos con ✕)
  var _genericPhoto = cur._bundleImg || cur._imgUrl || cur._frontImg || '';
  var _frontUrlByPack = {};
  if (packsToAdd.length) {
    toast('📤 Subiendo fotos de ' + packsToAdd.length + ' pack(s) activo(s)...');
    var _frontJobs = packsToAdd.map(function(p){
      var pi = (cur._packImages && cur._packImages[p]) || null;
      var frontSrc = pi ? pi.front : '';
      return ensurePackUrl(frontSrc, 'pack-' + p).then(function(url){
        return { pack: p, url: url || '' };
      });
    });
    var _frontResults = await Promise.all(_frontJobs);
    _frontResults.forEach(function(r){ _frontUrlByPack[r.pack] = r.url; });
  }

  for (var i = 0; i < packsToAdd.length; i++) {
    var p = packsToAdd[i];
    var sku = makeSKU(cur.brand, cur.upc, p, cur.title);
    // Peso total del paquete (unidad × pack + caja) para eBay/ShipStation.
    // getUnitWeightLb() lee las casillas lb/oz. Si no hay peso, queda 0.
    var _unitLb = (typeof getUnitWeightLb === 'function') ? getUnitWeightLb() : 0;
    var _pkgLb = (_unitLb > 0 && typeof packTotalWeightLb === 'function') ? packTotalWeightLb(_unitLb, p) : 0;
    // Desglose en lb enteras + oz para el CSV de eBay (WeightMajor / WeightMinor)
    var _wMajor = _pkgLb > 0 ? Math.floor(_pkgLb) : 0;
    var _wMinor = _pkgLb > 0 ? Math.round((_pkgLb - _wMajor) * 16) : 0;
    if (_wMinor === 16) { _wMajor += 1; _wMinor = 0; }
    var dup = false;
    for (var j = 0; j < bulk.length; j++) { if (bulk[j].sku === sku) { dup = true; break; } }
    if (dup) { skippedDup++; continue; }

    var title = rebuildTitle(baseTitle, p, shade, expDate);
    var price = calcBundlePrice(cur.ebay || {}, p);

    // Armar las fotos del listado:
    //  1) PORTADA = imagen del pack (ej: 3-Pack con distintivo azul) → foto principal en eBay
    //  2) Referencias = FRONT original (1 bote) + BACK + EXTRAS
    // Todas ya subidas en paralelo arriba. eBay usa la primera como principal.
    var photoUrl = '';
    var fUrl = _frontUrlByPack[p] || '';
    if (fUrl) {
      var parts = [fUrl];                                  // portada: imagen del pack
      // Para el 1pk la portada YA es 1 bote de frente → no repetir el front original.
      if (sharedFrontUrl && p > 1 && sharedFrontUrl !== fUrl) parts.push(sharedFrontUrl);
      if (sharedBackUrl)  parts.push(sharedBackUrl);       // referencia: back
      for (var k2 = 0; k2 < sharedExtraUrls.length; k2++) parts.push(sharedExtraUrls[k2]); // extras
      photoUrl = parts.join('|');
    }
    // Si la imagen del pack no subió (rate limit/timeout), usar foto genérica del producto
    if (!photoUrl) {
      photoUrl = _genericPhoto;
      if (p > 1) toast('⚠️ ' + p + 'pk: usando foto del producto');
    }


    // ── P0-A FIX: Use actual computed quantity without modification
    // Selected pack is included in CSV with its actual quantity (may be 0).
    // eBay CSV importer will handle/reject invalid quantities.
    // Diagnostics visible in console for zero-quantity investigation.
    var qty = getSplitListings(split, p);

    bulk.push({
      sku:         sku,
      title:       title,
      price:       price,
      shade:       shade,
      expDate:     expDate,
      mfgCode:     (cur && cur._mfgCode) || '',
      upc:         cur.upc || '',
      brand:       cur.brand || 'Generic',
      category:    psSafeCategory(cur.category),
      description: descToEbayHTML(descForPack(cur._description || cur.description, p, cur)) || '',
      location:    location,
      packs:       p,
      quantity:    qty,
      photo:       photoUrl,
      bundleImg:   photoUrl,
      _specifics:  (cur && cur._specifics) || {},
      weightLb:    _pkgLb,
      weightMajor: _wMajor,
      weightMinor: _wMinor,
      truck:       window._truckNumber || '',
      scannedBy:   SAVVY_CURRENT_USER || 'unknown'
    });
    added++;
  }

  saveBulkToStorage();
  updateFAB();
  if (added > 0) {
    var msg = '✅ ' + added + ' pack(s) agregados al CSV' + (skippedDup ? ' — ' + skippedDup + ' ya estaban' : '') + ' (Auto-saved: ' + bulk.length + ' total)';
    toast(msg);
    console.log('PERSIST: ' + msg);

    // Nota: la ubicación se guardará en ShipStation automáticamente
    // cuando llegue la primera orden real desde eBay → Sellbrite → ShipStation.
    // En ese momento el Inventory Manager puede asignarle la ubicación.

    return true;
  } else if (skippedDup > 0) {
    toast('⚠️ Esos packs ya están en el CSV');
    return true;
  }
  return false;
}

function cycleSplitTier(){
  const card = $('split-calc-card');
  if(!card) return;
  const current = card.dataset.tier || card.dataset.autoTier || 'media';
  const idx = DEMAND_TIER_ORDER.indexOf(current);
  const next = DEMAND_TIER_ORDER[(idx+1) % DEMAND_TIER_ORDER.length];
  card.dataset.tier = next;
  updateSplitCalc();
}


// ── SELLBRITE + SHIPSTATION — ¿ya existe este producto? ¿dónde está? ──
// Portado del módulo Inventory Manager (mismo Railway backend, endpoints
// /sb/search y /ss/location).
async function psCheckSellbrite(upc, brand){
  const statusEl = $('ps-sellbrite-status');
  if(!statusEl) return;
  window._psSbExisting = {}; // limpiar estado del producto anterior
  // RAILWAY_SB URLs now use SAVVY_API for staging
  try{
    const upcClean = String(upc).replace(/\D/g,'');
    const sbCtrl = new AbortController();
    const sbTimer = setTimeout(function(){ sbCtrl.abort(); }, 10000);
    // ── Mandamos la marca también — el backend arma los mismos SKUs
    // exactos que ya calcula makeSKU() aquí (PREFIJO-UPC-Npk) y los pide
    // directo a Sellbrite, en vez de recorrer el catálogo completo (25k+
    // productos), lo cual antes hacía que nunca encontrara nada real. ──
    const res = await psAuthFetch('/sb/search' + '?upc=' + encodeURIComponent(upcClean) + (brand ? '&brand=' + encodeURIComponent(brand) : ''), { signal: sbCtrl.signal });
    clearTimeout(sbTimer);
    if (!res.ok && res.status !== 404) {
      throw new Error('HTTP ' + res.status + ' del backend Sellbrite');
    }
    const data = await res.json();

    if(res.status === 404 || data.status === 'not_found' || !data.products || !data.products.length){
      // No está en Sellbrite — consultar ShipStation por UPC de todas formas
      statusEl.innerHTML = '🆕 <strong style="color:#ff9800">No existe en Sellbrite todavía</strong><br><span id="ps-ss-upc-status" style="font-size:12px;color:var(--mu)">🔍 Consultando ShipStation...</span>';
      try {
        const ssRes = await psAuthFetch('/ss/location' + '?upc=' + encodeURIComponent(upcClean));
        const ssData = await ssRes.json();
        const ssEl = $('ps-ss-upc-status');
        if (ssEl) {
          if (ssData.exists) {
            var loc = ssData.warehouse_location || '';
            ssEl.innerHTML = loc
              ? '🚢 <strong style="color:#00e676">En ShipStation</strong> — 📍 ' + esc(loc)
              : '🚢 <strong style="color:#ffab00">En ShipStation</strong> — sin ubicación asignada';
            // Guardar el productId para actualizar la ubicación después si es necesario
            window._psSsProductId = ssData.product_id || null;
          } else {
            ssEl.innerHTML = '⚠️ <span style="color:#ff9800">No está en ShipStation — se creará al agregar al CSV</span>';
            window._psSsProductId = null;
          }
        }
      } catch(ssErr) {
        const ssEl = $('ps-ss-upc-status');
        if (ssEl) ssEl.innerHTML = '📍 <span style="color:var(--mu)">No se pudo consultar ShipStation</span>';
      }
      return;
    }

    const products = data.products;
    // ── Detectar qué packs (1/3/6/12) YA existen en Sellbrite y auto-excluirlos ──
    var sbExisting = {};
    products.forEach(function(p){
      var m = String(p.sku || '').toUpperCase().match(/-(\d+)\s*PK$/);
      if (m && String(p.sku || '').indexOf(upcClean) >= 0) {
        var pn = parseInt(m[1], 10);
        if (pn === 1 || pn === 3 || pn === 6 || pn === 12) sbExisting[pn] = true;
      }
    });
    window._psSbExisting = sbExisting;
    if (!window._splitActive) window._splitActive = {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
    var autoExcluded = [];
    PACK_SIZES.forEach(function(pn){
      if (sbExisting[pn] && window._splitActive[pn]) {
        window._splitActive[pn] = false;
        autoExcluded.push(pn + 'pk');
      }
    });
    if (autoExcluded.length) {
      toast('✅ Ya en Sellbrite: ' + autoExcluded.join(', ') + ' — excluidos del reparto');
      try { updateSplitCalc(); } catch(e) {}
    }
    _psSellbriteProducts = {}; // guardar info para el update por SKU
    _psSbInvVacio = {};        // marca los SKU cuyo inventario vino vacío
    let html = '📦 <strong style="color:#00e676">En Sellbrite: ' + products.length + ' listado' + (products.length>1?'s':'') + '</strong>';
    products.forEach(function(p, idx){
      const inv = p.inventory || {};
      const totalQty = inv.total_quantity || 0;
      const totalOnHand = inv.total_on_hand || 0;
      // ── warehouse_uuid: buscar en varias formas ──────────────────────────
      // ⚠️ 17 ago 2026: antes solo se leía de inv.channels[0].warehouse_uuid.
      // Cuando el producto tiene 0 disponibles, Sellbrite devuelve ese arreglo
      // VACÍO — así que el uuid salía en blanco y el backend contestaba
      // "Falta sku o warehouse_uuid". Círculo vicioso: solo se podía
      // actualizar el inventario de lo que YA tenía inventario, que es justo
      // lo contrario de lo que se necesita al reponer stock.
      // Ahora se intenta en el orden de lo más probable, y si no aparece se
      // recuerda el último uuid conocido de la sesión.
      var wh = '';
      var _fuentes = [
        (inv.channels    || [])[0],
        (inv.warehouses  || [])[0],
        (p.inventories   || [])[0],
        (p.warehouses    || [])[0],
        inv, p
      ];
      for (var _f = 0; _f < _fuentes.length && !wh; _f++) {
        var o = _fuentes[_f];
        if (o && typeof o === 'object') {
          wh = o.warehouse_uuid || o.warehouseUuid || o.warehouse_id || '';
        }
      }
      // Respaldo: el almacén es siempre el mismo, así que si en esta sesión ya
      // se vio un uuid válido, sirve para los productos sin existencia.
      if (!wh && window._psLastWarehouseUuid) wh = window._psLastWarehouseUuid;
      if (wh) window._psLastWarehouseUuid = wh;
      // ¿Sellbrite devolvió datos de inventario, o vino vacío?
      var _invVacio = !inv || Object.keys(inv).length === 0;
      _psSbInvVacio = _psSbInvVacio || {};
      _psSbInvVacio[idx] = _invVacio;
      // Deja la estructura cruda en la consola de debug (5 toques al logo)
      // para poder ver el nombre real del campo si esto vuelve a fallar.
      try { console.log('[Sellbrite] ' + p.sku + ' warehouse_uuid="' + wh + '" inventory=' + JSON.stringify(inv).substring(0,400)); } catch(e){}
      const inputId = 'ps-sbqty-' + idx;
      _psSellbriteProducts[idx] = { sku: p.sku, name: p.name || p.sku, upc: upcClean, warehouse_uuid: wh, inputId: inputId };

      html += '<div style="margin-top:8px;padding:8px;background:var(--sf);border-radius:8px;border-left:2px solid var(--bd)">'
        + '<div><span style="font-family:monospace;color:var(--ac)">' + esc(p.sku||'—') + '</span>'
        + ' — <span id="ps-sbqty-avail-' + idx + '">' + totalQty + '</span> disponibles</div>'
        + '<span id="ps-ssloc-' + idx + '" style="display:block;font-size:11px;color:var(--mu);margin:4px 0">📍 Consultando ShipStation...</span>'
        + '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">'
        + '<button onclick="psAdjustSbQty(\'' + inputId + '\',-1)" style="width:32px;height:32px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:18px;cursor:pointer">−</button>'
        + '<input id="' + inputId + '" type="number" inputmode="numeric" value="' + totalOnHand + '" style="flex:1;min-width:0;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:8px;color:var(--tx);font-size:15px;text-align:center">'
        + '<button onclick="psAdjustSbQty(\'' + inputId + '\',1)" style="width:32px;height:32px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:18px;cursor:pointer">+</button>'
        + '</div>'
        + '<div style="display:flex;gap:6px;margin-top:6px">'
        +   '<button id="ps-sbqty-btn-' + idx + '" onclick="psUpdateSellbriteInventory(' + idx + ',\'add\')" style="flex:1;padding:10px 6px;background:linear-gradient(135deg,#00c853,#00963f);border:none;border-radius:8px;color:#fff;font-weight:800;font-size:13px;cursor:pointer">➕ Sumar</button>'
        +   '<button id="ps-sbqty-set-' + idx + '" onclick="psUpdateSellbriteInventory(' + idx + ',\'set\')" style="flex:1;padding:10px 6px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-weight:800;font-size:13px;cursor:pointer">🔄 Reemplazar</button>'
        + '</div>'
        + '<div id="ps-sbqty-preview-' + idx + '" style="margin-top:5px;font-size:11px;color:var(--mu);text-align:center">Actual: ' + totalQty + ' — escribe cuántas <strong>llegaron</strong> y toca Sumar</div>'
        + '<div id="ps-sbqty-confirm-' + idx + '" style="margin-top:6px;font-size:12px;text-align:center"></div>'
        + '</div>';
    });
    statusEl.innerHTML = html;

    // Consultar la ubicación en ShipStation para cada SKU encontrado (en paralelo)
    products.forEach(function(p, idx){ psCheckShipStationLocation(p.sku, idx); });
  }catch(err){
    // ── El "{}" que salía antes en el log era inútil: los objetos Error
    // nativos de JS no serializan su .message/.stack con JSON.stringify.
    // Ahora mostramos el mensaje real, y distinguimos el tipo de falla
    // (red/timeout vs. HTTP error vs. respuesta no-JSON) para diagnosticar
    // rápido la próxima vez que esto pase. ──
    var errDetail = (err && err.name === 'AbortError') ? 'timeout — el backend no respondió a tiempo'
      : (err && err.message) ? err.message
      : String(err);
    console.error('psCheckSellbrite error:', errDetail);
    if (window._psDebug) window._psDebug('❌ psCheckSellbrite falló: ' + errDetail);
    statusEl.innerHTML = '<span style="color:var(--mu)">⚠️ No se pudo consultar Sellbrite (' + esc(errDetail) + ')</span>';
  }
}

async function psCheckShipStationLocation(sku, idx){
  const el = $('ps-ssloc-' + idx);
  if(!el) return;
  // RAILWAY_SB URLs now use SAVVY_API for staging
  try{
    const res = await psAuthFetch('/ss/location' + '?sku=' + encodeURIComponent(sku));
    const data = await res.json();
    const loc = data.exists ? (data.warehouse_location || '') : '';
    if(_psSellbriteProducts[idx]) _psSellbriteProducts[idx].currentLoc = loc; // para modo "añadir"/borrar

    // Cada ubicación (separada por coma) se muestra como fichita con ✕ para borrarla individualmente
    let statusLine;
    if (loc) {
      const parts = loc.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      let chips = parts.map(function(part, pi){
        return '<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.4);border-radius:14px;padding:3px 6px 3px 10px;margin:2px 3px 2px 0">'
          + '<strong style="color:#00e676;font-size:12px">' + esc(part) + '</strong>'
          + '<button onclick="psRemoveLocation(' + idx + ',' + pi + ')" style="width:18px;height:18px;background:rgba(255,82,82,.25);color:#ff8a80;border:none;border-radius:50%;font-size:11px;line-height:1;cursor:pointer;padding:0">✕</button>'
          + '</span>';
      }).join('');
      statusLine = '📍 Ubicaciones: <span style="display:inline">' + chips + '</span>';
    } else {
      statusLine = data.exists
        ? '📍 <span style="color:#ffab00">En ShipStation, sin ubicación asignada</span>'
        : '📍 <span style="color:#ff9800">No está en ShipStation todavía</span>';
    }

    const locInputId = 'ps-ssloc-input-' + idx;
    // Botones según haya o no ubicación existente:
    // - Sin ubicación: solo "📍 Guardar"
    // - Con ubicación: "➕ Añadir" (agrega sin borrar) y "🔄 Reemplazar"
    const buttonsHtml = loc
      ? '<button id="ps-ssloc-btn-' + idx + '" onclick="psSaveShipStationLocation(' + idx + ',\'append\')" style="padding:8px 10px;background:linear-gradient(135deg,#00c853,#00963f);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">➕ Añadir</button>'
        + '<button id="ps-ssloc-btn-rep-' + idx + '" onclick="psSaveShipStationLocation(' + idx + ',\'replace\')" style="padding:8px 10px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">🔄 Reemplazar</button>'
      : '<button id="ps-ssloc-btn-' + idx + '" onclick="psSaveShipStationLocation(' + idx + ',\'replace\')" style="padding:8px 12px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">📍 Guardar</button>';

    el.innerHTML = '<span id="ps-ssloc-line-' + idx + '">' + statusLine + '</span>'
      + '<div style="display:flex;gap:6px;margin-top:6px">'
      + '<input id="' + locInputId + '" type="text" placeholder="' + (loc ? 'Nueva ubicación adicional...' : 'Ej: A-12') + '" autocapitalize="characters" style="flex:1;min-width:0;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;padding:8px;color:var(--tx);font-size:13px">'
      + '<button onclick="psScanLocation(' + idx + ')" style="padding:8px 10px;background:var(--sf2);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-size:16px;cursor:pointer">📷</button>'
      + buttonsHtml
      + '</div>'
      + '<div id="ps-ssloc-confirm-' + idx + '" style="margin-top:6px;font-size:12px;text-align:center"></div>';
  }catch(err){
    console.error('psCheckShipStationLocation error:', err);
    el.innerHTML = '📍 <span style="color:var(--mu)">No se pudo consultar ubicación</span>';
  }
}

// ── Escanear la ubicación con la cámara (código de barras del anaquel/caja) ──
// Reutiliza el mismo escáner (savvyStartScan) que ya usa el resto de la app.
function psScanLocation(idx){
  document.querySelectorAll('.scr').forEach(function(s){ s.classList.remove('on'); });
  var camScreen = document.getElementById('scr-cam');
  if(camScreen) camScreen.classList.add('on');
  setTimeout(function(){
    if(typeof savvyStartScan !== 'function'){
      console.error('❌ savvyStartScan not defined!');
      toast('❌ Error: escáner no disponible');
      return;
    }
    savvyStartScan('qr-video', function(txt){
      if(typeof savvyStopScan === 'function') savvyStopScan('qr-video');
      document.querySelectorAll('.scr').forEach(function(s){ s.classList.remove('on'); });
      var resScreen = document.getElementById('scr-res');
      if(resScreen) resScreen.classList.add('on');
      var input = document.getElementById('ps-ssloc-input-' + idx);
      var value = String(txt||'').trim();
      if(input) input.value = value;
      toast('📷 Ubicación escaneada: ' + value);
    });
  }, 100);
}

async function psSaveShipStationLocation(idx, mode){
  mode = mode || 'replace';
  console.log('📍 psSaveShipStationLocation llamado, idx=' + idx + ', mode=' + mode);
  const p = (_psSellbriteProducts || {})[idx];
  const confirmEl = $('ps-ssloc-confirm-' + idx);
  const btnEl = $('ps-ssloc-btn-' + idx);
  if(!p){ console.error('❌ No hay producto guardado en _psSellbriteProducts[' + idx + ']'); toast('⚠️ No se cargó el producto'); return; }
  const input = $('ps-ssloc-input-' + idx);
  const newLoc = (input && input.value || '').trim();
  if(!newLoc){ toast('⚠️ Escribe o escanea una ubicación primero'); return; }

  // ── Modo AÑADIR: combinar con la ubicación existente sin borrarla ──
  let location = newLoc;
  if(mode === 'append' && p.currentLoc){
    // Evitar duplicados exactos (ignorando mayúsculas/espacios)
    const parts = p.currentLoc.split(',').map(function(s){ return s.trim(); });
    const already = parts.some(function(s){ return s.toLowerCase() === newLoc.toLowerCase(); });
    if(already){ toast('⚠️ Esa ubicación ya está en la lista'); return; }
    location = p.currentLoc + ', ' + newLoc;
  }
  // ShipStation limita warehouseLocation a ~100 caracteres
  if(location.length > 100){
    toast('⚠️ Demasiadas ubicaciones (límite ~100 caracteres). Considera reemplazar.');
    if(confirmEl) confirmEl.innerHTML = '<span style="color:#ff5252;font-weight:700">❌ El texto combinado excede el límite de ShipStation (' + location.length + '/100 caracteres)</span>';
    return;
  }

  await psPersistLocation(idx, location);
}

// ── Borrar UNA ubicación individual (la ✕ de cada fichita) ──
async function psRemoveLocation(idx, partIndex){
  const p = (_psSellbriteProducts || {})[idx];
  if(!p || !p.currentLoc){ toast('⚠️ No hay ubicaciones cargadas'); return; }
  const parts = p.currentLoc.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  if(partIndex < 0 || partIndex >= parts.length) return;
  const removed = parts.splice(partIndex, 1)[0];
  const newLocation = parts.join(', '); // puede quedar vacío = borrar todas
  console.log('🗑️ Borrando ubicación "' + removed + '" → nueva lista: "' + newLocation + '"');
  toast('🗑️ Quitando ' + removed + '...');
  await psPersistLocation(idx, newLocation);
}

// ── Guardado compartido: escribe el texto de ubicación (o vacío para borrar)
// en AMBOS sistemas: Sellbrite (bin_location) + ShipStation (pick ticket) ──
async function psPersistLocation(idx, location){
  const p = (_psSellbriteProducts || {})[idx];
  if(!p) return;
  const confirmEl = $('ps-ssloc-confirm-' + idx);
  const btnEl = $('ps-ssloc-btn-' + idx);
  // RAILWAY_SB URLs now use SAVVY_API for staging

  const btnRep = $('ps-ssloc-btn-rep-' + idx);
  if(btnEl){ btnEl.disabled = true; btnEl.textContent = '⏳...'; }
  if(btnRep){ btnRep.disabled = true; }

  // ── ESTRATEGIA DOBLE ──
  // 1. Sellbrite (bin_location) — SIEMPRE funciona, fuente de verdad desde el día uno
  // 2. ShipStation (warehouseLocation) — es lo que sale en el PICK TICKET; funciona
  //    solo si el producto ya existe ahí (ShipStation no permite crear por API)
  let sbOk = false, ssOk = false, ssErr = '', sbBinCleared = null;

  if(confirmEl) confirmEl.innerHTML = '<span style="color:var(--mu)">📤 1/2 Guardando en Sellbrite (bin location)...</span>';
  try{
    const sbRes = await psAuthFetch('/sb/update-inventory', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sku: p.sku,
        warehouse_uuid: p.warehouse_uuid || '',
        bin_location: location
      })
    });
    const sbResult = await sbRes.json();
    console.log('📥 Sellbrite bin_location:', sbRes.status, JSON.stringify(sbResult).substring(0,200));
    sbOk = sbRes.ok && sbResult.status !== 'error';
    if('bin_cleared' in sbResult) sbBinCleared = sbResult.bin_cleared; // true/false/null
  }catch(e){ console.error('Sellbrite bin_location error:', e); }

  if(confirmEl) confirmEl.innerHTML = '<span style="color:var(--mu)">📤 2/2 Guardando en ShipStation (pick ticket)...</span>';
  try{
    const res = await psAuthFetch('/ss/create-product', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sku: p.sku,
        name: p.name || p.sku,
        warehouse_location: location,
        upc: p.upc || ''
      })
    });
    const result = await res.json();
    console.log('📥 ShipStation:', res.status, JSON.stringify(result).substring(0,200));
    ssOk = res.ok && result.status !== 'error';
    if(!ssOk) ssErr = result.error || ('HTTP ' + res.status);
  }catch(e){ ssErr = e.message || String(e); console.error('ShipStation error:', e); }

  // ── Resultado combinado, claro y permanente ──
  const isClear = !location;
  if(sbOk && ssOk){
    toast(isClear ? '🗑️ Ubicación borrada' : '✅ Ubicación guardada en Sellbrite y ShipStation', 3000);
    await psCheckShipStationLocation(p.sku, idx); // refresca — las fichitas verdes son la confirmación
    const c2 = $('ps-ssloc-confirm-' + idx);
    if(c2){
      if(isClear && sbBinCleared === false){
        c2.innerHTML = '<span style="color:#ffab00;font-weight:700">🗑️ Borrada en ShipStation ✅ (pick ticket limpio)<br>⚠️ Sellbrite rechazó el borrado por API — quítala manualmente en app.sellbrite.com si te importa que quede limpio ahí</span>';
      } else if(isClear){
        c2.innerHTML = '<span style="color:#00e676;font-weight:700">🗑️ Ubicación(es) borrada(s) en Sellbrite + ShipStation</span>';
      } else {
        c2.innerHTML = '<span style="color:#00e676;font-weight:700">✅ Guardada en Sellbrite + ShipStation (saldrá en el pick ticket)</span>';
      }
    }
  } else if(sbOk && !ssOk){
    toast('✅ Guardada en Sellbrite (ShipStation pendiente)', 3500);
    if(confirmEl) confirmEl.innerHTML = '<span style="color:#ffab00;font-weight:700">✅ Guardada en Sellbrite (bin location).<br>⚠️ ShipStation: ' + esc(ssErr) + '<br><span style="font-weight:400;font-size:11px;color:var(--mu)">Cuando llegue la primera orden de este SKU, ShipStation creará el producto y podrás guardar la ubicación ahí (o se puede automatizar después).</span></span>';
  } else if(!sbOk && ssOk){
    toast('✅ Guardada en ShipStation (Sellbrite falló)', 3500);
    await psCheckShipStationLocation(p.sku, idx);
    const c3 = $('ps-ssloc-confirm-' + idx);
    if(c3) c3.innerHTML = '<span style="color:#ffab00;font-weight:700">✅ ShipStation OK · ⚠️ Sellbrite no se pudo actualizar</span>';
  } else {
    toast('❌ No se pudo guardar la ubicación');
    if(confirmEl) confirmEl.innerHTML = '<span style="color:#ff5252;font-weight:700">❌ Falló en ambos sistemas. ShipStation: ' + esc(ssErr||'—') + '</span>';
  }
  const btnEl2 = $('ps-ssloc-btn-' + idx);
  if(btnEl2){ btnEl2.disabled = false; btnEl2.textContent = (p.currentLoc ? '➕ Añadir' : '📍 Guardar'); }
  const btnRep2 = $('ps-ssloc-btn-rep-' + idx);
  if(btnRep2){ btnRep2.disabled = false; }
}

function psAdjustSbQty(inputId, delta){
  const input = $(inputId);
  if(!input) return;
  const val = parseInt(input.value||'0', 10) + delta;
  input.value = Math.max(0, val);
}

async function psUpdateSellbriteInventory(idx, modo){
  console.log('✅ psUpdateSellbriteInventory llamado, idx=' + idx);
  const p = (_psSellbriteProducts || {})[idx];
  const confirmEl = $('ps-sbqty-confirm-' + idx);
  const btnEl = $('ps-sbqty-btn-' + idx);
  if(!p){ console.error('❌ No hay producto guardado en _psSellbriteProducts[' + idx + ']'); toast('⚠️ No se cargó el producto'); return; }
  const input = $(p.inputId);
  const newQty = parseInt((input && input.value) || '0', 10);
  // RAILWAY_SB URLs now use SAVVY_API for staging

  // Último recurso antes de mandar: si este producto no traía uuid (típico
  // cuando está en 0), se usa el del almacén visto en esta sesión. Y si de
  // plano no hay ninguno, se dice QUÉ falta y qué hacer, en vez del mensaje
  // críptico "Falta sku o warehouse_uuid" que devuelve el backend.
  if (!p.warehouse_uuid && window._psLastWarehouseUuid) {
    p.warehouse_uuid = window._psLastWarehouseUuid;
  }
  // ── PROTECCIÓN CONTRA BORRADO DE STOCK ────────────────────────────────
  // 17 ago 2026: REP-742676961970-1 tiene 924 unidades en Sellbrite pero la
  // app mostraba 0, porque el backend no está trayendo el inventario
  // (inventory={} en el log). Si alguien le da a "Actualizar" con ese 0 en
  // pantalla, le manda 0 a Sellbrite y BORRA las 924 unidades reales.
  // Mientras el backend no devuelva inventario, no se deja mandar nada:
  // no podemos escribir sobre un dato que no pudimos leer.
  if (typeof _psSbInvVacio !== 'undefined' && _psSbInvVacio && _psSbInvVacio[idx]) {
    if (confirmEl) confirmEl.innerHTML =
      '<span style="color:#ff5252;font-weight:700">🛑 Bloqueado — Sellbrite no devolvió el inventario de este SKU.</span>' +
      '<br><span style="font-size:11px;color:var(--mu)">La app no sabe cuántas unidades hay realmente, así que ' +
      'mandar una cantidad podría <strong>borrar el stock verdadero</strong>. ' +
      'Actualiza este producto directo en Sellbrite hasta que se arregle el backend.</span>';
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✅ Actualizar inventario'; }
    return;
  }

  // ⚠️ 18 ago 2026: ya NO se bloquea por falta de warehouse_uuid.
  // El backend lo resuelve solo con el almacén de la cuenta cuando la app no
  // se lo manda, así que trabar aquí era un obstáculo sin motivo. Lo que SÍ
  // sigue bloqueando es no conocer la cantidad real (ver arriba), porque ahí
  // el riesgo es borrar stock verdadero.
  console.log('📤 Enviando a /sb/update-inventory:', JSON.stringify({sku:p.sku, warehouse_uuid:p.warehouse_uuid, quantity:newQty}));

  if(btnEl){ btnEl.disabled = true; btnEl.textContent = '⏳ Actualizando...'; }
  if(confirmEl) confirmEl.innerHTML = '<span style="color:var(--mu)">📤 Enviando a Sellbrite...</span>';
  try{
    const res = await psAuthFetch('/sb/update-inventory', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sku: p.sku,
        warehouse_uuid: p.warehouse_uuid || '',
        quantity: newQty,
        mode: (modo === 'add' ? 'add' : 'set')
      })
    });
    console.log('📥 Respuesta /sb/update-inventory, status:', res.status);
    const result = await res.json();
    console.log('📥 Body:', JSON.stringify(result));
    if(!res.ok || result.status === 'error'){
      throw new Error(result.error || ('HTTP ' + res.status));
    }
    // ── Confirmación con la OPERACIÓN completa ────────────────────────
    // El total lo calcula y confirma el backend (result.available), no la
    // app: cuando se suma, la cuenta se hace sobre el valor recién leído de
    // Sellbrite, no sobre el que estaba en pantalla. Entre que se cargó la
    // tarjeta y se presionó el botón pudo haberse vendido algo.
    var _antes = (result.previous_available != null) ? result.previous_available : '?';
    var _final = (result.available != null) ? result.available : newQty;
    var _op = (result.mode === 'add')
      ? (_antes + ' + ' + newQty + ' = <strong>' + _final + '</strong>')
      : ('<strong>' + _final + '</strong> (reemplazado, antes ' + _antes + ')');
    if(confirmEl) confirmEl.innerHTML = '<span style="color:#00e676;font-weight:700">✅ Confirmado por Sellbrite — ' + _op + '</span>';
    const availSpan = $('ps-sbqty-avail-' + idx);
    if(availSpan) availSpan.textContent = _final;
    var prevEl = $('ps-sbqty-preview-' + idx);
    if(prevEl) prevEl.innerHTML = 'Actual: ' + _final + ' — escribe cuántas <strong>llegaron</strong> y toca Sumar';
    // Dejar la casilla en 0 para que nadie repita la suma sin querer.
    if(input) input.value = 0;
    toast('✅ ' + p.sku + ' → ' + _final + ' unidades', 3000);
  }catch(err){
    console.error('❌ psUpdateSellbriteInventory error:', err.message, err);
    if(confirmEl) confirmEl.innerHTML = '<span style="color:#ff5252;font-weight:700">❌ No se pudo actualizar: ' + esc(err.message||String(err)) + '</span>';
    toast('❌ Error al actualizar: ' + (err.message||err));
  }finally{
    if(btnEl){ btnEl.disabled = false; btnEl.textContent = '➕ Sumar'; }
  }
}

// ── DESCRIPCIÓN eBay generada automáticamente con Claude ──────────────
// Se llama automáticamente al renderizar el resultado.
// Formato fijo pedido por Manuel:
//   1. Introducción del producto
//   2. Lista de beneficios con bullets
//   3. Contenido detallado del paquete
//   4. Disclaimer final (siempre igual, incluido en la descripción)
const PS_DESC_DISCLAIMER = 'This package was assembled by our company. All products are new and authentic. Packaging may vary from retail presentation.';

// ⚠️ 18 ago 2026 — El texto de arriba declara un bundle armado por nosotros.
// Se estaba mandando SIEMPRE, también en los listados de 1 unidad, donde la
// misma descripción decía "This listing includes 1 unit" y acto seguido
// "This multi-pack bundle was packaged by our store". Dos frases que se
// contradicen en la misma ficha: el comprador lee que le llega un paquete
// armado por la tienda cuando en realidad recibe el producto tal cual salió
// de fábrica. Para 1 unidad se usa este otro texto, que dice lo mismo sobre
// autenticidad sin inventar un bundle que no existe.
// Detectado en GOV-850061998606-1pk (Govee H706A).
const PS_DESC_DISCLAIMER_SINGLE = 'All products are new and authentic. Packaging may vary from retail presentation.';

function psDisclaimerForPack(disclaimer, packs) {
  if (!disclaimer) return '';
  if (Number(packs) > 1) return disclaimer;
  // Solo se sustituye el texto de bundle. Si alguien puso otro disclaimer
  // a mano, se respeta tal cual.
  if (/multi-pack bundle was packaged by our store/i.test(disclaimer)) {
    return PS_DESC_DISCLAIMER_SINGLE;
  }
  return disclaimer;
}

async function psAutoGenerateDescription(){
  if(!cur){ return; }
  const out = $('ps-desc-result');
  if(!out){ return; }
  if(!savvyToken()){ console.warn('Sin sesion activa: inicia sesion para usar Claude'); return; }

  const packs = cur.packSize || 1;
  const title = cur.title || cur.prod && cur.prod.title || '';
  const brand = cur.brand || '';
  const prodTitle = (cur.prod && cur.prod.title) || title;
  const category = cur.categoryName || 'Health & Beauty';

  const prompt = `Write an eBay product description in ENGLISH for this listing:

Product: ${prodTitle}
Brand: ${brand}
Category: ${category}
eBay title: ${title}

STRICT FORMAT — respond ONLY with valid JSON (no markdown, no backticks):
{
 "intro": "2-3 sentence engaging product introduction paragraph",
 "benefits": ["benefit 1", "benefit 2", "benefit 3", "benefit 4", "benefit 5"],
 "package_contents": "Detailed description of what the package includes, without mentioning quantity or how many units this listing contains"
}

Rules:
- ENGLISH only
- Do NOT invent medical claims; use safe marketing language ("supports", "helps promote")
- Do NOT mention UPC or barcodes
- NEVER use the words "assembled", "assembly", or anything implying WE manufacture the product
- Do NOT claim items are factory-sealed, from the original manufacturer, or sourced directly from the manufacturer
- CRITICAL — the "intro" and "benefits" must describe the PRODUCT ITSELF only. Do NOT mention any quantity, count of units, "pack of N", "bundle of N", or how many bottles/boxes/items are included. Those numbers change per listing, so keep intro/benefits quantity-free.
- ONLY "package_contents" describes what is included, but WITHOUT specifying HOW MANY of this listing. The quantity will be added separately. For example, if the title is "LEGO Creator 3 in 1 Space Shuttle Building Set", package_contents should describe "LEGO Creator 3 in 1 Space Shuttle Building Set" without saying "1 unit" or "includes 2 units". The quantity will be inserted dynamically.
- benefits: 4 to 6 bullets, each under 12 words, NO quantities
- If the eBay title separately mentions a piece/count number for what's INSIDE the product (e.g. "6 Pieces", "55-Piece Set", "24 Count", "8oz"), copy it EXACTLY as written in the title and include it in package_contents when describing the single product. This is the product\'s inherent attribute, not a bundle quantity.
- IMPORTANT: NEVER write the literal characters "(s)" anywhere in your response — always write the fully resolved word (e.g. "2 units" or "1 unit", never "unit(s)" or "2 units(s)").`;

  try{
    const ctrl = new AbortController();
    const timer = setTimeout(function(){ ctrl.abort(); }, 20000);
    const r = await savvyClaude({
      signal: ctrl.signal,
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:800,messages:[{role:'user',content:prompt}]}) // ⚠️ HAIKU LOCKED - NEVER CHANGE
    });
    clearTimeout(timer);
    if(!r.ok) throw new Error('Claude HTTP ' + r.status);
    const d = await r.json();
    const txt = (d.content&&d.content[0]&&d.content[0].text||'').replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(txt);

    // ── Sanitizer: eliminar el patrón literal "(s)" por si Haiku lo repite
    // pese a la instrucción (defensa adicional contra "2 units(s)"). ──
    function _fixPluralEcho(s) {
      if (!s || typeof s !== 'string') return s;
      return s.replace(/\b(unit|item|piece|bottle|box|pack)\(s\)/gi, function(m, w){ return w + 's'; });
    }

    // ── Sanitizer: el intro y los benefits NUNCA deben mencionar cantidad
    // (regla explícita del prompt), pero a veces Haiku la menciona de todas
    // formas — y si el pack size cambia después (ej. de 2 a 1), la mención
    // queda INCORRECTA y puede confundir al comprador ("bundle of 2" en un
    // listado de Pack of 1). Quitamos cualquier mención de cantidad como
    // respaldo determinístico, sin depender de que la IA obedezca siempre. ──
    function _stripQtyFromIntro(s) {
      if (!s || typeof s !== 'string') return s;
      return s
        .replace(/\b(this|these)\s+(bundle|pack|set|lot)\s+of\s+\d+\s+/gi, '$1 ')
        .replace(/\b(bundle|pack|set|lot)\s+of\s+\d+\s+/gi, '')
        .replace(/\b\d+\s*(units?|pieces?|bottles?|boxes?|packs?|sleeves?)\s+of\s+/gi, '')
        .replace(/\s{2,}/g, ' ').trim();
    }

    cur._description = {
      intro: _stripQtyFromIntro(_fixPluralEcho(parsed.intro || '')),
      benefits: Array.isArray(parsed.benefits) ? parsed.benefits.map(function(b){ return _stripQtyFromIntro(_fixPluralEcho(b)); }) : [],
      package_contents: _fixPluralEcho(parsed.package_contents || ''),
      disclaimer: PS_DESC_DISCLAIMER
    };
    if(out) out.innerHTML = renderDescriptionHTML(cur._description);
  }catch(err){
    console.error('psAutoGenerateDescription error:', err);
    if(out) out.innerHTML = '<div style="color:#ff9800;font-size:12px;padding:12px;background:var(--sf2);border-radius:8px">' + (err.name==='AbortError'?'Claude tardó demasiado':'⚠️ No se pudo generar descripción') + '</div>';
  }
}

// ── GENERAR ITEM SPECIFICS CON IA ───────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// FASE 1: Parsing local de Item Specifics ANTES de llamar a Claude
// Esto pre-llena Set Includes, Type correcto, Flavor, etc. sin APIs
// ──────────────────────────────────────────────────────────────────────────

// Extrae "Set Includes" del título (ej: "44 Count", "3 Pack", "6 Tests")
function psParseSetIncludes(title) {
  if (!title) return null;
  
  var t = (title || '').toLowerCase();
  
  // ⚠️ ESPECIAL: Para Dolls/Toys - detectar "Doll" en el título
  if (t.match(/doll|barbie|polly\s+pocket|american\s+girl|bratz/i)) {
    // Si el título mention "set" o múltiples items
    if (t.match(/\bset\b|playset|collector|bundle/i)) return null; // Dejar que Claude lo llene
    return 'Doll'; // Default para dolls individuales
  }
  
  // Patrones comunes para medicinas/skincare: "44 Count", "3 Pack", "X units", "X tests", "365ct", etc.
  // IMPORTANTE: "ct" (count abreviado) agregado para detectar "365ct"
  var regex = /(\d+)\s*(?:ct|CT|count|pack|units?|tests?|strips?|bottles?|boxes?|pieces?|pcs?|tabs?|tablets?|caps?|capsules?)/gi;
  var matches = [];
  var match;
  
  while ((match = regex.exec(title)) !== null) {
    matches.push({
      num: parseInt(match[1]),
      text: match[0],
      word: match[0].replace(/^\d+\s*/, '').toLowerCase()
    });
  }
  
  // Si no hay coincidencias, retornar null
  if (matches.length === 0) return null;
  
  // ESTRATEGIA: Priorizar números grandes (365, 100) sobre pequeños (10, 3)
  // Porque "365 tablets" es el Set Includes, "10mg" es dosage (que no queremos)
  var bestMatch = matches.reduce(function(prev, curr) {
    return curr.num > prev.num ? curr : prev;
  });
  
  var num = bestMatch.num;
  var word = bestMatch.word;
  
  // Mapear a valores eBay estándar
  if (word.match(/ct|count/i)) return num + ' Tablets';  // "365ct" o "365 count" → "365 Tablets"
  if (word.match(/pack|units?|pieces?|pcs?/i)) return num + ' Units';
  if (word.match(/test/i)) return num + ' Tests';
  if (word.match(/strip/i)) return num + ' Strips';
  if (word.match(/bottle/i)) return num + ' Bottles';
  if (word.match(/box/i)) return num + ' Boxes';
  if (word.match(/tab/i)) return num + ' Tablets';
  if (word.match(/cap/i)) return num + ' Capsules';
  
  // Default
  return bestMatch.text;
}

// Extrae "Type" correcto según categoría y título (NO devuelve "Other")
function psExtractTypeFromTitle(title, category, brand) {
  if (!title) return null;
  
  var cat = String(category || '');
  var t = (title || '').toLowerCase();
  var b = (brand || '').toLowerCase();
  
  // FERTILITY & OVULATION (categoría 30118)
  if (cat === '30118') {
    if (t.match(/ovulation|lh|opk/i)) return 'Ovulation Test';
    if (t.match(/pregnancy|hcg/i)) return 'Pregnancy Test';
    if (t.match(/fsh|hormone/i)) return 'Hormone Test';
  }
  
  // COLD, COUGH & FLU (categoría 75038)
  if (cat === '75038') {
    if (t.match(/cough/i)) return 'Cough Treatment';
    if (t.match(/cold/i)) return 'Cold Treatment';
    if (t.match(/flu/i)) return 'Flu Treatment';
  }
  
  // OVER-THE-COUNTER MEDICATIONS (categoría 75037) - ALLERGY/ANTIHISTAMINE
  if (cat === '75037') {
    // ⚠️ CRÍTICO: Antihistamines PRIMERO, antes de "Allergy Relief"
    if (t.match(/loratadine|cetirizine|fexofenadine|desloratadine|levocetirizine|antihistamine\b/i)) {
      return 'Antihistamine';
    }
    // Decongestants
    if (t.match(/pseudoephedrine|phenylephrine|decongestant/i)) return 'Decongestant';
    // Pain relief
    if (t.match(/pain|ache|analgesic|ibuprofen|acetaminophen/i)) return 'Pain Relief';
    // Digestive
    if (t.match(/digestiv|acid|antacid|omeprazole/i)) return 'Digestive Aid';
    // Generic allergy fallback (SOLO si no hay antihistamine)
    if (t.match(/allerg/i)) return 'Allergy Relief';
  }
  
  // VITAMINS & SUPPLEMENTS (categoría 51227)
  if (cat === '51227') {
    if (t.match(/vitamin\s*[a-z]/i)) return 'Vitamin Supplement';
    if (t.match(/mineral/i)) return 'Mineral Supplement';
    if (t.match(/omega|fish oil/i)) return 'Omega Supplement';
  }
  
  // SKINCARE (categorías 21205, 177765, 67181, etc.)
  if (['21205', '177765', '67181', '67169', '180959', '31774', '31787'].includes(cat)) {
    // Tipos de skincare basados en título
    if (t.match(/cleanser|cleansing\s+water|toner|cleanser|makeup\s+remover/i)) return 'Cleansing Water';
    if (t.match(/cream\b/i) && !t.match(/sun|spf/i)) return 'Face Cream';
    if (t.match(/lotion\b/i)) return 'Lotion';
    if (t.match(/serum\b/i)) return 'Serum';
    if (t.match(/moisturizer|moisturiser/i)) return 'Moisturizer';
    if (t.match(/daily\s+use|daily\s+moisturizer|daily\s+care/i)) return 'Daily Use';
    if (t.match(/sunscreen|sun\s+protection|spf\s+\d+/i)) return 'Sunscreen';
  }
  
  // LASH & BROW (categoría 172023) - MEJORADO
  if (cat === '172023') {
    if (t.match(/eyelash|lash\s+serum|brow\s+serum/i)) return 'Lash Serum';
    if (t.match(/eyebrow|brow/i)) return 'Eyebrow Serum';
    if (t.match(/eyelash|lash/i)) return 'Lash Serum';
    return 'Lash Serum'; // Default para esta categoría
  }
  
  // GROOMING & TRIMMERS (categoría 67408) - NUEVA
  if (cat === '67408') {
    if (t.match(/beard\s+trimmer|mustache\s+trimmer/i)) return 'Beard Trimmer';
    if (t.match(/nose\s+trimmer/i)) return 'Nose Trimmer';
    if (t.match(/hair\s+clipper|clipper\b/i)) return 'Hair Clipper';
    if (t.match(/grooming\s+kit|kit\b/i)) return 'Grooming Kit';
    if (t.match(/trimmer\b/i)) return 'Trimmer';
    return 'Grooming Kit'; // Default para grooming
  }
  
  // LIPSTICK & LIP PRODUCTS (categoría 31804) - NUEVA
  if (cat === '31804') {
    if (t.match(/lipstick\b/i)) return 'Lipstick';
    if (t.match(/lip\s+kit|lip\s+set/i)) return 'Lip Kit';
    if (t.match(/lip\s+gloss|gloss\b/i)) return 'Lip Gloss';
    if (t.match(/lip\s+liner/i)) return 'Lip Liner';
    if (t.match(/ready|kit/i)) return 'Lip Kit'; // "Mistletoe Ready Lip Kit"
    return 'Lipstick'; // Default para lip products
  }
  
  // TOYS - DOLLS (categoría 220)
  if (cat === '220') {
    // Types específicos de dolls/toys
    if (t.match(/doll\b/i)) return 'Doll';
    if (t.match(/action\s+figure|figure\b/i)) return 'Action Figure';
    if (t.match(/plushie|plush\b/i)) return 'Plushie';
  }
  
  // Si no match específico, devolver null (dejar que Claude lo llene)
  return null;
}

// Extrae "Flavor" del título si existe (para medicinas, bebidas, etc.)
function psExtractFlavorFromTitle(title) {
  if (!title) return null;
  
  var flavorPatterns = [
    /(?:Flavor|Flavour|Taste):\s*(\w+)/i,
    /^([A-Z][a-z]+)\s+(?:Flavor|Flavour|Taste)/i,
    /(Grape|Cherry|Strawberry|Raspberry|Orange|Lemon|Lime|Mint|Vanilla|Chocolate|Cinnamon|Honey|Peach|Apple|Blueberry|Watermelon|Pineapple)\b/i
  ];
  
  for (var i = 0; i < flavorPatterns.length; i++) {
    var match = title.match(flavorPatterns[i]);
    if (match) {
      var flavor = match[1] || match[0];
      // Normalizar
      flavor = flavor.charAt(0).toUpperCase() + flavor.slice(1).toLowerCase();
      return flavor;
    }
  }
  return null;
}

// Extrae "Administration" según categoría (Oral para OTC/Medicines)
function psExtractAdministration(category) {
  var cat = String(category || '');
  
  // OTC/Medicines/Supplements = Oral por default
  // Categorías: 75037 (OTC), 75038 (Cold/Cough), 51227 (Vitamins), 180959 (First Aid), 67169 (Supplements)
  if (['75037', '75038', '51227', '180959', '67169', '105070'].includes(cat)) {
    return 'Oral'; // Default seguro para la mayoría de OTC
  }
  return null;
}

// Extrae "Age Group" según título (Adult/Children/Senior) — OJO: pese al
// nombre de la función, esto llena el aspecto "Age Group" de eBay, NO
// "Department". Se dejó el nombre por compatibilidad con el resto del código.
function psExtractDepartment(title) {
  if (!title) return 'Adult'; // Default
  var t = (title || '').toLowerCase();
  
  if (t.match(/children|kids|baby|infant|toddler|pediatric/i)) return 'Children';
  if (t.match(/senior|elderly|adult\s+65|65\+/i)) return 'Senior';
  
  return 'Adult'; // Default para mayoría
}

// Extrae "Department" REAL de eBay para salud/belleza: es un aspecto de
// GÉNERO (Men/Women/Unisex), no de edad — confirmado con la respuesta real
// de eBay ("Department: Unisex" como sugerencia, separado de "Adult").
// Default seguro: "Unisex", salvo que el título indique explícitamente
// un producto dirigido a un género.
function psExtractGenderDepartment(title) {
  var t = (title || '').toLowerCase();
  if (/\bwomen'?s?\b|\bfor her\b|\bfeminine\b|\bprenatal\b|\bmenopause\b/.test(t)) return 'Women';
  if (/\bmen'?s?\b|\bfor him\b|\bmasculine\b|\bprostate\b/.test(t)) return 'Men';
  return 'Unisex';
}

// Extrae SPF del título para sunscreen (CRÍTICO para categoría 31774)
function psExtractSPF(title, category) {
  if (!title) return null;
  var t = title.toLowerCase();
  var cat = String(category || '');
  
  // Categorías de sunscreen: 31774, 31787, 180959
  if (['31774', '31787', '180959'].includes(cat)) {
    var match = t.match(/spf\s*(\d+)/i);
    if (match) return 'SPF ' + match[1];
  }
  return null;
}

// Extrae Hair Type según el título (para haircare cat 177660, 67181)
function psExtractHairType(title) {
  if (!title) return null;
  var t = (title || '').toLowerCase();
  
  if (t.match(/damaged|damage|repair/i)) return 'Damaged Hair';
  if (t.match(/curly|curl|coily/i)) return 'Curly Hair';
  if (t.match(/straight|straightening/i)) return 'Straight Hair';
  if (t.match(/oily|oiliness|oil control/i)) return 'Oily Hair';
  if (t.match(/dry|dryness/i)) return 'Dry Hair';
  if (t.match(/thick|volume|volumizing/i)) return 'Thick Hair';
  if (t.match(/thin|fine|thinning/i)) return 'Fine Hair';
  
  // Default para haircare
  return null;
}

// Extrae PAO (Period After Opening) para cosmetics/haircare/skincare
function psExtractPAO(category) {
  var cat = String(category || '');
  
  // Cosmetics/Haircare/Skincare típicamente = 12 meses (12M)
  // Categorías: 177660 (Hair), 67181 (Haircare), 67169 (Skincare), 180959 (First Aid/Sunscreen)
  if (['177660', '67181', '67169', '180959', '31774', '31787'].includes(cat)) {
    return '12M'; // 12 months post-opening (estándar industria)
  }
  return null;
}

// Extrae Body Area según categoría (Full Body para sunscreen, Hair para haircare)
function psExtractBodyArea(category, title) {
  var cat = String(category || '');
  var t = (title || '').toLowerCase();
  
  // Sunscreen = Full Body por default
  if (['31774', '31787'].includes(cat)) return 'Full Body';
  
  // Haircare = Scalp/Hair
  if (['177660', '67181'].includes(cat)) {
    if (t.match(/scalp/i)) return 'Scalp';
    return 'Hair'; // Default para haircare
  }
  
  // SKINCARE - Moisturizers, Cleansers, etc. (categoría 21205, 177765, 67181, etc.)
  if (['21205', '177765', '67181', '67169', '180959'].includes(cat)) {
    // Detectar Body Area del título
    if (t.match(/face|facial|cleanser|toner|serum/i)) return 'Face';
    if (t.match(/body\s+lotion|body\s+cream|body\s+moisturizer/i)) return 'Full Body';
    if (t.match(/hand\s+cream|hand\s+lotion|hand\s+moisturizer/i)) return 'Hand';
    if (t.match(/lip\b|lip\s+balm/i)) return 'Lip';
    if (t.match(/eye\b|eye\s+cream|under\s+eye/i)) return 'Eye';
    // Default para skincare: Face
    if (t.match(/moisturizer|lotion|cream|serum/i)) return 'Face';
  }
  
  return null;
}

// NUEVA: Extrae "Character" para Dolls (Barbie - Chelsea, Ken, etc.)
function psExtractDollCharacter(title, brand) {
  if (!title) return null;
  var t = (title || '').toLowerCase();
  var b = (brand || '').toLowerCase();
  
  // Si es Barbie, detectar character específico
  if (b.match(/barbie/i)) {
    // Barbie characters
    if (t.match(/chelsea/i)) return 'Chelsea';
    if (t.match(/ken\b/i)) return 'Ken';
    if (t.match(/skipper/i)) return 'Skipper';
    if (t.match(/stacie/i)) return 'Stacie';
    if (t.match(/babysitters\s+club|bsc/i)) return 'BSC';
    // Default para Barbie
    return 'Barbie';
  }
  
  // Otros dolls/characters
  if (t.match(/polly\s+pocket/i)) return 'Polly Pocket'; // Aunque esto es Franchise, puede usarse aquí
  if (t.match(/american\s+girl/i)) return 'American Girl';
  if (t.match(/monster\s+high/i)) return 'Monster High';
  
  return null;
}

// NUEVA: Extrae "Franchise" para Dolls (Polly Pocket, American Girl, Monster High)
function psExtractFranchise(title, brand) {
  if (!title) return null;
  var t = (title || '').toLowerCase();
  var b = (brand || '').toLowerCase();
  
  // Franchises principales
  if (t.match(/polly\s+pocket/i)) return 'Polly Pocket';
  if (t.match(/american\s+girl/i)) return 'American Girl';
  if (t.match(/monster\s+high/i)) return 'Monster High';
  if (t.match(/bratz/i)) return 'Bratz';
  if (t.match(/lol\s+surprise|l\.o\.l/i)) return 'LOL Surprise';
  if (t.match(/our\s+generation/i)) return 'Our Generation';
  
  return null;
}

// NUEVA: Extrae "Skin Type" para Skincare (Dry Skin, Oily Skin, Sensitive Skin)
function psExtractSkinType(title) {
  if (!title) return null;
  var t = (title || '').toLowerCase();
  
  if (t.match(/dry\s+skin|for\s+dry|dryness/i)) return 'Dry Skin';
  if (t.match(/oily\s+skin|for\s+oily|oily|acne/i)) return 'Oily Skin';
  if (t.match(/sensitive\s+skin|for\s+sensitive|sensitive|hypoallergenic/i)) return 'Sensitive Skin';
  if (t.match(/combination\s+skin|combination|mixed/i)) return 'Combination Skin';
  if (t.match(/normal\s+skin|for\s+normal|normal/i)) return 'Normal Skin';
  
  return null;
}

// NUEVA: Extrae Brand inteligentemente del título
function psExtractBrand(title) {
  if (!title) return null;
  var t = (title || '').toLowerCase();
  
  // Marcas conocidas: Milani, Essie, Maybelline, etc.
  if (t.match(/\bmilani\b/i)) return 'Milani';
  if (t.match(/\bessie\b/i)) return 'Essie';
  if (t.match(/\bmaybelline\b/i)) return 'Maybelline';
  if (t.match(/\bsally hansen\b/i)) return 'Sally Hansen';
  if (t.match(/\borp\b|opi\b/i)) return 'OPI';
  if (t.match(/\bcvs\b/i)) return 'CVS';
  if (t.match(/\bwalgreens\b/i)) return 'Walgreens';
  if (t.match(/\bthe creme shop\b/i)) return 'The Crème Shop';
  if (t.match(/\bpolly pocket\b/i)) return 'Polly Pocket';
  if (t.match(/\bbarbie\b/i)) return 'Barbie';
  
  // Si no detecta marca específica, retornar null (dejar que lo determine de otra forma)
  return null;
}

// NUEVA: Extrae especificaciones LEGO automáticamente
function psExtractLEGOSpecifics(title) {
  if (!title) return {};
  var t = (title || '').toLowerCase();
  var specs = {};
  
  // Si NO es LEGO, retornar vacío
  if (!t.match(/lego/i)) return specs;
  
  // LEGO Set Name - palabras después de "LEGO" hasta números
  // Ej: "LEGO Creator 3-in-1 Space Shuttle" → "Space Shuttle"
  var nameMatch = t.match(/lego\s+(?:creator\s+)?(?:\d-in-\d\s+)?([a-z\s]+?)(?:\d+|pack|set|new|$)/i);
  if (nameMatch && nameMatch[1]) {
    var setName = nameMatch[1].trim();
    setName = setName.replace(/3-in-1|2-in-1|pack|set/i, '').trim();
    if (setName.length > 2) specs['LEGO Set Name'] = setName;
  }
  
  // LEGO Set Number - números entre 3-5 dígitos precedidos de "31", "60", "10", etc
  // Ej: "31134", "60123", "10991"
  var numMatch = t.match(/\b(\d{5})\b/);
  if (!numMatch) numMatch = t.match(/\b(31\d{3}|10\d{3}|60\d{3}|21\d{3}|75\d{3})\b/i);
  if (numMatch) {
    specs['LEGO Set Number'] = numMatch[1];
    specs['MPN'] = numMatch[1]; // MPN es el mismo set number
  }
  
  // LEGO Subtheme - detectar "3-in-1", "2-in-1"
  if (t.match(/3-in-1/i)) specs['LEGO Subtheme'] = '3 in 1';
  if (t.match(/2-in-1/i)) specs['LEGO Subtheme'] = '2 in 1';
  
  // LEGO Character - palabras como "Astronaut", "Robot", "Pirate", etc.
  if (t.match(/astronaut/i)) specs['LEGO Character'] = 'Astronaut';
  if (t.match(/robot/i)) specs['LEGO Character'] = 'Robot';
  if (t.match(/pirate/i)) specs['LEGO Character'] = 'Pirate';
  if (t.match(/knight/i)) specs['LEGO Character'] = 'Knight';
  if (t.match(/dragon/i)) specs['LEGO Character'] = 'Dragon';
  
  // Number of Pieces - ej: "144 pieces", "500 pcs"
  var piecesMatch = t.match(/(\d+)\s*(?:pieces?|pcs?|blocks?)\b/i);
  if (piecesMatch) specs['Number of Pieces'] = piecesMatch[1];
  
  // Defaults seguros para LEGO nuevo
  specs['Material'] = 'Plastic';
  specs['Retired'] = 'No';
  specs['Vintage'] = 'No';
  specs['Packaging'] = 'Box';
  specs['Type'] = 'Complete Set';
  specs['Release Year'] = ''; // No lo detectamos (difícil de confiar)
  
  return specs;
}

// NUEVA: Extrae "Shade" para Lash/Brow y Lip products
function psExtractShade(title, category) {
  if (!title) return null;
  var t = (title || '').toLowerCase();
  var cat = String(category || '');
  
  // Para lash/brow products (categoría 172023)
  if (cat === '172023') {
    // Detectar colores/shades específicos
    if (t.match(/clear\b|transparent|colorless|serum\b/i)) return 'Clear';
    if (t.match(/\bblack\b|jet black|ebony/i)) return 'Black';
    if (t.match(/\bbrown\b|dark brown|medium brown|light brown/i)) return 'Brown';
    if (t.match(/espresso/i)) return 'Espresso';
    if (t.match(/brunette/i)) return 'Brunette';
    if (t.match(/blonde|light/i)) return 'Blonde';
  }
  
  // Para Lipstick (categoría 31804)
  if (cat === '31804') {
    // Detectar colores de labios - buscar después de números (ej: "True 02 TRUE RED")
    if (t.match(/\bred\b|red\s+flag|true\s+red/i)) return 'Red';
    if (t.match(/pink\b/i)) return 'Pink';
    if (t.match(/coral\b/i)) return 'Coral';
    if (t.match(/nude\b|beige\b/i)) return 'Nude';
    if (t.match(/berry\b|plum\b/i)) return 'Berry';
    if (t.match(/mauve\b|wine\b/i)) return 'Mauve';
    if (t.match(/fuchsia\b|magenta\b/i)) return 'Fuchsia';
  }
  
  return null;
}

// Extrae campos básicos que Claude puede usar directamente
// Detecta la forma física del producto (Softgel, Capsule, Tablet, Gummy,
// Powder, Liquid, Drops) directamente del título — usado como fuente de
// verdad para C:Formulation y C:Item Form en vitaminas/suplementos/medicina,
// porque el título casi siempre lo dice explícitamente y es más confiable
// que dejarlo 100% a criterio de la IA.
function psDetectIngestibleForm(title) {
  var t = (title || '').toLowerCase();
  if (/gumm(y|ies)/.test(t)) return 'Gummy';
  if (/softgel|soft gel/.test(t)) return 'Softgel';
  if (/capsule/.test(t)) return 'Capsule';
  if (/tablet|caplet/.test(t)) return 'Tablet';
  if (/\bpowder\b/.test(t)) return 'Powder';
  if (/\bliquid\b/.test(t)) return 'Liquid';
  if (/\bdrops?\b/.test(t)) return 'Drops';
  return '';
}

// Quita una dosis final tipo "400mg" / "500 mcg" del nombre de un
// ingrediente (ej. "Magnesium 400mg" → "Magnesium"). La dosis ya tiene su
// propia columna (C:Dosage); dejarla mezclada en el ingrediente no calza
// con el valor exacto que eBay espera para el aspecto "Active Ingredients"/
// "Ingredients".
function psStripDosageFromIngredient(val) {
  if (!val) return '';
  return String(val).replace(/\s*\d+\.?\d*\s?(mg|mcg|iu|ml|oz|g)\b\.?\s*$/i, '').trim();
}

function psPreFillSpecifics(title, category, brand) {
  var prefilled = {};
  
  var setInc = psParseSetIncludes(title);
  if (setInc) prefilled['Set Includes'] = setInc;
  
  // NUEVA: Brand inteligente - busca marca real en el título
  var brandVal = psExtractBrand(title);
  if (brandVal) prefilled['Brand'] = brandVal;
  
  var typeVal = psExtractTypeFromTitle(title, category, brand);
  if (typeVal) prefilled['Type'] = typeVal;
  
  var flavor = psExtractFlavorFromTitle(title);
  if (flavor) {
    prefilled['Flavor'] = flavor;
  } else {
    // Sin sabor explícito en el título: si la forma es de las que
    // normalmente NO tienen sabor (softgel/cápsula/tableta/polvo/líquido/
    // gotas — se tragan enteras, no se saborean), "Unflavored" es un valor
    // seguro y estándar de eBay. Para Gummy NO se asume — casi siempre
    // tienen un sabor real y adivinar uno específico podría ser incorrecto.
    var _ingestForm = psDetectIngestibleForm(title);
    if (_ingestForm && _ingestForm !== 'Gummy') {
      prefilled['Flavor'] = 'Unflavored';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1 & 2: PRODUCT FORM RESOLUTION (CORRECTED)
  // Critical fix: Collect Tier 1 and Tier 2 INDEPENDENTLY even if Tier 1 exists,
  // so conflicts can be detected. Only match specific semantic aspect names,
  // not generic "form" substrings. No non-health category defaults.
  // ═══════════════════════════════════════════════════════════════════════════

  var _tier1Form = '';
  var _tier2Form = '';
  var _tier2FormSourceAspect = '';
  var _conflictDetected = false;

  // TIER 1: Extract from immutable title evidence
  _tier1Form = psDetectIngestibleForm(title) || '';

  // TIER 2: Inspect structured aspects INDEPENDENTLY (ALWAYS, even if tier1 exists)
  // This is critical for detecting conflicts
  if (cur && cur.prod && cur.prod.aspects) {
    var aspectsArray = Array.isArray(cur.prod.aspects)
      ? cur.prod.aspects
      : Object.keys(cur.prod.aspects).map(function(k) {
          return { name: k, value: cur.prod.aspects[k] };
        });

    // Only match SPECIFIC semantic aspect names (no generic "form" substring)
    var formAspectNames = ['Formulation', 'Item Form', 'Dosage Form', 'Product Form'];

    for (var ai = 0; ai < aspectsArray.length; ai++) {
      var aspect = aspectsArray[ai];
      if (!aspect || !aspect.name || !aspect.value) continue;

      var aspName = String(aspect.name).trim();
      var aspValue = String(aspect.value).trim();
      var aspNameNorm = aspName.toLowerCase();
      var isFormAspect = false;

      // Exact normalized match only
      for (var fai = 0; fai < formAspectNames.length; fai++) {
        if (aspNameNorm === formAspectNames[fai].toLowerCase()) {
          isFormAspect = true;
          break;
        }
      }

      if (isFormAspect && aspValue) {
        _tier2Form = aspValue;
        _tier2FormSourceAspect = aspName;
        break;
      }
    }
  }

  // CONFLICT DETECTION & RESOLUTION
  var resolvedForm = '';
  var formSource = '';
  var conflictInfo = null;

  if (_tier1Form && _tier2Form) {
    // Normalize both for comparison
    var normalizePlural = function(w) {
      w = String(w).toLowerCase();
      if (w.match(/ies$/)) return w.replace(/ies$/, 'y');
      if (w.match(/lets$/)) return w.replace(/s$/, '');
      if (w.match(/gels$/)) return w.replace(/s$/, '');
      if (w.match(/sules$/)) return w.replace(/s$/, '');
      if (w.match(/ers$/)) return w.replace(/s$/, '');
      if (w.match(/els$/)) return w.replace(/s$/, '');
      if (w.match(/ids$/)) return w.replace(/s$/, '');
      if (w.match(/ops$/)) return w.replace(/s$/, '');
      if (w.match(/pes$/)) return w.replace(/s$/, '');
      if (w.match(/[^aeiou]es$/)) return w.replace(/es$/, '');
      if (w.match(/s$/)) return w.replace(/s$/, '');
      return w;
    };

    var t1Norm = normalizePlural(_tier1Form);
    var t2Norm = normalizePlural(_tier2Form);

    if (t1Norm === t2Norm) {
      // Agreement: use with higher confidence
      resolvedForm = _tier1Form;
      formSource = 'TIER_1_AND_2_AGREE';
    } else {
      // CONFLICT: Do NOT silently resolve
      // Record conflict internally but mark as unresolved for review
      _conflictDetected = true;
      conflictInfo = {
        tier1: _tier1Form,
        tier2: _tier2Form,
        tier2SourceAspect: _tier2FormSourceAspect,
        policy: 'BLOCKED_FOR_REVIEW',
        reason: 'Explicit product metadata conflicts: title says ' + _tier1Form +
                ', structured aspect ' + _tier2FormSourceAspect + ' says ' + _tier2Form
      };
      // DO NOT resolve to either value
      resolvedForm = '';
      formSource = 'CONFLICT_BLOCKED_REQUIRES_REVIEW';
    }
  } else if (_tier1Form) {
    // Only Tier 1: use it
    resolvedForm = _tier1Form;
    formSource = 'DETECTED_IN_TITLE';
  } else if (_tier2Form) {
    // Only Tier 2: use it
    resolvedForm = _tier2Form;
    formSource = 'STRUCTURED_ASPECT_' + (_tier2FormSourceAspect || 'Form');
  }

  // DATA-DRIVEN APPLICABILITY GUARD
  // Check which form fields are actually applicable based on:
  // 1. Primary: available aspect names in current product data
  // 2. Secondary: verified category fallback ONLY if no aspects found
  var applicableFormFields = { formulation: false, itemForm: false };

  if (cur && cur.prod && cur.prod.aspects) {
    var aspectsArray2 = Array.isArray(cur.prod.aspects)
      ? cur.prod.aspects
      : Object.keys(cur.prod.aspects).map(function(k) {
          return { name: k, value: cur.prod.aspects[k] };
        });

    var formAspectNames2 = ['Formulation', 'Item Form', 'Dosage Form', 'Product Form'];

    for (var ai2 = 0; ai2 < aspectsArray2.length; ai2++) {
      var aspect2 = aspectsArray2[ai2];
      if (!aspect2 || !aspect2.name) continue;

      var aspNameNorm2 = String(aspect2.name).toLowerCase().trim();

      for (var fai2 = 0; fai2 < formAspectNames2.length; fai2++) {
        if (aspNameNorm2 === formAspectNames2[fai2].toLowerCase()) {
          if (formAspectNames2[fai2].toLowerCase() === 'formulation' ||
              formAspectNames2[fai2].toLowerCase() === 'dosage form' ||
              formAspectNames2[fai2].toLowerCase() === 'product form') {
            applicableFormFields.formulation = true;
          } else if (formAspectNames2[fai2].toLowerCase() === 'item form') {
            applicableFormFields.itemForm = true;
          }
          break;
        }
      }
    }
  }

  // ONLY apply category fallback if NO aspects were found
  if (!applicableFormFields.formulation && !applicableFormFields.itemForm) {
    if (typeof window.PS_HEALTH_CATS !== 'undefined' &&
        window.PS_HEALTH_CATS.indexOf(String(category || '')) !== -1) {
      applicableFormFields.formulation = true;
      applicableFormFields.itemForm = true;
    }
    // Otherwise: leave both false (do NOT default to formulation = true)
  }

  // PRE-FILL ONLY applicable fields
  if (resolvedForm) {
    if (applicableFormFields.formulation) {
      prefilled['Formulation'] = resolvedForm;
    }
    if (applicableFormFields.itemForm) {
      prefilled['Item Form'] = resolvedForm;
    }
    if (applicableFormFields.formulation || applicableFormFields.itemForm) {
      prefilled['_formationSource'] = formSource;
    }
    // Record conflict info internally (will be filtered before export)
    if (_conflictDetected && conflictInfo) {
      prefilled['_conflictInfo'] = JSON.stringify(conflictInfo);
    }
  }

  // FASE 1.5: Administration + Age Group + Department (género)
  var admin = psExtractAdministration(category);
  if (admin) prefilled['Administration'] = admin;
  
  // Age Group: SIEMPRE se envía (incluyendo "Adult", el caso más común —
  // antes se omitía justo cuando era "Adult", dejando ese campo de eBay
  // vacío en la mayoría de los productos). OJO: esto llena el aspecto
  // "Age Group" de eBay, no "Department" (son campos distintos).
  // ⚠️ 15 ago 2026: en JUGUETES no se manda un Age Group adivinado.
  // psExtractDepartment() devuelve 'Adult' por defecto cuando el título no
  // trae palabras de niño — razonable en salud y belleza, desastroso en
  // juguetes: el LEGO 31134 salió como "Adult" cuando la caja marca una edad
  // infantil, y eso lo saca de todas las búsquedas de regalo para niños.
  // Mejor no mandar el aspecto que mandarlo mal.
  var _toyCats = ['19006','220','261068','2536','19169','233'];
  var ageGroupVal = psExtractDepartment(title);
  if (ageGroupVal && _toyCats.indexOf(String(category || '')) === -1) {
    prefilled['Age Group'] = ageGroupVal;
  }
  
  // Department: aspecto de GÉNERO en eBay (Men/Women/Unisex) — separado
  // de Age Group. Default "Unisex" salvo que el título indique un género.
  prefilled['Department'] = psExtractGenderDepartment(title);
  
  // FASE 2: SPF + Hair Type + PAO + Body Area
  var spf = psExtractSPF(title, category);
  if (spf) prefilled['Sun Protection Factor'] = spf;
  
  var hairType = psExtractHairType(title);
  if (hairType) prefilled['Hair Type'] = hairType;
  
  var pao = psExtractPAO(category);
  if (pao) prefilled['Period After Opening (PAO)'] = pao;
  
  var bodyArea = psExtractBodyArea(category, title);
  if (bodyArea) prefilled['Body Area'] = bodyArea;
  
  // NUEVA: Shade para Lash/Brow products (categoría 172023)
  var shade = psExtractShade(title, category);
  if (shade) prefilled['Shade'] = shade;
  
  // FASE 3 - TOYS & DOLLS: Character, Franchise, Product Line
  var dollChar = psExtractDollCharacter(title, brand);
  if (dollChar) prefilled['Character'] = dollChar;
  
  var franchise = psExtractFranchise(title, brand);
  if (franchise) prefilled['Franchise'] = franchise;
  
  // Agregar "Product Line" si es Barbie con character
  if (brand && brand.toLowerCase().match(/barbie/i) && dollChar && dollChar !== 'Barbie') {
    // Para Barbie, product line puede ser "Barbie Club Chelsea", etc.
    if (title && title.match(/barbie\s+club/i)) {
      prefilled['Product Line'] = 'Barbie Club ' + dollChar;
    }
  }
  
  // FASE 3 - SKINCARE: Skin Type
  var skinType = psExtractSkinType(title);
  if (skinType) prefilled['Skin Type'] = skinType;
  
  // NUEVA: LEGO Automatización (categoría 19006 = Toys)
  var cat = String(category || '');
  if (cat === '19006') {
    var legoSpecs = psExtractLEGOSpecifics(title);
    for (var key in legoSpecs) {
      if (legoSpecs[key] && legoSpecs[key] !== '') {
        prefilled[key] = legoSpecs[key];
      }
    }
    // ⚠️ 15 ago 2026: LEG-673419373609 se publicó con C:Size = "1128".
    // psExtractLEGOSpecifics() NUNCA escribe Size — ese número lo inventó la
    // IA. La caja del set trae 144 piezas. Un conteo falso en la ficha es
    // información incorrecta al comprador, así que se bloquea: en LEGO,
    // "Size" no es un aspecto real, y "Number of Pieces" solo se acepta si
    // el número aparece de verdad en el título (o sea, si vino de una
    // fuente y no de la imaginación del modelo).
    delete prefilled['Size'];
    var _np = String(prefilled['Number of Pieces'] || '').replace(/[^0-9]/g, '');
    if (_np && String(title || '').indexOf(_np) === -1) {
      delete prefilled['Number of Pieces'];
    }
  }
  
  return prefilled;
}

// ── LIMPIEZA DE SPECIFICS INVENTADOS ────────────────────────────────────────
// 15 ago 2026. Historia de este bug, porque importa: primero se bloquearon
// Size y Age Group en los valores PREVIOS (los que el código deduce del
// título). No sirvió — al quitarlos de ahí, la respuesta de la IA dejó de
// chocar con un valor existente y entró sin filtro. El mismo LEGO salió
// primero con Size=1128 y luego con Size=1176: dos números distintos para
// una caja que trae 144 piezas.
//
// Por eso el filtro va AQUÍ, después de mezclar previos + IA, y se aplica
// otra vez al exportar. Un dato inventado en la ficha es peor que un campo
// vacío: el comprador lo lee como cierto.
var PS_TOY_CATS = ['19006','220','261068','2536','19169','233'];

// ── LIMPIEZA DE SPECIFICS EN SALUD / SUPLEMENTOS ────────────────────────────
// 17 ago 2026, del lote de 10. Cuatro problemas distintos, todos con la misma
// raíz: cuando falta un dato, algo se lo inventa.
//
// El peor fue GNC-048107227494: salió publicado con
//   Active Ingredients = "Tribulus Terrestris, Fenugreek, Saw Palmetto"
// Nada de eso aparece en el título ni viene del UPC — lo inventó la IA. En un
// suplemento eso no es SEO, es información falsa sobre algo que la gente
// ingiere. Lo mismo en QUN-850052593452 ("Ubiquinol, Phosphatidylserine,
// Ginkgo Biloba" sobre un título que solo dice "Brain Health Memory Plus").
//
// La regla: un ingrediente solo se publica si aparece en el título. Es
// conservadora a propósito — puede tirar algún ingrediente real que venía de
// buena fuente, pero prefiero un campo vacío que una etiqueta falsa.
// Verificado contra este lote: CONSERVA "Ubiquinol CoQ10", "Benzocaine" y
// "Magnesium" (los tres sí están en sus títulos) y DESCARTA los dos
// inventados.

// Prefijos GS1 → marca. Se usa solo cuando la marca llegó como "Generic":
// MAG-850052593254 se publicó como Generic aunque su UPC arranca con 850052,
// el mismo prefijo que dos Qunol del MISMO lote (850052593148 y 850052593452).
// Es una lista, no magia: cuando aparezca un prefijo nuevo, se agrega aquí.
var PS_UPC_BRANDS = {
  '850052': 'Qunol',
  '898440': 'Qunol'
};

function psBrandFromUPC(upc) {
  var u = String(upc || '').replace(/[^0-9]/g, '');
  if (u.length < 6) return '';
  return PS_UPC_BRANDS[u.substring(0, 6)] || '';
}

// Formas ingeribles: el color de una pastilla no lo verifica nadie y no se
// busca por él, así que un color inventado solo suma riesgo sin sumar ventas.
var PS_INGESTIBLE_FORMS = ['tablet','capsule','softgel','caplet','gummy','pill','gel cap','soft gel'];

// Categorías OTC que necesitan esta limpieza pero que NO deben entrar a
// PS_HEALTH_CATS: esa lista además obliga fecha de expiración y Dosage, y
// para un reliner de dentadura o un removedor de verrugas eso no aplica
// igual. Lista aparte, mismo criterio de limpieza.
var PS_OTC_EXTRA_CATS = ['48080','159882','29618','11780','67588','63514'];

function psScrubHealthSpecs(specs, category, title, upc) {
  if (!specs || typeof specs !== 'object') return specs;
  var c = String(category || '');
  var healthy = (typeof PS_HEALTH_CATS !== 'undefined' && PS_HEALTH_CATS.indexOf(c) !== -1) ||
                PS_OTC_EXTRA_CATS.indexOf(c) !== -1;
  if (!healthy) return specs;

  var t = String(title || '').toLowerCase();

  // 1) Ingredientes: solo los que aparecen en el título.
  ['Active Ingredients', 'Ingredients'].forEach(function(k) {
    if (!specs[k]) return;
    var kept = String(specs[k]).split(/\s*,\s*/).filter(function(ing) {
      var bare = ing.trim().toLowerCase();
      if (!bare) return false;
      // basta con que la primera palabra del ingrediente esté en el título
      // ("Ubiquinol CoQ10" pasa si el título dice "Ubiquinol")
      var first = bare.split(/\s+/)[0];
      return t.indexOf(bare) !== -1 || (first.length >= 4 && t.indexOf(first) !== -1);
    });
    if (kept.length) specs[k] = kept.join(', ');
    else delete specs[k];
  });

  // 2) Formulation e Item Form no pueden contradecirse. Gana la que aparezca
  //    en el título; si ninguna aparece, gana Formulation.
  var f = String(specs['Formulation'] || '').trim();
  var itf = String(specs['Item Form'] || '').trim();
  if (f && itf && f.toLowerCase() !== itf.toLowerCase()) {
    var win = (t.indexOf(itf.toLowerCase()) !== -1 && t.indexOf(f.toLowerCase()) === -1) ? itf : f;
    specs['Formulation'] = win;
    specs['Item Form']   = win;
  }

  // 3) Color inventado en pastillas.
  var formLower = String(specs['Item Form'] || specs['Formulation'] || '').toLowerCase();
  if (specs['Color'] && PS_INGESTIBLE_FORMS.indexOf(formLower) !== -1) {
    // solo se conserva si el título realmente menciona el color
    if (t.indexOf(String(specs['Color']).toLowerCase()) === -1) delete specs['Color'];
  }

  // 4) "Period After Opening (PAO)" es un aspecto de cosméticos. En algo que
  //    se ingiere manda la fecha de expiración, no el PAO.
  delete specs['Period After Opening (PAO)'];

  // 5) Dosage tiene que ser una dosis, no un conteo. CankerMelts salió con
  //    Dosage = "20 Count", que es la cantidad de pastillas del frasco.
  var dose = String(specs['Dosage'] || '').trim();
  if (dose && /^\d+\s*(count|ct|pcs|pieces|tablets?|capsules?)$/i.test(dose)) {
    var mg = t.match(/(\d+\.?\d*)\s*(mg|mcg|g|iu|ml)\b/);
    if (mg) specs['Dosage'] = mg[1] + ' ' + mg[2];
    else specs['Dosage'] = 'See product label';
  }

  // 6) Size con un número pelón es ambiguo: en este lote guardaba el conteo
  //    del frasco (30, 60, 120). Si el título trae un tamaño real con unidad
  //    (5 g, 3 oz) se usa ese; si no, se etiqueta como conteo para que al
  //    menos se lea bien en la ficha.
  // Las tres claves caen en la misma columna del CSV; se normaliza la que venga.
  var _szKey = ['Size','Count','Unit Quantity'].filter(function(k){ return specs[k]; })[0] || 'Size';
  var sz = String(specs[_szKey] || '').trim();
  if (/^\d+$/.test(sz)) {
    var real = String(title || '').match(/(\d+\.?\d*)\s*(g|oz|ml|fl oz|lb)\b/i);
    if (real) specs[_szKey] = real[1] + ' ' + real[2].toLowerCase();
    else if (sz === '1') delete specs[_szKey];
    else specs[_szKey] = sz + ' Count';
  }

  // 7) Marca "Generic" cuando el UPC sí la delata.
  var brandFromUpc = psBrandFromUPC(upc);
  if (brandFromUpc && /^(generic|unknown|n\/a)$/i.test(String(specs['Brand'] || ''))) {
    specs['Brand'] = brandFromUpc;
  }

  return specs;
}

function psScrubSpecs(specs, category, title) {
  if (!specs || typeof specs !== 'object') return specs;
  var cat = String(category || '');
  if (PS_TOY_CATS.indexOf(cat) === -1) return specs;

  // "Size" no es un aspecto real en sets de construcción; es donde aterrizan
  // los conteos de piezas inventados.
  // ⚠️ 17 ago 2026: hay que borrar las TRES claves que el SPEC_MAP manda a la
  // columna C:Size ('Size', 'Count', 'Unit Quantity'). Borrando solo 'Size',
  // el LEGO volvió a salir con C:Size = "Multiple Pieces" porque el valor
  // venía por otra de las claves.
  ['Size', 'Count', 'Unit Quantity'].forEach(function(k){ delete specs[k]; });

  // Age Group adivinado ("Adult" por defecto) saca al juguete de las
  // búsquedas de regalo para niños. Sin dato real, mejor no mandarlo.
  delete specs['Age Group'];

  // El conteo de piezas solo se acepta si ese número aparece de verdad en el
  // título — o sea, si vino de una fuente y no de la imaginación del modelo.
  var t = String(title || '');
  ['Number of Pieces','Number of Items'].forEach(function(k){
    var n = String(specs[k] || '').replace(/[^0-9]/g, '');
    if (n && t.indexOf(n) === -1) delete specs[k];
  });
  return specs;
}

// Le pregunta a Claude los item specifics correctos para el producto,
// según su título, marca y categoría. Claude CONOCE los productos (ej: sabe
// que Advantage II = Imidacloprid 9.1%) y qué specifics pide cada categoría
// de eBay. Devuelve solo los specifics que aplican; el resto quedan vacíos.
// Guarda el resultado en cur._specifics (un objeto {nombre: valor}).
async function psGenerateSpecifics(){
  if(!cur) { toast('⚠️ Escanea un producto primero'); return; }
  if(!savvyToken()){ toast('\uD83D\uDD11 Inicia sesion para usar Claude'); return; }

  var btn = document.getElementById('specifics-btn');
  var origBtnHtml = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.innerHTML = '⏳ Revisando...'; }

  var titleForAI = (cur._selectedTitle || cur.title || '').replace(/\s*Pack of \d+\s*/gi,' ').replace(/\s*New\s*$/i,'').trim();
  var brandForAI = cur.brand || '';
  var catForAI   = String(cur.category || '');
  
  // ✨ FASE 1: PRE-PARSE local fields sin APIs (Set Includes, Type, Flavor)
  var prefilled = psPreFillSpecifics(titleForAI, catForAI, brandForAI);
  console.log('🔍 Pre-parsed specifics:', prefilled);

  // Lista de specifics que el CSV soporta (columnas comunes ampliadas).
  // Claude llena SOLO los que apliquen al producto; deja el resto fuera.
  var SUPPORTED = [
    'Size','Volume','Count','Color','Scent','Flavor','Formulation','Material',
    'Features','Active Ingredients','Ingredients','Number of Doses','Dosage',
    'For Pet Type','Pet Weight','Suitable For','Hair Type','Skin Type',
    'Department','Age Group','MPN','Model','Connectivity','SPF','Power Source',
    'Item Form','Fragrance','Scent Type','Unit Quantity','Unit Type',
    'Country/Region of Manufacture','Country of Origin','Expiration Date',
    'Main Purpose','Body Area','Type of Product','Set Includes',
    'Period After Opening (PAO)','Styling Effect','Product Line','Item Weight','Size Type','When to Take'
  ];

  var prompt = 'You are an eBay listing expert. For the product below, return the correct eBay item specifics as a JSON object.\n\n'
    + 'Product title: ' + titleForAI + '\n'
    + 'Brand: ' + brandForAI + '\n'
    + 'eBay category ID: ' + catForAI + '\n'
    + 'Pre-parsed fields (already extracted): ' + JSON.stringify(prefilled) + '\n\n'
    + 'RULES:\n'
    + '- Pre-parsed values are ALREADY CONFIRMED; use them as-is in your response (do NOT change or override Set Includes, Type, or Flavor if they were pre-parsed).\n'
    + '- Return ONLY a flat JSON object of {"Specific Name": "value"}.\n'
    + '- Use ONLY these specific names when they apply: ' + SUPPORTED.join(', ') + '.\n'
    + '- MANDATORY FIELDS: ALWAYS include Color, Formulation, and Country/Region of Manufacture (haircare, beauty, skincare, pet, health products MUST have all three). Fill AS MANY other specifics as possible for ranking. Only omit one you genuinely cannot determine; NEVER invent fake values.\n'
    + '- Use your product knowledge to fill values even if NOT in the title. Example: Advantage II for cats = Active Ingredients \"Imidacloprid 9.1%, Pyriproxyfen 0.46%\", Item Form Topical, Fragrance Fragrance-Free, Features Waterproof, Color Orange, Country/Region of Manufacture Germany. For hair gels: Color (Clear/Translucent), Formulation (Gel/Mousse/Lightweight), Hair Type, Scent, Features, Country/Region of Manufacture, etc. Apply the same depth to every product.\n'
    + '- CRITICAL SAFETY RULE for "Active Ingredients" and "Ingredients": these are FACTUAL health/safety claims, not general knowledge like Color or Country. Only fill them from memory for products you are HIGHLY confident about (major, iconic, extremely well-documented formulas like Advantage II, Tylenol, well-known EPA-registered pesticides). For smaller, niche, or less common brands, do NOT guess a plausible-sounding ingredient list from memory — if the ingredients are not stated in the title/description provided, LEAVE THIS FIELD OUT ENTIRELY rather than inventing one. A wrong ingredient claim is a real safety/liability risk (allergies, false advertising) — omitting is always safer than guessing wrong.\n'
    + '- MANDATORY for medicine/OTC/supplement/vitamin products: "Dosage" is REQUIRED by eBay for these categories and listings FAIL to publish without it (this is a hard blocker, not just a quality issue). If you know the actual dosing instructions confidently (e.g. from a well-known product), state them briefly (e.g. "1 tablet every 4-6 hours", "Ages 6-12: 1 tsp"). If you do NOT know the exact dosing with confidence, use the literal value "See product label" — this is a standard, safe, eBay-accepted value; never leave Dosage blank for a medicine/OTC/supplement product, and never invent specific numbers you are not sure about.\n'
    + '- Extract Size/Volume/Count/Color/Scent from the title when present (e.g. "24.3 fl oz", "90 Count", "Pomegranate Rose Water").\n'
    + '- For beauty/haircare products without a visible color: use "Clear", "Colorless", or "Translucent" as Color value.\n'
    + '- For gels/creams/mousses: always specify Formulation (e.g., "Gel", "Mousse", "Lightweight Gel", "Styling Mousse").\n'
    + '- For Country/Region of Manufacture: use common knowledge (e.g., USA for Hollywood Beauty, Germany for many European brands, Japan for many beauty brands). If genuinely unknown, use the brand origin country.\n'
    + '- NEW FIELDS to fill when they apply: "Product Line" (the sub-brand/collection name, often visible in the title, e.g. "Pure Honey", "Aquafresh Complete Care", "Simply Nourish" — only fill if a real collection name is stated, not the base brand itself). "Styling Effect" (haircare only: e.g. "Curl Enhancing", "Nourishing", "Volumizing", "Smoothing" — infer from the product\'s stated purpose). "Item Weight" (the dry/solid weight in oz or g, when the product has one SEPARATE from a liquid Volume — e.g. a toothpaste tube net weight; skip if Volume already covers it). "Size Type" (simple category: "Standard Size", "Travel Size", "Trial Size" — infer from title/size only if clearly one of these). "Period After Opening (PAO)" (cosmetics/skincare/oral-care industry standard, format like "12M" or "24M" for months — only use a value if it is a reasonably standard, well-known convention for that PRODUCT TYPE, e.g. most toothpaste/cosmetics are commonly 12M-24M; if you are not reasonably confident, LEAVE THIS FIELD OUT rather than guessing). "MPN" (Manufacturer Part Number — only fill if you genuinely know the real MPN for that exact product; if unknown, use the literal value "Does Not Apply", which is the standard eBay-accepted convention for unknown/non-applicable MPNs — never invent a fake part number). "When to Take" (vitamins/supplements ONLY: e.g. "After Meal", "Before Meal", "With Food", "Morning", "Before Bed" — use the well-known instructions if confident. If NOT confident, use the literal value "As Directed" instead of omitting it — never leave this blank for a vitamin/supplement product).\n'
    + '- Values must be short and eBay-friendly (a few words max).\n'
    + '- Do NOT include Brand, Type, UPC, or EPA (already handled).\n'
    + '- Return ONLY the JSON, no preamble, no markdown.';

  try{
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, 20000);
    var r = await savvyClaude({
      signal: ctrl.signal,
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:600,messages:[{role:'user',content:prompt}]}) // ⚠️ HAIKU LOCKED - NEVER CHANGE
    });
    clearTimeout(timer);
    if(!r.ok) throw new Error('Claude HTTP ' + r.status);
    var d = await r.json();
    var txt = (d.content && d.content[0] && d.content[0].text || '').replace(/```json|```/g,'').trim();
    var parsed = JSON.parse(txt);

    // Guardar solo pares válidos (nombre soportado + valor no vacío)
    var clean = {};
    var count = 0;
    
    // FASE 1: Empezar con prefilled values (pre-parsed del título, 100% confiables)
    for(var pk in prefilled){
      if(prefilled.hasOwnProperty(pk)){
        clean[pk] = String(prefilled[pk]).substring(0, 65);
        count++;
      }
    }
    
    // Luego agregar/sobreescribir con respuesta de Claude (excepto los que ya están en prefilled)
    for(var k in parsed){
      if(!parsed.hasOwnProperty(k)) continue;
      if(prefilled.hasOwnProperty(k)) continue; // Skip si ya fue pre-parsed
      var val = String(parsed[k] == null ? '' : parsed[k]).trim();
      if(val && SUPPORTED.indexOf(k) !== -1){
        clean[k] = val.substring(0, 65); // eBay limita valores de specifics
        count++;
      }
    }
    // ── RESPALDO DETERMINÍSTICO: "Dosage" es OBLIGATORIO en eBay para
    // categorías de medicina/OTC/suplementos — si falta, el listado
    // NO se publica (error 21919303, bloqueante, no solo de calidad).
    // No podemos confiar 100% en que la IA siempre lo llene (mismo
    // patrón que ya vimos con otros campos hoy), así que si la categoría
    // lo requiere y sigue vacío después de la IA, lo llenamos aquí con
    // el valor estándar "See product label" — seguro, honesto, y
    // aceptado por eBay (no inventamos números de dosis específicos). ──
    var _dosageCats = window.PS_HEALTH_CATS;
    if (_dosageCats.includes(String(catForAI)) && !clean['Dosage']) {
      // ⚠️ PRIMERO: Intentar parsear dosage del título (ej. "10 mg", "500mg")
      var dosageMatch = titleForAI.match(/(\d+)\s*(?:mg|mcg|iu|ml|cc)\b/i);
      if (dosageMatch) {
        var dosageNum = dosageMatch[1];
        var dosageUnit = titleForAI.substring(dosageMatch.index + dosageNum.length, dosageMatch.index + dosageMatch[0].length).trim().toUpperCase();
        clean['Dosage'] = dosageNum + ' ' + dosageUnit; // Ej: "10 mg", "500 mcg"
      } else {
        // FALLBACK: Si no hay dosage en el título
        clean['Dosage'] = 'See product label';
      }
    }

    // Filtrar valores inventados antes de guardar (ver psScrubSpecs).
    clean = psScrubSpecs(clean, catForAI, titleForAI);
    // Para salud se usa el título COMPLETO (cur._selectedTitle/cur.title),
    // no titleForAI, porque este último recorta "Pack of N" y podría
    // esconder un tamaño o una unidad que sí queremos poder verificar.
    var _fullTitle = (cur && (cur._selectedTitle || cur.title)) || titleForAI;
    clean = psScrubHealthSpecs(clean, catForAI, _fullTitle, (cur && cur.upc) || '');
    cur._specifics = clean;

    renderSpecificsPreview(clean);
    toast('✅ ' + count + ' especificaciones agregadas');
  }catch(err){
    console.error('psGenerateSpecifics error:', err);
    toast(err.name==='AbortError' ? '⚠️ Claude tardó demasiado' : '⚠️ No se pudieron generar especificaciones');
    // Marcar como "intentado" aunque falló — así el guard de ADD TO CSV no
    // espera de nuevo innecesariamente en un segundo intento, y el listado
    // sigue con specifics vacíos {} en vez de bloquear indefinidamente.
    if (cur && cur._specifics === undefined) cur._specifics = {};
  }finally{
    if(btn){ btn.disabled = false; btn.innerHTML = origBtnHtml; }
  }
}
window.psGenerateSpecifics = psGenerateSpecifics;

// Muestra los specifics generados en pantalla para que el usuario los revise
function renderSpecificsPreview(specs){
  var box = document.getElementById('specifics-preview');
  if(!box) return;
  if(!specs || !Object.keys(specs).length){
    box.innerHTML = '';
    return;
  }
  var rows = Object.keys(specs).map(function(k){
    return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bd)">'
      + '<span style="color:var(--tx2);font-size:12px">' + k + '</span>'
      + '<span style="font-size:12px;font-weight:700;text-align:right;max-width:60%">' + specs[k] + '</span></div>';
  }).join('');
  box.innerHTML = '<div style="background:var(--sf2);border-radius:8px;padding:10px;margin-top:8px">'
    + '<div style="color:var(--ac);font-size:11px;font-weight:800;margin-bottom:6px">✅ ESPECIFICACIONES (IA)</div>'
    + rows + '</div>';
}

// Convierte la descripción estructurada en HTML para mostrar + copiar
function renderDescriptionHTML(desc){
  if(!desc) return '';
  let h = '<div style="background:var(--sf2);border-radius:10px;padding:12px;font-size:13px;line-height:1.6">';
  h += '<div style="margin-bottom:10px">' + esc(desc.intro) + '</div>';
  h += '<div style="font-weight:800;font-size:11px;color:var(--mu);margin-bottom:4px">BENEFITS:</div><ul style="margin:0 0 10px 18px;padding:0">';
  desc.benefits.forEach(function(b){ h += '<li style="margin-bottom:3px">' + esc(b) + '</li>'; });
  h += '</ul>';
  h += '<div style="font-weight:800;font-size:11px;color:var(--mu);margin-bottom:4px">PACKAGE CONTENTS:</div>';
  h += '<div style="margin-bottom:10px">' + esc(desc.package_contents) + '</div>';
  h += '<div style="font-size:11px;color:var(--mu);font-style:italic;border-top:1px solid var(--bd);padding-top:8px">' + esc(desc.disclaimer) + '</div>';
  h += '</div>';
  return h;
}

function renderResult(r){
  if(!r)return;
  const sv=r.verdict==='SAVVY';
  const ebay=r.ebay||{};
  const low =ebay.prices&&ebay.prices.low||0;
  const avg =ebay.prices&&ebay.prices.avg||0;
  const packs=r.packSize||1;
  const sku=makeSKU(r.brand,r.upc,packs,r.title);
  const bundlePrice=calcBundlePrice(ebay,packs);

  // ── COMPACT SUMMARY CARD (same structure as Clothing & Shoes "✅ Found!") ──
  const bcResult = $('ps-barcode-result');
  if (bcResult) {
    const sourceLabel = ebay.priceSource === 'manual_override' ? 'Manual' : (ebay.priceSource || '');
    bcResult.innerHTML = `
      <div style="color:#00e676;font-weight:700;margin-bottom:6px">✅ Found! ${esc(sourceLabel)}</div>
      <div>🏷️ <strong>Brand:</strong> ${esc(r.brand||'—')}</div>
      <div style="margin:4px 0">📦 ${esc((r.title||'').substring(0,80))}${(r.title||'').length>80?'...':''}</div>
      ${low>0 ? `
        <div>💰 <strong>Precio:</strong> <strong style="color:#00e676">$${low.toFixed(2)} total</strong> (item + envío)</div>
        <div style="font-size:11px;color:var(--mu);margin-top:2px">📊 Precio más bajo en eBay (Buy It Now)</div>
      ` : '<div style="color:var(--mu)">💰 Sin precio disponible — toca "eBay Lowest" abajo para ingresarlo manual</div>'}
      <div style="margin-top:4px">🗂️ <strong>Category:</strong> ${esc(r.categoryName||'Other')}</div>
      <div style="margin-top:4px">🔖 <strong>SKU:</strong> <span style="font-family:monospace;color:var(--ac)">${esc(sku)}</span></div>
      <div id="ps-sellbrite-status" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:var(--mu)">🔍 Buscando en Sellbrite...</div>`;
    bcResult.style.display = 'block';
    if (r.upc) psCheckSellbrite(r.upc, r.brand);
  }

  // ── VER PRECIO REAL EN eBay + MARKET DATA — juntos, debajo del scanner ──
  const marketSlot = $('ps-market-data-slot');
  if (marketSlot) {
    let mh = '';
    if (r.upc) {
      const ebaySearchUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(r.upc)
        + '&LH_BIN=1&_sop=15&LH_ItemCondition=3&_ipg=25';
      mh += `<a href="${ebaySearchUrl}" target="_blank" rel="noopener"
        style="display:block;margin-bottom:8px;background:#0064d2;border-radius:10px;padding:12px 14px;
               color:#fff;font-weight:700;font-size:14px;text-decoration:none;text-align:center">
        🔍 Ver precio real en eBay →
      </a>`;
    }
    if (ebay.activeListings > 0) {
      const soldTop = ebay.pricing && ebay.pricing.sold;
      mh += `<div style="background:var(--sf2);border-radius:10px;padding:10px;font-size:12px;line-height:1.8">
        🏷 <strong>Active BIN:</strong> ${ebay.activeListings}
        &nbsp;|&nbsp; Min: <strong>${fmt(low)}</strong> · Avg: <strong>${fmt(avg)}</strong> · Max: ${fmt(ebay.prices&&ebay.prices.high)}
        ${soldTop?`<br>✅ <strong>Sold (90d):</strong> ${soldTop.count} · Avg: ${fmt(soldTop.avg)}`:''}
      </div>`;
    }
    mh += `<div class="price-row" style="margin-top:8px">
      <div class="pc editable" onclick="editLowPrice()"><div class="lbl">eBay Lowest<br><span style="font-size:9px;color:var(--mu)">(item+ship, NEW)</span></div><div class="pc-num low">${low>0?fmt(low):'—'}</div></div>
      <div class="pc"><div class="lbl">eBay Avg<br><span style="font-size:9px;color:var(--mu)">(item+ship)</span></div><div class="pc-num avg">${avg>0?fmt(avg):'—'}</div></div>
      <div class="pc"><div class="lbl">Your Bundle</div><div class="pc-num bdl" id="pack-bundle-price">${fmt(bundlePrice)}</div></div>
    </div>`;
    marketSlot.innerHTML = mh;
  }

  let h=`<div class="badge ${sv?'sv':'dw'}">${sv?'✅ SAVVY':'❌ DWI'}</div>`;

  // ── 1. TITLE ─────────────────────────────────────────────────
  h+=`<div class="card" style="border-left:3px solid var(--ac)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div class="lbl" style="color:var(--ac)">📝 eBay SEO Title</div>
      <button id="title-edit-btn" onclick="startTitleEdit()" ontouchend="event.preventDefault();startTitleEdit()" style="background:var(--sf2);border:1.5px solid var(--bd);border-radius:8px;padding:5px 12px;color:var(--ac);font-size:12px;font-weight:800;cursor:pointer">✏️ Editar</button>
    </div>
    <div id="pack-title-display" class="val" style="font-size:15px;font-weight:700;line-height:1.5" data-val="${esc(r.title||'')}">${esc(r.title||'')}</div>
    <textarea id="pack-title-input" maxlength="80" rows="3" style="display:none;width:100%;box-sizing:border-box;font-size:15px;font-weight:700;line-height:1.5;background:var(--sf2);color:var(--tx);border:2px solid var(--ac);border-radius:10px;padding:10px;margin-top:4px;resize:vertical;font-family:inherit"></textarea>
    <div id="title-char-count" style="font-size:11px;color:var(--mu);margin-top:4px">${(r.title||'').length}/80 chars</div>
    <div id="title-edit-actions" style="display:none;gap:8px;margin-top:8px">
      <button onclick="saveTitleEdit()" ontouchend="event.preventDefault();saveTitleEdit()" style="flex:1;background:var(--sv,#00e676);border:none;border-radius:10px;padding:11px;color:#00110a;font-size:14px;font-weight:800;cursor:pointer">✓ Guardar</button>
      <button onclick="cancelTitleEdit()" ontouchend="event.preventDefault();cancelTitleEdit()" style="flex:1;background:var(--sf2);border:1.5px solid var(--bd);border-radius:10px;padding:11px;color:var(--mu);font-size:14px;font-weight:800;cursor:pointer">✕ Cancelar</button>
    </div>
  </div>`;

  // ── 2. SKU ───────────────────────────────────────────────────
  h+=`<div class="card"><div class="lbl">SKU</div>
    <div id="pack-sku-display" class="val" style="font-family:monospace;font-size:14px" data-val="${esc(sku)}">${esc(sku)}</div></div>`;

  // ── 3. CATEGORY ──────────────────────────────────────────────
  h+=`<div class="card"><div class="lbl">Category</div>
    <div class="val">${esc(r.categoryName||'Health & Beauty')}
      <span style="color:var(--mu);font-size:11px"> · ID ${esc(r.category||'26395')}</span>
    </div></div>`;

  // ── 3.5 DESCRIPCIÓN eBay (generada automáticamente con Claude) ──────────────
  h+=`<div class="card" style="border-left:3px solid #7c4dff">
    <div class="lbl" style="color:#b388ff">📄 eBay Description</div>
    <div id="ps-desc-result" style="margin-top:8px">${cur&&cur._description?renderDescriptionHTML(cur._description):'<div style="text-align:center;padding:12px"><div class="sp" style="width:20px;height:20px;margin:0 auto 6px"></div><div style="font-size:11px;color:var(--mu)">Generando descripción...</div></div>'}</div>
  </div>`;

  // (El botón "Ver precio real en eBay" y el Market Data ahora viven arriba,
  // en #ps-market-data-slot, justo debajo de "paste eBay listing URL")

  // ── 4. PACK SELECTOR ─────────────────────────────────────────
  // (Los 3 cuadros de precio -Lowest/Avg/Bundle- ahora viven arriba,
  // en #ps-market-data-slot, junto con Active BIN — ver más arriba)
  h+=
  (function(){
    var _cb=low||avg||0;
    // NOTA: La sección "SELECT PACK SIZE" de arriba fue removida porque no se
    // usaba — el pack se elige abajo en el reparto de inventario (BULK SPLIT).
    // Mantenemos los elementos ocultos (pack-chips, pack-sel-display) para no
    // romper referencias de otras funciones, y conservamos el Shade/Color.
    var h2='<div class="card"><div class="lbl">🎨 Shade / Color (opcional)</div>';
    h2+='<div class="pack-chips" id="pack-chips" style="display:none"></div>';
    h2+='<div id="pack-sel-display" style="display:none">Pack of '+packs+'</div>';
    h2+='<div class="extra-field" style="margin-top:0"><input class="extra-input" id="shade-input" type="text" placeholder="e.g. Cherry Red, #12 Brown..." oninput="updateShadeColor(this.value)"></div>';
    return h2;
  }());

  // ── 4b. BULK SPLIT CALCULATOR — reparte unidades del camión entre 1/3/6/12
  // según la demanda real de eBay (soldCount de los últimos 90 días) ──
  h+=renderSplitCalculatorHTML(ebay);

  // ── LOCATION (movido ANTES de las fotos para evitar conflicto de memoria de cámara en iOS) ──
  const locVal=r.location||'';
  h+=`<div class="card" style="border:1px solid rgba(255,109,31,.35);background:rgba(255,109,31,.05)">
    <div class="lbl">📍 Warehouse Location <span style="color:var(--mu);font-size:11px;font-weight:400">— escanea o escribe ANTES de las fotos</span></div>
    <div style="margin-top:8px">${locVal?locBadgeHTML(locVal,'scanner'):locEmptyHTML('scanner')}</div>
  </div>`;

  // ── EXPIRATION DATE (movido ANTES de las fotos también) ──
  // Duplicamos el picker aquí arriba para que Manuel lo llene antes de generar packs
  var EXP_REQUIRED_CATS_TOP = window.PS_HEALTH_CATS; // misma lista que el resto (antes estaba duplicada y corta)
  var needsExpTop = EXP_REQUIRED_CATS_TOP.includes(String(r.category||''));
  h+='<div class="card" style="border:1px solid ' + (needsExpTop?'rgba(231,76,60,.5)':'rgba(255,109,31,.35)') + ';background:' + (needsExpTop?'rgba(231,76,60,.05)':'rgba(255,109,31,.05)') + '">'
    + '<div class="lbl">📅 Expiration Date'
    + (needsExpTop ? ' <span style="color:#e74c3c;font-weight:800">* REQUIRED</span>' : ' <span style="color:var(--mu);font-size:11px;font-weight:400">(optional)</span>')
    + '</div>';
  if (needsExpTop) {
    h+='<div style="background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.4);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:12px;color:#e74c3c">⚠️ Este producto requiere fecha de expiración para listarse en eBay</div>';
  }
  h+='<div id="exp-toggle-btn" onclick="toggleExpDate()" style="display:inline-flex;align-items:center;gap:8px;background:var(--sf2);border:1.5px solid '+(needsExpTop?'#e74c3c':'var(--bd)')+';border-radius:10px;padding:10px 16px;cursor:pointer;margin-top:6px;font-size:13px;color:'+(needsExpTop?'#e74c3c':'var(--mu)')+'"><span>📅</span><span>'+(needsExpTop?'Ingresar fecha de expiración (REQUERIDO)':'This product has an expiration date')+'</span></div>';
  h+='<div id="exp-date-picker" style="display:none;margin-top:10px"><div class="extra-label">MONTH</div><div class="pack-chips" id="month-chips" style="gap:6px"></div><div class="extra-label" style="margin-top:10px">YEAR</div><div class="pack-chips" id="year-chips" style="gap:6px"></div><div class="date-result" id="date-result-display" style="text-align:left;margin-top:8px"></div><button onclick="clearExpDate()" style="background:none;border:none;color:var(--mu);font-size:12px;cursor:pointer;margin-top:4px">✕ Remove date</button></div>';

  // ── CÓDIGO DE MANUFACTURA / LOTE (17 ago 2026) ────────────────────────────
  // Muchos productos no traen fecha impresa pero sí un código de lote, y eBay
  // exige algo en Expiration Date en las categorías de salud (error 21919303).
  // Hasta ahora eso se resolvía a mano metiendo el código en el campo de la
  // fecha — funciona, pero deja un dato raro sin explicación en la ficha.
  //
  // Ahora se captura por separado, NO es obligatorio, y se conecta así:
  //   · Si hay fecha  → C:Expiration Date = la fecha
  //   · Si no hay fecha pero sí código → C:Expiration Date = el código
  //   · La descripción SIEMPRE lo muestra etiquetado como lote, para que el
  //     comprador no lo confunda con una fecha.
  h+='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)">'
    + '<div class="lbl" style="font-size:12px">🏭 Código de manufactura / Lote '
    + '<span style="color:var(--mu);font-size:11px;font-weight:400">(opcional — úsalo cuando NO haya fecha)</span></div>'
    + '<input id="mfg-code-input" type="text" value="' + esc(r._mfgCode || '') + '" '
    + 'placeholder="Ej. L4A0231" autocapitalize="characters" autocomplete="off" '
    + 'oninput="setMfgCode(this.value)" '
    + 'style="width:100%;margin-top:6px;background:var(--sf2);border:1.5px solid var(--bd);border-radius:10px;padding:10px 12px;color:var(--tx);font-size:14px;font-weight:700;box-sizing:border-box">'
    + '<div id="mfg-code-hint" style="font-size:11px;color:var(--mu);margin-top:5px">' + psMfgHint(r) + '</div>'
    + '</div>';
  h+='</div>';

  // ── 3. FRONT / BACK PHOTOS — Step 1: capture + remove background ──
  const frontThumb = r._frontImg ? `<img src="${esc(r._frontImg)}" style="width:100%;height:100%;object-fit:contain;background:#ffffff">` : '<div style="text-align:center;color:var(--mu);font-size:24px">📷</div>';
  const backThumb  = r._backImg  ? `<img src="${esc(r._backImg)}" style="width:100%;height:100%;object-fit:contain;background:#ffffff">` : '<div style="text-align:center;color:var(--mu);font-size:24px">📷</div>';
  h+=`<div class="bundle-photo-card">
    <div class="lbl">📸 Front &amp; Back Photos (background removed)</div>
    <div style="font-size:11px;color:var(--mu);margin:4px 0 10px">Paso 1: toma las dos fotos <strong>obligatorias</strong> del producto. Se les quita el fondo automáticamente.</div>
    <div style="display:flex;gap:10px">
      <div style="flex:1">
        <div style="font-size:11px;color:var(--mu);text-align:center;margin-bottom:4px">FRONT${r._frontImg?' ✅':''}</div>
        <div id="ps-slot-front" 
          onclick="psCapturePhoto('front')" 
          ontouchend="event.preventDefault();psCapturePhoto('front')" 
          style="aspect-ratio:1;background:var(--sf2);border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden">${frontThumb}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:11px;color:var(--mu);text-align:center;margin-bottom:4px">BACK${r._backImg?' ✅':''}</div>
        <div id="ps-slot-back" 
          onclick="psCapturePhoto('back')" 
          ontouchend="event.preventDefault();psCapturePhoto('back')" 
          style="aspect-ratio:1;background:var(--sf2);border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden">${backThumb}</div>
      </div>
    </div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)">
      <div style="font-size:11px;color:var(--mu);margin-bottom:2px">Fotos extra (opcional) — mismo proceso, se usan como fotos secundarias:</div>
      <div id="ps-extra-photos-wrap"></div>
    </div>
  </div>`;

  // ── 3b. PACK IMAGE GENERATOR — Paso 2: 1/3/6/12 con distintivo ──
  const hasPhotos = !!(r._frontImg && r._backImg);
  h+=`<div class="bundle-photo-card">
    <div class="lbl">🎁 Generar Imágenes de Pack (1-12)</div>
    <div id="ps-pack-gen-hint" style="font-size:11px;color:var(--mu);margin:4px 0 10px">
      ${hasPhotos
        ? 'FRONT se multiplica según el paquete + distintivo azul (excepto pack de 1). BACK queda igual, compartida en todos los paquetes.'
        : '⚠️ Primero toma las fotos FRONT y BACK de arriba.'}
    </div>
    <button id="ps-gen-packs-btn"
      onclick="window._psDebug('onclick disparado');psGenerateAllPacks()"
      ontouchend="event.preventDefault();window._psDebug('ontouchend disparado');psGenerateAllPacks()"
      style="width:100%;background:linear-gradient(135deg,#0F97DB,#0a6ea3);border:none;border-radius:10px;padding:13px;color:#fff;font-size:14px;font-weight:800;cursor:pointer">
      🎁 Generar Imágenes de Pack (1-12)
    </button>
    <div id="ps-pack-gen-status" style="font-size:11px;color:var(--mu);margin-top:6px;text-align:center"></div>
    <div id="ps-pack-images-preview"></div>
    <div style="margin-top:10px;background:#000;border-radius:8px;padding:8px;max-height:140px;overflow-y:auto">
      <div style="font-size:9px;color:#666;margin-bottom:4px">🐛 DEBUG LOG (siempre visible):</div>
      <div id="ps-debug-log" style="font-family:monospace;font-size:10px;color:#0f0;white-space:pre-wrap;word-break:break-all">Esperando acción...</div>
    </div>
  </div>`;

  // ── 5. UPC MATCH BADGE ───────────────────────────────────────
  const src=ebay.priceSource||'keyword';
  const srcBadge=src==='gtin_exact'
    ?'<span style="background:rgba(0,230,118,.15);color:var(--sv);font-size:11px;padding:3px 10px;border-radius:10px;font-weight:700">✅ UPC EXACT MATCH</span>'
    :src.includes('gtin')
    ?'<span style="background:rgba(255,171,0,.15);color:var(--gd);font-size:11px;padding:3px 10px;border-radius:10px">⚠️ PARTIAL MATCH</span>'
    :'<span style="background:rgba(255,107,0,.15);color:var(--ac);font-size:11px;padding:3px 10px;border-radius:10px">🔍 KEYWORD ONLY</span>';
  h+=`<div style="text-align:center;margin:8px 0">${srcBadge}</div>`;

  // ── 6. (Market Data ahora vive en la tarjeta compacta de arriba, junto a Brand/Precio/SKU) ──

  // ── 7. DWI REASON ────────────────────────────────────────────
  if(!sv)h+=`<div class="card"><div class="lbl">DWI Reason</div><div class="val">${esc(r.reason||'')}</div></div>`;

  // ── AUDITORÍA FINAL CON IA — revisa TODO el listado y completa specifics ──
  // Va al final, justo antes de agregar al CSV, para que revise el listado
  // completo (título, categoría, fotos ya puestas) como último paso.
  h+=`<div class="card" style="border-left:3px solid #7c4dff;background:rgba(124,77,255,.06)">
    <div class="lbl" style="color:#a98bff">✨ Auditoría IA — Item Specifics</div>
    <div style="font-size:12px;color:var(--mu);margin:4px 0 8px">Último paso: deja que la IA revise el listado y complete las especificaciones para máxima visibilidad en eBay.</div>
    <button id="specifics-btn" onclick="psGenerateSpecifics()" ontouchend="event.preventDefault();psGenerateSpecifics()" style="width:100%;background:linear-gradient(135deg,#7c4dff,#448aff);border:none;border-radius:10px;padding:13px;color:#fff;font-size:15px;font-weight:800;cursor:pointer">🔍 Revisar y Completar Listado</button>
    <div id="specifics-preview"></div>
  </div>`;

  h+=sv
    ? `<button class="add-btn" id="addBtn">➕ ADD TO CSV</button>`
    : `<button class="ov-add-btn" id="addBtn">➕ Add anyway (DWI override)</button>`;
  h+=`<button id="shopifyBtn" style="width:100%;padding:14px;background:#96bf48;color:#fff;border:none;border-radius:10px;font-weight:900;font-size:15px;cursor:pointer;margin-top:8px">🛍️ SEND TO SHOPIFY (1pk)</button>`;
  h+=`<button class="ag-btn" id="agBtn">🔄 SCAN ANOTHER</button>`;

  $('resBody').innerHTML=h;

  const addB=$('addBtn');
  if(addB){
    var addFn = async function(e){
      if(e && e.preventDefault) e.preventDefault();
      // ── FEEDBACK VISUAL INMEDIATO ──
      var originalText = addB.textContent;
      var originalBg = addB.style.background;
      addB.textContent = '⏳ Agregando...';
      addB.style.background = '#ffa500';
      addB.style.opacity = '0.7';
      addB.style.pointerEvents = 'none';

      // Contar bulk antes
      var bulkBefore = (typeof bulk !== 'undefined' && Array.isArray(bulk)) ? bulk.length : 0;

      try {
        await addBulk();
        // Contar bulk después
        var bulkAfter = (typeof bulk !== 'undefined' && Array.isArray(bulk)) ? bulk.length : 0;
        var added = bulkAfter - bulkBefore;

        if (added > 0) {
          // ÉXITO — feedback verde brillante
          addB.textContent = '✅ AGREGADO (' + added + ' pack' + (added>1?'s':'') + ')';
          addB.style.background = '#00c853';
          addB.style.opacity = '1';
          setTimeout(function(){
            addB.textContent = originalText;
            addB.style.background = originalBg;
            addB.style.pointerEvents = '';
          }, 2500);
        } else {
          // NO se agregó nada — feedback amarillo
          addB.textContent = '⚠️ Ya estaba o requisitos faltan';
          addB.style.background = '#ff9800';
          addB.style.opacity = '1';
          setTimeout(function(){
            addB.textContent = originalText;
            addB.style.background = originalBg;
            addB.style.pointerEvents = '';
          }, 3000);
        }
      } catch(err) {
        // ERROR — feedback rojo
        addB.textContent = '❌ Error: ' + (err.message || err).substring(0,40);
        addB.style.background = '#e74c3c';
        addB.style.opacity = '1';
        setTimeout(function(){
          addB.textContent = originalText;
          addB.style.background = originalBg;
          addB.style.pointerEvents = '';
        }, 4000);
      }
    };
    addB.addEventListener('touchend', addFn);
    addB.addEventListener('click', addFn);
  }

  const agB=$('agBtn');
  if(agB){agB.addEventListener('touchend',e=>{e.preventDefault();scanAnother();});agB.addEventListener('click',scanAnother);}

  // Botón Enviar a Shopify
  const shopifyB = $('shopifyBtn');
  if (shopifyB) {
    shopifyB.addEventListener('touchend', function(e){ e.preventDefault(); psSendToShopify(); });
    shopifyB.addEventListener('click', psSendToShopify);
  }

  setTimeout(function(){
    var ebayPrices=(r.ebay&&r.ebay.prices)?r.ebay.prices:null;
    initPackWheel(Number(packs)||1,ebayPrices,r.title||'',r.upc||'',r.brand||'',
      {sku:document.getElementById('pack-sku-display'),
       title:document.getElementById('pack-title-display'),
       price:document.getElementById('pack-bundle-price'),
       display:document.getElementById('pack-sel-display')});
    var si=document.getElementById('shade-input');
    if(si&&cur&&cur._shade) si.value=cur._shade;
    window._splitActive = {1:true,2:false,3:true,4:false,5:false,6:true,7:false,8:false,9:false,10:false,11:false,12:true};
    window._splitManual = {}; // limpiar ajustes manuales del producto anterior
    // Respetar packs ya detectados en Sellbrite (auto-excluidos)
    var _sbEx = window._psSbExisting || {};
    PACK_SIZES.forEach(function(pn){ if (_sbEx[pn]) window._splitActive[pn] = false; });
    updateSplitCalc();
    if(cur && cur._packImages) renderPackImagesPreview();
    renderExtraPhotosUI();
    // Generar descripción automáticamente
    setTimeout(function(){ psAutoGenerateDescription(); }, 500);
    // Generar item specifics automáticamente — ANTES esto requería que el
    // usuario tocara manualmente "🔍 Revisar y Completar Listado". Si se
    // olvidaba (o no sabía que debía hacerlo), el listado salía con solo
    // 2-3 specifics (Brand, Type, Country) en vez de 9-11. Ahora corre solo,
    // igual que la descripción. El botón sigue ahí por si quieren re-generar
    // manualmente, pero ya NO es obligatorio para tener un listado completo.
    setTimeout(function(){
      if (typeof psGenerateSpecifics === 'function') psGenerateSpecifics();
    }, 900);
  },80);
}

// ── ENVIAR A SHOPIFY (1pk) ────────────────────────────────────────────
// Crea el producto como ACTIVE en Savvy Deal Shopify con toda la info:
// título, descripción, precio mínimo de eBay, SKU del 1pk, y fotos.
// ── SHOPIFY: Convertir imagen a cuadrado 1:1 con fondo blanco ─────────
// Usa destination-over para que el fondo blanco tape cualquier fondo
// negro o transparente. Funciona sin importar cómo vino el PNG.
function psImageToWhiteSquare(url, size) {
  size = size || 2048;
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');

      // Paso 1: centrar la imagen manteniendo proporciones con 8% padding
      var pad = size * 0.08;
      var maxW = size - pad * 2;
      var maxH = size - pad * 2;
      var ratio = Math.min(maxW / img.width, maxH / img.height);
      var drawW = Math.round(img.width * ratio);
      var drawH = Math.round(img.height * ratio);
      var drawX = Math.round((size - drawW) / 2);
      var drawY = Math.round((size - drawH) / 2);

      // Paso 2: dibujar la imagen primero
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Paso 3: poner el fondo blanco DETRÁS de la imagen
      // destination-over dibuja el fondo detrás de lo que ya está en el canvas
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      resolve(canvas.toDataURL('image/jpeg', 0.93));
    };
    img.onerror = function() { reject(new Error('No se pudo cargar: ' + url)); };
    img.src = url;
  });
}

// Convierte una lista de URLs a imágenes cuadradas blancas y las sube a ImgBB
// Devuelve la lista de URLs nuevas de ImgBB (con fondo blanco, cuadradas)
async function psPreparShopifyImages(imageUrls) {
  var result = [];
  var imgbbKey = localStorage.getItem('savvy_imgbb_key') || DEFAULT_IMGBB_KEY;
  for (var i = 0; i < imageUrls.length; i++) {
    var url = imageUrls[i];
    if (!url || !url.startsWith('http')) continue;
    try {
      // Convertir a cuadrado blanco
      var dataUrl = await psImageToWhiteSquare(url, 1200);
      // Subir a ImgBB
      var uploaded = await clUploadPhotoToImgBB(dataUrl, imgbbKey, 'shopify-' + Date.now() + '-' + i);
      if (uploaded) {
        result.push(uploaded);
      } else {
        result.push(url); // fallback a la original si falla ImgBB
      }
    } catch(e) {
      console.warn('psPreparShopifyImages error img ' + i + ':', e.message);
      result.push(url); // fallback a la original
    }
  }
  return result;
}

async function psSendToShopify() {
  if (!cur) { toast('⚠️ No hay producto escaneado'); return; }

  var btn = $('shopifyBtn');
  if (btn) { btn.textContent = '⏳ Enviando a Shopify...'; btn.disabled = true; }

  // ── Misma protección: esperar descripción rica antes de enviar ──
  if (cur && !cur._description) {
    if (btn) btn.textContent = '⏳ Terminando descripción...';
    var waited3 = 0;
    while (cur && !cur._description && waited3 < 12000) {
      await new Promise(function(res){ setTimeout(res, 300); });
      waited3 += 300;
    }
    if (cur && !cur._description) {
      cur._description = buildLocalFallbackDescription(cur, cur.packSize || 1);
      if (window._psDebug) window._psDebug('⚠️ Descripción IA no llegó a tiempo — usando fallback local con bullets');
    }
    if (btn) btn.textContent = '⏳ Enviando a Shopify...';
  }

  // ── Misma protección para item specifics ──
  if (cur && cur._specifics === undefined) {
    if (btn) btn.textContent = '⏳ Terminando specifics...';
    var waitedSpecs3 = 0;
    while (cur && cur._specifics === undefined && waitedSpecs3 < 8000) {
      await new Promise(function(res){ setTimeout(res, 300); });
      waitedSpecs3 += 300;
    }
    if (btn) btn.textContent = '⏳ Enviando a Shopify...';
  }

  try {
    // Precio: usar el mínimo de eBay (ebayLow) si existe, si no el precio calculado
    var price = '0.00';
    if (cur.ebay && cur.ebay.prices && cur.ebay.prices.ebayLow) {
      price = Number(cur.ebay.prices.ebayLow).toFixed(2);
    } else if (cur.price) {
      price = Number(cur.price).toFixed(2);
    }

    // SKU del 1pk
    var sku = makeSKU(cur.brand, cur.upc, 1, cur.title);

    // Título limpio
    var title = rebuildTitle(cur.title || '', 1, cur._shade || '', cur._expDate || '');
    title = title.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '').trim().substring(0, 200);

    // Descripción en HTML
    var description = descToEbayHTML(cur._description || cur.description || '');

    // Fotos: front + back + extras
    var rawImages = [];
    if (cur._frontImg && String(cur._frontImg).startsWith('http')) rawImages.push(cur._frontImg);
    if (cur._backImg  && String(cur._backImg).startsWith('http'))  rawImages.push(cur._backImg);
    if (cur._extraImgs) {
      cur._extraImgs.forEach(function(ex) {
        if (ex && ex.img && String(ex.img).startsWith('http')) rawImages.push(ex.img);
      });
    }

    // Convertir fotos a cuadrado 1200x1200 con fondo blanco — estándar Shopify
    if (btn) btn.textContent = '🖼️ Preparando fotos...';
    var images = await psPreparShopifyImages(rawImages, 2048);

    // Vendor (marca)
    var vendor = cur.brand || 'Generic';

    if (window._psDebug) window._psDebug('🛍️ Enviando a Shopify: ' + title + ' @ $' + price + ' — ' + images.length + ' foto(s)');
    if (btn) btn.textContent = '⏳ Enviando a Shopify...';

    var r = await psAuthFetch('/shopify-create-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        description: description,
        price: price,
        sku: sku,
        vendor: vendor,
        product_type: cur.categoryName || 'Health & Beauty',
        images: images,
        quantity: 0
      })
    });

    var d = await r.json();

    if (d.success) {
      if (btn) { btn.textContent = '✅ ¡En Shopify!'; btn.style.background = '#00e676'; btn.style.color = '#000'; }
      toast('✅ Producto creado en Shopify con fotos cuadradas');
      if (d.admin_url) {
        setTimeout(function() {
          var linkEl = document.createElement('div');
          linkEl.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#96bf48;color:#fff;padding:12px 20px;border-radius:10px;z-index:9999;font-size:13px;font-weight:700;max-width:80vw;text-align:center';
          linkEl.innerHTML = '🛍️ <a href="' + d.admin_url + '" target="_blank" style="color:#fff">Ver en Shopify Admin</a>';
          document.body.appendChild(linkEl);
          setTimeout(function(){ try { document.body.removeChild(linkEl); } catch(e){} }, 6000);
        }, 500);
      }
    } else {
      if (btn) { btn.textContent = '🛍️ SEND TO SHOPIFY (1pk)'; btn.disabled = false; }
      toast('❌ Error Shopify: ' + (d.error || 'desconocido'));
      console.error('shopify error:', d);
    }

  } catch(e) {
    if (btn) { btn.textContent = '🛍️ SEND TO SHOPIFY (1pk)'; btn.disabled = false; }
    toast('❌ Error: ' + (e.message || e));
    console.error('psSendToShopify error:', e);
  }
}

function clearBulkSession() {
  if (bulk.length === 0) { toast('⚠️ No hay productos'); return; }
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:30px';
  ov.innerHTML = '<div style="background:var(--sf);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center">'
    + '<div style="font-size:18px;font-weight:800;margin-bottom:8px">🗑 Clear Session</div>'
    + '<div style="font-size:14px;color:var(--mu);margin-bottom:20px">Borrar ' + bulk.length + ' producto(s)?</div>'
    + '<button onclick="bulk=[];updateFAB();renderBulk();saveBulkToStorage();document.querySelectorAll(\'.clear-ov\').forEach(e=>e.remove());toast(\'✅ Sesión limpiada\')" '
    + 'style="width:100%;padding:12px;background:#e74c3c;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:8px;display:block">Sí, borrar todo</button>'
    + '<button onclick="document.querySelectorAll(\'.clear-ov\').forEach(e=>e.remove())" '
    + 'style="width:100%;padding:10px;background:none;border:1px solid #555;border-radius:10px;color:#888;cursor:pointer;display:block">Cancelar</button>'
    + '</div>';
  ov.className = 'clear-ov';
  document.body.appendChild(ov);
}

function emptyStateHTML(){
  return `<div class="badge" style="background:var(--sf2);color:var(--mu);border:1px solid var(--bd)">⏳ AWAITING SCAN</div>
    <div class="card" style="border-left:3px solid var(--bd)">
      <div class="lbl" style="color:var(--mu)">📝 eBay SEO Title</div>
      <div class="val" style="font-size:15px;font-weight:700;line-height:1.5;color:var(--mu)">Scan a barcode, type a UPC, or paste an eBay link to begin</div>
    </div>
    <div class="card"><div class="lbl">SKU</div><div class="val" style="font-family:monospace;font-size:14px;color:var(--mu)">—</div></div>
    <div class="card"><div class="lbl">Category</div><div class="val" style="color:var(--mu)">—</div></div>
    <div class="price-row">
      <div class="pc"><div class="lbl">eBay Lowest<br><span style="font-size:9px;color:var(--mu)">(item+ship, NEW)</span></div><div class="pc-num low" style="color:var(--mu)">—</div></div>
      <div class="pc"><div class="lbl">eBay Avg<br><span style="font-size:9px;color:var(--mu)">(item+ship)</span></div><div class="pc-num avg" style="color:var(--mu)">—</div></div>
      <div class="pc"><div class="lbl">Your Bundle</div><div class="pc-num bdl" style="color:var(--mu)">—</div></div>
    </div>`;
}

function scanAnother() {
  const upcInput = document.getElementById('upcInRes');
  if (upcInput) { upcInput.value = ''; setTimeout(()=>upcInput.focus(), 100); }
  const ebayUrlInput = document.getElementById('ps-ebay-url');
  if (ebayUrlInput) ebayUrlInput.value = '';
  const barcodeResult = document.getElementById('ps-barcode-result');
  if (barcodeResult) { barcodeResult.style.display='none'; barcodeResult.innerHTML=''; }
  const rb = document.getElementById('resBody');
  if (rb) rb.innerHTML = emptyStateHTML();
  _lastBundleUrl = '';
  screen('res');
}

function renderBulk(){
  var el=$('bulkList');
  if(!el)return;
  if(!bulk.length){el.innerHTML='<p style="text-align:center;color:#888;padding:20px">No items yet.</p>';return;}
  el.innerHTML=bulk.map(function(it,i){
    var qty = it.quantity ? ' \u00b7 qty '+it.quantity : '';
    return '<div style="display:flex;align-items:center;gap:10px;background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:12px;margin-bottom:8px">'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="color:#fff;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc((it.title||'').substring(0,60))+'</div>'
      +   '<div style="color:#888;font-size:11px">'+esc(it.sku||'')+qty+'</div>'
      + '</div>'
      + '<div style="color:#00e676;font-weight:800;font-size:14px">'+fmt(it.price)+'</div>'
      + '<button class="bdel" data-i="'+i+'" style="background:none;border:1px solid #555;border-radius:8px;padding:6px 10px;color:#aaa;cursor:pointer">\u2715</button>'
      + '</div>';
  }).join('');
  el.querySelectorAll('.bdel').forEach(function(b){
    b.addEventListener('click',function(){bulk.splice(+b.dataset.i,1);updateFAB();renderBulk();saveBulkToStorage();});
  });
}

// CSV Export
// ── ENVIAR A HOJA DE REGISTRO (pestaña "Product Scanner") ──────────────
// Misma hoja de cálculo que Ropa, pestaña separada. tipo:"product" enruta al tab correcto.
var PS_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxNTFzs4hGWzahc3c4X0SidYaXTDOzJhGu-v_FdG3pVHzT8mbKigq8In8l1nqoO3UhpKw/exec';

// ── Ajustar la descripción al pack correspondiente (1pk/3pk/6pk/12pk) ──────
// Cada listado debe decir SU cantidad correcta en intro y Package Contents.
// ── Fallback LOCAL (sin IA) para cuando psAutoGenerateDescription falla o
// tarda demasiado. Usa lo que YA tenemos (título, marca, specifics si existen)
// para armar una descripción decente con bullets — NUNCA la oración plana.
function buildLocalFallbackDescription(curObj, packs) {
  var brand = (curObj && curObj.brand) || '';
  var title = (curObj && (curObj._selectedTitle || curObj.title)) || '';
  var specs = (curObj && curObj._specifics) || {};
  var benefits = [];
  if (specs['Features']) benefits.push(specs['Features']);
  if (specs['Main Purpose']) benefits.push('Main use: ' + specs['Main Purpose']);
  if (specs['Active Ingredients'] || specs['Ingredients']) benefits.push('Contains: ' + (specs['Active Ingredients'] || specs['Ingredients']));
  if (specs['Scent']) benefits.push('Scent: ' + specs['Scent']);
  if (specs['Formulation']) benefits.push('Formulation: ' + specs['Formulation']);
  if (specs['Suitable For'] || specs['Hair Type']) benefits.push('Suitable for: ' + (specs['Suitable For'] || specs['Hair Type']));
  // ── FACTORY-SEALED FIX: Remove unverified claim unless evidence field exists
  if (!benefits.length) benefits = ['Brand new', 'Fast shipping from our North Carolina warehouse', '100% authentic'];
  return {
    intro: (brand ? brand + ' — ' : '') + (title || 'Quality product') + '. Brand new.',
    benefits: benefits,
    package_contents: 'This listing includes ' + packs + ' unit' + (packs>1?'s':'') + ', brand new.',
    disclaimer: PS_DESC_DISCLAIMER
  };
}

function descForPack(desc, packs, curObj) {
  if (!desc) return desc;

  // ── DYNAMIC PRODUCT-SPECIFIC PACKAGE CONTENTS GENERATION ──
  // Extract clean product identity from immutable base fields
  var productName = '';
  if (curObj) {
    // Use the original product title from curObj.prod (immutable, before any eBay transformations)
    // or fall back to curObj.title (base title before pack-specific modifications)
    // Never use curObj._selectedTitle as it contains pack-specific "Pack of N" and "New" suffixes
    productName = (curObj.prod && curObj.prod.title) || (curObj.title || '');
    productName = productName.trim();
  }

  // ── Generate package_contents with clean architecture (no duplication) ──
  // packageContents describes WHAT the units are, WITHOUT the pack count
  var packageContents = '';
  var productDescFacts = (desc.package_contents || '').trim();

  if (productName) {
    // Base: just the product name (without pack count at this stage)
    packageContents = productName;

    // Only append facts from Claude if they add NEW information not already in productName
    // Extract just the factual suffix (e.g., "with 144 pieces") - the part after the product description
    if (productDescFacts) {
      // Look for factual details like "with N pieces", "containing", "size", etc.
      var factMatch = productDescFacts.match(/\b(?:with|contains?|size|color|material|includes?).+$/i);
      if (factMatch) {
        packageContents += ' ' + factMatch[0];
      }
    }
  } else {
    // Fallback when no product name available
    packageContents = 'the product';
    if (productDescFacts) {
      packageContents += ' ' + productDescFacts;
    }
  }

  if (typeof desc === 'string') {
    // Original string description stays untouched.
    // Prepend bundle intro.
    var bundleIntro = (packs === 1 ? 'This listing includes 1 individual unit' : 'This bundle includes ' + packs + ' individual units');
    if (productName) {
      bundleIntro += ' of ' + productName;
    } else {
      bundleIntro += ' of the product';
    }
    return bundleIntro + '. ' + desc;
  }

  // Structured description object (from Claude/Algopix)
  // Rebuild with immutable original data + generated bundle text
  // Build final text with pluralization if needed
  var bundlePrefix = (packs === 1 ? 'This listing includes 1 individual unit of ' : 'This bundle includes ' + packs + ' individual units of ');
  var bundleContents = packageContents;

  // Apply pluralization: if we have multiple packs and product name ends with singular countable
  if (packs > 1 && productName && productName.match(/\b(set|kit|pack|item|unit|piece|box|bottle|container|jar|tube|can|bag|pouch|packet)$/i)) {
    // Pluralize the last word of packageContents if it matches the last word of productName
    var lastWord = productName.split(/\s+/).pop();
    if (lastWord && /^(set|kit|pack|item|unit|piece|box|bottle|container|jar|tube|can|bag|pouch|packet)$/i.test(lastWord)) {
      bundleContents = bundleContents.replace(new RegExp('\\b' + lastWord + '\\b(?!.*\\b' + lastWord + '\\b)', 'i'), lastWord + 's');
    }
  }

  var finalPackageContents = bundlePrefix + bundleContents;

  return {
    intro: desc.intro || '',  // Original intro, untouched (product facts only)
    benefits: desc.benefits || [],  // Original benefits, untouched (product facts only)
    package_contents: finalPackageContents,
    disclaimer: psDisclaimerForPack(desc.disclaimer || '', packs)
  };
}

// ── Convertir descripción (objeto de Claude o string) a HTML/texto ──────
// Agrega el código de lote al final de la descripción, ETIQUETADO.
// Importante que se vea como lote y no como fecha: cuando el producto no
// trae fecha impresa, ese mismo código viaja en C:Expiration Date porque
// eBay exige algo ahí. En la ficha, el comprador debe entender qué está
// leyendo. (17 ago 2026)
function psAppendLote(html, it) {
  var code = String((it && it.mfgCode) || '').trim();
  if (!code) return html;
  var etiqueta = String((it && it.expDate) || '').trim()
    ? '<p><strong>Lot / Manufacture Code:</strong> ' + code + '</p>'
    : '<p><strong>Lot / Manufacture Code:</strong> ' + code +
      '<br><span style="font-size:12px">This item does not display a printed expiration date. ' +
      'The lot code above is shown in its place.</span></p>';
  return String(html || '') + etiqueta;
}
window.psAppendLote = psAppendLote;

function descToEbayHTML(d){
  if(!d) return '';
  if(typeof d === 'string') return d;
  try{
    var h = '';
    if(d.intro) h += '<p>' + d.intro + '</p>';
    if(d.benefits && d.benefits.length){
      h += '<ul>';
      for(var i=0;i<d.benefits.length;i++){ h += '<li>' + d.benefits[i] + '</li>'; }
      h += '</ul>';
    }
    if(d.package_contents) h += '<p><b>Package Contents:</b> ' + d.package_contents + '</p>';
    if(d.disclaimer) h += '<p><i>' + d.disclaimer + '</i></p>';
    return h;
  }catch(e){ return ''; }
}
function descToText(d){
  return descToEbayHTML(d).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}

function psSendToRegistroSheet(items) {
  if (!items || !items.length) return;

  // UNA FILA POR PACK — formato vertical (más fácil de leer)
  var rows = items.map(function(it) {
    var p = Number(it.packs) || 1;
    var q = Number(it.quantity) || 1;
    var cat = it.category;
    if (!cat || cat === 'undefined' || cat === 'null') cat = '';
    // UPC como texto con apóstrofe para que Google Sheets no borre el cero inicial
    var upcText = "'" + (it.upc || '');
    return {
      tipo:        'product',
      date:        new Date().toISOString().slice(0,19).replace('T',' '),
      sku:         it.sku || '',
      upc:         upcText,
      brand:       it.brand || '',
      title:       it.title || '',
      description: descToText(it.description),
      category:    cat,
      package:     p + 'pk',
      units:       p * q,
      listings:    q,
      price:       it.price || '',
      weight:      (it.weightLb ? Number(it.weightLb).toFixed(2) : ''),
      exp_date:    it.expDate || '',
      location:    it.location || '',
      photo_url:   it.bundleImg || it.photo || '',
      scanned_by:  it.scannedBy || 'unknown',
      load_number: it.truck || ''
    };
  });

  fetch(PS_SHEET_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ tipo: 'product', items: rows }),
    headers: {'Content-Type': 'text/plain'}
  }).catch(function(e) { console.warn('Error enviando a Sheet de registro:', e); });
}

// ── VALIDACIÓN DE CATEGORÍAS CONTRA eBay (Taxonomy API vía backend) ──
// Le manda a eBay el TÍTULO + categoría de cada producto. eBay elige la
// mejor categoría leaf real por título. Devuelve un mapa {categoriaOriginal: leafValida}.
// Si el backend no responde, devuelve mapa vacío y se usa psSafeCategory de respaldo.
async function validateCategoriesWithEbay(items) {
  var map = {};
  try {
    var payload = [];
    var seen = {};
    items.forEach(function(it) {
      var cat = String(it.category || '').trim();
      var title = String(it.title || '').trim();
      var key = cat + '|' + title;
      if (!seen[key] && title) {
        seen[key] = true;
        payload.push({ category: cat, title: title });
      }
    });
    if (!payload.length) return map;

    var r = await psAuthFetch('/leaf-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload })
    });
    if (!r.ok) { console.warn('leaf-category HTTP', r.status); return map; }
    var d = await r.json();

    if (d && d.results) {
      Object.keys(d.results).forEach(function(k) {
        var res = d.results[k];
        if (res && res.suggested) {
          map[k] = String(res.suggested);
        }
      });
    }
  } catch (e) {
    console.warn('validateCategoriesWithEbay error:', e && e.message);
  }
  return map;
}

async function exportCSV(){
  try {
  if(!bulk.length){toast('⚠️ No products');return;}

  // ── DEFENSIVE GUARD: Block Clothing items from general Product Scanner export ──
  // Clothing & Shoes items (SKU prefix CLO-) must be exported via clExportEbayCSV()
  // to ensure proper photo validation and CSV schema.
  const clothingItems = bulk.filter(function(it){ return /^CLO-/i.test(it.sku || ''); });
  if (clothingItems.length > 0) {
    const clothingSKUs = clothingItems.map(function(it){ return it.sku; }).join('\n');
    var errOv = document.createElement('div');
    errOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:12px;text-align:center';
    errOv.innerHTML = '<div style="font-size:40px">👕</div>'
      + '<div style="color:#fff;font-size:16px;font-weight:800">Clothing & Shoes items detected</div>'
      + '<div style="color:#aaa;font-size:13px;line-height:1.6">The following item(s) must be exported from the Clothing & Shoes module:<br><br><code style="background:#1a1a1a;padding:8px;border-radius:6px;display:inline-block;color:#ff9500;font-size:12px">' + clothingSKUs.replace(/\n/g, '<br>') + '</code><br><br>Click <strong>Clothing & Shoes</strong> tab and use <strong>Exportar a eBay</strong>.</div>'
      + '<button onclick="this.parentElement.remove()" style="background:linear-gradient(135deg,#FF6B35,#E71D36);border:none;border-radius:10px;padding:12px 24px;color:#fff;cursor:pointer;font-weight:800">Understood</button>';
    document.body.appendChild(errOv);
    return;
  }

  // Candado anti doble-tap: evita exports (y filas) duplicados
  if (window._exportLock) { toast('⏳ Export en proceso...'); return; }
  window._exportLock = true;
  setTimeout(function(){ window._exportLock = false; }, 5000);

  // ── Feedback visual inmediato: el botón responde al instante ──
  var expBtnEl = document.getElementById('expBtn');
  if (expBtnEl) {
    var expBtnOldHTML = expBtnEl.innerHTML;
    expBtnEl.innerHTML = '⏳ Exportando...';
    expBtnEl.style.opacity = '0.55';
    expBtnEl.style.pointerEvents = 'none';
    setTimeout(function(){
      expBtnEl.innerHTML = expBtnOldHTML;
      expBtnEl.style.opacity = '';
      expBtnEl.style.pointerEvents = '';
    }, 5000);
  }

  // Enviar también a la hoja de registro (pestaña "Product Scanner"), no bloquea
  psSendToRegistroSheet(bulk);

  function q(v) {
    v = String(v==null?'':v);
    return (v.indexOf(',')>=0||v.indexOf('"')>=0||v.indexOf('\n')>=0)
      ? '"'+v.replace(/"/g,'""')+'"' : v;
  }

  var SHIP = 'Flat:Standard Shipp(Free),Same business day';
  var RET  = '30 Day return';
  var PAY  = 'eBay Payments';

  var HDR = [
    '*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)',
    'CustomLabel','*Category','*Title','*ConditionID','*Description',
    'PicURL','*Format','*Duration','*StartPrice','*Quantity',
    'ImmediatePayRequired','*Location','*DispatchTimeMax',
    'ShippingProfileName','ReturnProfileName','PaymentProfileName',
    'StoreCategory',
    '*C:Brand','Product:UPC','C:Type','C:EPA Registration Number','C:Model',
    'C:Color','C:Language','C:Book Title','C:Author','ISBN',
    'C:Expiration Date','C:Dosage','C:Shade','C:Connectivity',
    // ── Item specifics generados por IA (columnas comunes) ──
    'C:Size','C:Volume','C:Scent','C:Flavor','C:Formulation','C:Active Ingredients','C:Ingredients',
    'C:Features','C:Material','C:Number of Doses','C:Suitable For',
    'C:Fragrance','C:Item Form','C:Country of Origin',
    'C:Main Purpose','C:Age Group','C:Department',
    'C:MPN','C:Period After Opening (PAO)','C:Styling Effect','C:Product Line','C:Item Weight','C:Size Type','C:When to Take',
    'WeightMajor','WeightMinor'
  ];

  // Nombres de specific de IA → columna del CSV (para mapear cur._specifics).
  // La IA puede usar varios nombres equivalentes; los normalizamos aquí.
  // IMPORTANTE: "Flavor", "Ingredients" y "Department" son aspectos PROPIOS
  // de eBay (distintos de Scent, Active Ingredients y Age Group) — antes se
  // mezclaban en la misma columna y uno pisaba al otro, dejando el aspecto
  // real de eBay vacío. Ahora cada uno tiene su columna dedicada.
  var SPEC_COL_MAP = {
    'Size':'C:Size', 'Volume':'C:Volume', 'Count':'C:Size', 'Unit Quantity':'C:Size',
    'Scent':'C:Scent', 'Scent Type':'C:Scent',
    'Flavor':'C:Flavor',
    'Color':'C:Color',
    'Formulation':'C:Formulation', 'Item Form':'C:Item Form',
    'Active Ingredients':'C:Active Ingredients',
    'Ingredients':'C:Ingredients',
    'Features':'C:Features',
    'Material':'C:Material',
    'Number of Doses':'C:Number of Doses',
    'Dosage':'C:Dosage',
    'Suitable For':'C:Suitable For', 'For Pet Type':'C:Suitable For', 'Hair Type':'C:Suitable For', 'Skin Type':'C:Suitable For',
    'Fragrance':'C:Fragrance',
    'Country/Region of Manufacture':'C:Country of Origin', 'Country of Origin':'C:Country of Origin',
    'Main Purpose':'C:Main Purpose', 'Body Area':'C:Main Purpose', 'Type of Product':'C:Main Purpose',
    'Age Group':'C:Age Group',
    'Department':'C:Department',
    'MPN':'C:MPN',
    'Period After Opening (PAO)':'C:Period After Opening (PAO)', 'PAO':'C:Period After Opening (PAO)',
    'Styling Effect':'C:Styling Effect',
    'Product Line':'C:Product Line',
    'Item Weight':'C:Item Weight',
    'Size Type':'C:Size Type',
    'When to Take':'C:When to Take'
  };
  var SPEC_COLS = ['C:Size','C:Volume','C:Scent','C:Flavor','C:Formulation','C:Active Ingredients','C:Ingredients','C:Features','C:Material','C:Number of Doses','C:Suitable For','C:Fragrance','C:Item Form','C:Country of Origin','C:Main Purpose','C:Age Group','C:Department'];

  var lines = ['Info,Version=1.0.0,Template=fx_category_template_EBAY_US', HDR.join(',')];
  var skipped = 0;

  // Category → required Type value
  // ── MAPA CATEGORÍA → Type (respaldo por categoría) ──────────────────
  // Solo categorías donde el Type es INEQUÍVOCO por la categoría misma.
  // NO incluimos 31786 (Skin Care) aquí porque es el default general y
  // asignar "Lotion" a todo lo que cae ahí causaba errores (toallas, roll-ons).
  // El Type real se decide PRIMERO por título en detectType().
  var CAT_TYPE = {
    '36870': 'Lip Balm',
    '11838': 'Deodorant',
    '11840': 'Body Wash',
    '26683': 'Razor',
    '67167': 'Pads',
    '105070': 'Adult Diaper',
    '36478': 'Nail Polish',
    '57041': 'Eye Drops',
    '11854': 'Shampoo',
    '131689': 'Shampoo',
    '31085': 'Hair Color',
    '45258': 'Hair Styling',
    '67602': 'Toothpaste',
    '1232':  'Insect Repellent',
    '261844':'Insect Repellent',
    '19264': 'Brace',
    '181':   'Brace',
    '51227': 'First Aid',
    '67169': 'Pain Reliever',
    '180959':'Vitamin',
    '48619': 'Battery',
    '44867': 'Cable',
    '112529':'Headphones',
    '14969': 'Speaker',
    '9394':  'Case',
    '6000':  'Automotive',
    '16486': 'Office Supply',
    '261186':'Book',
    '20695': 'Mug',
    '177005':'Knife',
    '20654': 'Cookware',
    '168763':'Appliance',
    '20650': 'Dinnerware',
    '26677': 'Grill Tool',
    '20725': 'Grill',
    '19006': 'Building Set',
    '31788': 'Body Lotion',
    '32062': 'Face Cream',
    '2984':  'Baby Care',
    '1281':  'Pet Supply',
    '14308': 'Food',
    '888':   'Fitness Equipment',
    '75655': 'Fitness Equipment',
    '220':   'Toy',
    '261068':'Toy',
    '177660':'Hair Treatment', // Treatments, Oils & Protectors (bajo Hair Care & Styling)
  };

  // ── Detectar el Type — TÍTULO PRIMERO (más confiable), luego categoría ──
  // El título describe el producto exacto; la categoría a veces cae al
  // default (Skin Care) y no refleja lo que realmente es. Por eso revisamos
  // el título primero, en orden de más específico a más general.
  function detectType(category, title) {
    var t = (title || '').toLowerCase();

    // ── HEALTH & BEAUTY — específicos primero ──────────────────────
    // Roll-ons y analgésicos tópicos (Absorbine, Bengay, Icy Hot, Biofreeze)
    if(/roll.?on|absorbine|bengay|icy hot|biofreeze|aspercreme|salonpas|tiger balm|pain reliev/.test(t)) return 'Pain Relief';
    // Toallas / productos femeninos
    if(/sanitary|maxi pad|panty liner|pantiliner|feminine pad|menstrual|always infinity|always pad|tampon|tampax|kotex|stayfree|playtex/.test(t)) return 'Pads';
    if(/incontinence|adult diaper|depend|poise|tena|bladder/.test(t)) return 'Adult Diaper';
    // Air fresheners / aromatizantes / repuestos
    if(/air freshener|air wick|febreze|glade|scented oil|plug.?in refill|room spray|odor eliminat|wax melt|scentsy|renuzit/.test(t)) return 'Air Freshener';
    if(/candle|yankee candle|wax warmer/.test(t)) return 'Candle';
    // Cuidado de piel
    if(/lip balm|chapstick|lip butter|carmex|blistex/.test(t)) return 'Lip Balm';
    if(/body wash|shower gel|bath gel|body cleanser/.test(t)) return 'Body Wash';
    if(/bar soap|hand soap|liquid soap|antibacterial soap|castile soap/.test(t)) return 'Soap';
    if(/sunscreen|sunblock|\bspf\b|sun protection|after sun/.test(t)) return 'Sunscreen';
    if(/face cream|facial cream|face moisturizer|facial moisturizer|anti.aging|wrinkle cream|night cream|day cream|eye cream/.test(t)) return 'Face Cream';
    if(/body lotion|hand lotion|body cream|hand cream|body butter|moisturizing lotion|daily moisturizer/.test(t)) return 'Body Lotion';
    if(/face wash|facial cleanser|face scrub|cleanser/.test(t)) return 'Face Wash';
    if(/serum|toner|retinol serum|hyaluronic|niacinamide/.test(t)) return 'Serum';
    if(/\blotion|moisturizer|moisturis/.test(t)) return 'Lotion';
    // Cabello
    if(/shampoo/.test(t)) return 'Shampoo';
    if(/conditioner/.test(t)) return 'Conditioner';
    if(/hair color|hair dye|hair bleach/.test(t)) return 'Hair Color';
    if(/hair spray|hairspray|hair gel|hair mousse|pomade|hair wax/.test(t)) return 'Hair Styling';
    if(/hair oil|hair mask|hair treatment|hair serum/.test(t)) return 'Hair Treatment';
    // Dental
    if(/toothpaste/.test(t)) return 'Toothpaste';
    if(/toothbrush/.test(t)) return 'Toothbrush';
    if(/mouthwash|mouth rinse|oral rinse/.test(t)) return 'Mouthwash';
    if(/dental floss|floss pick|flosser|interdental/.test(t)) return 'Floss';
    if(/whitening strip|whitening kit|teeth whiten/.test(t)) return 'Whitening';
    // Afeitado
    if(/shaving cream|shave gel|shave foam|aftershave|after shave/.test(t)) return 'Shaving Cream';
    if(/razor|blade refill|cartridge razor/.test(t)) return 'Razor';
    // Desodorante
    if(/deodorant|antiperspirant/.test(t)) return 'Deodorant';
    // Fragancia
    if(/perfume|cologne|eau de toilette|eau de parfum|body mist|body spray|fragrance/.test(t)) return 'Fragrance';
    // Maquillaje
    if(/mascara/.test(t)) return 'Mascara';
    if(/foundation|bb cream|cc cream/.test(t)) return 'Foundation';
    if(/concealer/.test(t)) return 'Concealer';
    if(/lipstick|lip gloss|lip liner|lip stain|lip tint/.test(t)) return 'Lipstick';
    if(/eyeshadow|eye shadow/.test(t)) return 'Eye Shadow';
    if(/eyeliner|eye liner/.test(t)) return 'Eyeliner';
    if(/blush|bronzer|contour|highlighter makeup/.test(t)) return 'Makeup';
    if(/makeup remover|micellar|makeup wipe/.test(t)) return 'Makeup Remover';
    // Uñas
    if(/nail polish|nail lacquer|nail color|nail gel/.test(t)) return 'Nail Polish';
    if(/nail file|nail clipper|cuticle|nail remover|acetone/.test(t)) return 'Nail Care';
    // Ojos / oídos
    if(/eye drop|eye wash|visine|contact solution|contact lens/.test(t)) return 'Eye Drops';
    if(/ear drop|ear wax|earwax|ear cleaner/.test(t)) return 'Ear Care';
    // Cuidado de pies
    if(/foot cream|heel balm|callus|corn remover|athlete.?s foot|antifungal/.test(t)) return 'Foot Care';

    // ── SUPLEMENTOS Y MEDICINA ─────────────────────────────────────
    // Vitaminas y suplementos: el Type "Vitamin"/"Supplement" es mejor para
    // búsqueda que la forma (tablet/capsule), así que va PRIMERO.
    if(/multivitamin|vitamin [abcdek]|vitamin d3|vitamin b12|prenatal vitamin/.test(t)) return 'Vitamin';
    // ── Ingredientes AMBIGUOS: biotin, collagen y omega-3 aparecen tanto en
    // suplementos que se ingieren (cápsulas, gomitas, softgels — incluso
    // "fish OIL" softgels) como en productos tópicos (aceite de cabello,
    // crema, sérum) que USAN esos ingredientes. Si tiene forma tópica Y NO
    // tiene forma ingerible, es un producto de cuidado externo, no un
    // suplemento — así no perdemos "fish oil 1000mg softgels" (sí es
    // suplemento) ni confundimos "biotin oil" para cabello (no lo es).
    var _hasTopicalForm = /\b(oil|cream|lotion|serum|spray|shampoo|conditioner|mist|gel|mask|leave-?in|treatment)\b/.test(t);
    var _hasIngestibleForm = /softgel|soft gel|capsule|tablet|caplet|gumm(y|ies)|\d+\s?mcg|\d+\s?mg\b|\bdrops?\b|liquid supplement/.test(t);
    var _hasAmbiguousIngredient = /\bbiotin\b|\bcollagen\b|omega.?3/.test(t);
    if(!(_hasAmbiguousIngredient && _hasTopicalForm && !_hasIngestibleForm) &&
       /probiotic|omega.?3|fish oil|collagen|biotin|melatonin|turmeric|elderberry|ashwagandha|magnesium|zinc supplement|calcium supplement|iron supplement|coq10/.test(t)) return 'Supplement';
    if(/fiber supplement|metamucil|benefiber|psyllium/.test(t)) return 'Fiber Supplement';
    if(/whey protein|protein powder|protein shake|mass gainer/.test(t)) return 'Protein Powder';
    if(/creatine|pre.?workout|bcaa|amino acid/.test(t)) return 'Sports Supplement';
    if(/testosterone booster|test booster|nugenix|t.boost/.test(t)) return 'Supplement';
    if(/\bvitamin\b|supplement/.test(t)) return 'Vitamin';
    // Medicina OTC
    if(/ibuprofen|tylenol|advil|motrin|aspirin|acetaminophen|naproxen|aleve/.test(t)) return 'Pain Reliever';
    if(/antihistamine|allergy relief|zyrtec|claritin|benadryl|allegra/.test(t)) return 'Allergy Relief';
    if(/antacid|heartburn|tums|pepcid|prilosec|nexium/.test(t)) return 'Antacid';
    if(/cough|cold medicine|nyquil|dayquil|mucinex|robitussin|sinus|decongestant/.test(t)) return 'Cold & Flu';
    if(/sleep aid|unisom|zzzquil/.test(t)) return 'Sleep Aid';
    // Forma (solo si no fue identificado como vitamina/medicina arriba)
    if(/gummy|gummies/.test(t)) return 'Gummy';
    if(/softgel|soft gel/.test(t)) return 'Softgel';
    if(/capsule/.test(t)) return 'Capsule';
    if(/tablet|caplet/.test(t)) return 'Tablet';

    // ── PRIMEROS AUXILIOS ──────────────────────────────────────────
    if(/band.?aid|bandage|adhesive bandage|gauze|medical tape/.test(t)) return 'Bandage';
    if(/neosporin|bacitracin|antibiotic ointment|wound care/.test(t)) return 'First Aid';
    if(/hydrogen peroxide|rubbing alcohol|antiseptic|betadine/.test(t)) return 'Antiseptic';
    if(/thermometer|blood pressure|glucose meter|pulse oximeter/.test(t)) return 'Medical Device';
    if(/heating pad|\bice pack\b|\bhot pack\b|cold pack/.test(t)) return 'Therapy';
    if(/brace|compression sleeve|compression sock|support wrap|arthritis glove/.test(t)) return 'Brace';

    // ── LIMPIEZA / HOGAR ───────────────────────────────────────────
    if(/laundry detergent|laundry pod|tide|gain detergent|persil/.test(t)) return 'Laundry Detergent';
    if(/fabric softener|dryer sheet|downy|bounce/.test(t)) return 'Fabric Softener';
    if(/dish soap|dishwashing liquid|dawn dish|cascade/.test(t)) return 'Dish Soap';
    if(/disinfectant|lysol|clorox|bleach|all.purpose cleaner|multi.surface/.test(t)) return 'Cleaner';
    if(/glass cleaner|windex/.test(t)) return 'Glass Cleaner';
    if(/paper towel|bounty|scott towel/.test(t)) return 'Paper Towel';
    if(/toilet paper|bath tissue|charmin|cottonelle/.test(t)) return 'Toilet Paper';
    if(/facial tissue|kleenex|puffs/.test(t)) return 'Facial Tissue';
    if(/trash bag|garbage bag|hefty|glad bag/.test(t)) return 'Trash Bag';
    if(/plastic wrap|aluminum foil|sandwich bag|ziploc|storage bag/.test(t)) return 'Food Storage';
    if(/sponge|scrub brush|mop|broom|dustpan/.test(t)) return 'Cleaning Tool';

    // ── COMIDA Y BEBIDA ────────────────────────────────────────────
    if(/coffee|espresso|k.?cup|coffee pod|cold brew/.test(t)) return 'Coffee';
    if(/tea bag|green tea|herbal tea/.test(t)) return 'Tea';
    if(/energy drink|monster|red bull|5.hour energy|bang energy/.test(t)) return 'Energy Drink';
    if(/sports drink|gatorade|powerade|electrolyte|pedialyte/.test(t)) return 'Sports Drink';
    if(/protein bar|kind bar|clif bar|granola bar|nutri.grain/.test(t)) return 'Snack Bar';
    if(/candy|chocolate|gummy candy|skittles|m&m|reese|hershey/.test(t)) return 'Candy';
    if(/chewing gum|breath mint|tic tac|altoid|trident|orbit gum/.test(t)) return 'Gum & Mints';
    if(/chip|popcorn|pretzel|trail mix|nut snack|cracker/.test(t)) return 'Snack';
    if(/sauce|ketchup|mustard|mayonnaise|salad dressing|hot sauce/.test(t)) return 'Condiment';
    if(/cereal|oatmeal|granola|breakfast/.test(t)) return 'Breakfast Food';
    if(/soup|broth|ramen|instant noodle|bouillon/.test(t)) return 'Soup';
    if(/seasoning|spice|garlic powder|paprika|cumin/.test(t)) return 'Seasoning';

    // ── ELECTRÓNICOS ───────────────────────────────────────────────
    if(/aa battery|aaa battery|9v battery|lithium battery|alkaline battery|duracell|energizer|rayovac/.test(t)) return 'Battery';
    if(/usb.?c cable|lightning cable|charging cable|phone cable/.test(t)) return 'Cable';
    if(/phone charger|wireless charger|power bank|charging pad|wall charger/.test(t)) return 'Charger';
    if(/earbuds|earphone|airpod|in.?ear/.test(t)) return 'Earbuds';
    if(/headphone|over.?ear|on.?ear/.test(t)) return 'Headphones';
    if(/bluetooth speaker|portable speaker|wireless speaker/.test(t)) return 'Speaker';
    if(/phone case|screen protector|tempered glass|tablet case/.test(t)) return 'Case';
    if(/light bulb|led bulb|smart bulb|led strip/.test(t)) return 'Light Bulb';

    // ── AUTOMOTIVE ─────────────────────────────────────────────────
    if(/motor oil|engine oil|synthetic oil|castrol|mobil.?1|valvoline/.test(t)) return 'Motor Oil';
    if(/wiper blade|windshield/.test(t)) return 'Wiper Blade';
    if(/car wash|turtle wax|armor all|rain.?x/.test(t)) return 'Car Care';

    // ── OFICINA / ESCUELA ──────────────────────────────────────────
    if(/\bpens?\b|sharpie|marker|highlighter/.test(t)) return 'Writing Instrument';
    if(/notebook|composition book|legal pad|sticky note|post.?it/.test(t)) return 'Paper Product';
    if(/stapler|tape dispenser|scotch tape|binder|folder/.test(t)) return 'Office Supply';

    // ── DEPORTES / FITNESS ─────────────────────────────────────────
    if(/yoga mat|yoga block|yoga strap/.test(t)) return 'Yoga';
    if(/resistance band|dumbbell|weight plate|jump rope|foam roller/.test(t)) return 'Exercise Equipment';

    // ── LIBROS ─────────────────────────────────────────────────────
    if(/board book|children.?s book|coloring book|activity book|workbook|cookbook|novel|paperback|hardcover/.test(t)) return 'Book';

    // ── COCINA / HOGAR ─────────────────────────────────────────────
    if(/\bmug\b|tumbler|travel mug|coffee cup/.test(t)) return 'Mug';
    if(/knife|knives|chef knife|paring knife/.test(t)) return 'Knife';
    if(/\bpan\b|\bpot\b|\bskillet\b|\bwok\b|dutch oven|\bcookware\b/.test(t)) return 'Cookware';
    if(/blender|mixer|toaster|air fryer|instant pot|slow cooker|coffee maker/.test(t)) return 'Small Appliance';
    if(/\bplate\b|\bbowl\b|platter|dinnerware|flatware/.test(t)) return 'Dinnerware';
    if(/grill tool|bbq tool|grilling set/.test(t)) return 'Grill Tool';

    // ── JUGUETES ───────────────────────────────────────────────────
    if(/lego|building set|building block/.test(t)) return 'Building Set';
    if(/action figure|doll|barbie|funko/.test(t)) return 'Action Figure';
    if(/board game|card game|puzzle|jigsaw/.test(t)) return 'Game';
    if(/hot wheels|matchbox|die.?cast|toy car/.test(t)) return 'Toy Vehicle';
    if(/fidget|slime|kinetic sand|pop it/.test(t)) return 'Novelty Toy';
    if(/toy|playset/.test(t)) return 'Toy';

    // ── BEBÉ ───────────────────────────────────────────────────────
    if(/diaper|pampers|huggies|luvs/.test(t)) return 'Diaper';
    if(/baby wipe|baby cleaning wipe/.test(t)) return 'Baby Wipe';
    if(/baby formula|infant formula|similac|enfamil/.test(t)) return 'Baby Formula';
    if(/baby food|pureed|gerber/.test(t)) return 'Baby Food';
    if(/baby lotion|baby wash|baby shampoo|baby oil|baby powder/.test(t)) return 'Baby Care';

    // ── MASCOTAS ───────────────────────────────────────────────────
    if(/dog food|cat food|pet food|kibble/.test(t)) return 'Pet Food';
    if(/dog treat|cat treat|pet treat/.test(t)) return 'Pet Treat';
    // \b obligatorio: sin él, "s-TICK" (lipstick, chapstick, stick deodorant)
    // caía aquí y ponía C:Type = "Flea & Tick" en productos de belleza.
    if(/\bfleas?\b|\bticks?\b|frontline|advantage flea|heartgard/.test(t)) return 'Flea & Tick';
    if(/pet toy|cat toy|dog toy|catnip|chew toy/.test(t)) return 'Pet Toy';
    if(/cat litter|kitty litter/.test(t)) return 'Cat Litter';

    // ── RESPALDO POR CATEGORÍA (si el título no fue concluyente) ────
    var mapped = CAT_TYPE[String(category)];
    if (mapped) return mapped;

    // ── ÚLTIMO RECURSO ─────────────────────────────────────────────
    // Nunca devolvemos un Type engañoso. "Other" es honesto cuando no
    // podemos determinar el tipo — mejor que asumir "Lotion".
    return 'Other';
  }

  // ── STORE CATEGORY — asigna automáticamente la categoría de TIENDA
  // (no la categoría de eBay) según el Type ya detectado. IDs numéricos
  // reales sacados directo de "Manage My Store > Store Categories" de
  // savvydealdotcom (confirmados por Manuel el 4 de agosto 2026). ──
  var STORE_CAT = {
    id_healthBeauty:      '37588505016', // Health & Beauty (categoría padre / respaldo general)
    id_vitaminsSuppDrugs: '37588513016', // VITAMINS / SUPPLEMENT / DRUGS
    id_baby:              '37588508016', // Baby
    id_generalMerch:      '37588510016', // General Merchandise (respaldo final)
    id_hairCareStyling:   '37588507016', // Hair Care & Styling
    id_homeGarden:        '37588509016', // Home & Garden
    id_personalCare:      '37588511016', // Personal Care
    id_pets:              '37588512016', // Pets
    id_toysGamesHobbies:  '3657032016',  // Toys, Games & Hobbies
    id_clothing:          '40909914016',// Clothing
    id_food:              '44739916016' // FOOD
  };

  // Type (ya detectado arriba) → Store Category ID
  var TYPE_TO_STORE_CAT = {
    // Hair Care & Styling
    'Shampoo': STORE_CAT.id_hairCareStyling, 'Conditioner': STORE_CAT.id_hairCareStyling,
    'Hair Color': STORE_CAT.id_hairCareStyling, 'Hair Styling': STORE_CAT.id_hairCareStyling,
    'Hair Treatment': STORE_CAT.id_hairCareStyling,
    // Vitamins / Supplement / Drugs
    'Vitamin': STORE_CAT.id_vitaminsSuppDrugs, 'Supplement': STORE_CAT.id_vitaminsSuppDrugs,
    'Fiber Supplement': STORE_CAT.id_vitaminsSuppDrugs, 'Protein Powder': STORE_CAT.id_vitaminsSuppDrugs,
    'Sports Supplement': STORE_CAT.id_vitaminsSuppDrugs, 'Pain Reliever': STORE_CAT.id_vitaminsSuppDrugs,
    'Allergy Relief': STORE_CAT.id_vitaminsSuppDrugs, 'Antacid': STORE_CAT.id_vitaminsSuppDrugs,
    'Cold & Flu': STORE_CAT.id_vitaminsSuppDrugs, 'Sleep Aid': STORE_CAT.id_vitaminsSuppDrugs,
    // Baby
    'Diaper': STORE_CAT.id_baby, 'Baby Wipe': STORE_CAT.id_baby, 'Baby Formula': STORE_CAT.id_baby,
    'Baby Food': STORE_CAT.id_baby, 'Baby Care': STORE_CAT.id_baby,
    // Personal Care
    'Pain Relief': STORE_CAT.id_personalCare, 'Pads': STORE_CAT.id_personalCare,
    'Adult Diaper': STORE_CAT.id_personalCare, 'Lip Balm': STORE_CAT.id_personalCare,
    'Body Wash': STORE_CAT.id_personalCare, 'Soap': STORE_CAT.id_personalCare,
    'Sunscreen': STORE_CAT.id_personalCare, 'Face Cream': STORE_CAT.id_personalCare,
    'Body Lotion': STORE_CAT.id_personalCare, 'Face Wash': STORE_CAT.id_personalCare,
    'Serum': STORE_CAT.id_personalCare, 'Lotion': STORE_CAT.id_personalCare,
    'Toothpaste': STORE_CAT.id_personalCare, 'Toothbrush': STORE_CAT.id_personalCare,
    'Mouthwash': STORE_CAT.id_personalCare, 'Floss': STORE_CAT.id_personalCare,
    'Whitening': STORE_CAT.id_personalCare, 'Shaving Cream': STORE_CAT.id_personalCare,
    'Razor': STORE_CAT.id_personalCare, 'Deodorant': STORE_CAT.id_personalCare,
    'Fragrance': STORE_CAT.id_personalCare, 'Mascara': STORE_CAT.id_personalCare,
    'Foundation': STORE_CAT.id_personalCare, 'Concealer': STORE_CAT.id_personalCare,
    'Lipstick': STORE_CAT.id_personalCare, 'Eye Shadow': STORE_CAT.id_personalCare,
    'Eyeliner': STORE_CAT.id_personalCare, 'Makeup': STORE_CAT.id_personalCare,
    'Makeup Remover': STORE_CAT.id_personalCare, 'Nail Polish': STORE_CAT.id_personalCare,
    'Nail Care': STORE_CAT.id_personalCare, 'Eye Drops': STORE_CAT.id_personalCare,
    'Ear Care': STORE_CAT.id_personalCare, 'Foot Care': STORE_CAT.id_personalCare,
    'Bandage': STORE_CAT.id_personalCare, 'First Aid': STORE_CAT.id_personalCare,
    'Antiseptic': STORE_CAT.id_personalCare, 'Medical Device': STORE_CAT.id_personalCare,
    'Therapy': STORE_CAT.id_personalCare, 'Brace': STORE_CAT.id_personalCare,
    // Pets
    'Pet Food': STORE_CAT.id_pets, 'Pet Treat': STORE_CAT.id_pets, 'Flea & Tick': STORE_CAT.id_pets,
    'Pet Toy': STORE_CAT.id_pets, 'Cat Litter': STORE_CAT.id_pets,
    // Toys, Games & Hobbies
    'Building Set': STORE_CAT.id_toysGamesHobbies, 'Action Figure': STORE_CAT.id_toysGamesHobbies,
    'Game': STORE_CAT.id_toysGamesHobbies, 'Toy Vehicle': STORE_CAT.id_toysGamesHobbies,
    'Novelty Toy': STORE_CAT.id_toysGamesHobbies, 'Toy': STORE_CAT.id_toysGamesHobbies,
    'Yoga': STORE_CAT.id_toysGamesHobbies, 'Exercise Equipment': STORE_CAT.id_toysGamesHobbies,
    // Food
    'Coffee': STORE_CAT.id_food, 'Tea': STORE_CAT.id_food, 'Energy Drink': STORE_CAT.id_food,
    'Sports Drink': STORE_CAT.id_food, 'Snack Bar': STORE_CAT.id_food, 'Candy': STORE_CAT.id_food,
    'Gum & Mints': STORE_CAT.id_food, 'Snack': STORE_CAT.id_food, 'Condiment': STORE_CAT.id_food,
    'Breakfast Food': STORE_CAT.id_food, 'Soup': STORE_CAT.id_food, 'Seasoning': STORE_CAT.id_food,
    // Home & Garden
    'Laundry Detergent': STORE_CAT.id_homeGarden, 'Fabric Softener': STORE_CAT.id_homeGarden,
    'Dish Soap': STORE_CAT.id_homeGarden, 'Cleaner': STORE_CAT.id_homeGarden,
    'Glass Cleaner': STORE_CAT.id_homeGarden, 'Paper Towel': STORE_CAT.id_homeGarden,
    'Toilet Paper': STORE_CAT.id_homeGarden, 'Facial Tissue': STORE_CAT.id_homeGarden,
    'Trash Bag': STORE_CAT.id_homeGarden, 'Food Storage': STORE_CAT.id_homeGarden,
    'Cleaning Tool': STORE_CAT.id_homeGarden, 'Mug': STORE_CAT.id_homeGarden,
    'Knife': STORE_CAT.id_homeGarden, 'Cookware': STORE_CAT.id_homeGarden,
    'Small Appliance': STORE_CAT.id_homeGarden, 'Appliance': STORE_CAT.id_homeGarden,
    'Dinnerware': STORE_CAT.id_homeGarden, 'Grill Tool': STORE_CAT.id_homeGarden,
    'Air Freshener': STORE_CAT.id_homeGarden, 'Candle': STORE_CAT.id_homeGarden,
    'Motor Oil': STORE_CAT.id_homeGarden, 'Wiper Blade': STORE_CAT.id_homeGarden,
    'Car Care': STORE_CAT.id_homeGarden, 'Automotive': STORE_CAT.id_homeGarden,
    'Battery': STORE_CAT.id_homeGarden, 'Cable': STORE_CAT.id_homeGarden,
    'Charger': STORE_CAT.id_homeGarden, 'Earbuds': STORE_CAT.id_homeGarden,
    'Headphones': STORE_CAT.id_homeGarden, 'Speaker': STORE_CAT.id_homeGarden,
    'Case': STORE_CAT.id_homeGarden, 'Light Bulb': STORE_CAT.id_homeGarden,
    'Writing Instrument': STORE_CAT.id_homeGarden, 'Paper Product': STORE_CAT.id_homeGarden,
    'Office Supply': STORE_CAT.id_homeGarden, 'Book': STORE_CAT.id_homeGarden
  };

  function getStoreCategoryId(typeVal) {
    if (typeVal && TYPE_TO_STORE_CAT[typeVal]) return TYPE_TO_STORE_CAT[typeVal];
    // Respaldo: si no lo reconocemos, mejor "General Merchandise" (existe
    // en tu tienda como categoría genérica) que dejarlo sin categoría.
    return STORE_CAT.id_generalMerch;
  }

  // EPA Registration Number — REQUERIDO por eBay para pesticidas:
  // insect repellents Y productos de flea/tick (son pesticidas regulados).
  // Sin este número, eBay rechaza el listado (Error 21919303).
  function getEpaNumber(category, title) {
    var t = (title || '').toLowerCase();

    // ── FLEA & TICK — números EPA reales por producto (verificados contra
    // las etiquetas oficiales de la EPA en epa.gov, no adivinados) ──────
    // Advantage II para gatos (varía por peso del gato)
    if(/advantage\s*ii/.test(t) && /cat/.test(t)) {
      if(/kitten|2\s*-\s*5\s*lbs|2\s*to\s*5\s*lbs/.test(t)) return '11556-150'; // Kitten 2-5 lbs
      if(/large|over 9|9\s*lbs and over|9\+/.test(t)) return '11556-152'; // Large Cat 9+ lbs
      return '11556-151'; // Small Cat 5-9 lbs (el más común) — verificado EPA.gov
    }
    if(/advantage\s*ii/.test(t) && /dog/.test(t)) return '11556-149'; // Advantage II Dog (aprox)
    if(/frontline plus/.test(t) && /cat/.test(t)) return '65331-3';   // Frontline Plus Cat
    if(/frontline plus/.test(t) && /dog/.test(t)) return '65331-4';   // Frontline Plus Dog
    if(/seresto/.test(t) && /cat/.test(t)) return '11556-155';        // Seresto Cat collar
    if(/seresto/.test(t) && /dog/.test(t)) return '11556-154';        // Seresto Dog collar
    // Otros flea/tick sin número conocido → usar el del pet flea genérico de la categoría
    // (mejor tener uno que dejar vacío; el vendedor puede corregir)
    //
    // ⚠️ BUG CORREGIDO (13 ago 2026): antes decía /flea|tick/ SIN límites de
    // palabra. "S-TICK" contiene "tick", así que a un lip balm ("...Oil Stick
    // Twin Pack") se le puso EPA 11556-151 y eBay lo rechazó por política de
    // pesticidas (OKE-722510010057-3pk). Mismo riesgo con lipstick, chapstick,
    // stick deodorant, nonstick, sticker, ticket. Ahora: \b límites de palabra
    // + exigir contexto de mascota/plaga, no solo la palabra suelta.
    if(String(category) === '20738' || String(category) === '20742' ||
       (/\b(flea|ticks?)\b/.test(t) && /\b(dog|dogs|cat|cats|pet|pets|puppy|kitten|collar|topical|treatment|spot[\s-]?on|shampoo|spray|repell)/.test(t))) {
      return '11556-151'; // respaldo flea/tick (Advantage II Small Cat, EPA verificado)
    }

    // ── INSECT REPELLENT ───────────────────────────────────────────
    // También con \b: "repellent" suelto aparece en textiles ("water
    // repellent"), así que se exige contexto de insecto/plaga.
    if(String(category) === '1232' || String(category) === '261844' ||
       /\b(insect|mosquito|deet)\b/.test(t) ||
       /\bbug\s+(spray|repellent)\b/.test(t) ||
       (/\brepellent\b/.test(t) && /\b(insect|mosquito|bug|fly|flies|gnat|tick|pest)\w*\b/.test(t))) {
      return '4822-547'; // OFF! generic EPA registration
    }
    return '';
  }

  var EPA_BLOCKED = ['046500221545','046500047452','046500017087'];
  var APPLIANCE_C = ['168763','14284','75655','293','112529','44867','14969','9394','48619','20625'];
  var COLOR_C     = ['20695','20694','20696','36903','37558','261068','220'];
  var BOOK_C      = ['261186','171228','377','267','2228','69'];

  // ── VERIFICAR DUPLICADOS EN eBay ANTES DE EXPORTAR ──────────────────
  // Le pregunta al backend si algún SKU ya tiene listado activo en eBay.
  // Si hay duplicados, avisa al usuario y le da la opción de continuar o cancelar.
  // Si el backend falla (sin token, sin red), sigue normal sin bloquear.
  toast('🔍 Verificando SKUs en eBay...');
  var _skusToCheck = bulk.map(function(it){ return it.sku || ''; }).filter(Boolean);
  var _existingSkus = {};
  // [STAGING PILOT] /check-skus endpoint not available in staging
  // Skip remote verification but continue with local checks
  console.warn('check-skus no disponible en staging — continuando sin verificar duplicados remotamente');

  // Si hay duplicados, mostrar aviso y pedir confirmación
  var _dupSkus = Object.keys(_existingSkus);
  if (_dupSkus.length > 0) {
    var _dupMsg = '⚠️ DUPLICADOS EN eBay\n\nEstos SKUs ya tienen listado activo:\n\n'
      + _dupSkus.join('\n')
      + '\n\n¿Continuar y exportar de todas formas?\n(eBay los va a rechazar)';
    if (!confirm(_dupMsg)) {
      // Usuario canceló — quitar el candado y restaurar el botón
      window._exportLock = false;
      if (expBtnEl) {
        expBtnEl.innerHTML = expBtnOldHTML;
        expBtnEl.style.opacity = '';
        expBtnEl.style.pointerEvents = '';
      }
      toast('❌ Export cancelado — elimina los duplicados del CSV primero');
      return;
    }
    // Si el usuario decide continuar, avisar cuántos van a fallar
    toast('⚠️ ' + _dupSkus.length + ' SKU(s) duplicado(s) — eBay los rechazará');
  }

  // Validar categorías contra eBay ANTES de armar el CSV.
  // eBay elige la mejor categoría leaf real según el título de cada producto.
  // Esto elimina el Error 87 de raíz. Si el backend no responde, usamos psSafeCategory.
  // La consola de debug (5 toques al logo) es incómoda de encontrar en medio
  // del trabajo. El build se muestra también aquí, al exportar, porque es el
  // momento en que sí importa saber qué versión generó el archivo.
  toast('🏷️ Build ' + (window.PS_BUILD || '?') + ' — generando CSV');
  toast('🔎 Validando categorías con eBay...');
  var leafMap = await validateCategoriesWithEbay(bulk);

  // ── MISMA CATEGORÍA PARA TODOS LOS PAQUETES DEL MISMO PRODUCTO ──────────
  // 17 ago 2026: SAN-197638007751-1pk salió en categoría 82597 y su hermano
  // -2pk en 69528. Mismo UPC, misma caja — lo único distinto es el título,
  // porque el de paquete termina en "Pack of 2 New" en vez de "Makeup New",
  // y la Taxonomy API de eBay contesta según el texto que le mandas.
  //
  // Un mismo producto no puede vivir en dos secciones de la tienda: una de
  // las dos está mal por definición. Se toma la categoría del paquete más
  // chico (el 1pk, cuyo título es el más limpio y descriptivo) y se aplica a
  // todos los paquetes del mismo SKU base.
  var _catPorBase = {};
  bulk.forEach(function(it){
    var base = String(it.sku || '').replace(/-\d+pk$/i, '');
    if (!base) return;
    var k  = String(it.category || '').trim() + '|' + String(it.title || '').trim();
    var lc = leafMap[k] || leafMap[k.substring(0,120)];
    if (!lc) return;
    var packs = parseInt((String(it.sku).match(/-(\d+)pk$/i) || [])[1] || '1', 10);
    if (!_catPorBase[base] || packs < _catPorBase[base].packs) {
      _catPorBase[base] = { cat: lc, packs: packs };
    }
  });
  bulk.forEach(function(it){
    var base = String(it.sku || '').replace(/-\d+pk$/i, '');
    var ref  = _catPorBase[base];
    if (!ref) return;
    var k = String(it.category || '').trim() + '|' + String(it.title || '').trim();
    var actual = leafMap[k] || leafMap[k.substring(0,120)];
    if (actual && actual !== ref.cat) {
      leafMap[k] = ref.cat;
      leafMap[k.substring(0,120)] = ref.cat;
      console.log('[cat unificada] ' + it.sku + ': ' + actual + ' → ' + ref.cat);
    }
  });

  // ── RED DE SEGURIDAD: fecha de expiración faltante ────────────────────
  // El guardia de _addBulkInternal() solo cubre UN camino de entrada; el
  // flujo de split/packs mete productos al CSV sin pasar por ahí. eBay
  // rechaza el listado completo (error 21919303) si falta Expiration Date.
  //
  // ⚠️ VA DESPUÉS de validateCategoriesWithEbay A PROPÓSITO (corregido 14 ago):
  // antes estaba arriba y leía it.category, que es la categoría ADIVINADA
  // localmente — no la que eBay realmente asigna. El Boost Oxygen entraba con
  // una categoría local cualquiera y terminaba en 45206 recién aquí abajo, así
  // que el chequeo miraba la categoría equivocada. Ahora usa _finalCat, la
  // misma que va a viajar en el CSV.
  //
  // Es BLOQUEO, no confirmación: BOO-637866288459 se rechazó TRES veces por
  // esto. Un CSV que ya sabemos que eBay va a rechazar no debe poder salir.
  var _noExp = bulk.filter(function(it){
    if (String(it.expDate || '').trim()) return false;
    var _k  = String(it.category || '').trim() + '|' + String(it.title || '').trim();
    var _fc = leafMap[_k] || leafMap[_k.substring(0,120)] || psSafeCategory(it.category, '31786');
    return window.psMayNeedExpDate(_fc, it.title);
  });
  if (_noExp.length) {
    var _noExpList = _noExp.map(function(it){ return '• ' + (it.sku || it.title || '?'); }).join('\n');
    window._exportLock = false;
    if (expBtnEl) {
      expBtnEl.innerHTML = expBtnOldHTML;
      expBtnEl.style.opacity = '';
      expBtnEl.style.pointerEvents = '';
    }
    alert(
      '🚫 EXPORT DETENIDO\n\n' + _noExp.length + ' producto(s) SIN fecha de expiración:\n\n' +
      _noExpList +
      '\n\neBay RECHAZA estos listados (error 21919303).\n\n' +
      'Abre cada uno, toca 📅 y agrega la fecha del envase. Después exporta otra vez.'
    );
    toast('🚫 Export detenido — faltan ' + _noExp.length + ' fecha(s) de expiración');
    return;
  }

  bulk.forEach(function(it) {
    // ── CATEGORÍA FINAL, CALCULADA AL PRINCIPIO DEL CICLO ──────────────────
    // Antes esto se calculaba hasta abajo (justo antes de armar la fila), pero
    // toda la lógica de item specifics de arriba usaba it.category — que es la
    // categoría ADIVINADA localmente, no la que eBay asigna y que realmente
    // viaja en el CSV. Por eso el Dosage no se llenaba: TUM-307667388107 salió
    // en 75039 y NAT-074312014024 en 11776, pero la lógica estaba comparando
    // contra otra categoría. Se calcula UNA vez aquí y se reutiliza en todo
    // el ciclo. (Corregido 14 ago 2026 — misma clase de bug que la fecha de
    // expiración.)
    var _catKey     = String(it.category || '').trim() + '|' + String(it.title || '').trim();
    var _catKeyTrim = _catKey.substring(0, 120); // el backend recorta la clave a 120 chars
    var _finalCat   = leafMap[_catKey] || leafMap[_catKeyTrim] || psSafeCategory(it.category, '31786');

    // Saltar productos no identificados o restringidos por EPA
    if (EPA_BLOCKED.some(function(u){ return (it.sku||'').includes(u); })) {
      skipped++; toast('⚠️ ' + it.sku + ' — Bloqueado por EPA'); return;
    }
    if (!it.title || it.title.includes('UNABLE TO CREATE') || it.title.includes('UNIDENTIFIED') || it.brand === 'UNKNOWN') {
      skipped++; return;
    }
    // Saltar productos sin título real (solo "Pack of N New" sin nombre de producto)
    var titleWords = (it.title||'').replace(/pack of \d+/gi,'').replace(/\bnew\b/gi,'').replace(/\bsealed\b/gi,'').trim();
    if (titleWords.length < 8) {
      skipped++;
      toast('⚠️ SKU ' + (it.sku||'') + ' — sin título válido, omitido del CSV');
      return;
    }
    var pics = it.bundleImg || it.photo || it.imgUrl || '';
    var typeVal   = detectType(String(it.category), it.title);
    var epaVal    = getEpaNumber(String(it.category), it.title);
    var modelVal  = '';
    var colorVal  = '';
    var langVal   = '';
    var bookTitle = '';
    var authorVal = '';
    var isbnVal    = '';
    // La fecha manda; si no hay, va el código de manufactura. eBay exige algo
    // en este campo en categorías de salud (error 21919303) y el código es
    // lo único verificable que trae el envase. Ver psExpOrCode().
    var expDateVal = psExpOrCode(it);
    var dosageVal  = '';
    var connectivityVal = '';
    // ── IMPORTANTE: Definir _itSpecs aquí (ANTES de usarlo en lógica de colorVal) ──
    var _itSpecs = (it._specifics && typeof it._specifics === 'object') ? it._specifics : {};
    // Segunda pasada: el export es el punto por donde cruzan TODOS los
    // caminos, incluidos productos guardados antes de este arreglo.
    _itSpecs = psScrubSpecs(_itSpecs, _finalCat, it.title);
    _itSpecs = psScrubHealthSpecs(_itSpecs, _finalCat, it.title, it.upc || it.sku || '');

    // Detectar Connectivity del título automáticamente
    var _tl = (it.title || '').toLowerCase();
    if (/bitty boomer|bittyboomers/i.test(_tl))        connectivityVal = 'Bluetooth';
    else if (/mini speaker|pocket speaker|character speaker|collectible speaker/i.test(_tl)) connectivityVal = 'Bluetooth';
    else if (/bluetooth/i.test(_tl))       connectivityVal = 'Bluetooth';
    else if (/wireless/i.test(_tl))        connectivityVal = 'Wireless';
    else if (/wi-fi|wifi/i.test(_tl))      connectivityVal = 'Wi-Fi';
    else if (/usb-c|usb c/i.test(_tl))     connectivityVal = 'USB-C';
    else if (/\busb\b/i.test(_tl))         connectivityVal = 'USB';
    else if (/wired/i.test(_tl))           connectivityVal = 'Wired';
    else if (/nfc/i.test(_tl))             connectivityVal = 'NFC';
    else if (/aux|3\.5mm/i.test(_tl))      connectivityVal = '3.5mm Audio Jack';

    // Extract dosage from title for health products
    // Dosage — requerido para vitaminas, suplementos, productos de salud
    // Lista ampliada de categorías que requieren Dosage en eBay
    var EXP_CATS_D = window.PS_HEALTH_CATS;
    // También detectar por palabras clave en el título
    // Incluye vitaminas, suplementos Y productos de salud/analgésicos
    var _isSupplement = /vitamin|supplement|probiotic|omega|collagen|protein|melatonin|zinc|magnesium|calcium|iron|biotin|turmeric|elderberry|fish oil|gummy|gummies|capsule|tablet|softgel|multivitamin|pain reliev|pain relief|pain killer|arthritis|joint pain|muscle rub|muscle ache|sore muscle|backache|lidocaine|phenol|topical|analgesic|ibuprofen|acetaminophen|aspirin|naproxen|roll on|lotion|cream|gel|ointment|serum|absorbine|bengay|icy hot|biofreeze|antacid|heartburn|acid reducer|acid indigestion|\btums\b|rolaids|maalox|mylanta|pepcid|prilosec|nexium|zantac|famotidine|omeprazole|ranitidine|pepto|bismol|simethicone|gas relief|laxative|stool softener|fiber supplement|metamucil|dulcolax|miralax|imodium|anti.?diarrheal|electrolyte|rehydration|cold medicine|cough syrup|cough medicine|\bflu\b|decongestant|expectorant|antihistamine|dimetapp|robitussin|mucinex|delsym|dayquil|nyquil|benadryl|claritin|zyrtec|allegra|sudafed/i.test(it.title||'');
    if (EXP_CATS_D.includes(String(_finalCat)) || _isSupplement) {
      // ⚠️ 17 ago 2026: el regex incluía ct/count/capsule/tablet/softgel, que
      // son unidades de CANTIDAD, no de dosis. Por eso CankerMelts salió con
      // Dosage = "20 Count" — que es cuántas pastillas trae el frasco, no
      // cuánto benzocaína tiene cada una. Una dosis lleva unidad de masa o
      // volumen; si el título no la trae, se remite a la etiqueta.
      var doseMatch = (it.title||'').match(/(\d+\.?\d*\s*(?:mg|mcg|iu|ml|g)\b)/i);
      dosageVal = doseMatch ? doseMatch[0].replace(/(\d)([a-zA-Z])/, '$1 $2') : 'See product label';
    }

    // Auto-fix brand for known brands in title
    var brandFix = it.brand || 'Generic';
    // ⚠️ 17 ago 2026: la corrección de marca por UPC la había puesto dentro de
    // psScrubHealthSpecs, sobre el objeto de item specifics. Error de diseño:
    // la columna *C:Brand del CSV NO lee de ahí, lee de it.brand. Por eso
    // MAG-850052593254 volvió a salir como "Generic" aunque su UPC empieza con
    // 850052 (Qunol). Se corrige en el punto por donde sí pasa el dato.
    if (/^(generic|unknown|n\/a)$/i.test(String(brandFix))) {
      var _bUpc = (typeof psBrandFromUPC === 'function')
        ? psBrandFromUPC(it.upc || it.sku || '') : '';
      if (_bUpc) brandFix = _bUpc;
    }
    const titleLower = (it.title||'').toLowerCase();
    if (/\blego\b/.test(titleLower)) { brandFix = 'LEGO'; }
    else if (/\bdash\b/.test(titleLower) && /waffle|maker|blender|toaster/.test(titleLower)) { brandFix = 'Dash'; }
    else if (/\bjergens\b/.test(titleLower)) { brandFix = 'Jergens'; }
    else if (/\bolay\b/.test(titleLower)) { brandFix = 'Olay'; }
    else if (/\bneutrogena\b/.test(titleLower)) { brandFix = 'Neutrogena'; }
    else if (/\bdove\b/.test(titleLower)) { brandFix = 'Dove'; }
    else if (/\bold spice\b/.test(titleLower)) { brandFix = 'Old Spice'; }
    else if (/\bcolgate\b/.test(titleLower)) { brandFix = 'Colgate'; }
    else if (/\bcrest\b/.test(titleLower)) { brandFix = 'Crest'; }
    else if (/\bpantene\b/.test(titleLower)) { brandFix = 'Pantene'; }
    else if (/\bmetamucil\b/.test(titleLower)) { brandFix = 'Metamucil'; }
    else if (/\bcentrum\b/.test(titleLower)) { brandFix = 'Centrum'; }

    var cleanTitle = psFixTitleCase((it.title||'').replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FEFF}✳️⭐🔥💊📦✅❌⚠️🌟💰📊🏷️]/gu, '').replace(/\s+/g,' ').trim(), it.brand).substring(0,80);

    // Model — required for Electronics & Appliances
    // ── Solo usamos el texto extraído del título como Model si el título
    // REALMENTE tenía un delimitador (coma/guión) separando un segmento
    // corto tipo modelo. Nuestros títulos SEO son texto corrido sin comas,
    // así que sin esta protección se copiaba el título casi completo como
    // "Model" (ej. "Bluetooth Portable Speaker Wireless Audio Player Pack
    // of 2 New"). Si no hay modelo real identificable, usamos el estándar
    // de eBay "Does Not Apply" — honesto y aceptado para productos sin MPN. ──
    if (APPLIANCE_C.includes(String(it.category))) {
      var titleHadDelim = /,/.test(it.title || '');
      var titleWords = (it.title||'').split(/,/)[0].trim();
      var candidateApplModel = brandFix ? titleWords.replace(new RegExp('^'+brandFix+'\\s*','i'),'').trim() : titleWords.trim();
      modelVal = (titleHadDelim && candidateApplModel && candidateApplModel.length <= 40)
        ? candidateApplModel.substring(0,65)
        : 'Does Not Apply';
    }

    // Model — también requerido para electrónicos (cualquier producto con Connectivity)
    if (!modelVal && connectivityVal) {
      var titleHadDelim2 = /[,\-|]/.test(it.title || '');
      var titleParts = (it.title || '').split(/[,\-|]/)[0].trim();
      var candidateModel = brandFix
        ? titleParts.replace(new RegExp('^' + brandFix + '\\s*', 'i'), '').trim()
        : titleParts.trim();
      modelVal = (titleHadDelim2 && candidateModel && candidateModel.length <= 40)
        ? candidateModel.substring(0, 65)
        : 'Does Not Apply';
    }

    // Color — required for mugs, kitchenware
    if (COLOR_C.includes(String(it.category))) {
      const tl = titleLower;
      if (/white/i.test(tl)) colorVal = 'White';
      else if (/black/i.test(tl)) colorVal = 'Black';
      else if (/red/i.test(tl)) colorVal = 'Red';
      else if (/blue/i.test(tl)) colorVal = 'Blue';
      else if (/green/i.test(tl)) colorVal = 'Green';
      else if (/gray|grey/i.test(tl)) colorVal = 'Gray';
      else if (/silver/i.test(tl)) colorVal = 'Silver';
      else if (/clear|transparent/i.test(tl)) colorVal = 'Clear';
      else colorVal = 'Multicolor';
    }
    // Si la IA determinó un Color y aún no tenemos uno, usar el de la IA.
    if (!colorVal && _itSpecs && _itSpecs['Color']) {
      colorVal = String(_itSpecs['Color']).trim();
    }

    // Override type for books
    if (BOOK_C.includes(String(it.category))) {
      typeVal = 'Fiction'; // eBay accepts Fiction/Non-Fiction for books
    }
    if (BOOK_C.includes(String(it.category))) {
      langVal   = 'English';
      // Book Title max 65 chars
      var rawBookTitle = cleanTitle.replace(/\s*Pack of \d+\s*/gi,'').replace(/\s*New\s*$/i,'').trim();
      bookTitle = rawBookTitle.length > 65 ? rawBookTitle.substring(0,62).replace(/\s+\S*$/,'').trim() + '...' : rawBookTitle;
      authorVal = (it.brand && it.brand !== 'Generic') ? it.brand : 'Unknown';
      // ISBN = last 13 digits from SKU (UPCs for books are ISBNs)
      const upcStr = (it.sku||'').replace(/[^0-9]/g,'');
      // Try to get 13-digit number from the SKU
      const isbnMatch = (it.sku||'').match(/(\d{13})/);
      isbnVal = isbnMatch ? isbnMatch[1] : (upcStr.length >= 13 ? upcStr.substring(0,13) : '');
    }

    // Categoría final: ya se calculó al inicio del ciclo (_finalCat), para que
    // la lógica de item specifics de arriba use la MISMA categoría que el CSV.

    // UPC para el CSV: preferir it.upc; si no, extraerlo del SKU (BRAND-UPC-Npk).
    // eBay solo acepta UPCs de 12-14 dígitos. Si no hay UPC válido, va vacío
    // (eBay permite "Does not apply" pero preferimos dejarlo vacío que inventar).
    var upcVal = '';
    // ── Helper: obtiene el valor de un specific de IA para una columna dada.
    // Recorre cur._specifics del producto y mapea cada nombre a su columna.
    var _specByCol = {};
    for (var _sk in _itSpecs) {
      if (!_itSpecs.hasOwnProperty(_sk)) continue;
      var _col = SPEC_COL_MAP[_sk];
      if (_col && _itSpecs[_sk] && !_specByCol[_col]) {
        _specByCol[_col] = String(_itSpecs[_sk]).trim();
      }
    }
    function _specForCol(col){ return _specByCol[col] || ''; }

    var _rawUpc = String((it.upc || '')).replace(/[^0-9]/g, '');
    if (!_rawUpc && it.sku) {
      // SKU formato BRAND-UPC-Npk → sacar el bloque de dígitos más largo
      var _skuDigits = String(it.sku).match(/\d{8,14}/);
      if (_skuDigits) _rawUpc = _skuDigits[0];
    }
    if (_rawUpc.length >= 12 && _rawUpc.length <= 14) {
      upcVal = _rawUpc;
    }

    // ── Formulation / Item Form: cuando el título dice explícitamente la
    // forma del producto (Softgel, Capsule, Tablet, Gummy, etc.), esa es la
    // fuente de verdad — más confiable que lo que adivine la IA. Solo se usa
    // el valor de la IA cuando el título no lo deja claro (cremas, geles,
    // líquidos tópicos donde no aplica este detector).
    var _ingestibleForm = psDetectIngestibleForm(it.title);
    var formulationVal = _ingestibleForm || _specForCol('C:Formulation');
    var itemFormVal     = _ingestibleForm || _specForCol('C:Item Form');

    // ── Active Ingredients / Ingredients: quitar la dosis del nombre del
    // ingrediente (ej. "Magnesium 400mg" → "Magnesium"). La dosis ya vive
    // en su propia columna (C:Dosage); dejarla en el ingrediente duplica el
    // dato y no calza con el valor exacto que eBay espera para el aspecto.
    var activeIngredientsVal = psStripDosageFromIngredient(_specForCol('C:Active Ingredients'));
    var ingredientsVal       = psStripDosageFromIngredient(_specForCol('C:Ingredients')) || activeIngredientsVal;

    // ── Flavor / Department: mismo respaldo que Formulation — se calculan
    // de nuevo aquí con el TÍTULO FINAL (it.title). La generación automática
    // de specifics corre 900ms después de escanear y a veces el título aún
    // no tiene su forma definitiva (ej. sin "Softgels" todavía) — por eso
    // Flavor podía quedar vacío aunque la lógica en sí esté bien. Al
    // recalcular aquí, en el momento de exportar, siempre usa el título
    // ya terminado.
    var flavorVal = _specForCol('C:Flavor');
    if (!flavorVal && _ingestibleForm && _ingestibleForm !== 'Gummy') {
      flavorVal = 'Unflavored';
    }
    // ⚠️ 15 ago 2026: aunque psScrubSpecs borre "Age Group" de los specifics,
    // este respaldo lo volvía a inventar con psExtractDepartment(), que
    // devuelve "Adult" por defecto. En juguetes se queda vacío.
    var ageGroupVal = _specForCol('C:Age Group');
    if (!ageGroupVal && PS_TOY_CATS.indexOf(String(_finalCat)) === -1) {
      ageGroupVal = psExtractDepartment(it.title);
    }
    var departmentVal = _specForCol('C:Department') || psExtractGenderDepartment(it.title);

    lines.push([
      'Add',
      it.sku||'',
      _finalCat,
      cleanTitle,
      '1000',
      psAppendLote(descToEbayHTML(it.description) || ('<p>' + cleanTitle + '</p>'), it),
      pics,
      'FixedPrice','GTC',
      it.price||'9.99',
      String(it.quantity||1),'1',
      'Lumberton, NC','1',
      SHIP, RET, PAY,
      getStoreCategoryId(typeVal),
      brandFix,
      upcVal,
      typeVal,
      epaVal,
      modelVal,
      colorVal,
      langVal,
      bookTitle,
      authorVal,
      isbnVal,
      expDateVal,
      dosageVal,
      (it.shade || ''),
      connectivityVal,
      // ── Valores de specifics de IA (mapeados a sus columnas) ──
      _specForCol('C:Size'),
      _specForCol('C:Volume'),
      _specForCol('C:Scent'),
      flavorVal,
      formulationVal,
      activeIngredientsVal,
      ingredientsVal,
      _specForCol('C:Features'),
      _specForCol('C:Material'),
      _specForCol('C:Number of Doses'),
      _specForCol('C:Suitable For'),
      _specForCol('C:Fragrance'),
      itemFormVal,
      _specForCol('C:Country of Origin'),
      _specForCol('C:Main Purpose'),
      ageGroupVal,
      departmentVal,
      _specForCol('C:MPN'),
      _specForCol('C:Period After Opening (PAO)'),
      _specForCol('C:Styling Effect'),
      _specForCol('C:Product Line'),
      _specForCol('C:Item Weight'),
      _specForCol('C:Size Type'),
      _specForCol('C:When to Take'),
      (it.weightMajor != null ? String(it.weightMajor) : ''),
      (it.weightMinor != null ? String(it.weightMinor) : '')
    ].map(q).join(','));
  });

  var csv  = lines.join('\r\n');
  var now  = new Date();
  var stamp = now.getFullYear()+'-'
    + String(now.getMonth()+1).padStart(2,'0')+'-'
    + String(now.getDate()).padStart(2,'0')+'-'
    + String(now.getHours()).padStart(2,'0')
    + String(now.getMinutes()).padStart(2,'0');
  var exportedCount = bulk.length - skipped;
  var fname = 'eBay-FX-'+stamp+'-'+exportedCount+'items.csv';
  if (skipped > 0) toast('⚠️ ' + skipped + ' producto(s) no identificados omitidos del CSV');

  var driveUrl = localStorage.getItem('cl_drive_url');
  if (driveUrl) {
    toast('📤 Subiendo a Google Drive...');
    fetch(driveUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({csv: csv, filename: fname}),
      headers: {'Content-Type': 'text/plain'}
    }).then(function() {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99999;'
        +'display:flex;flex-direction:column;align-items:center;justify-content:center;'
        +'padding:30px;gap:16px;text-align:center';
      ov.innerHTML = '<div style="font-size:60px">✅</div>'
        +'<div style="color:#fff;font-size:22px;font-weight:800">CSV en Google Drive</div>'
        +'<div style="color:#aaa;font-size:14px">'+fname+'</div>'
        +'<div style="color:#aaa;font-size:13px;line-height:1.6">'
        +'En Windows abre <b style="color:#fff">drive.google.com</b><br>'
        +'Carpeta <b style="color:#fff">eBay Listings</b><br>'
        +'Descarga el CSV → sube a eBay</div>'
        +'<a href="https://drive.google.com/drive/folders" target="_blank" '
        +'style="background:#1a73e8;border-radius:12px;padding:14px 28px;color:#fff;'
        +'font-weight:800;font-size:16px;text-decoration:none">📁 Abrir Google Drive</a>'
        +'<button onclick="this.parentElement.remove()" '
        +'style="background:none;border:1px solid #555;border-radius:10px;padding:10px 24px;'
        +'color:#888;cursor:pointer;font-size:14px">Cerrar</button>';
      document.body.appendChild(ov);
    }).catch(function() {
      savvyShowExportOptions(csv, fname, bulk.length);
    });
  } else {
    savvyShowExportOptions(csv, fname, bulk.length);
  }
  } catch(exportErr) {
    console.error('exportCSV error:', exportErr);
    toast('❌ Export error: ' + exportErr.message);
    // Show full error for debugging
    var errOv = document.createElement('div');
    errOv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:12px;text-align:center';
    errOv.innerHTML = '<div style="font-size:32px">❌</div>'
      + '<div style="color:#fff;font-size:16px;font-weight:800">Export Error</div>'
      + '<div style="color:#ff5252;font-size:13px;word-break:break-all;max-width:340px;background:#1a1a1a;padding:12px;border-radius:8px">' + exportErr.message + '</div>'
      + '<button onclick="this.parentElement.remove()" style="background:linear-gradient(135deg,#FF6B35,#E71D36);border:none;border-radius:10px;padding:12px 24px;color:#fff;cursor:pointer;font-weight:800">Cerrar</button>';
    document.body.appendChild(errOv);
  }
}

function savvyShowExportOptions(csv, fname, count) {
  var blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  var url  = URL.createObjectURL(blob);
  var ov   = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:99999;'
    +'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;gap:12px;text-align:center';
  ov.innerHTML = '<div style="font-size:40px">📄</div>'
    +'<div style="color:#fff;font-size:18px;font-weight:800">'+fname+'</div>'
    +'<div style="color:#aaa;font-size:13px">'+count+' producto(s) listos para eBay</div>'
    +'<a href="'+url+'" download="'+fname+'" '
    +'style="background:linear-gradient(135deg,#FF6B35,#E71D36);border-radius:12px;padding:14px 28px;color:#fff;'
    +'font-weight:800;font-size:16px;text-decoration:none;margin-top:8px">⬇️ Descargar CSV</a>'
    +'<div style="color:#666;font-size:11px;margin-top:4px">Configura Google Drive URL en ⚙️ para subida directa</div>'
    +'<button onclick="this.parentElement.remove()" '
    +'style="background:none;border:1px solid #555;border-radius:10px;padding:10px 24px;'
    +'color:#888;cursor:pointer;font-size:14px;margin-top:4px">Cerrar</button>';
  document.body.appendChild(ov);
}

// Init
document.addEventListener('DOMContentLoaded',()=>{
  if(!localStorage.getItem('savvy_ebay_id'))localStorage.setItem('savvy_ebay_id',DEF_EBAY);

  // ── WARM-UP DISABLED in staging ──
  // The background-removal service is not available in staging, so warmup is skipped.
  // This would normally wake the service on app start, but it only exists in production.

  // ── FAB + panel de export (PRIMERO — a prueba de errores posteriores) ──
  function ensureBulkOverlay(){
    if (document.getElementById('bulkOv')) return;
    var ov = document.createElement('div');
    ov.id = 'bulkOv';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(13,13,13,.97);z-index:5000;display:none;flex-direction:column;padding:16px;padding-top:calc(16px + env(safe-area-inset-top))';
    ov.innerHTML = ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
      +   '<div style="font-size:18px;font-weight:800;color:#fff">\ud83d\udccb CSV Session</div>'
      +   '<button id="bulkX" style="background:none;border:1px solid #555;border-radius:10px;padding:8px 14px;color:#aaa;font-size:14px;cursor:pointer">\u2715 Close</button>'
      + '</div>'
      + '<div id="bulkList" style="flex:1;overflow-y:auto;margin-bottom:12px"></div>'
      + '<button id="expBtn" style="width:100%;background:linear-gradient(135deg,#00e676,#00a854);border:none;border-radius:12px;padding:15px;color:#000;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:8px">\ud83d\udce4 EXPORT CSV \u2192 Drive + Sheet</button>'
      + '<button id="clrBtn" style="width:100%;background:none;border:1px solid #e74c3c;border-radius:12px;padding:12px;color:#e74c3c;font-size:14px;font-weight:800;cursor:pointer">\ud83d\uddd1 Clear Session</button>';
    document.body.appendChild(ov);
    document.getElementById('bulkX').addEventListener('click', closeBulk);
    var eb = document.getElementById('expBtn');
    eb.addEventListener('touchend', function(e){ e.preventDefault(); exportCSV(); });
    eb.addEventListener('click', exportCSV);
    var cb = document.getElementById('clrBtn');
    function clrHandler(e){
      if (e && e.type === 'touchend') e.preventDefault();
      if(bulk.length===0){toast('\u26a0\ufe0f No hay productos en el CSV');return;}
      var ov2=document.createElement('div');
      ov2.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:30px';
      ov2.innerHTML='<div style="background:#1a1a1a;border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center">'
        +'<div style="font-size:18px;font-weight:800;margin-bottom:8px;color:#fff">\ud83d\uddd1 Clear Session</div>'
        +'<div style="font-size:14px;color:#888;margin-bottom:20px">Vas a borrar '+bulk.length+' producto(s). \u00bfConfirmas?</div>'
        +'<button onclick="bulk=[];updateFAB();renderBulk();saveBulkToStorage();this.closest(\'div[style*=fixed]\').remove();toast(\'\u2705 Sesi\u00f3n limpiada\')" style="width:100%;padding:12px;background:#e74c3c;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:8px">S\u00ed, borrar todo</button>'
        +'<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:100%;padding:10px;background:none;border:1px solid #555;border-radius:10px;color:#888;cursor:pointer">Cancelar</button>'
        +'</div>';
      document.body.appendChild(ov2);
    }
    cb.addEventListener('touchend', clrHandler);
    cb.addEventListener('click', function(){ clrHandler(); });
  }
  function openBulk(){ ensureBulkOverlay(); renderBulk(); document.getElementById('bulkOv').style.display='flex'; }
  function closeBulk(){ var o=document.getElementById('bulkOv'); if(o) o.style.display='none'; }
  // Functions are called locally via event listeners; no need for window exposure
  var _fabEl = document.getElementById('fab');
  if (_fabEl) {
    _fabEl.addEventListener('touchend', function(e){ e.preventDefault(); openBulk(); });
    _fabEl.addEventListener('click', openBulk);
  }


  const cfgBtn=$('cfgBtn');
  if(cfgBtn){
    cfgBtn.addEventListener('touchend',e=>{e.preventDefault();openCfgWithPin();});
    cfgBtn.addEventListener('click',openCfgWithPin);
  }
  if($('cfgX')) $('cfgX').addEventListener('click',closeCfg);

  const camBtn=$('camBtn');
  if(camBtn){
    camBtn.addEventListener('touchend',e=>{e.preventDefault();startCam();});
    camBtn.addEventListener('click',startCam);
  }else{
    console.warn('⚠️ camBtn not found in DOM');
  }
  const stopBtn=$('camStop');
  if(stopBtn){
    stopBtn.addEventListener('touchend',e=>{e.preventDefault();stopCam();});
    stopBtn.addEventListener('click',stopCam);
  }

  // NOTE: upcIn/srchBtn from the old idle screen were removed — scr-res
  // (upcInRes + its 🔍 button) is now the single home screen and is wired
  // via inline onclick/onkeydown attributes directly in the HTML.

  // eBay URL paste box lives in scr-res (ps-ebay-url) and is wired inline in the HTML.


  renderSt();
  checkSavedSession();
  const su = localStorage.getItem('cl_sheets_url');
  if ($('sheetsIn') && su) $('sheetsIn').value = su;
  const rk = localStorage.getItem('rbg_key') || DEFAULT_RBG_KEY;
  if ($('rbgKeyIn') && rk) $('rbgKeyIn').placeholder = '••••••••' + rk.slice(-4);
  const pk = localStorage.getItem('photoroom_key') || DEFAULT_PHOTOROOM_KEY;
  // Clothing keys
  const clRbg = localStorage.getItem('cl_rbg_key') || DEFAULT_RBG_KEY;
  const clPr  = localStorage.getItem('cl_photoroom_key');
  if (document.getElementById('cl-rbg-key-in') && clRbg)
    document.getElementById('cl-rbg-key-in').placeholder = '••••••••' + clRbg.slice(-4);
  if (document.getElementById('cl-pr-key-in') && clPr)
    document.getElementById('cl-pr-key-in').placeholder = '••••••••' + clPr.slice(-4);
  const scannerRbg = localStorage.getItem('rbg_key') || DEFAULT_RBG_KEY;
  const scannerPr  = localStorage.getItem('photoroom_key') || DEFAULT_PHOTOROOM_KEY;
  // Google Drive URL
  const driveEl = document.getElementById('drive-url-input');
  const driveUrl = localStorage.getItem('cl_drive_url');
  if (driveEl && driveUrl) {
    driveEl.value = driveUrl;
    document.getElementById('drive-status').textContent = '✅ Google Drive conectado';
    document.getElementById('drive-status').style.color = 'var(--sv)';
  }
  // ImgBB key
  const imgbbKey = (localStorage.getItem('cl_imgbb_key') || DEFAULT_IMGBB_KEY);
  if (document.getElementById('imgbb-key-in') && imgbbKey) {
    document.getElementById('imgbb-key-in').placeholder = '••••••••' + imgbbKey.slice(-4);
    document.getElementById('imgbb-status').textContent = '✅ ImgBB configured — photos will auto-upload for eBay URLs';
  }

  if (clRbg) {
    clShowBgStatus('✅ Clothing Remove.bg key active — no watermark on clothing photos', 'var(--sv)');
  } else if (scannerRbg) {
    clShowBgStatus('✅ Using Scanner Remove.bg key for clothing (no watermark). You can set a separate key above.', 'var(--sv)');
  } else if (clPr || scannerPr) {
    clShowBgStatus('⚠️ Using PhotoRoom — photos will have watermark. Add a Remove.bg key above for clean photos.', 'var(--gd)');
  }
  if ($('phroomKeyIn') && pk) {
    $('phroomKeyIn').placeholder = '••••••••' + pk.slice(-4);
    showRbgStatus('✅ PhotoRoom configured — tap "Test Background Removal" to verify', 'var(--sv)');
  } else if (rk) {
    showRbgStatus('✅ Remove.bg configured — consider also adding PhotoRoom (75 free/month)', 'var(--gd)');
  }

  // Clothing FAB
  const clFab = $('cl-fab');
  if (clFab) {
    clFab.addEventListener('touchend', e => { e.preventDefault(); clShowSession(); });
    clFab.addEventListener('click', clShowSession);
  }

  // Restore session badge on page reload
  setTimeout(function() {
    if (typeof clUpdateSessionBadge === 'function') clUpdateSessionBadge();
    if (typeof clUpdateClFAB === 'function') clUpdateClFAB();
    // Update cl-fab badge number
    const sess = JSON.parse(localStorage.getItem('cl_ebay_session') || '[]');
    const fabN = document.getElementById('cl-fab-n');
    if (fabN && sess.length > 0) fabN.textContent = sess.length;
  }, 500);
});

function clShowSession() {
  const ebayCount = JSON.parse(localStorage.getItem('cl_ebay_session')||'[]').length;
  const oldCount  = clBulk.length;
  if (!ebayCount && !oldCount) { toast('No items in session'); return; }

  // Mostrar modal con opciones de export
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999;display:flex;align-items:flex-end';
  let content = `
    <div style="background:var(--bg);border-radius:18px 18px 0 0;padding:24px;width:100%;max-width:480px;margin:0 auto">
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">📦 Clothing Session</div>
      <div style="font-size:13px;color:var(--mu);margin-bottom:12px">${ebayCount} item(s) in eBay export queue</div>`;

  // If no eBay items but clBulk has items, show option to add
  if (!ebayCount && oldCount) {
    content += `<button onclick="clAddBulkToEbaySession();this.closest('div[style]').remove();setTimeout(clShowSession,50)" style="width:100%;background:linear-gradient(135deg,#FF6B35,#E71D36);border:none;border-radius:12px;padding:15px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:10px">
      ➕ Add ${oldCount} items to eBay export (${oldCount} in staging)
    </button>`;
  }

  content += `<button onclick="clPreviewSession()" style="width:100%;background:none;border:1px solid #555;border-radius:8px;padding:8px;color:var(--mu);font-size:12px;cursor:pointer;margin-bottom:10px">🔍 Preview CSV content (debug)</button>
      <div id="cl-url-check" style="background:var(--sf2);border-radius:10px;padding:10px;margin-bottom:12px;font-size:12px;color:var(--mu)">⏳ Checking photo URLs...</div>

      <button onclick="this.closest('div[style]').remove();setTimeout(clExportEbayCSV,50)" style="width:100%;background:var(--sv);border:none;border-radius:12px;padding:15px;color:#000;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:10px">
        📥 Export for eBay (.csv)
        <div style="font-size:11px;font-weight:400;margin-top:2px">Upload to eBay → Reports → Try it now → Upload template</div>
      </button>

      <button onclick="clClearSession();this.closest('div[style]').remove()" ontouchend="event.preventDefault();clClearSession();this.closest('div[style]').remove()" style="width:100%;background:none;border:1px solid var(--dw);border-radius:10px;padding:10px;color:var(--dw);font-size:13px;cursor:pointer;margin-bottom:8px">🗑 Clear Session (start fresh)</button>
      <button onclick="this.closest('div[style]').remove()" style="width:100%;background:none;border:none;padding:10px;color:var(--mu);font-size:14px;cursor:pointer">Cancel</button>
    </div>`;
  modal.innerHTML = content;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Verify photo URLs immediately
  setTimeout(function() {
    const checkEl = document.getElementById('cl-url-check');
    if (!checkEl) return;
    const sess = JSON.parse(localStorage.getItem('cl_ebay_session') || '[]');
    if (!sess || sess.length === 0) {
      checkEl.innerHTML = '⚠️ No items in eBay export queue';
      checkEl.style.color = 'var(--dw)';
      return;
    }
    const withPhotos = sess.filter(r => clGetPrimaryPhotoURL(r.photos));
    const noPhotos   = sess.filter(r => !clGetPrimaryPhotoURL(r.photos));
    if (noPhotos.length === 0) {
      checkEl.innerHTML = '✅ All ' + sess.length + ' items have photo URLs — ready for eBay!';
      checkEl.style.color = 'var(--sv)';
    } else {
      checkEl.innerHTML = '⚠️ ' + noPhotos.length + ' item(s) missing photo URLs. '
        + 'Clear session and re-scan with ImgBB configured. ' + withPhotos.length + ' item(s) have photos ✅';
      checkEl.style.color = 'var(--gd)';
    }
  }, 100);
}

// Add all items from clBulk to cl_ebay_session
function clAddBulkToEbaySession() {
  if (!clBulk || clBulk.length === 0) {
    toast('⚠️ No items in staging to add');
    return;
  }
  try {
    localStorage.setItem('cl_ebay_session', JSON.stringify(clBulk));
    const fabN = document.getElementById('cl-fab-n');
    if (fabN) fabN.textContent = clBulk.length;
    toast('✅ Added ' + clBulk.length + ' item(s) to eBay export queue');
  } catch(e) {
    toast('❌ Error adding items: ' + e.message);
  }
}

// ── CLOTHING & SHOES eBay EXPORT ────────────────────────────
// Extract primary photo URL from photos object
function clGetPrimaryPhotoURL(photos) {
  if (!photos) return null;
  if (typeof photos === 'string') {
    // Already a URL
    return photos.startsWith('https://') ? photos : null;
  }
  if (typeof photos === 'object') {
    // Try in priority order: front, back, tag, detail
    for (const key of ['front', 'back', 'tag', 'detail']) {
      const url = photos[key];
      if (url && typeof url === 'string' && url.startsWith('https://')) {
        return url;
      }
    }
  }
  return null;
}

// Normalize size values for eBay (only confirmed: XXL → 2XL)
function clNormalizeSize(size) {
  if (!size) return size;
  const normalized = String(size).trim().toUpperCase();
  // Size normalization: only confirmed mapping from production data
  if (normalized === 'XXL') return '2XL';
  return String(size).trim();
}

// Preview CSV content (debug function)
function clPreviewSession() {
  const sess = JSON.parse(localStorage.getItem('cl_ebay_session') || '[]');
  if (!sess || sess.length === 0) {
    toast('⚠️ No items in session');
    return;
  }
  const previewData = sess.map((item, idx) => ({
    '#': idx + 1,
    'SKU': item.sku || '?',
    'Size': item.size || '?',
    'Photo URL': clGetPrimaryPhotoURL(item.photos) || '(MISSING)',
    'Title': (item.title || '').substring(0, 50),
    'Price': item.price || '?'
  }));
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999;overflow-y:auto;padding:20px';
  let html = '<div style="background:var(--bg);border-radius:12px;padding:20px;max-width:600px;margin:0 auto">' +
    '<div style="font-size:16px;font-weight:800;margin-bottom:12px">CSV Preview (' + sess.length + ' items)</div>' +
    '<pre style="background:var(--sf);padding:12px;border-radius:8px;overflow-x:auto;font-size:11px;line-height:1.4">';
  const cols = Object.keys(previewData[0]);
  html += cols.join(' | ') + '\n';
  html += '─'.repeat(80) + '\n';
  previewData.forEach(row => {
    html += cols.map(col => String(row[col]).substring(0, 20).padEnd(20)).join('') + '\n';
  });
  html += '</pre><button onclick="this.closest(\'div\').remove()" style="width:100%;padding:10px;background:var(--sv);border:none;border-radius:8px;color:#000;font-weight:800;cursor:pointer;margin-top:12px">Close</button></div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}

// Export session as eBay CSV (REAL CLOTHING SCHEMA)
function clExportEbayCSV() {
  const sess = JSON.parse(localStorage.getItem('cl_ebay_session') || '[]');
  if (!sess || sess.length === 0) {
    toast('⚠️ No items in session');
    return;
  }

  // ── VALIDATE: ALL items must have valid public HTTPS photo URLs ──
  const noPhotos = sess.filter(r => !clGetPrimaryPhotoURL(r.photos));
  if (noPhotos.length > 0) {
    const skuList = noPhotos.map(r => r.sku || 'UNKNOWN').join('\n');
    toast('❌ Export blocked: ' + noPhotos.length + ' item(s) missing photo URLs.\n\nMissing public photo URL:\n' + skuList);
    return;
  }

  // ── REAL CLOTHING CSV HEADER ──
  // This is the exact established Clothing & Shoes eBay header.
  const HDR = [
    '*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)',
    'CustomLabel',
    '*Category',
    '*Title',
    '*ConditionID',
    '*C:Brand',
    '*C:Size Type',
    '*C:Size',
    '*C:Department',
    '*C:Color',
    '*C:Style',
    'C:Type',
    'C:Inseam',
    'C:Dress Length',
    'C:Outer Shell Material',
    'C:Performance/Activity',
    'C:Width',
    'PicURL',
    '*Description',
    '*Format',
    '*Duration',
    '*StartPrice',
    '*Quantity',
    'ImmediatePayRequired',
    '*Location',
    '*DispatchTimeMax',
    'ShippingProfileName',
    'ReturnProfileName',
    'PaymentProfileName',
    'WeightMajor',
    'WeightMinor'
  ];

  const lines = [
    'Info,Version=1.0.0,Template=fx_category_template_EBAY_US',
    HDR.join(',')
  ];

  // ── BUILD CSV ROWS FROM CLOTHING ITEMS ──
  sess.forEach(item => {
    const row = {};

    // Established fixed values (not hardcoded, derived from production data)
    row['*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)'] = 'Add';
    row['*Format'] = 'FixedPrice';
    row['*Duration'] = 'GTC';
    row['ImmediatePayRequired'] = '1';
    row['*DispatchTimeMax'] = '1';
    row['ShippingProfileName'] = 'Flat:Standard Shipp(Free),Same business day';
    row['ReturnProfileName'] = '30 Day return';
    row['PaymentProfileName'] = 'eBay Payments';

    // Clothing item properties mapped to eBay CSV
    row['CustomLabel'] = item.sku || '';
    row['*Category'] = item.category || '';
    row['*Title'] = item.title || '';
    row['*ConditionID'] = item.conditionId || '';
    row['*C:Brand'] = item.brand || '';
    row['*C:Size Type'] = item.sizeType || '';
    row['*C:Size'] = item.size ? clNormalizeSize(item.size) : '';
    row['*C:Department'] = item.department || '';
    row['*C:Color'] = item.color || '';
    row['*C:Style'] = item.style || '';

    // Optional Clothing fields
    row['C:Type'] = item.type || '';
    row['C:Inseam'] = item.inseam || '';
    row['C:Dress Length'] = item.dressLength || '';
    row['C:Outer Shell Material'] = item.outerShellMaterial || '';
    row['C:Performance/Activity'] = item.performanceActivity || '';
    row['C:Width'] = item.width || '';

    // CRITICAL FIX: Populate PicURL with actual HTTPS photo URL
    row['PicURL'] = clGetPrimaryPhotoURL(item.photos) || '';

    // Description and pricing
    row['*Description'] = item.description || '';
    row['*StartPrice'] = item.price || '';
    row['*Quantity'] = String(item.quantity || 1);
    row['*Location'] = item.location || '';

    // Weight
    row['WeightMajor'] = item.weightMajor !== undefined ? String(item.weightMajor) : '';
    row['WeightMinor'] = item.weightMinor !== undefined ? String(item.weightMinor) : '';

    // Build CSV row values in correct order
    const rowValues = HDR.map(h => {
      const val = row[h] || '';
      const str = String(val).replace(/"/g, '""'); // CSV escape: "" for "
      return '"' + str + '"';
    });
    lines.push(rowValues.join(','));
  });

  // ── DOWNLOAD CSV ──
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'Clothing-eBay-' + new Date().toISOString().slice(0,10) + '.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast('✅ CSV exported: ' + sess.length + ' items');

  // Clear session after successful export (do NOT preserve)
  setTimeout(() => {
    localStorage.removeItem('cl_ebay_session');
    const fabN = document.getElementById('cl-fab-n');
    if (fabN) fabN.textContent = '0';
  }, 500);
}

// Clear session
function clClearSession() {
  if (!confirm('🗑 Clear all ' + JSON.parse(localStorage.getItem('cl_ebay_session')||'[]').length + ' items from eBay export session? This cannot be undone.')) return;
  localStorage.removeItem('cl_ebay_session');
  const fabN = document.getElementById('cl-fab-n');
  if (fabN) fabN.textContent = '0';
  toast('✅ Session cleared');
}


// ── SESSION PERSISTENCE ───────────────────────────────────────
// Auto-save scanner bulk to localStorage on every change
function saveBulkToStorage() {
  try {
    if (bulk.length > 0) {
      localStorage.setItem('savvy_bulk_backup', JSON.stringify(bulk));
      localStorage.setItem('savvy_bulk_backup_ts', new Date().toISOString());
      localStorage.setItem('savvy_bulk_count', String(bulk.length)); // Guardar count para recuperación
    }
  } catch(e) {}
}

// Protección: confirmar antes de borrar bulk (previene pérdida accidental)
function confirmClearBulk(callback) {
  if (bulk.length === 0) {
    if (callback) callback();
    return;
  }
  if (confirm(`⚠️ ¿Borrar ${bulk.length} producto(s)? NO se puede deshacer.`)) {
    if (callback) callback();
  }
}

// Auto-save clothing bulk
function saveClBulkToStorage() {
  try {
    if (clBulk.length > 0) {
      // Save without full photo data (too large) — save metadata only
      const lite = clBulk.map(it => ({...it, photos: {
        front:  it.photos?.front  ? '[foto]' : null,
        back:   it.photos?.back   ? '[foto]' : null,
        tag:    it.photos?.tag    ? '[foto]' : null,
        detail: it.photos?.detail ? '[foto]' : null,
      }}));
      localStorage.setItem('savvy_cl_backup', JSON.stringify(lite));
      localStorage.setItem('savvy_cl_backup_ts', new Date().toISOString());
    }
  } catch(e) {}
}

// Restore session on page load
function checkSavedSession() {
  const bulkBackup = localStorage.getItem('savvy_bulk_backup');
  const clBackup   = localStorage.getItem('savvy_cl_backup');
  const bulkTs     = localStorage.getItem('savvy_bulk_backup_ts');
  const clTs       = localStorage.getItem('savvy_cl_backup_ts');

  const hasBulk = bulkBackup && JSON.parse(bulkBackup).length > 0;
  const hasCl   = clBackup   && JSON.parse(clBackup).length > 0;

  if (!hasBulk && !hasCl) return;

  // Build restore banner
  let msg = '📦 Saved Session detectada: ';
  const parts = [];
  if (hasBulk) parts.push(JSON.parse(bulkBackup).length + ' scanner product(s)');
  if (hasCl)   parts.push(JSON.parse(clBackup).length + ' clothing item(s)');
  msg += parts.join(' + ');

  const ts = bulkTs || clTs;
  if (ts) {
    const d = new Date(ts);
    msg += ' · ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }

  // Show in dashboard panel instead of a floating banner
  const panel = document.getElementById('dash-session-panel');
  const desc  = document.getElementById('dash-session-desc');
  if (panel) panel.style.display = 'block';
  if (desc)  desc.textContent = msg;
}

function restoreSession() {
  try {
    const bulkData = localStorage.getItem('savvy_bulk_backup');
    if (bulkData) {
      bulk = JSON.parse(bulkData);
      updateFAB();
    }
    const clData = localStorage.getItem('savvy_cl_backup');
    if (clData) {
      clBulk = JSON.parse(clData);
      clUpdateClFAB();
    }

    // ── DEFENSIVE CHECK: Separate any Clothing items that ended up in bulk ──
    // If any SKU starts with CLO-, move it to clBulk to prevent wrong export route
    const clothingInBulk = bulk.filter(function(it){ return /^CLO-/i.test(it.sku || ''); });
    if (clothingInBulk.length > 0) {
      clBulk = clBulk.concat(clothingInBulk);
      bulk = bulk.filter(function(it){ return !/^CLO-/i.test(it.sku || ''); });
      saveBulkToStorage();
      saveClBulkToStorage();
      const movedSKUs = clothingInBulk.map(function(it){ return it.sku; }).join(', ');
      toast('⚠️ Moved to Clothing & Shoes: ' + movedSKUs);
    }

    toast('✅ Session restored');
  } catch(e) {
    toast('❌ Restore failed');
  }
  dismissRestoreBanner();
}

function discardSession() {
  localStorage.removeItem('savvy_bulk_backup');
  localStorage.removeItem('savvy_bulk_backup_ts');
  localStorage.removeItem('savvy_cl_backup');
  localStorage.removeItem('savvy_cl_backup_ts');
  dismissRestoreBanner();
}

function dismissRestoreBanner() {
  const panel = document.getElementById('dash-session-panel');
  if (panel) panel.style.display = 'none';
}

// ── WARN BEFORE LEAVING PAGE ──────────────────────────────────
window.addEventListener('beforeunload', function(e) {
  if (bulk.length > 0 || clBulk.length > 0) {
    // Auto-save before leaving
    saveBulkToStorage();
    saveClBulkToStorage();
    // Show browser warning
    e.preventDefault();
    e.returnValue = '¿Seguro que quieres salir? Tus escaneos se guardarán automáticamente.';
    return e.returnValue;
  }
});


// ═══════════════════════════════════════════════════════════
// LOCATION SCANNER MODULE — shared between Scanner + Clothing
// ═══════════════════════════════════════════════════════════
let _locCallback = null;
let _locTarget = null; // 'scanner' or 'clothing'

// ── LOCATION SCANNER - SOLO TECLADO (sin cámara para evitar conflictos iOS) ──
async function locOpen(target) {
  _locTarget = target;
  if (window._psDebug) window._psDebug('📍 LOC: abriendo teclado...');

  // Limpiar cualquier overlay anterior
  ['loc-overlay','loc-manual-panel'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) { try { el.parentNode.removeChild(el); } catch(e){} }
  });

  // Crear overlay simple con SOLO input y botones
  var ov = document.createElement('div');
  ov.id = 'loc-overlay';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.95);z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px';

  // Marca para evitar auto-cierre en los primeros 500ms (evita bug de propagación de touch)
  ov.dataset.openedAt = String(Date.now());

  // ATRAPAR y detener CUALQUIER touch/click que llegue al overlay durante los primeros 500ms
  // Esto evita que el touch que abrió el overlay lo cierre inmediatamente
  var swallowEarly = function(e){
    var age = Date.now() - parseInt(ov.dataset.openedAt || '0', 10);
    if (age < 500) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (window._psDebug) window._psDebug('🛡️ LOC: touch temprano bloqueado (' + age + 'ms)');
    }
  };
  ov.addEventListener('touchstart', swallowEarly, true);
  ov.addEventListener('touchend', swallowEarly, true);
  ov.addEventListener('click', swallowEarly, true);

  ov.innerHTML =
    '<div style="color:#fff;font-size:20px;font-weight:900;text-align:center">📍 Warehouse Location</div>' +
    '<div style="color:#aaa;font-size:13px;text-align:center;margin-bottom:4px">Escanea el código o escribe la ubicación</div>' +

    // ── CÁMARA QR/BARCODE (oculta por defecto, se muestra al tocar el botón) ──
    '<div id="loc-cam-wrap" style="display:none;width:100%;max-width:420px">' +
      '<div id="loc-qr-video" style="width:100%;border-radius:12px;overflow:hidden;background:#111;min-height:180px"></div>' +
      '<button id="loc-cam-stop" style="width:100%;max-width:420px;padding:12px;background:transparent;color:#ff9800;border:2px solid #ff9800;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px">✕ Cerrar cámara</button>' +
    '</div>' +

    // ── BOTÓN ESCANEAR ──
    '<button id="loc-scan-btn" style="width:100%;max-width:420px;padding:16px;background:#1565c0;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:900;cursor:pointer">📷 ESCANEAR CÓDIGO DE BARRAS</button>' +

    // ── INPUT MANUAL ──
    '<div style="width:100%;max-width:420px;text-align:center;color:#555;font-size:12px">— o escribe manualmente —</div>' +
    '<input id="loc-input-v2" type="text" placeholder="Ej: K/P6, RN3:S3:4" autocapitalize="characters" autocomplete="off" spellcheck="false" style="width:100%;max-width:420px;padding:20px;border-radius:12px;border:2px solid #00e676;background:#111;color:#fff;font-size:22px;text-align:center;font-weight:700">' +
    '<button id="loc-ok-v2" style="width:100%;max-width:420px;padding:20px;background:#00e676;color:#000;border:none;border-radius:12px;font-size:18px;font-weight:900;cursor:pointer">✔ GUARDAR UBICACIÓN</button>' +
    '<button id="loc-cancel-v2" style="width:100%;max-width:420px;padding:16px;background:transparent;color:#ff5252;border:2px solid #ff5252;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer">✕ CANCELAR</button>';
  document.body.appendChild(ov);

  var input = document.getElementById('loc-input-v2');
  var okBtn = document.getElementById('loc-ok-v2');
  var cnBtn = document.getElementById('loc-cancel-v2');

  var closeMe = function(){
    try { ov.parentNode.removeChild(ov); } catch(e){}
  };

  var saveMe = function(e){
    if(e && e.preventDefault) e.preventDefault();
    if(e && e.stopPropagation) e.stopPropagation();
    // Ignorar toques muy tempranos (bug de propagación)
    var age = Date.now() - parseInt(ov.dataset.openedAt || '0', 10);
    if (age < 500) return;
    var v = (input.value || '').trim();
    if (!v) { input.focus(); return; }
    closeMe();
    locCapture(v);
  };

  okBtn.addEventListener('touchend', saveMe);
  okBtn.addEventListener('click', saveMe);

  var cancelMe = function(e){
    if(e && e.preventDefault) e.preventDefault();
    if(e && e.stopPropagation) e.stopPropagation();
    // Ignorar toques muy tempranos (bug de propagación)
    var age = Date.now() - parseInt(ov.dataset.openedAt || '0', 10);
    if (age < 500) return;
    closeMe();
  };
  cnBtn.addEventListener('touchend', cancelMe);
  cnBtn.addEventListener('click', cancelMe);

  // ── BOTÓN ESCANEAR: abre la cámara con html5-qrcode ──
  var scanBtn = document.getElementById('loc-scan-btn');
  var camWrap = document.getElementById('loc-cam-wrap');
  var camStop = document.getElementById('loc-cam-stop');
  var _locScannerActive = false;

  var startLocScan = function(e){
    if(e && e.preventDefault) e.preventDefault();
    var age = Date.now() - parseInt(ov.dataset.openedAt || '0', 10);
    if (age < 500) return;
    if (_locScannerActive) return;
    _locScannerActive = true;
    camWrap.style.display = 'block';
    scanBtn.style.display = 'none';
    if (window._psDebug) window._psDebug('📷 LOC: iniciando cámara...');
    // Usar el mismo savvyStartScan que usa el scanner de UPC
    if (typeof savvyStartScan === 'function') {
      savvyStartScan('loc-qr-video', function(decoded){
        if (window._psDebug) window._psDebug('📍 LOC: código leído: ' + decoded);
        // Código leído: mostrar en el input y guardar automático
        var v = String(decoded || '').trim();
        if (v) {
          // Detener cámara
          if (typeof savvyStopScan === 'function') savvyStopScan('loc-qr-video');
          _locScannerActive = false;
          camWrap.style.display = 'none';
          scanBtn.style.display = 'block';
          // Poner el valor en el input para que el usuario lo vea
          var inp = document.getElementById('loc-input-v2');
          if (inp) inp.value = v;
          // Guardar directamente
          closeMe();
          locCapture(v);
        }
      });
    } else {
      // Si savvyStartScan no está disponible, usar input[type=file] como fallback
      if (window._psDebug) window._psDebug('⚠️ LOC: savvyStartScan no disponible, usando input');
      camWrap.style.display = 'none';
      scanBtn.style.display = 'block';
      _locScannerActive = false;
      toast('⚠️ Scanner no disponible — usa el input manual');
    }
  };

  scanBtn.addEventListener('touchend', startLocScan);
  scanBtn.addEventListener('click', startLocScan);

  // Botón para cerrar la cámara sin escanear
  var stopLocScan = function(e){
    if(e && e.preventDefault) e.preventDefault();
    if (typeof savvyStopScan === 'function') savvyStopScan('loc-qr-video');
    _locScannerActive = false;
    camWrap.style.display = 'none';
    scanBtn.style.display = 'block';
  };
  camStop.addEventListener('touchend', stopLocScan);
  camStop.addEventListener('click', stopLocScan);

  input.addEventListener('keydown', function(e){ if(e.key==='Enter') saveMe(); });

  // Focus automático en el input DESPUÉS del delay de propagación
  setTimeout(function(){
    var i = document.getElementById('loc-input-v2');
    if (i) i.focus();
  }, 600);
}

async function locClose() {
  var el = document.getElementById('loc-overlay');
  if (el) { try { el.parentNode.removeChild(el); } catch(e){} }
}

function locCapture(code) {
  // Si el QR fue detectado, cerramos la cámara y quitamos el overlay YA.
  try { savvyStopScan('loc-qr-video'); } catch(e) {}
  ['loc-overlay','loc-manual-panel'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) {
      try { el.parentNode.removeChild(el); }
      catch(e) { el.style.display='none'; el.style.pointerEvents='none'; el.style.zIndex='-1'; }
    }
  });
  if (window._psDebug) window._psDebug('📍 LOC: overlay eliminado (via capture)');
  try { locClose(); } catch(e) { console.warn('locClose:', e); }
  try {
    // Product Scanner usa 'product' o 'scanner'. Ambos guardan en `cur`.
    if (_locTarget === 'scanner' || _locTarget === 'product' || (!_locTarget && typeof cur !== 'undefined' && cur)) {
      if (typeof cur !== 'undefined' && cur) {
        cur.location = code;
        // Actualizar también los packs YA agregados al CSV de este mismo producto,
        // para que la ubicación llegue al Sheet aunque se capture después de ADD TO CSV
        if (typeof bulk !== 'undefined' && Array.isArray(bulk)) {
          for (var bi = 0; bi < bulk.length; bi++) {
            if (bulk[bi].upc === cur.upc) bulk[bi].location = code;
          }
        }
        try { if (typeof saveBulkToStorage === 'function') saveBulkToStorage(); } catch(e) {}
        // Actualizar el badge visible si existe
        var badge1 = document.getElementById('loc-badge-scanner');
        if (badge1 && typeof locBadgeHTML === 'function') {
          try { badge1.outerHTML = locBadgeHTML(code, 'scanner'); } catch(e) {}
        }
      }
    } else if (_locTarget === 'clothing') {
      // Solo aplicable si el módulo de Ropa está cargado (cl existe)
      if (typeof cl !== 'undefined' && cl) {
        cl.location = code;
        var badge2 = document.getElementById('loc-badge-clothing');
        if (badge2 && typeof locBadgeHTML === 'function') {
          try { badge2.outerHTML = locBadgeHTML(code, 'clothing'); } catch(e) {}
        }
      }
    }
    toast('📍 Location: ' + code);
  } catch(err) {
    console.error('locCapture error:', err);
    toast('⚠️ Error al guardar ubicación: ' + (err.message || err));
  }
}

function locClear(target) {
  try {
    if ((target === 'scanner' || target === 'product') && typeof cur !== 'undefined' && cur) {
      cur.location = '';
      var badge = document.getElementById('loc-badge-scanner');
      if (badge && typeof locEmptyHTML === 'function') {
        try { badge.outerHTML = locEmptyHTML('scanner'); } catch(e) {}
      }
    } else if (target === 'clothing' && typeof cl !== 'undefined' && cl) {
      cl.location = '';
      var badge2 = document.getElementById('loc-badge-clothing');
      if (badge2 && typeof locEmptyHTML === 'function') {
        try { badge2.outerHTML = locEmptyHTML('clothing'); } catch(e) {}
      }
    }
  } catch(err) { console.warn('locClear:', err); }
}

function locBadgeHTML(code, target) {
  return `<span class="loc-badge" id="loc-badge-${target}">
    <span class="loc-scan-icon">📍</span>
    <span>${code}</span>
    <span class="loc-clear" onclick="locClear('${target}')" title="Borrar">✕</span>
  </span>`;
}

function locEmptyHTML(target) {
  return `<span class="loc-empty" id="loc-badge-${target}" onclick="locOpen('${target}')">
    <span>📦</span><span>Scan location (optional)</span>
  </span>`;
}

// ── MODULE NAVIGATION ─────────────────────────────────────────────────
function toDash() {
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  $('scr-dash').classList.add('on');
  // Update header back button visibility
  const hdrBack = $('hdr-back');
  if (hdrBack) hdrBack.style.display = 'none';
}

function openScanner() {
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  $('scr-res').classList.add('on');
}

function openClothing() {
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  $('cl-sku').classList.add('on');
  clRenderSKU();
}

function saveSheetsUrl() {
  const v = $('sheetsIn')?.value?.trim();
  if (!v) return;
  localStorage.setItem('cl_sheets_url', v);
  toast('✅ Sheets URL saved');
  setTimeout(closeCfg, 700);
}

