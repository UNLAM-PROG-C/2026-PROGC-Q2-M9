/**
 * @fileoverview Pruebas parciales C18 del lifecycle de audio ante RESTART.
 * Verifica cambio de gameId, limpieza lógica de IN_FLIGHT y detección de
 * resultados stale. Queue y PreparedRoundBuffer quedan pendientes de C12/C15.
 */
import assert from 'assert';

import {
  AudioPreparationManager,
} from '../../server/audio/audio-preparation-manager.js';
import {AudioResult} from '../../server/audio/model/audio-result.js';
import {AudioMode} from '../../server/audio/model/audio-mode.js';

/**
 * Pool falso que permite controlar cuándo termina cada trabajo.
 */
class DeferredFakeWorkerPool {
  constructor() {
    /** @type {!Array<!Object>} */
    this.submitted = [];

    /** @private {!Map<string, !Object>} */
    this.pending = new Map();
  }

  /**
   * Conserva el trabajo pendiente hasta que el test lo resuelva.
   * @param {!Object} job AudioJob delegado.
   * @return {!Promise<!AudioResult>} Resultado controlado por el test.
   */
  submit(job) {
    this.submitted.push(job);

    return new Promise((resolve, reject) => {
      this.pending.set(job.jobId, {
        resolve,
        reject,
      });
    });
  }

  /**
   * Resuelve un trabajo pendiente.
   * @param {string} jobId Identificador del AudioJob.
   * @param {!AudioResult} result Resultado del trabajo.
   */
  resolve(jobId, result) {
    const pending = this.pending.get(jobId);

    assert.ok(
        pending,
        `No existe job pendiente ${jobId}.`,
    );

    this.pending.delete(jobId);
    pending.resolve(result);
  }
}

/**
 * Crea un AudioResult exitoso para el AudioJob indicado.
 * @param {!Object} job AudioJob original.
 * @return {!AudioResult} Resultado correlacionado.
 */
function createResult(job) {
  return new AudioResult({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    ok: true,
    resource: {
      path: `/audio/${job.jobId}.wav`,
    },
  });
}

function createRestartScenario() {
  const workerPool = new DeferredFakeWorkerPool();
  const manager = new AudioPreparationManager({
    workerPool,
    initialGameId: 5,
  });
  return {workerPool, manager};
}

function requestRound(manager, gameId, mode, previewUrl) {
  return manager.requestPreparation({
    gameId,
    roundId: 2,
    mode,
    source: {previewUrl},
  });
}

function assertOldRequestStarted(manager, request) {
  assert.strictEqual(manager.getCurrentGameId(), 5);
  assert.strictEqual(request.accepted, true);
  assert.strictEqual(manager.isInFlight(5, 2), true);
  assert.strictEqual(manager.getInFlightCount(), 1);
}

function applyRestart(manager) {
  const restart = manager.handleGameRestart({
    previousGameId: 5,
    gameId: 6,
  });
  assert.deepStrictEqual(restart, {
    previousGameId: 5,
    gameId: 6,
    clearedInFlight: 1,
  });
}

function assertRestartState(manager) {
  assert.strictEqual(manager.getCurrentGameId(), 6);
  assert.strictEqual(manager.isInFlight(5, 2), false);
  assert.strictEqual(manager.getInFlightCount(), 0);
}

async function resolveRequest(workerPool, request) {
  const result = createResult(request.job);
  workerPool.resolve(request.job.jobId, result);
  const resolved = await request.resultPromise;
  assert.strictEqual(resolved, result);
  return resolved;
}

function assertStaleClassification(manager, result) {
  assert.strictEqual(manager.isStaleResult(result), true);
  assert.strictEqual(manager.isCurrentGame(result.gameId), false);
  assert.deepStrictEqual(manager.handleAudioResult(result), {
    accepted: false,
    reason: 'STALE_GAME',
    result,
  });
}

function assertCurrentClassification(manager, result) {
  assert.strictEqual(manager.isStaleResult(result), false);
  assert.strictEqual(manager.isCurrentGame(result.gameId), true);
  assert.deepStrictEqual(manager.handleAudioResult(result), {
    accepted: true,
    result,
  });
}

function prepareRunningRestartScenario() {
  const {workerPool, manager} = createRestartScenario();
  const oldRequest = requestRound(
      manager, 5, AudioMode.REVERSE, 'https://example.test/old.m4a',
  );
  assertOldRequestStarted(manager, oldRequest);
  applyRestart(manager);
  assertRestartState(manager);
  const newRequest = requestRound(
      manager, 6, AudioMode.NORMAL, 'https://example.test/new.m4a',
  );
  assert.strictEqual(newRequest.accepted, true);
  return {workerPool, manager, oldRequest, newRequest};
}

async function testRunningOldJobBecomesStale() {
  const scenario = prepareRunningRestartScenario();
  const oldResult = await resolveRequest(
      scenario.workerPool, scenario.oldRequest,
  );
  assertStaleClassification(scenario.manager, oldResult);
  const newResult = await resolveRequest(
      scenario.workerPool, scenario.newRequest,
  );
  assertCurrentClassification(scenario.manager, newResult);
  assert.strictEqual(scenario.manager.getInFlightCount(), 0);
}

function createValidationManager() {
  return new AudioPreparationManager({
    workerPool: {
      submit() {
        return Promise.resolve();
      },
    },
    initialGameId: 5,
  });
}

function assertRestartRejected(manager, previousGameId, gameId, pattern) {
  assert.throws(
      () => manager.handleGameRestart({previousGameId, gameId}),
      pattern,
  );
}

function testRestartValidation() {
  const manager = createValidationManager();
  assertRestartRejected(manager, 4, 6, /previousGameId/);
  assertRestartRejected(manager, 5, 5, /posterior/);
  assertRestartRejected(manager, 5, 4, /posterior/);
  assert.strictEqual(manager.getCurrentGameId(), 5);
}


/**
 * Verifica validación del gameId inicial.
 */
function testInitialGameValidation() {
  assert.throws(
      () =>
        new AudioPreparationManager({
          workerPool: {
            submit() {
              return Promise.resolve();
            },
          },
          initialGameId: 0,
        }),
      TypeError,
  );
}

/**
 * Ejecuta las pruebas parciales disponibles para C18.
 * @return {!Promise<void>} Finaliza al resolver los jobs diferidos.
 */
async function run() {
  testInitialGameValidation();
  testRestartValidation();
  await testRunningOldJobBecomesStale();

  console.log(
      '[C18] PASS parcial: gameId, RESTART lógico y stale validados.',
  );
}

run().catch((error) => {
  console.error('[C18] FAIL:', error);
  process.exitCode = 1;
});
