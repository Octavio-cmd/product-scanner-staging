import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(__dirname, '../app.js');
const indexPath = path.join(__dirname, '../index.html');
const appContent = fs.readFileSync(appPath, 'utf-8');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

// ─────────────────────────────────────────────────────────────
// TEST 1: Registros globales existen
// ─────────────────────────────────────────────────────────────
test('Registros globales _savvyScanners, _scannerInitInProgress, _scannerCancelled', () => {
  assert(appContent.includes('var _savvyScanners = {}'),
    '_savvyScanners debe inicializarse');
  assert(appContent.includes('var _scannerInitInProgress = {}'),
    '_scannerInitInProgress debe inicializarse');
  assert(appContent.includes('var _scannerCancelled = {}'),
    '_scannerCancelled debe inicializarse');
});

// ─────────────────────────────────────────────────────────────
// TEST 2: Detección iOS Safari
// ─────────────────────────────────────────────────────────────
test('Función isIOSSafari() detecta navegador iOS Safari', () => {
  assert(appContent.includes('function isIOSSafari()'),
    'isIOSSafari() debe estar definida');
  assert(appContent.includes('iphone|ipad|ipod'),
    'Debe detectar iOS');
  assert(appContent.includes('safari'),
    'Debe detectar Safari');
  assert(appContent.includes('chrome|crios|firefox|opera'),
    'Debe excluir otros navegadores');
});

// ─────────────────────────────────────────────────────────────
// TEST 3: SAVVY_SCAN_CONFIG es dinámico
// ─────────────────────────────────────────────────────────────
test('SAVVY_SCAN_CONFIG dinámico según isIOSSafari()', () => {
  assert(appContent.includes('const SAVVY_SCAN_CONFIG = (() => {') ||
         appContent.includes('SAVVY_SCAN_CONFIG = (() => {'),
    'SAVVY_SCAN_CONFIG debe usar IIFE dinámico');
  assert(appContent.includes('isIOSSafari()'),
    'Config debe usar isIOSSafari()');
});

// ─────────────────────────────────────────────────────────────
// TEST 4: iOS config: fps:10, facingMode:environment, sin aspectRatio
// ─────────────────────────────────────────────────────────────
test('iOS: fps:10, facingMode:environment, sin aspectRatio', () => {
  // fps:10 debe estar en baseConfig con ternario iOS
  assert(appContent.includes('fps: isIOSSafari() ? 10 : 20'),
    'fps debe ser 10 para iOS, 20 para otros');

  // facingMode debe estar presente en cualquier lugar (está en la sección iOS o en savvyStartScan)
  assert(appContent.includes("facingMode = 'environment'") || appContent.includes("facingMode: 'environment'") || appContent.includes("facingMode: SAVVY_SCAN_CONFIG.facingMode"),
    'Debe mencionar facingMode environment para iOS');

  // BarcodeDetector debe estar deshabilitado para iOS
  assert(appContent.includes('useBarCodeDetectorIfSupported: false'),
    'iOS debe desactivar BarcodeDetector');

  // Verificar config dinámica existe
  assert(appContent.includes('if (isIOSSafari())'),
    'Debe tener sección if iOS en config');
});

// ─────────────────────────────────────────────────────────────
// TEST 5: No-iOS config preserva original
// ─────────────────────────────────────────────────────────────
test('No-iOS preserva aspectRatio:1.7 y BarcodeDetector:true', () => {
  const elseStart = appContent.indexOf('} else {', appContent.indexOf('if (isIOSSafari())'));
  const elseEnd = appContent.indexOf('return baseConfig', elseStart);
  const nonIosSection = appContent.substring(elseStart, elseEnd);

  assert(nonIosSection.includes('aspectRatio:') || nonIosSection.includes('aspectRatio :') || nonIosSection.includes('1.7'),
    'No-iOS debe incluir aspectRatio 1.7');
  assert(nonIosSection.includes('useBarCodeDetectorIfSupported: true'),
    'No-iOS debe preservar BarcodeDetector:true');
});

