/**
 * @fileoverview Pruebas parciales C18 del lifecycle de audio ante RESTART.
 * Verifica gameId, limpieza de IN_FLIGHT, cancelación de QUEUED y resultados
 * stale. PreparedRoundBuffer continúa pendiente de C15.
 */
import assert from 'assert';

import {
  AudioPreparationManager,
} from '../../server/audio/audio-preparation-manager.js';
import {
  AudioWorkerPool,
} from '../../server/audio/audio-worker-pool.js';
import {AudioResult} from '../../server/audio/model/audio-result.js';
import {AudioMode} from '../../server/audio/model/audio-mode.js';

const OLD_GAME_ID = 5;
const NEW_GAME_ID = 6;
const SHARED_ROUND_ID = 2;
const QUEUED_ROUND_A = 3;
const QUEUED_ROUND_B = 4;
const SINGLE_WORKER = 1;
const OLD_URL = 'https://example.test/old.m4a';
const NEW_URL = 'https://example.test/new.m4a';

/**
 * Pool falso para aislar la clasificación lógica de resultados stale.
 */
class DeferredFakeWorkerPool {
  constructor() {
    this.submitted = [];
    this.pending = new Map();
  }

  submit(job) {
    this.submitted.push(job);
    return new Promise((resolve, reject) => {
      this.pending.set(job.jobId, {resolve, reject});
    });
  }

  cancelQueuedByGameId() {
    return 0;
  }

  resolve(jobId, result) {
    const pending = this.pending.get(jobId);
    assert.ok(pending, `No existe job pendiente ${jobId}.`);
    this.pending.delete(jobId);
    pending.resolve(result);
  }
}

/**
 * Worker controlado usado con el AudioWorkerPool real.
 */
class ControlledWorker {
  constructor(starts) {
    this.starts = starts;
    this.busy = false;
    this.exited = false;
    this.pending = null;
  }

  isBusy() {
    return this.busy;
  }

  hasExited() {
    return this.exited;
  }

  run(job) {
    this.busy = true;
    this.starts.push(job.jobId);
    return new Promise((resolve) => {
      this.pending = {job, resolve};
    });
  }

  complete() {
    const {job, resolve} = this.pending;
    this.busy = false;
    this.pending = null;
    resolve(createResult(job));
  }

  async terminate() {
    this.exited = true;
    this.busy = false;
  }
}

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
    initialGameId: OLD_GAME_ID,
  });
  return {workerPool, manager};
}

function requestRound(manager, gameId, roundId, mode, previewUrl) {
  return manager.requestPreparation({
    gameId,
    roundId,
    mode,
    source: {previewUrl},
  });
}

function assertOldRequestStarted(manager, request) {
  assert.strictEqual(manager.getCurrentGameId(), OLD_GAME_ID);
  assert.strictEqual(request.accepted, true);
  assert.strictEqual(
      manager.isInFlight(OLD_GAME_ID, SHARED_ROUND_ID),
      true,
  );
  assert.strictEqual(manager.getInFlightCount(), 1);
}

function applyRestart(manager) {
  const restart = manager.handleGameRestart({
    previousGameId: OLD_GAME_ID,
    gameId: NEW_GAME_ID,
  });
  assert.deepStrictEqual(restart, {
    previousGameId: OLD_GAME_ID,
    gameId: NEW_GAME_ID,
    cancelledQueued: 0,
    clearedInFlight: 1,
  });
}

