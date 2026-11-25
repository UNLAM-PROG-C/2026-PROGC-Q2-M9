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
const SPEC_TIMEOUT_MS = 60000;
const EXIT_SUCCESS = 0;
const MIN_SPECS_REQUIRED = 1;
const SPEC_FILE_PATTERN = /-(test)\.js$/;

const CANDIDATE_SPECS = [
  'tests/job-queue-test.js',
  'tests/prepared-round-buffer-test.js',
  'tests/prepared-round-coordination-test.js',
  'tests/worker-pool-integration-test.js',
  'tests/alt02-concurrent-answers.js',
  'tests/alt02-matrix.js',
];

function buildRunnerArgs(specRelPath) {
  const absPath = path.join(ROOT_DIR, specRelPath);
  return SPEC_FILE_PATTERN.test(specRelPath) ? ['--test', absPath] : [absPath];
}

function printFailureOutput(proc) {
  if (proc.stdout) {
    console.error(proc.stdout);
  }
  if (proc.stderr) {
    console.error(proc.stderr);
  }
}

function runSpecProcess(specRelPath) {
  return spawnSync('node', buildRunnerArgs(specRelPath), {
    cwd: ROOT_DIR,
    env: {...process.env},
    encoding: 'utf8',
    timeout: SPEC_TIMEOUT_MS,
  });
}

function executeSingleSpec(specRelPath) {
  const startedAt = Date.now();
  const proc = runSpecProcess(specRelPath);
  const passed = proc.status === EXIT_SUCCESS;
  console.log(
      `[${passed ? 'PASS' : 'FAIL'}] ${specRelPath} ` +
    `(${Date.now() - startedAt} ms, status=${proc.status})`,
  );
  if (!passed) {
    printFailureOutput(proc);
  }
  return {spec: specRelPath, passed, status: proc.status};
}

function printSummary(results) {
  const failedCount = results.filter((item) => !item.passed).length;
  console.log('\n=== RESUMEN REGRESIÓN V4-C26 ===');
  console.log(`Total ejecutados: ${results.length}`);
  console.log(`Aprobados: ${results.length - failedCount}`);
  console.log(`Fallidos: ${failedCount}\n`);
  return failedCount;
}

function runRegressionSuite() {
  const existingSpecs = CANDIDATE_SPECS.filter(
      (rel) => fs.existsSync(path.join(ROOT_DIR, rel)),
  );
  assert.ok(
      existingSpecs.length >= MIN_SPECS_REQUIRED,
      'Debe existir al menos un test de regresión en tests/',
  );
  const results = existingSpecs.map(executeSingleSpec);
  const failedCount = printSummary(results);
  assert.equal(failedCount, EXIT_SUCCESS, 'Todos los specs deben pasar');
}

runRegressionSuite();
