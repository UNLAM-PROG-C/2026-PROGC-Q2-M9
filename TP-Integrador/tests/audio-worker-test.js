/**
 * @fileoverview Prueba automatizada aislada para AudioWorker (V4-C09).
 * Verifica ejecución en un worker_thread real, correlación de AudioResult,
 * transformación PCM, reutilización del hilo y errores controlados.
 */

import assert from 'assert';
import {
  isMainThread,
  threadId as mainThreadId,
} from 'node:worker_threads';

import {AudioWorker} from '../server/audio/workers/audio-worker.js';
import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = 2;
const LOW_PASS_CUTOFF_HZ = 1200;
const INVALID_CUTOFF_HZ = 99999;
const PRIMARY_GAME_ID = 1;
const BUSY_GAME_ID = 2;
const PCM_BUFFER_KIND = 'PCM_BUFFER';

const INPUT_SAMPLES = [
  100, 500,
  200, 600,
  300, 700,
];

const REVERSED_SAMPLES = [
  300, 700,
  200, 600,
  100, 500,
];

function createPcm(samples) {
  const pcm = Buffer.alloc(samples.length * BYTES_PER_SAMPLE);
  samples.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * BYTES_PER_SAMPLE);
  });
  return pcm;
}

function createStereoPcm() {
  return createPcm(INPUT_SAMPLES);
}

function createExpectedReversePcm() {
  return createPcm(REVERSED_SAMPLES);
}

function createSource(options = {}) {
  return {
    kind: PCM_BUFFER_KIND,
    pcm: createStereoPcm(),
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    options,
  };
}

function createJob({jobId, gameId, roundId, mode, source}) {
  return new AudioJob({
    jobId,
    gameId,
    roundId,
    mode,
    source,
  });
}

function assertSuccessfulResult(result, job) {
  assert.ok(result instanceof AudioResult);
  assert.strictEqual(result.jobId, job.jobId);
  assert.strictEqual(result.gameId, job.gameId);
  assert.strictEqual(result.roundId, job.roundId);
  assert.strictEqual(result.mode, job.mode);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.error, null);
}

function assertReverseResource(result) {
  assert.strictEqual(result.resource.kind, PCM_BUFFER_KIND);
  assert.strictEqual(Buffer.isBuffer(result.resource.pcm), true);
  assert.deepStrictEqual(
      result.resource.pcm,
      createExpectedReversePcm(),
  );
}

function createReverseJob() {
  return createJob({
    jobId: 'c09-job-1',
    gameId: PRIMARY_GAME_ID,
    roundId: 1,
    mode: AudioMode.REVERSE,
    source: createSource(),
  });
}

async function testReverseJob(worker) {
  const job = createReverseJob();
  const resultPromise = worker.run(job);
  assert.strictEqual(worker.isBusy(), true);
  const result = await resultPromise;
  assert.strictEqual(worker.isBusy(), false);
  assertSuccessfulResult(result, job);
  assertReverseResource(result);
  return result.resource.threadId;
}

async function testPersistentWorker(worker, workerThreadId) {
  const job = createJob({
    jobId: 'c09-job-2',
    gameId: PRIMARY_GAME_ID,
    roundId: 2,
    mode: AudioMode.LOW_PASS,
    source: createSource({cutoffHz: LOW_PASS_CUTOFF_HZ}),
  });
  const result = await worker.run(job);
  assertSuccessfulResult(result, job);
  assert.strictEqual(result.resource.threadId, workerThreadId);
}

async function testControlledError(worker) {
  const job = createJob({
    jobId: 'c09-job-error',
    gameId: PRIMARY_GAME_ID,
    roundId: 3,
    mode: AudioMode.LOW_PASS,
    source: createSource({cutoffHz: INVALID_CUTOFF_HZ}),
  });
  const result = await worker.run(job);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.resource, null);
  assert.strictEqual(result.jobId, job.jobId);
  assert.ok(typeof result.error === 'string' && result.error);
  assert.strictEqual(worker.hasExited(), false);
}

function createBusyJob(jobId) {
  return createJob({
    jobId,
    gameId: BUSY_GAME_ID,
    roundId: 1,
    mode: AudioMode.NORMAL,
    source: createSource(),
  });
}

async function testBusyWorker(worker) {
  const jobA = createBusyJob('c09-busy-a');
  const jobB = createBusyJob('c09-busy-b');
  const pendingA = worker.run(jobA);
  await assert.rejects(() => worker.run(jobB), /ocupado/);
  const completedA = await pendingA;
  assert.strictEqual(completedA.jobId, jobA.jobId);
}

function createAfterExitJob() {
  return createJob({
    jobId: 'c09-after-exit',
    gameId: BUSY_GAME_ID,
    roundId: 2,
    mode: AudioMode.NORMAL,
    source: createSource(),
  });
}

async function assertRejectsAfterExit(worker) {
  await assert.rejects(
      () => worker.run(createAfterExitJob()),
      /terminó/,
  );
}

async function runWorkerTests(worker) {
  const workerThreadId = await testReverseJob(worker);
  assert.notStrictEqual(workerThreadId, mainThreadId);
  await testPersistentWorker(worker, workerThreadId);
  await testControlledError(worker);
  await testBusyWorker(worker);
  return workerThreadId;
}

async function main() {
  assert.strictEqual(isMainThread, true);
  const worker = new AudioWorker();
  let workerThreadId;

  try {
    workerThreadId = await runWorkerTests(worker);
  } finally {
    await worker.terminate();
  }

  assert.strictEqual(worker.hasExited(), true);
  await assertRejectsAfterExit(worker);
  printSuccess(workerThreadId);
}

function printSuccess(workerThreadId) {
  console.log(`[C09] Main threadId: ${mainThreadId}`);
  console.log(`[C09] Worker threadId: ${workerThreadId}`);
  console.log('[C09] PASS: AudioJob procesado en worker_thread real.');
}

main().catch((error) => {
  console.error('[C09] FAIL:', error);
  process.exitCode = 1;
});
