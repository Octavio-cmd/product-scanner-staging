import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appContent = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

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

test('regresión LU731-BLU conserva Model y Connectivity generados', () => {
  const map = readSpecificColumnMap();
  const specifics = { Model: 'LU731-BLU', Connectivity: '3.5mm Jack' };
  const byColumn = {};
  for (const [name, value] of Object.entries(specifics)) {
    const column = map[name];
    if (column && value && !byColumn[column]) byColumn[column] = value.trim();
  }
  assert.equal(byColumn['C:Model'], 'LU731-BLU');
  assert.equal(byColumn['C:Connectivity'], '3.5mm Jack');
});

test('el exportador usa specifics como respaldo', () => {
  assert.ok(appContent.includes("modelVal = modelVal || _specForCol('C:Model');"));
  assert.ok(appContent.includes("connectivityVal = connectivityVal || _specForCol('C:Connectivity');"));
});

test('la validación de electrónicos existe una sola vez y corre antes de guardar', () => {
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

test('regresión del headset no hardcodea el UPC ni sus respuestas', () => {
  assert.equal(appContent.includes('021331905642'), false);
  assert.equal(appContent.includes("proposedModel = 'LU731-BLU'"), false);
  assert.equal(appContent.includes("proposedConnectivity = '3.5mm Jack'"), false);
});
