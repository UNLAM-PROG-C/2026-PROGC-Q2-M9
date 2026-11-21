/** @fileoverview Pruebas C14 de AudioPreparationManager. */
import assert from 'assert';
import {AudioPreparationManager} from
  '../server/audio/audio-preparation-manager.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';

class FakeWorkerPool {
  constructor() {
    this.jobs = [];
    this.pending = new Map();
  }

  submit(job) {
    this.jobs.push(job);
    return new Promise((resolve, reject) => {
      this.pending.set(job.jobId, {resolve, reject});
    });
  }

  settle(jobId, action, value) {
    const pending = this.pending.get(jobId);
    assert.ok(pending, `No existe job pendiente ${jobId}.`);
    this.pending.delete(jobId);
    pending[action](value);
  }

  resolve(jobId, result) {
    this.settle(jobId, 'resolve', result);
  }

  reject(jobId, error) {
    this.settle(jobId, 'reject', error);
  }
}

function createSuccessResult(job) {
  return new AudioResult({
    jobId: job.jobId, gameId: job.gameId, roundId: job.roundId,
    mode: job.mode, ok: true, resource: {path: `/audio/${job.jobId}.wav`},
  });
}

function createHarness(options = {}) {
  const workerPool = options.workerPool || new FakeWorkerPool();
  const manager = new AudioPreparationManager({workerPool, ...options});
  return {workerPool, manager};
}

function request(manager, overrides = {}) {
  return manager.requestPreparation({
    gameId: 1, roundId: 1, mode: AudioMode.NORMAL,
    source: {previewUrl: 'https://example.test/a.m4a'}, ...overrides,
  });
}

function testConstructorValidation() {
  assert.throws(
      () => new AudioPreparationManager({workerPool: null}), TypeError,
  );
  assert.throws(() => new AudioPreparationManager({workerPool: {}}), TypeError);
  assert.throws(() => new AudioPreparationManager({
    workerPool: {submit() {}}, createJobId: 'invalid',
  }), TypeError);
}

function assertAcceptedRequest(harness, accepted, source) {
  assert.strictEqual(accepted.accepted, true);
  assert.strictEqual(harness.workerPool.jobs[0], accepted.job);
  assert.strictEqual(accepted.job.jobId, 'job-c14-1');
  assert.strictEqual(accepted.job.gameId, 2);
  assert.strictEqual(accepted.job.roundId, 3);
  assert.strictEqual(accepted.job.mode, AudioMode.REVERSE);
  assert.strictEqual(accepted.job.source, source);
  assert.strictEqual(harness.manager.isInFlight(2, 3), true);
}

async function testAcceptedPreparation() {
  const harness = createHarness({createJobId: () => 'job-c14-1'});
  const source = {previewUrl: 'https://example.test/song.m4a'};
  const accepted = request(harness.manager, {
    gameId: 2, roundId: 3, mode: AudioMode.REVERSE, source,
  });
  assertAcceptedRequest(harness, accepted, source);
  const result = createSuccessResult(accepted.job);
  harness.workerPool.resolve(accepted.job.jobId, result);
  assert.strictEqual(await accepted.resultPromise, result);
  assert.strictEqual(harness.manager.getInFlightCount(), 0);
}

async function testDuplicatePreparationIsRejected() {
  const harness = createHarness();
  const first = request(harness.manager, {roundId: 4});
  const duplicate = request(harness.manager, {
    roundId: 4, mode: AudioMode.LOW_PASS,
  });
  assert.strictEqual(first.accepted, true);
  assert.deepStrictEqual(duplicate, {
    accepted: false, reason: 'ALREADY_IN_FLIGHT',
  });
  assert.strictEqual(harness.workerPool.jobs.length, 1);
  harness.workerPool.resolve(first.job.jobId, createSuccessResult(first.job));
  await first.resultPromise;
}

async function testRoundIdentityIncludesGameId() {
  const harness = createHarness();
  const oldGame = request(harness.manager, {gameId: 5, roundId: 2});
  const newGame = request(harness.manager, {gameId: 6, roundId: 2});
  assert.strictEqual(harness.workerPool.jobs.length, 2);
  assert.strictEqual(harness.manager.getInFlightCount(), 2);
  harness.workerPool.resolve(
      oldGame.job.jobId, createSuccessResult(oldGame.job),
  );
  harness.workerPool.resolve(
      newGame.job.jobId, createSuccessResult(newGame.job),
  );
  await Promise.all([oldGame.resultPromise, newGame.resultPromise]);
  assert.strictEqual(harness.manager.getInFlightCount(), 0);
}

async function testRejectedPromiseClearsInFlight() {
  const harness = createHarness();
  const failed = request(harness.manager, {
    gameId: 3, roundId: 1, mode: AudioMode.LOW_PASS,
  });
  const expectedError = new Error('worker failure');
  harness.workerPool.reject(failed.job.jobId, expectedError);
  await assert.rejects(
      failed.resultPromise, (error) => error === expectedError,
  );
  assert.strictEqual(harness.manager.isInFlight(3, 1), false);
  assert.strictEqual(harness.manager.getInFlightCount(), 0);
}

function createThrowingManager(expectedError) {
  return new AudioPreparationManager({
    workerPool: {
      submit() {
        throw expectedError;
      },
    },
  });
}

function testSynchronousSubmitFailureClearsInFlight() {
  const error = new Error('submit failure');
  const manager = createThrowingManager(error);
  assert.throws(() => request(manager, {gameId: 4}),
      (caught) => caught === error);
  assert.strictEqual(manager.isInFlight(4, 1), false);
  assert.strictEqual(manager.getInFlightCount(), 0);
}

async function run() {
  testConstructorValidation();
  await testAcceptedPreparation();
  await testDuplicatePreparationIsRejected();
  await testRoundIdentityIncludesGameId();
  await testRejectedPromiseClearsInFlight();
  testSynchronousSubmitFailureClearsInFlight();
  console.log(
      '[C14] PASS: AudioPreparationManager coordina y deduplica trabajos.',
  );
}

run().catch((error) => {
  console.error('[C14] FAIL:', error);
  process.exitCode = 1;
});
