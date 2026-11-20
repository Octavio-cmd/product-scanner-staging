import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appContent = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const indexContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function readSpecificColumnMap() {
  const match = appContent.match(/var SPEC_COL_MAP = (\{[\s\S]*?\n\s*\});/);
  assert.ok(match, 'Debe existir SPEC_COL_MAP en el exportador CSV');
  return vm.runInNewContext(`(${match[1]})`);
}

test('Model y Connectivity se mapean a sus columnas del CSV', () => {
  const map = readSpecificColumnMap();
  assert.equal(map.Model, 'C:Model');
  assert.equal(map.Connectivity, 'C:Connectivity');
});

test('la validación existe una sola vez y corre antes de guardar', () => {
  assert.equal((appContent.match(/function psConfirmElectronicsSpecifics\(/g) || []).length, 1);
  assert.equal((appContent.match(/if \(cur && !psConfirmElectronicsSpecifics\(cur\)\) return;/g) || []).length, 1);
  assert.match(appContent, /\['80183', '171821'\]/);
});

test('Model y Connectivity siempre se confirman contra la caja', () => {
  assert.ok(appContent.includes("var proposedModel = catalogModel || String(specs.Model || '').trim();"));
  assert.ok(appContent.includes("'🎧 CONFIRMA EL MODELO\\n\\n'"));
  assert.ok(appContent.includes("'🔌 CONFIRMA LA CONECTIVIDAD\\n\\n'"));
  assert.ok(appContent.includes('specs.Model = modelAnswer.substring(0, 65);'));
  assert.ok(appContent.includes('specs.Connectivity = connectivityAnswer.substring(0, 65);'));
});

test('el exportador conserva Model y Connectivity confirmados', () => {
  assert.ok(appContent.includes("modelVal = modelVal || _specForCol('C:Model');"));
  assert.ok(appContent.includes("connectivityVal = connectivityVal || _specForCol('C:Connectivity');"));
});

test('el panel visible se actualiza después de confirmar electrónicos', () => {
  assert.ok(appContent.includes("renderSpecificsPreview(specs);"));
});

test('el botón explica el motivo exacto del bloqueo', () => {
  assert.ok(appContent.includes("reason: 'pack_locked'"));
  assert.ok(appContent.includes("message: '🔒 ' + packs + 'pk ya existe en Sellbrite/eBay'"));
  assert.ok(appContent.includes("message: '📷 Falta fotografía requerida'"));
  assert.ok(appContent.includes("var _why = (_r && _r.message) ||"));
});

test('regresión del headset no hardcodea UPC ni respuestas', () => {
  assert.equal(appContent.includes('021331905642'), false);
  assert.equal(appContent.includes("proposedModel = 'LU731-BLU'"), false);
  assert.equal(appContent.includes("proposedConnectivity = '3.5mm Jack'"), false);
});

test('index obliga al navegador a cargar la versión corregida', () => {
  assert.ok(indexContent.includes('app.js?v=2026-11-20-electronics-feedback-v2'));
});
