/**
 * @fileoverview Runner consolidado de regresión V4.
 */

import {spawnSync} from 'child_process';
import assert from 'node:assert/strict';

const SCRIPT_TIMEOUT_MS = 120000;
const EXIT_SUCCESS = 0;
const SUITE_ARG_INDEX = 2;

const CORE_SCRIPTS = [
  'test:c05',
  'test:c08',
  'test:c09',
  'test:c10',
  'test:c11',
  'test:c12',
  'test:c13',
  'test:c14',
  'test:c15',
  'test:c16',
  'test:c17',
  'test:c18',
  'test:c19',
  'test:c20',
  'test:c21',
  'test:score-display',
  'test:e2e:c22',
  'test:e2e:c23',
  'test:c24',
  'test:c25',
  'test:alt02',
  'test:alt02:matrix',
];

const ENV_SCRIPTS = [
  'test:c03',
  'test:c06',
  'test:c07',
  'test:c19a',
];

const SUITES = {
  core: CORE_SCRIPTS,
  env: ENV_SCRIPTS,
  full: [...CORE_SCRIPTS, ...ENV_SCRIPTS],
};

function npmCliPath() {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'No se encontró npm_execpath.');
  return npmCli;
}

function printFailureOutput(proc) {
  if (proc.error) {
    console.error(proc.error);
  }
  if (proc.stdout) {
    console.error(proc.stdout);
  }
  if (proc.stderr) {
    console.error(proc.stderr);
  }
}

function runNpmScript(script) {
  return spawnSync(process.execPath, [npmCliPath(), 'run', script], {
    cwd: process.cwd(),
    env: {...process.env},
    encoding: 'utf8',
    timeout: SCRIPT_TIMEOUT_MS,
  });
}

function executeScript(script) {
  const startedAt = Date.now();
  console.log(`\n>>> Ejecutando ${script}`);
  const proc = runNpmScript(script);
  const passed = proc.status === EXIT_SUCCESS;
  const elapsed = Date.now() - startedAt;
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${script} (${elapsed} ms)`);
  if (!passed) {
    printFailureOutput(proc);
  }
  return {script, passed, status: proc.status};
}

function executeSuite(scripts) {
  const results = [];
  for (const script of scripts) {
    const result = executeScript(script);
    results.push(result);
    if (!result.passed) {
      break;
    }
  }
  return results;
}

function printSummary(name, scripts, results) {
  const failed = results.filter((item) => !item.passed).length;
  console.log(`\n=== RESUMEN REGRESIÓN ${name.toUpperCase()} ===`);
  console.log(`Planificados: ${scripts.length}`);
  console.log(`Ejecutados: ${results.length}`);
  console.log(`Aprobados: ${results.length - failed}`);
  console.log(`Fallidos: ${failed}`);
  console.log(`Pendientes por corte: ${scripts.length - results.length}`);
  return failed;
}

function resolveSuite(name) {
  const scripts = SUITES[name];
  assert.ok(scripts, `Suite desconocida: ${name}`);
  return scripts;
}

function run() {
  const name = process.argv[SUITE_ARG_INDEX] || 'core';
  const scripts = resolveSuite(name);
  const results = executeSuite(scripts);
  const failed = printSummary(name, scripts, results);
  assert.equal(failed, EXIT_SUCCESS, `Regresión ${name} con fallos`);
  console.log(`REGRESIÓN ${name.toUpperCase()}: PASS`);
}

run();
