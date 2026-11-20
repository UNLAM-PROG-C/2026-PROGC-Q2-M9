import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {AudioJob} from '../../server/audio/model/audio-job.js';
import {AudioMode} from '../../server/audio/model/audio-mode.js';
import {AudioResult} from '../../server/audio/model/audio-result.js';
import {AudioWorker} from '../../server/audio/workers/audio-worker.js';

const SAMPLE_RATE_HZ = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = 2;
const NYQUIST_DIVISOR = 2;
const INVALID_CUTOFF_HZ = SAMPLE_RATE_HZ / NYQUIST_DIVISOR;
const UNEXPECTED_EXIT_CODE = 7;
const GAME_ID = 1;
const ROUND_ID = 1;
const PCM_BUFFER_KIND = 'PCM_BUFFER';
const INPUT_SAMPLES = [100, 500, 200, 600, 300, 700];
const FIXTURE_DIRECTORY = fileURLToPath(
    new URL('./fixtures/', import.meta.url),
);
const FATAL_WORKER_SCRIPT = path.join(
    FIXTURE_DIRECTORY,
    'fatal-error-worker.js',
);
const EXIT_WORKER_SCRIPT = path.join(
    FIXTURE_DIRECTORY,
    'unexpected-exit-worker.js',
);
const HANGING_WORKER_SCRIPT = path.join(
    FIXTURE_DIRECTORY,
    'hanging-worker.js',
);
const JOB_IDS = {
  success: 'c10-success',
  invalid: 'c10-invalid',
  beforeError: 'c10-before-error',
  afterError: 'c10-after-error',
  busyFirst: 'c10-busy-first',
  busySecond: 'c10-busy-second',
  fatal: 'c10-fatal',
  afterFatal: 'c10-after-fatal',
  exit: 'c10-exit',
  afterClose: 'c10-after-close',
  terminateBusy: 'c10-terminate-busy',
};

const TEST_CASES = [
  ['worker sano procesa un job', testSuccessfulJob],
  ['error de job no mata el worker', testJobError],
  ['el worker se reutiliza después de un error', testReuseAfterJobError],
  ['el worker ocupado rechaza otro job', testBusyWorker],
  ['error fatal invalida el worker', testFatalWorkerError],
  ['exit inesperado rechaza el job pendiente', testUnexpectedWorkerExit],
  ['terminate cierra el worker limpiamente', testCleanTermination],
  ['terminate rechaza el job activo', testTerminateWithActiveJob],
];

function createPcm() {
  const pcm = Buffer.alloc(INPUT_SAMPLES.length * BYTES_PER_SAMPLE);
  INPUT_SAMPLES.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * BYTES_PER_SAMPLE);
  });
  return pcm;
}

function createSource(options) {
  return {
    kind: PCM_BUFFER_KIND,
    pcm: createPcm(),
    sampleRate: SAMPLE_RATE_HZ,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    options,
  };
}

function createJob({jobId, mode = AudioMode.REVERSE, options = {}}) {
  return new AudioJob({
    jobId,
    gameId: GAME_ID,
    roundId: ROUND_ID,
    mode,
    source: createSource(options),
  });
}

function createInvalidJob(jobId) {
  return createJob({
    jobId,
    mode: AudioMode.LOW_PASS,
    options: {cutoffHz: INVALID_CUTOFF_HZ},
  });
}

function assertSuccessfulResult(result, jobId) {
  assert.ok(result instanceof AudioResult);
  assert.equal(result.jobId, jobId);
  assert.equal(result.ok, true);
  assert.equal(result.resource.kind, PCM_BUFFER_KIND);
}

function assertFailedResult(result, jobId) {
  assert.ok(result instanceof AudioResult);
  assert.equal(result.jobId, jobId);
  assert.equal(result.ok, false);
  assert.equal(result.resource, null);
  assert.ok(result.error.length > 0);
}

