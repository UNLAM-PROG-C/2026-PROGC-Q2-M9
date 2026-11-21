import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  AudioPreparationManager,
} from '../server/audio/audio-preparation-manager.js';
import {AudioWorkerPool} from '../server/audio/audio-worker-pool.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';
import {RoundAudioResolver} from '../server/audio/round-audio-resolver.js';
import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {AudioWorker} from '../server/audio/workers/audio-worker.js';
import {SessionCoordinator} from '../game/session-coordinator.js';
import {SessionState} from '../game/session-state.js';

const SAMPLE_RATE_HZ = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const INVALID_CUTOFF_HZ = SAMPLE_RATE_HZ / 2;
const TIMEOUT_MS = 5000;
const FIXTURE_DIRECTORY = fileURLToPath(
    new URL('./audio-worker/fixtures/', import.meta.url),
);
const FATAL_WORKER_SCRIPT = path.join(
    FIXTURE_DIRECTORY,
    'fatal-error-worker.js',
);
const IDLE_EXIT_WORKER_SCRIPT = path.join(
    FIXTURE_DIRECTORY,
    'idle-exit-worker.js',
);

function withTimeout(promise, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
        () => reject(new Error(`TIMEOUT: ${label}`)),
        TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(
      () => clearTimeout(timeoutId),
  );
}

function createSource(options = {}) {
  return {
    kind: 'PCM_BUFFER',
    pcm: Buffer.from([100, 0, 200, 0, 300, 0, 400, 0]),
    sampleRate: SAMPLE_RATE_HZ,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    options,
  };
}

function createJob(jobId, roundId = 1) {
  return new AudioJob({
    jobId, gameId: 1, roundId, mode: AudioMode.NORMAL, source: createSource(),
  });
}

function createSong(roundId) {
  return {
    title: `Canción ${roundId}`,
    preview: `https://example.invalid/${roundId}.mp3`,
  };
}

function createHarness(pool) {
  const buffer = new PreparedRoundBuffer();
  const manager = new AudioPreparationManager({
    workerPool: pool,
    preparedRoundBuffer: buffer,
  });
  return {pool, buffer, manager};
}

function prepareRound(manager, roundId, mode, source) {
  return manager.requestPreparation({
    gameId: 1, roundId, mode, source, song: createSong(roundId),
  });
}

async function prepareAndWait(manager, roundId, mode, source, label) {
  const request = prepareRound(manager, roundId, mode, source);
  return withTimeout(request.resultPromise, label);
}

function resolveActiveFallback(buffer) {
  const session = new SessionCoordinator();
  session.transitionTo(SessionState.ROUND_ACTIVE);
  const fallback = new RoundAudioResolver({
    preparedRoundBuffer: buffer,
  }).resolve({gameId: 1, roundId: 2, playlistSong: createSong(2)});
  assert.equal(fallback.mode, AudioMode.NORMAL);
  assert.equal(fallback.prepared, false);
  assert.equal(session.getState(), SessionState.ROUND_ACTIVE);
  return fallback;
}

async function runJobErrorScenario(harness) {
  const {manager, buffer} = harness;
  const before = await prepareAndWait(
      manager, 1, AudioMode.NORMAL, createSource(), 'job previo al error');
  const failed = await prepareAndWait(
      manager, 2, AudioMode.LOW_PASS,
      createSource({cutoffHz: INVALID_CUTOFF_HZ}), 'job con error controlado');
  const fallback = resolveActiveFallback(buffer);
  const after = await prepareAndWait(
      manager, 3, AudioMode.NORMAL, createSource(), 'job posterior al error');
  assertJobErrorResults(harness, before, failed, fallback, after);
}

function assertJobErrorResults({pool, manager, buffer}, before, failed,
    fallback, after) {
  assert.equal(before.ok, true);
  assert.equal(failed.ok, false);
  assert.equal(fallback.resource, createSong(2).preview);
  assert.equal(after.ok, true);
  assert.equal(before.resource.threadId, after.resource.threadId);
  assert.equal(manager.isInFlight(1, 2), false);
  assert.equal(buffer.has(1, 2), false);
  assert.equal(buffer.has(1, 3), true);
  assert.equal(pool.getSize(), 1);
  assert.equal(pool.getAvailableCount(), 1);
}

async function testJobError() {
  const pool = new AudioWorkerPool({size: 1});
  try {
    await runJobErrorScenario(createHarness(pool));
  } finally {
    await pool.terminate();
  }
}

function createFatalPool(workers) {
  const createWorker = () => {
    const worker = new AudioWorker({
      ...(workers.length === 0 ? {workerScript: FATAL_WORKER_SCRIPT} : {}),
    });
    workers.push(worker);
    return worker;
  };
  return new AudioWorkerPool({size: 3, createWorker});
}

function waitForWorkerExit(worker) {
  const exit = new Promise((resolve) => worker.onExit(resolve));
  return withTimeout(exit, 'salida del worker');
}

