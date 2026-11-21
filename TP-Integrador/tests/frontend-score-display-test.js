/**
 * @fileoverview Regresión de presentación> penalización por respuesta errónea.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(
    new URL('../public/index.html', import.meta.url),
    'utf8',
);

test('respuesta incorrecta muestra la penalización aplicada', () => {
  assert.ok(html.includes(
      'const penalty = data.potentialPoints - currentPotentialPoints;'));
  assert.ok(html.includes(
      'addAttempt(data.guess, false, penalty);'));
  assert.ok(!html.includes(
      'addAttempt(data.guess, false, data.potentialPoints);'));
});

