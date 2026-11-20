import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AudioPreparationManager,
} from '../server/audio/audio-preparation-manager.js';
import {AudioWorkerPool} from '../server/audio/audio-worker-pool.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';

const OLD_GAME_ID = 5;
const NEW_GAME_ID = 6;
const ROUND_ONE = 1;
const ROUND_TWO = 2;
const ROUND_THREE = 3;
const READY_ROUND = 4;
const POOL_SIZE = 1;

class ControlledWorker {
  constructor(id) {
    this.id = id;
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
    return new Promise((resolve) => {
      this.pending = {job, resolve};
    });
  }

  complete() {
    const {job, resolve} = this.pending;
    this.busy = false;
    this.pending = null;
    resolve(createSuccessResult(job, this.id));
  }

  async terminate() {
    this.exited = true;
    this.busy = false;
  }
}

function createSuccessResult(job, workerId) {
  return new AudioResult({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    ok: true,
    resource: {workerId},
  });
}

function createControlledWorker(workers) {
  const worker = new ControlledWorker(workers.length + 1);
  workers.push(worker);
  return worker;
}

function createHarness() {
  const workers = [];
  const createWorker = () => createControlledWorker(workers);
  const pool = new AudioWorkerPool({size: POOL_SIZE, createWorker});
  const buffer = new PreparedRoundBuffer();
  const manager = new AudioPreparationManager({
    workerPool: pool,
    preparedRoundBuffer: buffer,
    initialGameId: OLD_GAME_ID,
  });
  return {pool, buffer, manager, workers};
}

function requestRound(manager, gameId, roundId) {
  return manager.requestPreparation({
    gameId,
    roundId,
    mode: AudioMode.NORMAL,
    source: {id: `source-${gameId}-${roundId}`},
  });
}

function addOldReadyRound(buffer) {
  buffer.tryAdd(new PreparedRound({
    gameId: OLD_GAME_ID,
    roundId: READY_ROUND,
    mode: AudioMode.NORMAL,
    song: {id: 'old-song'},
    resource: {id: 'old-resource'},
  }));
}

function createScenario() {
  const harness = createHarness();
  addOldReadyRound(harness.buffer);
  const rounds = [ROUND_ONE, ROUND_TWO, ROUND_THREE];
  const oldRequests = rounds.map(
      (roundId) => requestRound(harness.manager, OLD_GAME_ID, roundId),
  );
  return {...harness, oldRequests};
}

function assertInitialState(scenario) {
  assert.equal(scenario.pool.getActiveCount(), POOL_SIZE);
  assert.equal(scenario.pool.getQueuedCount(), ROUND_TWO);
  assert.equal(scenario.manager.getInFlightCount(), ROUND_THREE);
  assert.equal(scenario.buffer.size, ROUND_ONE);
}

async function restartOldGame(scenario) {
  const queued = scenario.oldRequests.slice(ROUND_ONE);
  const rejections = queued.map(
      (request) => assert.rejects(request.resultPromise, /cancelado/),
  );
  const summary = scenario.manager.handleGameRestart({
    previousGameId: OLD_GAME_ID,
    gameId: NEW_GAME_ID,
  });
  await Promise.all(rejections);
  return summary;
}

function assertRestartSummary(summary) {
  assert.deepEqual(summary, {
    previousGameId: OLD_GAME_ID,
    gameId: NEW_GAME_ID,
    cancelledQueued: ROUND_TWO,
    clearedInFlight: ROUND_THREE,
  });
}

function assertRestartState(scenario) {
  assert.equal(scenario.manager.getCurrentGameId(), NEW_GAME_ID);
  assert.equal(scenario.manager.getInFlightCount(), 0);
  assert.equal(scenario.buffer.size, 0);
  assert.equal(scenario.pool.getQueuedCount(), 0);
  assert.equal(scenario.workers[0].isBusy(), true);
  assert.equal(scenario.workers[0].hasExited(), false);
}

async function completeAndDispatch(worker, completion) {
  worker.complete();
  const result = await completion;
  await Promise.resolve();
  return result;
}

async function completeOldRunning(scenario) {
  const oldResult = await completeAndDispatch(
      scenario.workers[0],
      scenario.oldRequests[0].resultPromise,
  );
  const classification = scenario.manager.handleAudioResult(oldResult);
  assert.equal(classification.accepted, false);
  assert.equal(classification.reason, 'STALE_GAME');
}

async function completeCurrentRequest(scenario, currentRequest) {
  const result = await completeAndDispatch(
      scenario.workers[0],
      currentRequest.resultPromise,
  );
  const classification = scenario.manager.handleAudioResult(result);
  assert.equal(classification.accepted, true);
}

test('C18: RESTART limpia estado viejo y preserva worker RUNNING', async () => {
  const scenario = createScenario();
  assertInitialState(scenario);
  const summary = await restartOldGame(scenario);
  assertRestartSummary(summary);
  assertRestartState(scenario);
  const current = requestRound(scenario.manager, NEW_GAME_ID, ROUND_ONE);
  assert.equal(scenario.pool.getQueuedCount(), ROUND_ONE);
  await completeOldRunning(scenario);
  assert.equal(scenario.workers[0].pending.job.gameId, NEW_GAME_ID);
  await completeCurrentRequest(scenario, current);
  await scenario.pool.terminate();
});