async function submitFatalWave({pool, manager}) {
  const fatal = prepareRound(manager, 2, AudioMode.NORMAL, createSource());
  const activeOne = pool.submit(createJob('c25-active-1', 2));
  const activeTwo = pool.submit(createJob('c25-active-2', 3));
  const queued = pool.submit(createJob('c25-queued', 4));
  return withTimeout(
      Promise.allSettled([fatal.resultPromise, activeOne, activeTwo, queued]),
      'job fatal, jobs activos y job en cola',
  );
}

function assertFatalOutcomes(harness, workers, outcomes) {
  assert.equal(outcomes[0].status, 'rejected');
  assert.match(outcomes[0].reason.message, /FATAL_TEST_WORKER/);
  assert.equal(workers[0].isHealthy(), false);
  assert.equal(harness.manager.isInFlight(1, 2), false);
  assert.equal(harness.buffer.has(1, 2), false);
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.equal(outcomes[2].status, 'fulfilled');
  assert.equal(outcomes[3].status, 'fulfilled');
  assert.equal(outcomes[3].value.jobId, 'c25-queued');
  assertRecoveredPool(harness.pool, workers);
}

function assertRecoveredPool(pool, workers) {
  assert.equal(workers.length, 4);
  assert.equal(pool.getSize(), 3);
  assert.equal(pool.getAvailableCount(), 3);
  assert.equal(pool.getQueuedCount(), 0);
}

async function assertNextWave(pool, workers) {
  const nextWave = await withTimeout(
      Promise.all([
        pool.submit(createJob('c25-next-1', 3)),
        pool.submit(createJob('c25-next-2', 4)),
        pool.submit(createJob('c25-next-3', 5)),
      ]),
      'tres jobs tras recuperar el pool',
  );
  assert.equal(new Set(nextWave.map((result) => result.resource.threadId)).size,
      3);
  assert.equal(workers.length, 4);
}

async function testFatalWorker() {
  const workers = [];
  const pool = createFatalPool(workers);
  const harness = createHarness(pool);
  try {
    const exited = waitForWorkerExit(workers[0]);
    const [outcomes] = await Promise.all([submitFatalWave(harness), exited]);
    assertFatalOutcomes(harness, workers, outcomes);
    resolveActiveFallback(harness.buffer);
    await assertNextWave(pool, workers);
  } finally {
    await pool.terminate();
  }
}

function createIdleExitPool(workers, failReplacement = false) {
  const createWorker = () => {
    if (failReplacement && workers.length > 0) {
      throw new Error('REPLACEMENT_TEST_FAILURE');
    }
    const worker = new AudioWorker({
      ...(workers.length === 0 ? {workerScript: IDLE_EXIT_WORKER_SCRIPT} : {}),
    });
    workers.push(worker);
    return worker;
  };
  return new AudioWorkerPool({size: 1, createWorker});
}

async function testIdleWorkerExit() {
  const workers = [];
  const pool = createIdleExitPool(workers);
  try {
    await waitForWorkerExit(workers[0]);
    assert.equal(workers.length, 2);
    assert.equal(pool.getAvailableCount(), 1);
    const result = await withTimeout(pool.submit(createJob('idle-replacement')),
        'job en worker de reemplazo');
    assert.equal(result.ok, true);
  } finally {
    await pool.terminate();
  }
}

async function testShutdownWithoutReplacement() {
  const workers = [];
  const pool = createFatalPool(workers);
  await withTimeout(pool.terminate(), 'cierre del pool');
  assert.equal(workers.length, 3);
  await assert.rejects(pool.submit(createJob('after-close')), /cerrado/);
}

async function assertReplacementFailure(pool, worker) {
  const outcomes = Promise.allSettled([
    pool.submit(createJob('running')), pool.submit(createJob('queued')),
  ]);
  await waitForWorkerExit(worker);
  const [, queued] = await withTimeout(outcomes, 'jobs tras fallo');
  assert.equal(queued.status, 'rejected');
  assert.match(queued.reason.message, /REPLACEMENT_TEST_FAILURE/);
  await assert.rejects(pool.submit(createJob('after-failed-replacement')),
      /REPLACEMENT_TEST_FAILURE/);
}

function captureReplacementError(context) {
  const originalError = console.error;
  return context.mock.method(console, 'error', (message, ...args) => {
    if (message !== '[AUDIO_WORKER_REPLACEMENT_ERROR]') {
      originalError(message, ...args);
    }
  });
}

function assertReplacementErrorLogged(log) {
  const calls = log.mock.calls.filter(
      (call) => call.arguments[0] === '[AUDIO_WORKER_REPLACEMENT_ERROR]',
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].arguments[1].message, /REPLACEMENT_TEST_FAILURE/);
}

async function testReplacementFailure(context) {
  const workers = [];
  const log = captureReplacementError(context);
  const pool = createIdleExitPool(workers, true);
  try {
    await assertReplacementFailure(pool, workers[0]);
    assertReplacementErrorLogged(log);
  } finally {
    await pool.terminate();
  }
}

