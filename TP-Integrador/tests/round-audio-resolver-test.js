import assert from 'node:assert/strict';
import test from 'node:test';

import {AudioMode} from '../server/audio/model/audio-mode.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {PreparedRoundBuffer} from
  '../server/audio/prepared-round-buffer.js';
import {RoundAudioResolver} from
  '../server/audio/round-audio-resolver.js';

const SONG = {
  title: 'Test Song',
  preview: 'https://example.invalid/original.mp3',
};

function createResolver(buffer, logs = []) {
  return new RoundAudioResolver({
    preparedRoundBuffer: buffer,
    log: (message) => logs.push(message),
  });
}

test('C19-I01: consume PreparedRound disponible', () => {
  const buffer = new PreparedRoundBuffer();
  const resource = 'https://example.invalid/reverse.wav';

  buffer.tryAdd(new PreparedRound({
    gameId: 5,
    roundId: 3,
    mode: AudioMode.REVERSE,
    song: SONG,
    resource,
  }));

  const resolved = createResolver(buffer).resolve({
    gameId: 5,
    roundId: 3,
    playlistSong: SONG,
  });

  assert.equal(resolved.prepared, true);
  assert.equal(resolved.mode, AudioMode.REVERSE);
  assert.equal(resolved.resource, resource);
  assert.equal(resolved.source, 'PREPARED_ROUND');
  assert.equal(buffer.size, 0);
});

test('C19-I02: ausencia produce fallback NORMAL inmediato', () => {
  const buffer = new PreparedRoundBuffer();

  const resolved = createResolver(buffer).resolve({
    gameId: 5,
    roundId: 3,
    playlistSong: SONG,
  });

  assert.equal(resolved.prepared, false);
  assert.equal(resolved.mode, AudioMode.NORMAL);
  assert.equal(resolved.resource, SONG.preview);
  assert.equal(resolved.source, 'FALLBACK_ORIGINAL');
});

test('C19-I03: no consume otra ronda del mismo game', () => {
  const buffer = new PreparedRoundBuffer();

  buffer.tryAdd({
    gameId: 1,
    roundId: 3,
    mode: AudioMode.LOW_PASS,
    song: SONG,
    resource: 'https://example.invalid/round-3.wav',
  });

  const resolved = createResolver(buffer).resolve({
    gameId: 1,
    roundId: 2,
    playlistSong: SONG,
  });

  assert.equal(resolved.prepared, false);
  assert.equal(buffer.has(1, 3), true);
});

test('C19-I04: no consume PreparedRound de otro game', () => {
  const buffer = new PreparedRoundBuffer();

  buffer.tryAdd({
    gameId: 5,
    roundId: 2,
    mode: AudioMode.REVERSE,
    song: SONG,
    resource: 'https://example.invalid/game-5.wav',
  });

  const resolved = createResolver(buffer).resolve({
    gameId: 6,
    roundId: 2,
    playlistSong: SONG,
  });

  assert.equal(resolved.prepared, false);
  assert.equal(buffer.has(5, 2), true);
});