// ─────────────────────────────────────────────────────────────
// TEST 6: validateVideoStream() existe y valida correctamente
// ─────────────────────────────────────────────────────────────
test('validateVideoStream() valida stream completo', () => {
  assert(appContent.includes('function validateVideoStream(videoElement)'),
    'validateVideoStream debe estar definida');

  // Buscar la sección de la función
  const fnIdx = appContent.indexOf('function validateVideoStream');
  assert(fnIdx > 0, 'validateVideoStream debe estar definida');
  const fnEnd = appContent.indexOf('// Monitor', fnIdx);
  const fn = appContent.substring(fnIdx, fnEnd);

  assert(fn.includes('srcObject'),
    'Debe validar srcObject');
  assert(fn.includes('getTracks()'),
    'Debe obtener tracks');
  // Buscar verificación de readyState y 'live' en cualquier lugar de la función
  assert(fn.includes("readyState !== 'live'") || fn.includes("readyState === 'live'"),
    'Debe verificar readyState live');
  assert(fn.includes('readyState < 2'),
    'Debe verificar video.readyState >= 2');
  assert(fn.includes('paused'),
    'Debe verificar paused');
  assert(fn.includes('videoWidth') && fn.includes('videoHeight'),
    'Debe verificar videoWidth y videoHeight > 0');
});

// ─────────────────────────────────────────────────────────────
// TEST 7: monitorVideoStream() NO falla inmediatamente
// ─────────────────────────────────────────────────────────────
test('monitorVideoStream() espera ~3 segundos, no falla a 300ms', () => {
  assert(appContent.includes('function monitorVideoStream(videoElementId)'),
    'monitorVideoStream debe estar definida');

  const fnIdx = appContent.indexOf('function monitorVideoStream');
  const fnEnd = appContent.indexOf('// Manejar timeout', fnIdx);
  const fn = appContent.substring(fnIdx, fnEnd);

  // Debe tener un timeout de 3000ms
  assert(fn.includes('var timeoutMs = 3000') || fn.includes('timeoutMs = 3000'),
    'Debe usar timeoutMs de 3000 ms');

  // Debe revisar periódicamente
  assert(fn.includes('300') || fn.includes('checkInterval'),
    'Debe revisar periódicamente');

  // Debe tener lógica de éxito antes del timeout
  assert(fn.includes('isValid'),
    'Debe tener variable isValid para éxito');

  // Debe respetar cancelación
  assert(fn.includes('_scannerCancelled[videoElementId]'),
    'Debe respetar cancelación durante monitoreo');
});

// ─────────────────────────────────────────────────────────────
// TEST 8: savvyOpenBarcodeScanner() existe y previene dobles aperturas
// ─────────────────────────────────────────────────────────────
test('savvyOpenBarcodeScanner() existe y previene dobles aperturas', () => {
  assert(appContent.includes('function savvyOpenBarcodeScanner()'),
    'savvyOpenBarcodeScanner debe estar definida');

  const fn = appContent.substring(
    appContent.indexOf('function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function', appContent.indexOf('function savvyOpenBarcodeScanner()'))
  );

  assert(fn.includes('_scannerInitInProgress[videoElementId]'),
    'Debe verificar si ya hay apertura en progreso');
});

// ─────────────────────────────────────────────────────────────
// TEST 9: savvyOpenBarcodeScanner activa modal y usa requestAnimationFrame
// ─────────────────────────────────────────────────────────────
test('savvyOpenBarcodeScanner activa #scr-cam y espera 2 requestAnimationFrame', () => {
  const fn = appContent.substring(
    appContent.indexOf('function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function', appContent.indexOf('function savvyOpenBarcodeScanner()'))
  );

  assert(fn.includes('scr-cam') && fn.includes('classList.add'),
    'Debe activar modal #scr-cam');

  assert(fn.includes('requestAnimationFrame'),
    'Debe usar requestAnimationFrame');

  assert(fn.includes('frameCount >= 2'),
    'Debe esperar 2 frames');
});

