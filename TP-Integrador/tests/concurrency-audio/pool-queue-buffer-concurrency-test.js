/** @fileoverview Prueba concurrente de pool, cola y buffer (V4-C24). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioWorkerPool} from '../../server/audio/audio-worker-pool.js';
import {PreparedRoundBuffer} from '../../server/audio/prepared-round-buffer.js';
import {AudioMode} from '../../server/audio/model/audio-mode.js';
import {DeterministicCpuWorker} from './concurrency-harness.js';

const POOL_SIZE = 3;
const BUFFER_CAPACITY = 3;
const GAME_ID = 1;
const SPECS = [
  [1, AudioMode.NORMAL, 90, 80000],
  [2, AudioMode.REVERSE, 20, 20000],
  [3, AudioMode.LOW_PASS, 50, 40000],
  [4, AudioMode.NORMAL, 30, 30000],
  [5, AudioMode.REVERSE, 15, 15000],
  [6, AudioMode.LOW_PASS, 25, 25000],
];

function buildScenarioJobs() {
  return SPECS.map(([roundId, mode, delayMs, cpuIterations], index) => ({
    jobId: `c24-job-${index + 1}`, gameId: GAME_ID, roundId, mode,
    source: {delayMs, cpuIterations},
  }));
}

function createTracker(dispatchOrder, completionOrder, logs, state) {
  return {
    onStart: (threadId, job, startMs) =>
      trackStart(dispatchOrder, logs, state, threadId, job, startMs),
    onFinish: (threadId, job, startMs, endMs) =>
      trackFinish(completionOrder, logs, state, threadId, job, startMs, endMs),
  };
}

function trackStart(order, logs, state, threadId, job, startMs) {
  state.activeWorkers += 1;
  state.peakActive = Math.max(state.peakActive, state.activeWorkers);
  order.push(job.jobId);
  logs.push(
      `[START] t=${startMs} tid=${threadId} ` +
      `job=${job.jobId} round=${job.roundId} active=${state.activeWorkers}`,
  );
}

function trackFinish(order, logs, state, threadId, job, startMs, endMs) {
  state.activeWorkers -= 1;
  order.push(job.jobId);
  logs.push(
      `[END]   t=${endMs} (+${endMs - startMs}ms) ` +
      `tid=${threadId} job=${job.jobId} round=${job.roundId}`,
  );
}

function storeInBoundedBuffer(buffer, result, state) {
  if (buffer.isFull()) consumeOldest(buffer);
  const addResult = buffer.tryAdd(buildPreparedRound(result));
  assert.equal(addResult.accepted, true);
  state.maxBufferSize = Math.max(state.maxBufferSize, buffer.size);
  assert.ok(buffer.size <= BUFFER_CAPACITY);
}

function consumeOldest(buffer) {
  const ids = [...buffer.rounds.values()].map((round) => round.roundId);
  buffer.consume(GAME_ID, Math.min(...ids));
}

function buildPreparedRound(result) {
  return {
    gameId: result.gameId, roundId: result.roundId, mode: result.mode,
    song: {title: `Song ${result.roundId}`,
      preview: `http://local/r${result.roundId}.mp3`},
    resource: result.resource,
  };
}

function createScenario() {
  const dispatchOrder = [];
  const completionOrder = [];
  const logs = [];
  const state = {activeWorkers: 0, peakActive: 0, maxBufferSize: 0};
  const tracker = createTracker(dispatchOrder, completionOrder, logs, state);
  return {dispatchOrder, completionOrder, logs, state, tracker};
}

function createPool(tracker) {
  let nextThreadId = 1;
  return new AudioWorkerPool({
    size: POOL_SIZE,
    createWorker: () => new DeterministicCpuWorker(nextThreadId++, tracker),
  });
}

async function runJobs(pool, buffer, jobs, state) {
  return Promise.all(jobs.map(async (job) => {
    const result = await pool.submit(job);
    storeInBoundedBuffer(buffer, result, state);
    return result;
  }));
}

function logEvidence(scenario) {
  console.log('\n=== EVIDENCIA V4-C24 ===');
  scenario.logs.forEach((line) => console.log(line));
  const peak = scenario.state.peakActive;
  console.log(`peakActive=${peak}, max=${BUFFER_CAPACITY}`);
  console.log(`dispatch=${scenario.dispatchOrder.join(' -> ')}`);
  console.log(`completion=${scenario.completionOrder.join(' -> ')}\n`);
}

function assertScenario(scenario, jobs, results) {
  assert.equal(results.length, jobs.length);
  assert.ok(scenario.state.peakActive >= 2 &&
    scenario.state.peakActive <= POOL_SIZE);
  assert.deepEqual(scenario.dispatchOrder, jobs.map((job) => job.jobId));
  assert.notDeepEqual(scenario.completionOrder, scenario.dispatchOrder);
  assertThreadReuse(results);
  assertResultOrder(jobs, results);
}

function assertThreadReuse(results) {
  const usedThreads = new Set(results.map((result) => result.threadId));
  assert.ok(usedThreads.size <= POOL_SIZE && results.length > usedThreads.size);
}

function assertResultOrder(jobs, results) {
  jobs.forEach((job, index) => {
    assert.equal(results[index].jobId, job.jobId);
    assert.equal(results[index].roundId, job.roundId);
  });
}

async function testConcurrentPipeline() {
  const scenario = createScenario();
  const buffer = new PreparedRoundBuffer({capacity: BUFFER_CAPACITY});
  const pool = createPool(scenario.tracker);
  const jobs = buildScenarioJobs();
  const results = await runJobs(pool, buffer, jobs, scenario.state);
  await pool.terminate();
  logEvidence(scenario);
  assertScenario(scenario, jobs, results);
  assert.ok(scenario.state.maxBufferSize <= BUFFER_CAPACITY);
}

test('V4-C24: concurrencia de pool, cola FIFO y buffer acotado',
    testConcurrentPipeline);
