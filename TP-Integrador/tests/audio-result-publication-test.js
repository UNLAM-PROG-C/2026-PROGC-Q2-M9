import assert from 'node:assert/strict';
import test from 'node:test';
import {AudioPreparationManager} from
  '../server/audio/audio-preparation-manager.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';

class ImmediatePool {
  constructor({ok = true} = {}) {
    this.ok = ok;
  }

  submit(job) {
    const resource = this.ok ? {kind: 'TEST_RESOURCE', jobId: job.jobId} : null;
    return Promise.resolve(new AudioResult({
      jobId: job.jobId, gameId: job.gameId, roundId: job.roundId,
      mode: job.mode, ok: this.ok, resource,
      error: this.ok ? null : 'fallo simulado',
    }));
  }

  cancelQueuedByGameId() {
    return 0;
  }
}

function createHarness({ok = true} = {}) {
  const buffer = new PreparedRoundBuffer();
  const manager = new AudioPreparationManager({
    workerPool: new ImmediatePool({ok}), preparedRoundBuffer: buffer,
  });
  return {buffer, manager};
}

function requestPreparation(manager, options = {}) {
  return manager.requestPreparation({
    gameId: 1, roundId: 2, mode: AudioMode.REVERSE,
    source: {kind: 'TEST_SOURCE'}, ...options,
  });
}

function assertPrepared(buffer, result, song) {
  const prepared = buffer.get(result.gameId, result.roundId);
  assert.ok(prepared);
  assert.strictEqual(prepared.song, song);
  assert.strictEqual(prepared.resource, result.resource);
  assert.equal(prepared.mode, result.mode);
}

async function testSuccessfulPublication() {
  const {buffer, manager} = createHarness();
  const song = {title: 'Canción original', preview: 'https://example.invalid/song.mp3'};
  const request = requestPreparation(manager, {song});
  const result = await request.resultPromise;
  assert.equal(result.ok, true);
  assertPrepared(buffer, result, song);
}

test('C19-I10: resultado exitoso publica PreparedRound',
    testSuccessfulPublication);

async function testFailedPublication() {
  const {buffer, manager} = createHarness({ok: false});
  const song = {title: 'Fallida', preview: 'https://example.invalid/fail.mp3'};
  const request = requestPreparation(manager, {
    roundId: 3, mode: AudioMode.LOW_PASS, song,
  });
  const result = await request.resultPromise;
  assert.equal(result.ok, false);
  assert.equal(buffer.has(1, 3), false);
}

test('C19-I11: resultado fallido no publica PreparedRound',
    testFailedPublication);

async function testMissingSongCompatibility() {
  const {buffer, manager} = createHarness();
  const request = requestPreparation(manager, {
    roundId: 4, mode: AudioMode.NORMAL,
  });
  const result = await request.resultPromise;
  assert.equal(result.ok, true);
  assert.equal(buffer.has(1, 4), false);
}

test('C19-I12: compatibilidad sin song no publica',
    testMissingSongCompatibility);

function createPlaylist() {
  return [1, 2, 3, 4].map((round) => ({
    title: `R${round}`, preview: `https://example.invalid/${round}.mp3`,
  }));
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testPrefetchPublication() {
  const {buffer, manager} = createHarness();
  const summary = manager.maintainPrefetchWindow({
    gameId: 1, currentRoundId: 1, currentSongIndex: 0,
    playlist: createPlaylist(), maxRounds: 4,
  });
  assert.deepEqual(summary.scheduled, [2, 3, 4]);
  await flushPromises();
  [2, 3, 4].forEach((round) => assert.equal(buffer.has(1, round), true));
}

test('C19-I13: prefetch publica rondas READY automáticamente',
    testPrefetchPublication);