// ─────────────────────────────────────────────────────────────
// TEST 10: savvyOpenBarcodeScanner inyecta atributos iOS
// ─────────────────────────────────────────────────────────────
test('savvyOpenBarcodeScanner inyecta playsinline, autoplay, muted', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function savvyStopScan', appContent.indexOf('async function savvyOpenBarcodeScanner()'))
  );

  assert(fn.includes('setAttribute') && fn.includes('playsinline'),
    'Debe inyectar playsinline');
  assert(fn.includes('autoplay'),
    'Debe inyectar autoplay');
  assert(fn.includes("muted'") || fn.includes("'muted'"),
    'Debe inyectar muted');
  assert(fn.includes('videoElement.muted = true'),
    'Debe establecer muted property');
  assert(fn.includes('play()'),
    'Debe llamar play()');
});

// ─────────────────────────────────────────────────────────────
// TEST 11: savvyOpenBarcodeScanner maneja cancellación durante start()
// ─────────────────────────────────────────────────────────────
test('savvyOpenBarcodeScanner respeta cancelación durante inicialización', () => {
  const fn = appContent.substring(
    appContent.indexOf('function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function', appContent.indexOf('function savvyOpenBarcodeScanner()'))
  );

  // Debe comprobar _scannerCancelled en múltiples puntos
  let cancelCount = 0;
  let idx = 0;
  while ((idx = fn.indexOf('_scannerCancelled[videoElementId]', idx)) > -1) {
    cancelCount++;
    idx += 1;
  }
  assert(cancelCount >= 2,
    'Debe comprobar cancelación en múltiples puntos durante inicialización');
});

// ─────────────────────────────────────────────────────────────
// TEST 12: savvyStopScan() usa instancia registrada, no crea nueva
// ─────────────────────────────────────────────────────────────
test('savvyStopScan() obtiene y usa instancia de _savvyScanners', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyStopScan(videoElementId)'),
    appContent.indexOf('async function', appContent.indexOf('async function savvyStopScan(videoElementId)') + 10)
  );

  assert(fn.includes('var scanner = _savvyScanners[videoElementId]'),
    'Debe obtener instancia del registro');
  assert(fn.includes('scanner.stop()'),
    'Debe llamar stop() en la instancia registrada');
  assert(fn.includes('scanner.clear()'),
    'Debe llamar clear()');
  assert(fn.includes('delete _savvyScanners[videoElementId]'),
    'Debe eliminar instancia del registro');
  assert(fn.includes("innerHTML = ''"),
    'Debe limpiar innerHTML (permite reapertura)');
});

// ─────────────────────────────────────────────────────────────
// TEST 13: Cache busting en index.html
// ─────────────────────────────────────────────────────────────
test('Cache busting real: app.js?v=', () => {
  assert(indexContent.includes('app.js?v='),
    'index.html debe cargar app.js con parámetro ?v=');
  assert(indexContent.includes('v=2026-08-28-ios-fix'),
    'Versión debe incluir fecha de fix');
});

// ─────────────────────────────────────────────────────────────
// TEST 14: Botón SCAN usa savvyOpenBarcodeScanner, no setTimeout
// ─────────────────────────────────────────────────────────────
test('Botón SCAN llama savvyOpenBarcodeScanner(), no setTimeout + savvyStartScan', () => {
  const btnSection = indexContent.substring(
    indexContent.indexOf('camBtnRes'),
    indexContent.indexOf('📷 Scan Barcode', indexContent.indexOf('camBtnRes'))
  );

  assert(btnSection.includes('savvyOpenBarcodeScanner'),
    'Botón debe llamar savvyOpenBarcodeScanner()');
  assert(!btnSection.includes('setTimeout(') || !btnSection.includes('savvyStartScan'),
    'Botón NO debe usar setTimeout + savvyStartScan juntos');
});