function assertRestartState(manager) {
  assert.strictEqual(manager.getCurrentGameId(), NEW_GAME_ID);
  assert.strictEqual(
      manager.isInFlight(OLD_GAME_ID, SHARED_ROUND_ID),
      false,
  );
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
      manager, OLD_GAME_ID, SHARED_ROUND_ID, AudioMode.REVERSE, OLD_URL,
  );
  assertOldRequestStarted(manager, oldRequest);
  applyRestart(manager);
  assertRestartState(manager);
  const newRequest = requestRound(
      manager, NEW_GAME_ID, SHARED_ROUND_ID, AudioMode.NORMAL, NEW_URL,
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

function createMinimalPool() {
  return {
    submit() {
      return Promise.resolve();
    },
    cancelQueuedByGameId() {
      return 0;
    },
  };
}

function createValidationManager() {
  return new AudioPreparationManager({
    workerPool: createMinimalPool(),
    initialGameId: OLD_GAME_ID,
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
  assertRestartRejected(manager, 4, NEW_GAME_ID, /previousGameId/);
  assertRestartRejected(manager, OLD_GAME_ID, OLD_GAME_ID, /posterior/);
  assertRestartRejected(manager, OLD_GAME_ID, 4, /posterior/);
  assert.strictEqual(manager.getCurrentGameId(), OLD_GAME_ID);
}

function testInitialGameValidation() {
  assert.throws(
      () => new AudioPreparationManager({
        workerPool: createMinimalPool(),
        initialGameId: 0,
      }),
      TypeError,
  );
}

function createRealPoolScenario() {
  const workers = [];
  const starts = [];
  const createWorker = () => {
    const worker = new ControlledWorker(starts);
    workers.push(worker);
    return worker;
  };
  const pool = new AudioWorkerPool({size: SINGLE_WORKER, createWorker});
  const manager = new AudioPreparationManager({
    workerPool: pool,
    initialGameId: OLD_GAME_ID,
  });
  return {pool, manager, workers, starts};
}

function requestOldRound(scenario, roundId, mode) {
  return requestRound(
      scenario.manager,
      OLD_GAME_ID,
      roundId,
      mode,
      OLD_URL,
  );
}

function prepareQueuedRestartScenario() {
  const scenario = createRealPoolScenario();
  const running = requestOldRound(
      scenario, SHARED_ROUND_ID, AudioMode.NORMAL,
  );
  const queuedA = requestOldRound(
      scenario, QUEUED_ROUND_A, AudioMode.REVERSE,
  );
  const queuedB = requestOldRound(
      scenario, QUEUED_ROUND_B, AudioMode.LOW_PASS,
  );
  return {...scenario, running, queuedA, queuedB};
}

function assertQueueBeforeRestart(scenario) {
  assert.strictEqual(scenario.pool.getQueuedCount(), 2);
  assert.strictEqual(scenario.workers[0].isBusy(), true);
  assert.strictEqual(scenario.workers[0].hasExited(), false);
  assert.deepStrictEqual(scenario.starts, [scenario.running.job.jobId]);
}

function watchQueuedRejections(scenario) {
  const rejectedA = assert.rejects(
      scenario.queuedA.resultPromise,
      /cancelado/,
  );
  const rejectedB = assert.rejects(
      scenario.queuedB.resultPromise,
      /cancelado/,
  );
  return Promise.all([rejectedA, rejectedB]);
}

function restartQueuedScenario(scenario) {
  const restart = scenario.manager.handleGameRestart({
    previousGameId: OLD_GAME_ID,
    gameId: NEW_GAME_ID,
  });
  assert.deepStrictEqual(restart, {
    previousGameId: OLD_GAME_ID,
    gameId: NEW_GAME_ID,
    cancelledQueued: 2,
    clearedInFlight: 3,
  });
}

async function assertQueuedCancellation(scenario) {
  const rejections = watchQueuedRejections(scenario);
  restartQueuedScenario(scenario);
  await rejections;
  assert.strictEqual(scenario.pool.getQueuedCount(), 0);
  assert.strictEqual(scenario.workers[0].isBusy(), true);
  assert.strictEqual(scenario.workers[0].hasExited(), false);
}

function queueCurrentGameRequest(scenario) {
  const request = requestRound(
      scenario.manager, NEW_GAME_ID, SHARED_ROUND_ID,
      AudioMode.NORMAL, NEW_URL,
  );
  assert.strictEqual(request.accepted, true);
  assert.strictEqual(scenario.pool.getQueuedCount(), 1);
  return request;
}

async function finishOldRunningJob(scenario, currentRequest) {
  scenario.workers[0].complete();
  const oldResult = await scenario.running.resultPromise;
  await Promise.resolve();
  assertStaleClassification(scenario.manager, oldResult);
  assert.strictEqual(scenario.workers[0].hasExited(), false);
  assert.strictEqual(scenario.workers[0].isBusy(), true);
  assert.strictEqual(scenario.starts.at(-1), currentRequest.job.jobId);
}

async function finishCurrentJob(scenario, currentRequest) {
  scenario.workers[0].complete();
  const currentResult = await currentRequest.resultPromise;
  assertCurrentClassification(scenario.manager, currentResult);
  await scenario.pool.terminate();
  assert.strictEqual(scenario.workers[0].hasExited(), true);
}

async function testQueuedCancellationOnRestart() {
  const scenario = prepareQueuedRestartScenario();
  assertQueueBeforeRestart(scenario);
  await assertQueuedCancellation(scenario);
  const currentRequest = queueCurrentGameRequest(scenario);
  await finishOldRunningJob(scenario, currentRequest);
  await finishCurrentJob(scenario, currentRequest);
}

async function run() {
  testInitialGameValidation();
  testRestartValidation();
  await testRunningOldJobBecomesStale();
  await testQueuedCancellationOnRestart();

  console.log(
      '[C18] PASS parcial: RESTART cancela QUEUED y descarta stale.',
  );
}

run().catch((error) => {
  console.error('[C18] FAIL:', error);
  process.exitCode = 1;
});