class DeferredPool {
  constructor() {
    this.jobs = [];
    this.pending = new Map();
  }

  submit(job) {
    this.jobs.push(job);
    return new Promise((resolve) => {
      this.pending.set(job.jobId, {job, resolve});
    });
  }

  resolveJob(jobId) {
    const {job, resolve} = this.pending.get(jobId);
    resolve(new AudioResult({
      jobId: job.jobId,
      gameId: job.gameId,
      roundId: job.roundId,
      mode: job.mode,
      ok: true,
      resource: {jobId: job.jobId},
    }));
  }
}

async function flushResultHandling() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createWindowParams() {
  const playlist = Array.from({length: 5}, (_, index) =>
    createSong(index + 1));
  return {
    gameId: 1,
    currentRoundId: 1,
    currentSongIndex: 0,
    playlist,
    maxRounds: playlist.length,
  };
}

async function assertMixedBackpressure(harness, params) {
  const {pool, buffer, manager} = harness;
  manager.maintainPrefetchWindow(params);
  pool.resolveJob(pool.jobs[0].jobId);
  pool.resolveJob(pool.jobs[1].jobId);
  await flushResultHandling();
  assert.equal(buffer.size, 2);
  assert.equal(manager.getInFlightCount(), 1);
  assert.deepEqual(manager.maintainPrefetchWindow(params).scheduled, []);
  assert.equal(pool.jobs.length, 3);
}

async function assertCapacityReleased(harness, params) {
  const {pool, buffer, manager} = harness;
  pool.resolveJob(pool.jobs[2].jobId);
  await flushResultHandling();
  assert.equal(buffer.size, 3);
  assert.equal(buffer.consume(1, 2).roundId, 2);
  const nextWindow = manager.maintainPrefetchWindow({
    ...params, currentRoundId: 2, currentSongIndex: 1,
  });
  assert.deepEqual(nextWindow.scheduled, [5]);
  assert.equal(pool.jobs.length, 4);
}

async function testBackpressure() {
  const harness = createHarness(new DeferredPool());
  const params = createWindowParams();
  await assertMixedBackpressure(harness, params);
  await assertCapacityReleased(harness, params);
}

function addOtherPreparedRounds(buffer) {
  buffer.tryAdd(new PreparedRound({
    gameId: 3, roundId: 3, mode: AudioMode.REVERSE,
    song: createSong(3), resource: 'prepared://game-3-round-3',
  }));
  buffer.tryAdd(new PreparedRound({
    gameId: 2, roundId: 2, mode: AudioMode.REVERSE,
    song: createSong(2), resource: 'prepared://game-2-round-2',
  }));
}

function resolveMissingRound(buffer, logs) {
  const resolver = new RoundAudioResolver({
    preparedRoundBuffer: buffer,
    log: (message) => logs.push(message),
  });
  return resolver.resolve({gameId: 3, roundId: 2, playlistSong: createSong(2)});
}

function assertMissingRound(result, buffer, logs, session) {
  assert.equal(result.mode, AudioMode.NORMAL);
  assert.equal(result.resource, 'https://example.invalid/2.mp3');
  assert.equal(result.prepared, false);
  assert.equal(result.source, 'FALLBACK_ORIGINAL');
  assert.equal(session.getState(), SessionState.ROUND_ACTIVE);
  assert.equal(buffer.has(3, 3), true);
  assert.equal(buffer.has(2, 2), true);
  assert.match(logs[0], /AUDIO_FALLBACK.*reason=PREPARED_NOT_READY/);
}

function testFallback() {
  const logs = [];
  const buffer = new PreparedRoundBuffer();
  const session = new SessionCoordinator();
  addOtherPreparedRounds(buffer);
  session.transitionTo(SessionState.ROUND_ACTIVE);
  const result = resolveMissingRound(buffer, logs);
  assertMissingRound(result, buffer, logs, session);
}

test('C25-F1: error de job no mata el worker ni publica la ronda fallida',
    {timeout: TIMEOUT_MS * 2}, testJobError);
test('C25-F2: worker fatal rechaza solo su job y recupera capacidad',
    {timeout: TIMEOUT_MS * 2}, testFatalWorker);
test('C25-F2: reemplaza worker que sale estando inactivo',
    {timeout: TIMEOUT_MS * 2}, testIdleWorkerExit);
test('C25-F2: cierre del pool no crea reemplazos',
    {timeout: TIMEOUT_MS * 2}, testShutdownWithoutReplacement);
test('C25-F2: error creando reemplazo se informa',
    {timeout: TIMEOUT_MS * 2}, testReplacementFailure);
test('C25-F3: READY + IN_FLIGHT limita producción y consumo libera capacidad',
    {timeout: TIMEOUT_MS}, testBackpressure);
test('C25-F4: fallback NORMAL conserva ROUND_ACTIVE sin preparación',
    {timeout: TIMEOUT_MS}, testFallback);