// ─────────────────────────────────────────────────────────────
// TEST 15: Botón CANCEL marca cancelación y await savvyStopScan
// ─────────────────────────────────────────────────────────────
test('Botón CANCEL marca _scannerCancelled y maneja async/await', () => {
  const btnStart = indexContent.indexOf('id="camStop"');
  const btnEnd = indexContent.indexOf('</button>', btnStart) + 9;
  const btnSection = indexContent.substring(btnStart, btnEnd);

  assert(btnSection.includes('_scannerCancelled'),
    'Debe marcar cancelación');
  assert(btnSection.includes('savvyStopScan'),
    'Debe llamar savvyStopScan()');
  assert(btnSection.includes('async') || btnSection.includes('await'),
    'Debe ser async/await');
  assert(btnSection.includes('scr-res'),
    'Debe mostrar pantalla de resultados');
});

// ─────────────────────────────────────────────────────────────
// TEST 16: #qr-video es DIV vacío, sin video manual
// ─────────────────────────────────────────────────────────────
test('#qr-video es DIV vacío (html5-qrcode generará el <video>)', () => {
  const qrDiv = indexContent.substring(
    indexContent.indexOf('id="qr-video"'),
    indexContent.indexOf('</div>', indexContent.indexOf('id="qr-video"')) + 6
  );

  assert(qrDiv.includes('id="qr-video"'),
    '#qr-video debe existir');
  assert(!qrDiv.includes('<video'),
    'NO debe contener <video> manual');
});

// ─────────────────────────────────────────────────────────────
// TEST 17: PS_BUILD actualizado
// ─────────────────────────────────────────────────────────────
test('PS_BUILD actualizado a 2026-08-28-ios-fix-v3', () => {
  assert(appContent.includes("window.PS_BUILD = '2026-08-28-ios-fix-v3'"),
    'PS_BUILD debe estar actualizado');
});

// ─────────────────────────────────────────────────────────────
// TEST 18: savvyStartScan registra instancia
// ─────────────────────────────────────────────────────────────
test('savvyStartScan() registra scanner en _savvyScanners[videoElementId]', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'),
    appContent.indexOf('// Camera — main scanner', appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'))
  );

  assert(fn.includes('_savvyScanners[videoElementId] = scanner'),
    'Debe registrar scanner en el registro global');
});

// ─────────────────────────────────────────────────────────────
// TEST 19: handleBlackScreenTimeout y handleScannerError existen
// ─────────────────────────────────────────────────────────────
test('handleBlackScreenTimeout() y handleScannerError() existen', () => {
  assert(appContent.includes('function handleBlackScreenTimeout(videoElementId)'),
    'handleBlackScreenTimeout debe estar definida');
  assert(appContent.includes('function handleScannerError(videoElementId, error)'),
    'handleScannerError debe estar definida');
});

// ─────────────────────────────────────────────────────────────
// TEST 20: savvyOpenBarcodeScanner respeta formato correcto
// ─────────────────────────────────────────────────────────────
test('Formato correcto de promesas y control de flujo', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function', appContent.indexOf('async function savvyOpenBarcodeScanner()') + 10)
  );

  // Debe ser async (refactorizado a async/await)
  assert(fn.includes('async function savvyOpenBarcodeScanner'), 'Debe ser async');
  assert(fn.includes('await'), 'Debe usar await para operaciones async');
});

// ─────────────────────────────────────────────────────────────
// TEST 21: savvyOpenBarcodeScanner verifica return value de savvyStartScan
// ─────────────────────────────────────────────────────────────
test('savvyOpenBarcodeScanner verifica return value de savvyStartScan', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function', appContent.indexOf('async function savvyOpenBarcodeScanner()') + 10)
  );

  assert(fn.includes('var started = await savvyStartScan') || fn.includes('let started = await savvyStartScan') || fn.includes('const started = await savvyStartScan'),
    'Debe guardar resultado de savvyStartScan en variable');
  assert(fn.includes('started !== true') || fn.includes('started !==') || fn.includes('!== true'),
    'Debe verificar si started !== true');
});

