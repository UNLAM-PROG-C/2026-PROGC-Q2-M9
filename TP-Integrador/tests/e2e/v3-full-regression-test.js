/**
 * @fileoverview Regresión completa de V3 y mecanismos integrados (V4-C26).
 */

import {spawnSync} from 'child_process';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

const CANDIDATE_SPECS = [
  'tests/job-queue-test.js',
  'tests/prepared-round-buffer-test.js',
  'tests/prepared-round-coordination-test.js',
  'tests/worker-pool-integration-test.js',
  'tests/alt02-concurrent-answers.js',
  'tests/alt02-matrix.js',
];

function runRegressionSuite() {
  const existing = CANDIDATE_SPECS.filter(
      (rel) => fs.existsSync(path.join(ROOT_DIR, rel)),
  );
  assert.ok(
      existing.length >= 1,
      'Debe existir al menos un test de regresión en tests/',
  );

  const results = [];
  for (const rel of existing) {
    const abs = path.join(ROOT_DIR, rel);
    const useNodeTest = /-(test)\.js$/.test(rel);
    const args = useNodeTest ? ['--test', abs] : [abs];
    const startedAt = Date.now();
    const proc = spawnSync('node', args, {
      cwd: ROOT_DIR,
      env: {...process.env},
      encoding: 'utf8',
      timeout: 60000,
    });
    const durationMs = Date.now() - startedAt;
    const passed = proc.status === 0;
    results.push({
      spec: rel,
      mode: useNodeTest ? 'node --test' : 'node',
      passed,
      durationMs,
      status: proc.status,
    });
    console.log(
        `[${passed ? 'PASS' : 'FAIL'}] ${rel} (${durationMs} ms, ` +
        `status=${proc.status})`,
    );
    if (!passed) {
      if (proc.stdout) {
        console.error(proc.stdout);
      }
      if (proc.stderr) {
        console.error(proc.stderr);
      }
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log('\n=== RESUMEN REGRESIÓN V4-C26 ===');
  console.log(`Total ejecutados: ${results.length}`);
  console.log(`Aprobados: ${results.length - failed.length}`);
  console.log(`Fallidos: ${failed.length}\n`);

  assert.equal(failed.length, 0, 'Todos los specs de regresión deben pasar');
}

runRegressionSuite();
