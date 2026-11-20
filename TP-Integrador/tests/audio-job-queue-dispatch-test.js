import assert from 'node:assert/strict';

import {
  AudioWorkerPool,
  DEFAULT_POOL_SIZE,
} from '../server/audio/audio-worker-pool.js';
import {ControlledWorker} from './helpers/controlled-audio-worker.js';

const TOTAL_JOBS = 6;
const DEFAULT_GAME_ID = 1;

function createPoolHarness(size = DEFAULT_POOL_SIZE) {
  const workers = [];
  const starts = [];
  const createWorker = () => {
    const worker = new ControlledWorker(workers.length + 1, {
      dispatchLog: starts,
    });
    workers.push(worker);
    return worker;
  };
  return {pool: new AudioWorkerPool({size, createWorker}), workers, starts};
}

function createJob(index, gameId = DEFAULT_GAME_ID) {
  return {
    jobId: `job-${index}`,
    gameId,
  };
}

function createJobs(count = TOTAL_JOBS) {
  return Array.from(
      {length: count},
      (_, index) => createJob(index + 1),
  );
}

async function completeAndDispatch(worker, completion) {
  worker.complete();
  await completion;
  await Promise.resolve();
}

function prepareFifoScenario() {
  const harness = createPoolHarness();
  const jobs = createJobs();
  const pending = jobs.map((job) => harness.pool.submit(job));
  return {...harness, jobs, pending};
}

function assertInitialFifoState(scenario) {
  assert.equal(scenario.pool.getActiveCount(), DEFAULT_POOL_SIZE);
  assert.equal(scenario.pool.getQueuedCount(), DEFAULT_POOL_SIZE);
  assert.deepEqual(
      scenario.starts.map((start) => start.jobId),
      ['job-1', 'job-2', 'job-3'],
  );
}

async function dispatchQueuedJobs(scenario) {
  const {workers, pending} = scenario;
  await completeAndDispatch(workers[1], pending[1]);
  await completeAndDispatch(workers[0], pending[0]);
  await completeAndDispatch(workers[2], pending[2]);
}

function assertFifoDispatch(scenario) {
  assert.equal(scenario.pool.getQueuedCount(), 0);
  assert.equal(scenario.pool.getActiveCount(), DEFAULT_POOL_SIZE);
  assert.deepEqual(
      scenario.starts.map((start) => start.jobId),
      ['job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6'],
  );
}

async function finishFifoScenario(scenario) {
  scenario.workers.forEach((worker) => worker.complete());
  const results = await Promise.all(scenario.pending);
  assert.deepEqual(
      results.map((result) => result.jobId),
      createJobs().map((job) => job.jobId),
  );
  await scenario.pool.terminate();
}

async function testFifoDispatch() {
  const scenario = prepareFifoScenario();
  assertInitialFifoState(scenario);
  await dispatchQueuedJobs(scenario);
  assertFifoDispatch(scenario);
  await finishFifoScenario(scenario);
}

function prepareCancellationScenario() {
  const harness = createPoolHarness(1);
  const jobs = [
    createJob(1, 1),
    createJob(2, 1),
    createJob(3, 2),
    createJob(4, 1),
  ];
  const pending = jobs.map((job) => harness.pool.submit(job));
  return {...harness, pending};
}

async function assertQueuedCancellation(scenario) {
  const rejection2 = assert.rejects(scenario.pending[1], /cancelado/);
  const rejection4 = assert.rejects(scenario.pending[3], /cancelado/);
  const cancelled = scenario.pool.cancelQueuedByGameId(1);
  assert.equal(cancelled, 2);
  await Promise.all([rejection2, rejection4]);
  assert.equal(scenario.pool.getQueuedCount(), 1);
}

async function finishCancellationScenario(scenario) {
  await completeAndDispatch(scenario.workers[0], scenario.pending[0]);
  assert.equal(scenario.starts.at(-1).jobId, 'job-3');
  scenario.workers[0].complete();
  const result = await scenario.pending[2];
  assert.equal(result.jobId, 'job-3');
  await scenario.pool.terminate();
}

async function testCancelQueuedByGameId() {
  const scenario = prepareCancellationScenario();
  assert.equal(scenario.pool.getQueuedCount(), 3);
  await assertQueuedCancellation(scenario);
  await finishCancellationScenario(scenario);
}

async function main() {
  await testFifoDispatch();
  await testCancelQueuedByGameId();
  console.log(
      '[C12] PASS: cola FIFO despacha jobs y cancela pendientes por gameId.',
  );
}

main().catch((error) => {
  console.error('[C12] FAIL:', error);
  process.exitCode = 1;
});
