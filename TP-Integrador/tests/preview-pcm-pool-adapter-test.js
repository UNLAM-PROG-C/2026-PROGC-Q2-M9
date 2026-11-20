import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PreviewPcmPoolAdapter,
} from '../server/audio/preview-pcm-pool-adapter.js';
import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';

const PCM_SOURCE = {
  kind: 'PCM_BUFFER',
  pcm: Buffer.alloc(16),
  sampleRate: 44100,
  channels: 2,
  bitsPerSample: 16,
  options: {},
};

class FakePool {
  constructor() {
    this.submitted = [];
    this.cancelled = [];
  }

  submit(job) {
    this.submitted.push(job);
    return Promise.resolve(job);
  }

  cancelQueuedByGameId(gameId) {
    this.cancelled.push(gameId);
    return 0;
  }
}

function createJob(gameId = 1) {
  return new AudioJob({
    jobId: `job-${gameId}`,
    gameId,
    roundId: 2,
    mode: AudioMode.REVERSE,
    source: {
      preview: 'https://example.test/song.m4a',
    },
  });
}

function createDeferredLoader() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return {
    load: () => promise,
    resolve,
  };
}

function createAdapter(pool, loadSource) {
  return new PreviewPcmPoolAdapter({
    workerPool: pool,
    loadSource,
  });
}

function assertDelegatedJob(pool, job, loadedUrl) {
  assert.equal(loadedUrl, job.source.preview);
  assert.equal(pool.submitted.length, 1);
  const submitted = pool.submitted[0];
  assert.equal(submitted.jobId, job.jobId);
  assert.equal(submitted.gameId, job.gameId);
  assert.equal(submitted.roundId, job.roundId);
  assert.equal(submitted.mode, job.mode);
  assert.strictEqual(submitted.source, PCM_SOURCE);
}

function assertCancelledState(pool) {
  assert.equal(pool.submitted.length, 0);
  assert.deepEqual(pool.cancelled, [5]);
}

test('C19A-I03: adapta preview antes de delegar al pool', async () => {
  const pool = new FakePool();
  let loadedUrl = null;
  const loadSource = async (url) => {
    loadedUrl = url;
    return PCM_SOURCE;
  };
  const adapter = createAdapter(pool, loadSource);
  const job = createJob();
  await adapter.submit(job);
  assertDelegatedJob(pool, job, loadedUrl);
});

test('C19A-I04: restart evita delegar preparación vieja', async () => {
  const pool = new FakePool();
  const deferred = createDeferredLoader();
  const adapter = createAdapter(pool, deferred.load);
  const job = createJob(5);
  const completion = adapter.submit(job);
  adapter.cancelQueuedByGameId(5);
  deferred.resolve(PCM_SOURCE);
  await assert.rejects(completion, /cancelado/);
  assertCancelledState(pool);
});
