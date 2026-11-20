import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AudioPreparationManager,
} from '../server/audio/audio-preparation-manager.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';

class ImmediatePool {
  constructor({ok = true} = {}) {
    this.ok = ok;
  }

  submit(job) {
    const resource = this.ok ?
      {kind: 'TEST_RESOURCE', jobId: job.jobId} :
      null;

    return Promise.resolve(new AudioResult({
      jobId: job.jobId,
      gameId: job.gameId,
      roundId: job.roundId,
      mode: job.mode,
      ok: this.ok,
      resource,
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
    workerPool: new ImmediatePool({ok}),
    preparedRoundBuffer: buffer,
  });
  return {buffer, manager};
}

test('C19-I10: resultado exitoso publica PreparedRound', async () => {
  const {buffer, manager} = createHarness();
  const song = {
    title: 'Canción original',
    preview: 'https://example.invalid/song.mp3',
  };

  const request = manager.requestPreparation({
    gameId: 1,
    roundId: 2,
    mode: AudioMode.REVERSE,
    source: {kind: 'TEST_SOURCE'},
    song,
  });

  const result = await request.resultPromise;

  assert.equal(result.ok, true);

  const prepared = buffer.get(1, 2);
  assert.ok(prepared);
  assert.strictEqual(prepared.song, song);
  assert.strictEqual(prepared.resource, result.resource);
  assert.equal(prepared.mode, AudioMode.REVERSE);
});

test('C19-I11: resultado fallido no publica PreparedRound', async () => {
  const {buffer, manager} = createHarness({ok: false});
  const song = {
    title: 'Fallida',
    preview: 'https://example.invalid/fail.mp3',
  };

  const request = manager.requestPreparation({
    gameId: 1,
    roundId: 3,
    mode: AudioMode.LOW_PASS,
    source: {kind: 'TEST_SOURCE'},
    song,
  });

  const result = await request.resultPromise;

  assert.equal(result.ok, false);
  assert.equal(buffer.has(1, 3), false);
});

test('C19-I12: compatibilidad sin song no publica', async () => {
  const {buffer, manager} = createHarness();

  const request = manager.requestPreparation({
    gameId: 1,
    roundId: 4,
    mode: AudioMode.NORMAL,
    source: {kind: 'TEST_SOURCE'},
  });

  const result = await request.resultPromise;

  assert.equal(result.ok, true);
  assert.equal(buffer.has(1, 4), false);
});

test('C19-I13: prefetch publica rondas READY automáticamente', async () => {
  const {buffer, manager} = createHarness();
  const playlist = [
    {title: 'R1', preview: 'https://example.invalid/1.mp3'},
    {title: 'R2', preview: 'https://example.invalid/2.mp3'},
    {title: 'R3', preview: 'https://example.invalid/3.mp3'},
    {title: 'R4', preview: 'https://example.invalid/4.mp3'},
  ];

  const summary = manager.maintainPrefetchWindow({
    gameId: 1,
    currentRoundId: 1,
    currentSongIndex: 0,
    playlist,
    maxRounds: 4,
  });

  assert.deepEqual(summary.scheduled, [2, 3, 4]);

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(buffer.has(1, 2), true);
  assert.equal(buffer.has(1, 3), true);
  assert.equal(buffer.has(1, 4), true);
});