function assertWorkerUnavailable(worker, jobId) {
  return assert.rejects(
      worker.run(createJob({jobId})),
      /no está disponible/,
  );
}

async function testSuccessfulJob() {
  const worker = new AudioWorker();
  try {
    const result = await worker.run(createJob({jobId: JOB_IDS.success}));
    assertSuccessfulResult(result, JOB_IDS.success);
    assert.equal(worker.isHealthy(), true);
    assert.equal(worker.isAvailable(), true);
  } finally {
    await worker.terminate();
  }
}

async function testJobError() {
  const worker = new AudioWorker();
  try {
    const result = await worker.run(createInvalidJob(JOB_IDS.invalid));
    assertFailedResult(result, JOB_IDS.invalid);
    assert.equal(worker.isHealthy(), true);
    assert.equal(worker.isAvailable(), true);
  } finally {
    await worker.terminate();
  }
}

async function testReuseAfterJobError() {
  const worker = new AudioWorker();
  try {
    const before = await worker.run(createJob({jobId: JOB_IDS.beforeError}));
    const failed = await worker.run(createInvalidJob(JOB_IDS.invalid));
    const after = await worker.run(createJob({jobId: JOB_IDS.afterError}));
    assertFailedResult(failed, JOB_IDS.invalid);
    assertSuccessfulResult(after, JOB_IDS.afterError);
    assert.equal(before.resource.threadId, after.resource.threadId);
  } finally {
    await worker.terminate();
  }
}

async function testBusyWorker() {
  const worker = new AudioWorker();
  try {
    const firstJob = worker.run(createJob({jobId: JOB_IDS.busyFirst}));
    assert.equal(worker.isAvailable(), false);
    await assert.rejects(
        worker.run(createJob({jobId: JOB_IDS.busySecond})),
        /ocupado/,
    );
    await firstJob;
    assert.equal(worker.isAvailable(), true);
  } finally {
    await worker.terminate();
  }
}

async function testFatalWorkerError() {
  const worker = new AudioWorker({workerScript: FATAL_WORKER_SCRIPT});
  try {
    await assert.rejects(
        worker.run(createJob({jobId: JOB_IDS.fatal})),
        /FATAL_TEST_WORKER/,
    );
    assert.ok(worker.fatalError instanceof Error);
    assert.equal(worker.isHealthy(), false);
    assert.equal(worker.isAvailable(), false);
    await assertWorkerUnavailable(worker, JOB_IDS.afterFatal);
  } finally {
    await worker.terminate();
  }
}

async function testUnexpectedWorkerExit() {
  const worker = new AudioWorker({workerScript: EXIT_WORKER_SCRIPT});
  const exitError = new RegExp(`código ${UNEXPECTED_EXIT_CODE}`);
  try {
    await assert.rejects(
        worker.run(createJob({jobId: JOB_IDS.exit})),
        exitError,
    );
    assert.equal(worker.isHealthy(), false);
    assert.equal(worker.isAvailable(), false);
  } finally {
    await worker.terminate();
  }
}

async function testCleanTermination() {
  const worker = new AudioWorker();
  try {
    assert.equal(worker.isHealthy(), true);
    await worker.terminate();
    assert.equal(worker.hasExited(), true);
    assert.equal(worker.isAvailable(), false);
    await assertWorkerUnavailable(worker, JOB_IDS.afterClose);
  } finally {
    await worker.terminate();
  }
}

async function testTerminateWithActiveJob() {
  const worker = new AudioWorker({workerScript: HANGING_WORKER_SCRIPT});
  const pendingJob = worker.run(createJob({jobId: JOB_IDS.terminateBusy}));
  const rejection = assert.rejects(pendingJob, /terminado/);
  try {
    await worker.terminate();
    await rejection;
    assert.equal(worker.hasExited(), true);
  } finally {
    await worker.terminate();
  }
}

test('C10: AudioWorker maneja fallos y terminación', async (context) => {
  for (const [name, run] of TEST_CASES) {
    await context.test(name, run);
  }
});
