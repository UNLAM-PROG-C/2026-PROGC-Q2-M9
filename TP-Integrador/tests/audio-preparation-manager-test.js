/**
 * @fileoverview Pruebas C14 de AudioPreparationManager como coordinador.
 * Verifica admisión, delegación, deduplicación y limpieza de IN_FLIGHT.
 * Usa un worker pool falso; no ejecuta DSP, workers reales, prefetch o I/O.
 */
const assert = require('assert');

const AudioPreparationManager = require(
  '../server/audio/audio-preparation-manager'
);
const AudioResult = require('../server/audio/model/audio-result');
const {AudioMode} = require('../server/audio/model/audio-mode');

/**
 * Fake controlable que registra jobs y permite resolver o rechazar por jobId.
 */
class FakeWorkerPool {
  constructor() {
    /** @type {!Array<!Object>} */
    this.jobs = [];

    /** @private {!Map<string, !Object>} */
    this.pending = new Map();
  }

  /**
   * Registra un job y devuelve una Promise pendiente.
   * @param {!Object} job AudioJob delegado por el manager.
   * @return {!Promise<!AudioResult>} Resultado controlado por el test.
   */
  submit(job) {
    this.jobs.push(job);

    return new Promise((resolve, reject) => {
      this.pending.set(job.jobId, {
        resolve,
        reject,
      });
    });
  }

  /**
   * Resuelve el job indicado.
   * @param {string} jobId Identificador del job.
   * @param {!AudioResult} result Resultado a entregar.
   */
  resolve(jobId, result) {
    const pending = this.pending.get(jobId);
    assert.ok(pending, `No existe job pendiente ${jobId}.`);
    this.pending.delete(jobId);
    pending.resolve(result);
  }

  /**
   * Rechaza el job indicado.
   * @param {string} jobId Identificador del job.
   * @param {!Error} error Error a entregar.
   */
  reject(jobId, error) {
    const pending = this.pending.get(jobId);
    assert.ok(pending, `No existe job pendiente ${jobId}.`);
    this.pending.delete(jobId);
    pending.reject(error);
  }
}

/**
 * Crea un resultado exitoso correlacionado con el job recibido.
 * @param {!Object} job AudioJob original.
 * @return {!AudioResult} Resultado exitoso.
 */
function createSuccessResult(job) {
  return new AudioResult({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    ok: true,
    resource: {path: `/audio/${job.jobId}.wav`},
  });
}

/**
 * Comprueba dependencias obligatorias del constructor.
 */
function testConstructorValidation() {
  assert.throws(
    () => new AudioPreparationManager({workerPool: null}),
    TypeError
  );

  assert.throws(
    () => new AudioPreparationManager({workerPool: {}}),
    TypeError
  );

  assert.throws(
    () =>
      new AudioPreparationManager({
        workerPool: {submit() {}},
        createJobId: 'invalid',
      }),
    TypeError
  );
}

/**
 * Comprueba creación, delegación y limpieza después de un resultado exitoso.
 */
async function testAcceptedPreparation() {
  const workerPool = new FakeWorkerPool();
  const manager = new AudioPreparationManager({
    workerPool,
    createJobId: () => 'job-c14-1',
  });
  const source = {previewUrl: 'https://example.test/song.m4a'};

  const request = manager.requestPreparation({
    gameId: 2,
    roundId: 3,
    mode: AudioMode.REVERSE,
    source,
  });

  assert.strictEqual(request.accepted, true);
  assert.strictEqual(workerPool.jobs.length, 1);
  assert.strictEqual(workerPool.jobs[0], request.job);
  assert.strictEqual(request.job.jobId, 'job-c14-1');
  assert.strictEqual(request.job.gameId, 2);
  assert.strictEqual(request.job.roundId, 3);
  assert.strictEqual(request.job.mode, AudioMode.REVERSE);
  assert.strictEqual(request.job.source, source);
  assert.strictEqual(manager.isInFlight(2, 3), true);
  assert.strictEqual(manager.getInFlightCount(), 1);

  const result = createSuccessResult(request.job);
  workerPool.resolve(request.job.jobId, result);

  assert.strictEqual(await request.resultPromise, result);
  assert.strictEqual(manager.isInFlight(2, 3), false);
  assert.strictEqual(manager.getInFlightCount(), 0);
}

/**
 * Comprueba que la misma gameId y roundId no generen trabajo duplicado.
 */