// ─────────────────────────────────────────────────────────────
// TEST 22: savvyStartScan retorna true/false (NO retorno vacío)
// ─────────────────────────────────────────────────────────────
test('savvyStartScan retorna true en éxito, false en cancelación/error', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'),
    appContent.indexOf('// Camera — main scanner', appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'))
  );

  assert(fn.includes('return true') || fn.includes('return false') || fn.includes('return true;'),
    'savvyStartScan debe retornar true o false');
  assert(fn.includes('return false'),
    'savvyStartScan debe retornar false en algunos casos');
});

// ─────────────────────────────────────────────────────────────
// TEST 23: savvyStopScan NO usa scanner._isScanning en lógica
// ─────────────────────────────────────────────────────────────
test('savvyStopScan NO usa scanner._isScanning en lógica (removido completamente)', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyStopScan(videoElementId)'),
    appContent.indexOf('// Camera — main scanner', appContent.indexOf('async function savvyStopScan(videoElementId)'))
  );

  // Verificar que no hay condicional con _isScanning
  assert(!fn.includes('if (scanner._isScanning)') && !fn.includes('if(scanner._isScanning)'),
    'NO debe tener condicional if (scanner._isScanning)');
  assert(fn.includes('await scanner.stop()'),
    'Debe llamar await scanner.stop() directamente');
});

// ─────────────────────────────────────────────────────────────
// TEST 24: monitorVideoStream espera video si no existe inicialmente
// ─────────────────────────────────────────────────────────────
test('monitorVideoStream espera <video> elemento si no existe inicialmente', () => {
  const fn = appContent.substring(
    appContent.indexOf('function monitorVideoStream(videoElementId)'),
    appContent.indexOf('// Manejar timeout', appContent.indexOf('function monitorVideoStream(videoElementId)'))
  );

  assert(fn.includes('if (!videoElement)'),
    'Debe verificar si videoElement existe');
  assert(fn.includes('Esperando <video> elemento') || fn.includes('waiting for video'),
    'Debe esperar el elemento <video>');
  assert(fn.includes('handleBlackScreenTimeout') && fn.includes('video> no encontrado'),
    'Si timeout sin video encontrado, debe llamar handleBlackScreenTimeout');
});

// ─────────────────────────────────────────────────────────────
// TEST 25: scanConfig construido dinámicamente sin aspectRatio en iOS
// ─────────────────────────────────────────────────────────────
test('scanConfig dinámico: iOS sin aspectRatio, No-iOS con aspectRatio', () => {
  const fnStart = appContent.substring(
    appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'),
    appContent.indexOf('// Camera — main scanner', appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'))
  );

  // Verificar construcción dinámica en savvyStartScan
  assert(fnStart.includes('var scanConfig = {') || fnStart.includes('scanConfig = {'),
    'Debe construir scanConfig dinámicamente');
  assert(fnStart.includes('if (!isIOSSafari()') && fnStart.includes('scanConfig.aspectRatio'),
    'Debe agregar aspectRatio solo en no-iOS');

  // Verificar que SAVVY_SCAN_CONFIG tiene 1.7 en no-iOS
  const configIdx = appContent.indexOf('const SAVVY_SCAN_CONFIG = (() => {');
  const configEnd = appContent.indexOf('return baseConfig;', configIdx);
  const configSection = appContent.substring(configIdx, configEnd);
  assert(configSection.includes('aspectRatio = 1.7') || configSection.includes('aspectRatio: 1.7'),
    'SAVVY_SCAN_CONFIG debe tener aspectRatio 1.7 para no-iOS');
});

// ─────────────────────────────────────────────────────────────
// TEST 26: CANCEL button diferencia entre start() pendiente y scanner iniciado
// ─────────────────────────────────────────────────────────────
test('CANCEL button: si _scannerInitInProgress, solo cierra modal; si no, llamar savvyStopScan', () => {
  const btnStart = indexContent.indexOf('id="camStop"');
  const btnEnd = indexContent.indexOf('</button>', btnStart);
  const btnSection = indexContent.substring(btnStart, btnEnd);

  assert(btnSection.includes('_scannerInitInProgress') || btnSection.includes('initInProgress'),
    'CANCEL debe verificar _scannerInitInProgress');
  assert(btnSection.includes('savvyStopScan'),
    'CANCEL debe llamar savvyStopScan en algunos casos');
  assert(btnSection.includes('aún pendiente') || btnSection.includes('pendiente') || btnSection.includes('initInProgress'),
    'CANCEL debe diferenciar entre start() pendiente y scanner iniciado');
});

// ─────────────────────────────────────────────────────────────
// TEST 27: savvyStartScan error: lanza excepción (throw) NO retorna false
// ─────────────────────────────────────────────────────────────
test('savvyStartScan en error: limpia registro/contenedor y lanza excepción (throw)', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'),
    appContent.indexOf('// Camera — main scanner', appContent.indexOf('async function savvyStartScan(videoElementId, onResult)'))
  );

  const catchBlock = fn.substring(fn.indexOf('catch(e)'));

  assert(catchBlock.includes('scanner.clear()'),
    'catch debe intentar scanner.clear()');
  assert(catchBlock.includes('delete _savvyScanners[videoElementId]'),
    'catch debe eliminar del registro');
  assert(catchBlock.includes('qrDiv.innerHTML = \'\''),
    'catch debe limpiar contenedor');
  assert(catchBlock.includes('throw e') || catchBlock.includes('throw e;'),
    'catch debe ejecutar throw e (NO return false)');
});

