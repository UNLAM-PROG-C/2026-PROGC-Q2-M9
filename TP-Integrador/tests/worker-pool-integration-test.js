import assert from 'node:assert/strict';
import test from 'node:test';

import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {AudioWorkerPool} from '../server/audio/audio-worker-pool.js';
import {ControlledWorker} from './helpers/controlled-audio-worker.js';

const POOL_SIZE = 3;
const TOTAL_JOBS = 6;
const GAME_ID = 10;
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = 2;
const PCM_BUFFER_KIND = 'PCM_BUFFER';
const INPUT_SAMPLES = [100, 500, 200, 600, 300, 700];
const REVERSED_SAMPLES = [300, 700, 200, 600, 100, 500];
const JOB_MODES = [
  AudioMode.NORMAL,
  AudioMode.REVERSE,
  AudioMode.LOW_PASS,
  AudioMode.REVERSE,
  AudioMode.NORMAL,
  AudioMode.LOW_PASS,
];

function createPcm(samples = INPUT_SAMPLES) {
  const pcm = Buffer.alloc(samples.length * BYTES_PER_SAMPLE);
  samples.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * BYTES_PER_SAMPLE);
  });
  return pcm;
}

function createSource() {
  return {
    kind: PCM_BUFFER_KIND,
    pcm: createPcm(),
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
  };
}

function createJob(index) {
  return new AudioJob({
    jobId: `c13-job-${index}`,
    gameId: GAME_ID,
    roundId: index,
    mode: JOB_MODES[index - 1],
    source: createSource(),
  });
}

function createJobs() {
  return Array.from({length: TOTAL_JOBS}, (_, index) => createJob(index + 1));
}

function createControlledResult(job, workerId) {
  return new AudioResult({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    ok: true,
    resource: {kind: PCM_BUFFER_KIND, pcm: job.source.pcm, threadId: workerId},
  });
}

function createControlledScenario() {
  const workers = [];
  const dispatchLog = [];
  const completionLog = [];
  const createWorker = () => {
    const worker = new ControlledWorker(
        workers.length + 1,
        {dispatchLog, completionLog, createResult: createControlledResult},
    );
    workers.push(worker);
    return worker;
  };
  const pool = new AudioWorkerPool({size: POOL_SIZE, createWorker});
  const jobs = createJobs();
  const pending = new Map(jobs.map((job) => [job.jobId, pool.submit(job)]));
  return {pool, workers, jobs, pending, dispatchLog, completionLog};
}

function assertInitialControlledState(scenario) {
  assert.equal(scenario.pool.getActiveCount(), POOL_SIZE);
  assert.equal(scenario.pool.getQueuedCount(), POOL_SIZE);
  assert.deepEqual(
      scenario.dispatchLog.map(({jobId}) => jobId),
      ['c13-job-1', 'c13-job-2', 'c13-job-3'],
  );
}

async function completeControlledJob(scenario, jobId) {
  const worker = scenario.workers.find(
      (candidate) => candidate.pending?.job.jobId === jobId,
  );
  assert.ok(worker, `No hay worker procesando ${jobId}.`);
  worker.complete();
  await scenario.pending.get(jobId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(scenario.pool.getActiveCount() <= POOL_SIZE);
}

async function completeFirstWave(scenario) {
  await completeControlledJob(scenario, 'c13-job-2');
  await completeControlledJob(scenario, 'c13-job-1');
  await completeControlledJob(scenario, 'c13-job-3');
}

async function completeQueuedJobs(scenario) {
  await completeControlledJob(scenario, 'c13-job-6');
  await completeControlledJob(scenario, 'c13-job-4');
  await completeControlledJob(scenario, 'c13-job-5');
}

function assertControlledDispatch(scenario) {
  assert.deepEqual(
      scenario.dispatchLog.map(({jobId}) => jobId),
      createJobs().map((job) => job.jobId),
  );
  assert.deepEqual(
      scenario.completionLog.map(({jobId}) => jobId),
      ['c13-job-2', 'c13-job-1', 'c13-job-3',
        'c13-job-6', 'c13-job-4', 'c13-job-5'],
  );
  assert.notDeepEqual(
      scenario.dispatchLog.map(({jobId}) => jobId),
      scenario.completionLog.map(({jobId}) => jobId),
  );
  assert.equal(scenario.pool.getQueuedCount(), 0);
  assert.equal(scenario.pool.getActiveCount(), 0);
  assert.equal(scenario.pool.getAvailableCount(), POOL_SIZE);
}

function assertResultMatchesJob(job, result) {
  assert.ok(result instanceof AudioResult);
  assert.equal(result.gameId, job.gameId);
  assert.equal(result.roundId, job.roundId);
  assert.equal(result.mode, job.mode);
  assert.equal(result.ok, true);
}

function assertResultsMatchJobs(jobs, results) {
  const resultIds = results.map((result) => result.jobId);
  assert.equal(resultIds.length, jobs.length);
  assert.deepEqual(
      [...new Set(resultIds)].sort(),
      jobs.map((job) => job.jobId).sort(),
  );
  for (const result of results) {
    const job = jobs.find((candidate) => candidate.jobId === result.jobId);
    assert.ok(job);
    assertResultMatchesJob(job, result);
  }
}

async function testControlledPoolIntegration() {
  const scenario = createControlledScenario();
  try {
    assertInitialControlledState(scenario);
    await completeFirstWave(scenario);
    await completeQueuedJobs(scenario);
    const results = await Promise.all(scenario.pending.values());
    assertControlledDispatch(scenario);
    assertResultsMatchJobs(scenario.jobs, results);
  } finally {
    await scenario.pool.terminate();
  }
}

function assertRealAudioTransform(results) {
  const reverseResult = results.find(
      (result) => result.mode === AudioMode.REVERSE,
  );
  assert.ok(reverseResult);
  assert.deepEqual(reverseResult.resource.pcm, createPcm(REVERSED_SAMPLES));
}

function assertRealWorkerReuse(results) {
  const threadIds = results.map((result) => result.resource.threadId);
  assert.ok(threadIds.every(Number.isInteger));
  assert.ok(new Set(threadIds).size <= POOL_SIZE);
  assert.ok(new Set(threadIds).size < results.length);
  assertRealAudioTransform(results);
}

async function testRealPoolIntegration() {
  const pool = new AudioWorkerPool({size: POOL_SIZE});
  try {
    const jobs = createJobs();
    const results = await Promise.all(jobs.map((job) => pool.submit(job)));
    assertResultsMatchJobs(jobs, results);
    assertRealWorkerReuse(results);
    assert.equal(pool.getSize(), POOL_SIZE);
    assert.equal(pool.getActiveCount(), 0);
    assert.equal(pool.getQueuedCount(), 0);
    assert.equal(pool.getAvailableCount(), POOL_SIZE);
  } finally {
    await pool.terminate();
  }
}

test(
    'C13: pool limita concurrencia y despacha FIFO con finalizacion variable',
    testControlledPoolIntegration,
);
test(
    'C13: workers reales procesan y reutilizan AudioJobs',
    testRealPoolIntegration,
);
