import assert from 'node:assert/strict';
import test from 'node:test';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';
import {RoundAudioResolver} from '../server/audio/round-audio-resolver.js';

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

function addPrepared(buffer, options) {
  buffer.tryAdd(new PreparedRound({song: SONG, ...options}));
}

function resolveRound(buffer, gameId, roundId) {
  return createResolver(buffer).resolve({
    gameId, roundId, playlistSong: SONG,
  });
}

function assertPreparedResolution(resolved, resource) {
  assert.equal(resolved.prepared, true);
  assert.equal(resolved.mode, AudioMode.REVERSE);
  assert.equal(resolved.resource, resource);
  assert.equal(resolved.source, 'PREPARED_ROUND');
}

function testPreparedRoundIsConsumed() {
  const buffer = new PreparedRoundBuffer();
  const resource = 'https://example.invalid/reverse.wav';
  addPrepared(buffer, {
    gameId: 5, roundId: 3, mode: AudioMode.REVERSE, resource,
  });
  assertPreparedResolution(resolveRound(buffer, 5, 3), resource);
  assert.equal(buffer.size, 0);
}

test('C19-I01: consume PreparedRound disponible', testPreparedRoundIsConsumed);

function testFallback() {
  const buffer = new PreparedRoundBuffer();
  const resolved = resolveRound(buffer, 5, 3);
  assert.equal(resolved.prepared, false);
  assert.equal(resolved.mode, AudioMode.NORMAL);
  assert.equal(resolved.resource, SONG.preview);
  assert.equal(resolved.source, 'FALLBACK_ORIGINAL');
}

test('C19-I02: ausencia produce fallback NORMAL inmediato', testFallback);

function testOtherRoundIsPreserved() {
  const buffer = new PreparedRoundBuffer();
  addPrepared(buffer, {
    gameId: 1, roundId: 3, mode: AudioMode.LOW_PASS,
    resource: 'https://example.invalid/round-3.wav',
  });
  assert.equal(resolveRound(buffer, 1, 2).prepared, false);
  assert.equal(buffer.has(1, 3), true);
}

test('C19-I03: no consume otra ronda del mismo game',
    testOtherRoundIsPreserved);

function testOtherGameIsPreserved() {
  const buffer = new PreparedRoundBuffer();
  addPrepared(buffer, {
    gameId: 5, roundId: 2, mode: AudioMode.REVERSE,
    resource: 'https://example.invalid/game-5.wav',
  });
  assert.equal(resolveRound(buffer, 6, 2).prepared, false);
  assert.equal(buffer.has(5, 2), true);
}

test('C19-I04: no consume PreparedRound de otro game',
    testOtherGameIsPreserved);
