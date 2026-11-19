/**
 * @fileoverview Prueba concurrente de pool, cola y buffer (V4-C24).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioWorkerPool} from '../../server/audio/audio-worker-pool.js';
import {PreparedRoundBuffer} from '../../server/audio/prepared-round-buffer.js';
import {AudioMode} from '../../server/audio/model/audio-mode.js';
import {DeterministicCpuWorker} from './concurrency-harness.js';

function buildScenarioJobs() {
  // Job 1 tarda más (90ms) para que Job 2 (20ms) cierre antes.
  const specs = [
    {roundId: 1, mode: AudioMode.NORMAL, delayMs: 90, cpuIterations: 80000},
    {roundId: 2, mode: AudioMode.REVERSE, delayMs: 20, cpuIterations: 20000},
    {roundId: 3, mode: AudioMode.LOW_PASS, delayMs: 50, cpuIterations: 40000},
    {roundId: 4, mode: AudioMode.NORMAL, delayMs: 30, cpuIterations: 30000},
    {roundId: 5, mode: AudioMode.REVERSE, delayMs: 15, cpuIterations: 15000},
    {roundId: 6, mode: AudioMode.LOW_PASS, delayMs: 25, cpuIterations: 25000},
  ];
  return specs.map((spec, idx) => ({
    jobId: `c24-job-${idx + 1}`,
    gameId: 1,
    roundId: spec.roundId,
    mode: spec.mode,
    source: {delayMs: spec.delayMs, cpuIterations: spec.cpuIterations},
  }));
}

function createTracker(dispatchOrder, completionOrder, logs, state) {
  return {
    onStart(threadId, job, startMs) {
      state.activeWorkers += 1;
      state.peakActive = Math.max(state.peakActive, state.activeWorkers);
      dispatchOrder.push(job.jobId);
      logs.push(
          `[START] t=${startMs} tid=${threadId} ` +
          `job=${job.jobId} round=${job.roundId} active=${state.activeWorkers}`,
      );
    },
    onFinish(threadId, job, startMs, endMs) {
      state.activeWorkers -= 1;
      completionOrder.push(job.jobId);
      logs.push(
          `[END]   t=${endMs} (+${endMs - startMs}ms) ` +
          `tid=${threadId} job=${job.jobId} round=${job.roundId}`,
      );
    },
  };
}

function storeInBoundedBuffer(buffer, res, state) {
  if (buffer.isFull()) {
    const oldestRoundId = Math.min(
        ...[...buffer.rounds.values()].map((r) => r.roundId),
    );
    buffer.consume(1, oldestRoundId);
  }
  const addRes = buffer.tryAdd({
    gameId: res.gameId,
    roundId: res.roundId,
    mode: res.mode,
    song: {
      title: `Song ${res.roundId}`,
      preview: `http://local/r${res.roundId}.mp3`,
    },
    resource: res.resource,
  });
  assert.equal(addRes.accepted, true);
  state.maxBufferSize = Math.max(state.maxBufferSize, buffer.size);
  assert.ok(buffer.size <= 3, `Buffer excedió 3: ${buffer.size}`);
}

test('V4-C24: concurrencia de pool, cola FIFO y buffer acotado', async () => {
  const poolSize = 3;
  const buffer = new PreparedRoundBuffer({capacity: 3});
  const dispatchOrder = [];
  const completionOrder = [];
  const logs = [];
  const state = {activeWorkers: 0, peakActive: 0, maxBufferSize: 0};
  let nextThreadId = 1;
  const tracker = createTracker(dispatchOrder, completionOrder, logs, state);
  const pool = new AudioWorkerPool({
    size: poolSize,
    createWorker: () => new DeterministicCpuWorker(nextThreadId++, tracker),
  });
  const jobs = buildScenarioJobs();
  const results = await Promise.all(
      jobs.map(async (job) => {
        const res = await pool.submit(job);
        storeInBoundedBuffer(buffer, res, state);
        return res;
      }),
  );
  await pool.terminate();

  console.log('\n=== EVIDENCIA V4-C24 ===');
  logs.forEach((line) => console.log(line));
  console.log(`peakActive=${state.peakActive}, max=${state.maxBufferSize}`);
  console.log(`dispatch=${dispatchOrder.join(' -> ')}`);
  console.log(`completion=${completionOrder.join(' -> ')}\n`);

  assert.equal(results.length, jobs.length);
  assert.ok(state.peakActive >= 2 && state.peakActive <= poolSize);
  assert.deepEqual(dispatchOrder, jobs.map((j) => j.jobId));
  assert.notDeepEqual(completionOrder, dispatchOrder);
  const usedThreads = new Set(results.map((r) => r.threadId));
  assert.ok(usedThreads.size <= poolSize && results.length > usedThreads.size);
  assert.ok(state.maxBufferSize <= 3);
  for (let i = 0; i < jobs.length; i += 1) {
    assert.equal(results[i].jobId, jobs[i].jobId);
    assert.equal(results[i].roundId, jobs[i].roundId);
  }
});