async function testDuplicatePreparationIsRejected() {
  const workerPool = new FakeWorkerPool();
  const manager = new AudioPreparationManager({workerPool});

  const first = manager.requestPreparation({
    gameId: 1,
    roundId: 4,
    mode: AudioMode.NORMAL,
    source: {previewUrl: 'https://example.test/a.m4a'},
  });

  const duplicate = manager.requestPreparation({
    gameId: 1,
    roundId: 4,
    mode: AudioMode.LOW_PASS,
    source: {previewUrl: 'https://example.test/b.m4a'},
  });

  assert.strictEqual(first.accepted, true);
  assert.deepStrictEqual(duplicate, {
    accepted: false,
    reason: 'ALREADY_IN_FLIGHT',
  });
  assert.strictEqual(workerPool.jobs.length, 1);
  assert.strictEqual(manager.getInFlightCount(), 1);

  workerPool.resolve(first.job.jobId, createSuccessResult(first.job));
  await first.resultPromise;
}

/**
 * Comprueba que la misma roundId de otra generación sea una identidad distinta.
 */
async function testRoundIdentityIncludesGameId() {
  const workerPool = new FakeWorkerPool();
  const manager = new AudioPreparationManager({workerPool});

  const oldGame = manager.requestPreparation({
    gameId: 5,
    roundId: 2,
    mode: AudioMode.NORMAL,
    source: {previewUrl: 'https://example.test/old.m4a'},
  });
  const newGame = manager.requestPreparation({
    gameId: 6,
    roundId: 2,
    mode: AudioMode.NORMAL,
    source: {previewUrl: 'https://example.test/new.m4a'},
  });

  assert.strictEqual(oldGame.accepted, true);
  assert.strictEqual(newGame.accepted, true);
  assert.strictEqual(workerPool.jobs.length, 2);
  assert.strictEqual(manager.getInFlightCount(), 2);

  workerPool.resolve(oldGame.job.jobId, createSuccessResult(oldGame.job));
  workerPool.resolve(newGame.job.jobId, createSuccessResult(newGame.job));

  await Promise.all([
    oldGame.resultPromise,
    newGame.resultPromise,
  ]);
  assert.strictEqual(manager.getInFlightCount(), 0);
}

/**
 * Comprueba que un rechazo asincrónico también libere el tracking IN_FLIGHT.
 */
async function testRejectedPromiseClearsInFlight() {
  const workerPool = new FakeWorkerPool();
  const manager = new AudioPreparationManager({workerPool});

  const request = manager.requestPreparation({
    gameId: 3,
    roundId: 1,
    mode: AudioMode.LOW_PASS,
    source: {previewUrl: 'https://example.test/fail.m4a'},
  });
  const expectedError = new Error('worker failure');

  workerPool.reject(request.job.jobId, expectedError);

  await assert.rejects(
    request.resultPromise,
    (error) => error === expectedError
  );
  assert.strictEqual(manager.isInFlight(3, 1), false);
  assert.strictEqual(manager.getInFlightCount(), 0);
}

/**
 * Comprueba limpieza si submit falla antes de devolver una Promise.
 */
function testSynchronousSubmitFailureClearsInFlight() {
  const expectedError = new Error('submit failure');
  const manager = new AudioPreparationManager({
    workerPool: {
      submit() {
        throw expectedError;
      },
    },
  });

  assert.throws(
    () =>
      manager.requestPreparation({
        gameId: 4,
        roundId: 1,
        mode: AudioMode.NORMAL,
        source: {previewUrl: 'https://example.test/fail.m4a'},
      }),
    (error) => error === expectedError
  );
  assert.strictEqual(manager.isInFlight(4, 1), false);
  assert.strictEqual(manager.getInFlightCount(), 0);
}

/**
 * Ejecuta todos los casos C14.
 * @return {!Promise<void>} Finaliza cuando todas las Promises quedan resueltas.
 */
async function run() {
  testConstructorValidation();
  await testAcceptedPreparation();
  await testDuplicatePreparationIsRejected();
  await testRoundIdentityIncludesGameId();
  await testRejectedPromiseClearsInFlight();
  testSynchronousSubmitFailureClearsInFlight();

  console.log(
    '[C14] PASS: AudioPreparationManager coordina y deduplica trabajos.'
  );
}

run().catch((error) => {
  console.error('[C14] FAIL:', error);
  process.exitCode = 1;
});