// ─────────────────────────────────────────────────────────────
// TEST 28: monitorVideoStream retorna "valid", "cancelled", o "failed"
// ─────────────────────────────────────────────────────────────
test('monitorVideoStream retorna string: "valid", "cancelled", o "failed"', () => {
  const fn = appContent.substring(
    appContent.indexOf('function monitorVideoStream(videoElementId)'),
    appContent.indexOf('// Manejar timeout', appContent.indexOf('function monitorVideoStream(videoElementId)'))
  );

  assert(fn.includes("resolve('valid')") || fn.includes("resolve('cancelled')") || fn.includes("resolve('failed')"),
    'Debe resolver con strings identificables');
  assert(fn.includes("resolve('valid')"),
    'Debe retornar "valid" cuando stream es válido');
  assert(fn.includes("resolve('cancelled')"),
    'Debe retornar "cancelled" cuando fue cancelado');
  assert(fn.includes("resolve('failed')"),
    'Debe retornar "failed" cuando timeout sin video');
});

// ─────────────────────────────────────────────────────────────
// TEST 29: savvyOpenBarcodeScanner maneja resultado de monitorVideoStream
// ─────────────────────────────────────────────────────────────
test('savvyOpenBarcodeScanner verifica return de monitorVideoStream y actúa', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function savvyStartScan', appContent.indexOf('async function savvyOpenBarcodeScanner()'))
  );

  assert(fn.includes('var monitorResult = await monitorVideoStream') || fn.includes('const monitorResult = await monitorVideoStream'),
    'Debe guardar resultado de monitorVideoStream');
  assert(fn.includes("monitorResult === 'cancelled'") && fn.includes('savvyStopScan'),
    'Si "cancelled", debe llamar savvyStopScan');
  assert(fn.includes("monitorResult === 'failed'"),
    'Debe verificar si "failed"');
});

// ─────────────────────────────────────────────────────────────
// TEST 30: savvyOpenBarcodeScanner cancela después de start() en múltiples puntos
// ─────────────────────────────────────────────────────────────
test('CANCEL después de start() resuelve: antes 300ms, después 300ms, durante monitor', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function savvyStartScan', appContent.indexOf('async function savvyOpenBarcodeScanner()'))
  );

  let cancelChecks = 0;
  let idx = 0;
  while ((idx = fn.indexOf('_scannerCancelled[videoElementId]', idx)) > -1) {
    cancelChecks++;
    idx += 1;
  }
  assert(cancelChecks >= 4,
    'Debe verificar cancelación en al menos 4 puntos (antes start, después start, antes 300ms, después 300ms)');

  // Contar cuántos savvyStopScan se llaman después de cancelación
  assert(fn.includes('await savvyStopScan(videoElementId);'),
    'Debe llamar savvyStopScan cuando se cancela después de started===true');
});

