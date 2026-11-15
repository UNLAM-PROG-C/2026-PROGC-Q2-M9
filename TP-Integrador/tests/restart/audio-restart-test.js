/**
 * @fileoverview Pruebas parciales C18 del lifecycle de audio ante RESTART.
 * Verifica cambio de gameId, limpieza lógica de IN_FLIGHT y detección de
 * resultados stale. Queue y PreparedRoundBuffer quedan pendientes de C12/C15.
 */
const assert = require('assert');

const AudioPreparationManager = require(
  '../../server/audio/audio-preparation-manager'
);
const AudioResult = require('../../server/audio/model/audio-result');
const {AudioMode} = require('../../server/audio/model/audio-mode');

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
      `No existe job pendiente ${jobId}.`
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

/**
 * Verifica el escenario central: trabajo viejo en vuelo durante RESTART.
 */
async function testRunningOldJobBecomesStale() {
  const workerPool = new DeferredFakeWorkerPool();
  const manager = new AudioPreparationManager({
    workerPool,
    initialGameId: 5,
  });

  assert.strictEqual(manager.getCurrentGameId(), 5);

  const oldRequest = manager.requestPreparation({
    gameId: 5,
    roundId: 2,
    mode: AudioMode.REVERSE,
    source: {
      previewUrl: 'https://example.test/old.m4a',
    },
  });

  assert.strictEqual(oldRequest.accepted, true);
  assert.strictEqual(manager.isInFlight(5, 2), true);
  assert.strictEqual(manager.getInFlightCount(), 1);

  const restart = manager.handleGameRestart({
    previousGameId: 5,
    gameId: 6,
  });

  assert.deepStrictEqual(restart, {
    previousGameId: 5,
    gameId: 6,
    clearedInFlight: 1,
  });

  assert.strictEqual(manager.getCurrentGameId(), 6);
  assert.strictEqual(manager.isInFlight(5, 2), false);
  assert.strictEqual(manager.getInFlightCount(), 0);

  const newRequest = manager.requestPreparation({
    gameId: 6,
    roundId: 2,
    mode: AudioMode.NORMAL,
    source: {
      previewUrl: 'https://example.test/new.m4a',
    },
  });

  assert.strictEqual(newRequest.accepted, true);
  assert.strictEqual(manager.isInFlight(6, 2), true);

  const oldResult = createResult(oldRequest.job);
  workerPool.resolve(oldRequest.job.jobId, oldResult);

  const resolvedOldResult = await oldRequest.resultPromise;

  assert.strictEqual(resolvedOldResult, oldResult);
  assert.strictEqual(manager.isStaleResult(resolvedOldResult), true);
  assert.strictEqual(manager.isCurrentGame(resolvedOldResult.gameId), false);

  const oldClassification =
    manager.handleAudioResult(resolvedOldResult);

  assert.deepStrictEqual(oldClassification, {
    accepted: false,
    reason: 'STALE_GAME',
    result: oldResult,
  });

  const newResult = createResult(newRequest.job);
  workerPool.resolve(newRequest.job.jobId, newResult);

  const resolvedNewResult = await newRequest.resultPromise;

  assert.strictEqual(resolvedNewResult, newResult);
  assert.strictEqual(manager.isStaleResult(resolvedNewResult), false);
  assert.strictEqual(manager.isCurrentGame(resolvedNewResult.gameId), true);

  const newClassification =
    manager.handleAudioResult(resolvedNewResult);

  assert.deepStrictEqual(newClassification, {
    accepted: true,
    result: newResult,
  });

  assert.strictEqual(manager.getInFlightCount(), 0);
}

/**
 * Verifica rechazos de transiciones de generación inconsistentes.
 */
function testRestartValidation() {
  const manager = new AudioPreparationManager({
    workerPool: {
      submit() {
        return Promise.resolve();
      },
    },
    initialGameId: 5,
  });

  assert.throws(
    () =>
      manager.handleGameRestart({
        previousGameId: 4,
        gameId: 6,
      }),
    /previousGameId/
  );

  assert.throws(
    () =>
      manager.handleGameRestart({
        previousGameId: 5,
        gameId: 5,
      }),
    /posterior/
  );

  assert.throws(
    () =>
      manager.handleGameRestart({
        previousGameId: 5,
        gameId: 4,
      }),
    /posterior/
  );

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
    TypeError
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
    '[C18] PASS parcial: gameId, RESTART lógico y stale validados.'
  );
}

run().catch((error) => {
  console.error('[C18] FAIL:', error);
  process.exitCode = 1;
});
