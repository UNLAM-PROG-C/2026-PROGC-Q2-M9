/** @fileoverview Pruebas C05 de los contratos de datos D03. */
import assert from 'assert';
import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';

const SOURCE = {previewUrl: 'https://example.test/song.m4a'};
const SONG = {title: 'Canción de prueba', artist: 'Artista'};

function expectTypeError(fn, message) {
  assert.throws(fn, TypeError, message);
}

function createJob(overrides = {}) {
  return new AudioJob({
    jobId: 'job-1', gameId: 1, roundId: 2,
    mode: AudioMode.REVERSE, source: SOURCE, ...overrides,
  });
}

function assertValidJob() {
  const job = createJob();
  assert.strictEqual(job.jobId, 'job-1');
  assert.strictEqual(job.gameId, 1);
  assert.strictEqual(job.roundId, 2);
  assert.strictEqual(job.mode, AudioMode.REVERSE);
  assert.strictEqual(job.source, SOURCE);
}

function testAudioJob() {
  assertValidJob();
  const cases = [
    [{jobId: ''}, 'jobId vacío debe rechazarse'],
    [{gameId: 0}, 'gameId inválido debe rechazarse'],
    [{roundId: 0}, 'roundId inválido debe rechazarse'],
    [{mode: 'UNKNOWN'}, 'mode desconocido debe rechazarse'],
    [{source: null}, 'source ausente debe rechazarse'],
  ];
  cases.forEach(([overrides, message]) =>
    expectTypeError(() => createJob(overrides), message));
}

function createSuccess(overrides = {}) {
  return new AudioResult({
    jobId: 'job-10', gameId: 2, roundId: 3,
    mode: AudioMode.LOW_PASS, ok: true,
    resource: {path: '/audio/generated/g2-r3.wav'}, ...overrides,
  });
}

function createFailure(overrides = {}) {
  return new AudioResult({
    jobId: 'job-11', gameId: 2, roundId: 4,
    mode: AudioMode.REVERSE, ok: false,
    error: 'No se pudo decodificar el audio.', ...overrides,
  });
}

function assertValidResults() {
  const success = createSuccess();
  assert.strictEqual(success.ok, true);
  assert.deepStrictEqual(success.resource, {
    path: '/audio/generated/g2-r3.wav',
  });
  assert.strictEqual(success.error, null);
  const failure = createFailure();
  assert.strictEqual(failure.ok, false);
  assert.strictEqual(failure.resource, null);
  assert.strictEqual(failure.error, 'No se pudo decodificar el audio.');
}

function testAudioResult() {
  assertValidResults();
  const cases = [
    [() => createSuccess({resource: null}), 'éxito sin resource'],
    [() => createSuccess({error: 'error'}), 'éxito con error'],
    [() => createFailure({resource: 'audio.wav'}), 'fallo con resource'],
    [() => createFailure({error: null}), 'fallo sin error'],
  ];
  cases.forEach(([build, message]) => expectTypeError(build, message));
}

function createPreparedRound(overrides = {}) {
  return new PreparedRound({
    gameId: 3, roundId: 1, mode: AudioMode.NORMAL,
    song: SONG, resource: 'https://example.test/original.m4a', ...overrides,
  });
}

function assertValidPreparedRound() {
  const round = createPreparedRound();
  assert.strictEqual(round.gameId, 3);
  assert.strictEqual(round.roundId, 1);
  assert.strictEqual(round.mode, AudioMode.NORMAL);
  assert.strictEqual(round.song, SONG);
  assert.strictEqual(round.resource, 'https://example.test/original.m4a');
}

function testPreparedRound() {
  assertValidPreparedRound();
  const cases = [
    [{mode: 'UNKNOWN'}, 'mode desconocido debe rechazarse'],
    [{song: null}, 'song ausente debe rechazarse'],
    [{resource: null}, 'resource ausente debe rechazarse'],
  ];
  cases.forEach(([overrides, message]) =>
    expectTypeError(() => createPreparedRound(overrides), message));
}

function run() {
  testAudioJob();
  testAudioResult();
  testPreparedRound();
  console.log(
      '[C05] PASS: contratos AudioJob, AudioResult y PreparedRound validados.',
  );
}

run();
