import assert from 'node:assert/strict';
import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';

import {
  AudioWorkerPool,
  DEFAULT_POOL_SIZE,
} from '../server/audio/audio-worker-pool.js';

const TOTAL_JOBS = 6;
const BYTES_PER_SAMPLE = 2;
const PCM_BUFFER_KIND = 'PCM_BUFFER';
const INPUT_SAMPLES = [100, 500, 200, 600, 300, 700];

class ControlledWorker {
  constructor(id) {
    this.id = id;
    this.busy = false;
    this.exited = false;
    this.pending = null;
    this.runCount = 0;
  }

  isBusy() {
    return this.busy;
  }

  hasExited() {
    return this.exited;
  }

  run(job) {
    this.busy = true;
    this.runCount += 1;
    return new Promise((resolve) => {
      this.pending = {job, resolve};
    });
  }

  complete() {
    const {job, resolve} = this.pending;
    this.busy = false;
    this.pending = null;
    resolve({jobId: job.jobId, workerId: this.id});
  }

  async terminate() {
    this.exited = true;
    this.busy = false;
  }
}

function createPoolHarness() {
  const workers = [];
  const createWorker = () => {
    const worker = new ControlledWorker(workers.length + 1);
    workers.push(worker);
    return worker;
  };
  return {
    pool: new AudioWorkerPool({createWorker}),
    workers,
  };
}

function createJobs(count = TOTAL_JOBS) {
  return Array.from(
      {length: count},
      (_, index) => ({jobId: `job-${index + 1}`}),
  );
}

function completeBusyWorkers(workers) {
  workers
      .filter((worker) => worker.isBusy())
      .forEach((worker) => worker.complete());
}

async function runWave(pool, workers, jobs) {
  const promises = jobs.map((job) => pool.submit(job));
  assert.equal(pool.getActiveCount(), DEFAULT_POOL_SIZE);
  completeBusyWorkers(workers);
  return Promise.all(promises);
}

function assertWorkersReused(workers) {
  assert.equal(workers.length, DEFAULT_POOL_SIZE);
  for (const worker of workers) {
    assert.equal(worker.runCount, 2);
  }
}

async function testSixJobsWithThreeWorkers() {
  const {pool, workers} = createPoolHarness();
  const jobs = createJobs();
  const first = await runWave(pool, workers, jobs.slice(0, DEFAULT_POOL_SIZE));
  const second = await runWave(pool, workers, jobs.slice(DEFAULT_POOL_SIZE));
  assert.equal(first.length + second.length, TOTAL_JOBS);
  assertWorkersReused(workers);
  await pool.terminate();
}

async function testTerminatePool() {
  const {pool, workers} = createPoolHarness();
  await pool.terminate();
  assert.equal(workers.every((worker) => worker.hasExited()), true);
  assert.equal(pool.getAvailableCount(), 0);
}

function createPcm() {
  const pcm = Buffer.alloc(INPUT_SAMPLES.length * BYTES_PER_SAMPLE);
  INPUT_SAMPLES.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * BYTES_PER_SAMPLE);
  });
  return pcm;
}

function createRealJob(index) {
  return new AudioJob({
    jobId: `c11-real-${index}`,
    gameId: 1,
    roundId: index,
    mode: AudioMode.NORMAL,
    source: {
      kind: PCM_BUFFER_KIND,
      pcm: createPcm(),
    },
  });
}

async function runRealWave(pool, startIndex) {
  const jobs = Array.from(
      {length: DEFAULT_POOL_SIZE},
      (_, offset) => createRealJob(startIndex + offset),
  );
  return Promise.all(jobs.map((job) => pool.submit(job)));
}

function getThreadIds(results) {
  return results.map((result) => result.resource.threadId);
}

function assertSameWorkers(firstIds, secondIds) {
  assert.equal(new Set(firstIds).size, DEFAULT_POOL_SIZE);
  assert.deepEqual(
      [...new Set(secondIds)].sort(),
      [...new Set(firstIds)].sort(),
  );
}

async function testRealWorkerReuse() {
  const pool = new AudioWorkerPool();
  try {
    const first = await runRealWave(pool, 1);
    const second = await runRealWave(pool, 4);
    assertSameWorkers(getThreadIds(first), getThreadIds(second));
  } finally {
    await pool.terminate();
  }
}

async function main() {
  await testSixJobsWithThreeWorkers();
  await testTerminatePool();
  await testRealWorkerReuse();
  console.log(
      '[C11] PASS: pool=3 limita concurrencia y reutiliza workers persistentes',
  );
}

main().catch((error) => {
  console.error('[C11] FAIL:', error);
  process.exitCode = 1;
});
