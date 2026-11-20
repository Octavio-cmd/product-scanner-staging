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

test('el exportador usa specifics solo como respaldo de detectores locales', () => {
  assert.ok(appContent.includes("modelVal = modelVal || _specForCol('C:Model');"));
  assert.ok(appContent.includes("connectivityVal = connectivityVal || _specForCol('C:Connectivity');"));
  assert.ok(
    appContent.indexOf("else if (/wired/i.test(_tl))") <
      appContent.indexOf("connectivityVal = connectivityVal || _specForCol('C:Connectivity');"),
    'La detección local de Connectivity debe ejecutarse antes del respaldo de IA'
  );
});