// ─────────────────────────────────────────────────────────────
// TEST 31: play() ocurre ANTES de validateVideoStream()
// ─────────────────────────────────────────────────────────────
test('Orden correcto: play() antes que validateVideoStream()', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function savvyStartScan', appContent.indexOf('async function savvyOpenBarcodeScanner()'))
  );

  const playIdx = fn.indexOf('await videoElement.play()');
  const validateIdx = fn.indexOf('validateVideoStream(videoElement)');

  assert(playIdx > -1, 'Debe tener await videoElement.play()');
  assert(validateIdx > -1, 'Debe tener validateVideoStream()');
  assert(playIdx < validateIdx, 'play() debe estar ANTES de validateVideoStream()');
});

// ─────────────────────────────────────────────────────────────
// TEST 32: play() usa try/catch, error no bloquea flujo
// ─────────────────────────────────────────────────────────────
test('play() dentro try/catch, fallo no impide monitorVideoStream', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function savvyStartScan', appContent.indexOf('async function savvyOpenBarcodeScanner()'))
  );

  assert(fn.includes('try {') && fn.includes('await videoElement.play()') && fn.includes('catch (playErr)'),
    'play() debe estar en try/catch');
  assert(fn.includes('play() rechazado'),
    'Debe registrar error de play()');
  assert(fn.includes('PASO 2: Intentar play()'),
    'Debe documentar orden explícitamente');
});

// ─────────────────────────────────────────────────────────────
// TEST 33: setTimeout es async para esperar play()
// ─────────────────────────────────────────────────────────────
test('setTimeout callback es async para esperar videoElement.play()', () => {
  const fn = appContent.substring(
    appContent.indexOf('async function savvyOpenBarcodeScanner()'),
    appContent.indexOf('async function savvyStartScan', appContent.indexOf('async function savvyOpenBarcodeScanner()'))
  );

  assert(fn.includes('setTimeout(async function') && fn.includes('await videoElement.play()'),
    'setTimeout debe ser async y esperar play()');
  assert(fn.includes('PASO 1: Aplicar atributos') && fn.includes('PASO 2: Intentar play()') && fn.includes('PASO 3: Validar stream'),
    'Debe seguir orden explícito: atributos → play() → validateVideoStream()');
});

// ─────────────────────────────────────────────────────────────
// TEST 34: Regresión de sintaxis - app.js debe ser válido
// ─────────────────────────────────────────────────────────────
test('Sintaxis de app.js es válida (no hay errores de parsing)', () => {
  try {
    execSync('node --check ' + appPath, { stdio: 'pipe' });
    assert(true, 'app.js pasa validación de sintaxis con node --check');
  } catch (err) {
    assert(false, 'app.js tiene error de sintaxis: ' + err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// TEST 35: Remove Background deshabilitado en staging (sin fetch activo)
// ─────────────────────────────────────────────────────────────
test('clRemoveBackground lanza error en staging (no intenta fetch a rembg)', () => {
  assert(appContent.includes('async function clRemoveBackground(file, onStatus)'),
    'clRemoveBackground debe estar definida');
  assert(appContent.includes("throw new Error('El servicio de eliminación de fondo todavía no está disponible en staging')"),
    'Debe lanzar error indicando que Remove Background no está disponible');
  assert(!appContent.includes('savvy-rembg-production'),
    'NO debe contener URL de producción savvy-rembg-production');
  assert(!appContent.includes('const rbgRes = null;'),
    'NO debe quedar el bloque huérfano (const rbgRes = null;)');
  assert(!appContent.includes('const b64 = dataUrl.split'),
    'NO debe quedar extracción de base64 después del throw');
});

console.log('\n✅ Todos los 35 tests de scanner iOS ejecutados!');
