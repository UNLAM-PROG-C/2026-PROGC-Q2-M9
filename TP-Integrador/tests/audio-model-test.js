/**
 * @fileoverview Pruebas C05 de los contratos de datos D03.
 * Ejercita constructores válidos y rechazos seleccionados mediante assert.
 * No ejecuta trabajos de audio ni verifica recursos externos, workers o I/O.
 */
import assert from 'assert';

import {AudioJob} from '../server/audio/model/audio-job.js';
import {AudioResult} from '../server/audio/model/audio-result.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';

/**
 * Comprueba que la operación arroje TypeError, sin exigir un texto concreto.
 * @param {function(): *} fn Operación inválida a ejecutar.
 * @param {string} message Mensaje de diagnóstico de la aserción.
 */
function expectTypeError(fn, message) {
  assert.throws(fn, TypeError, message);
}

/**
 * Verifica identidad del source y datos válidos; rechaza ejemplos de
 * identificadores inválidos, modo desconocido y fuente ausente.
 */
function testAudioJob() {
  const source = {previewUrl: 'https://example.test/song.m4a'};

  const job = new AudioJob({
    jobId: 'job-1',
    gameId: 1,
    roundId: 2,
    mode: AudioMode.REVERSE,
    source,
  });

  assert.strictEqual(job.jobId, 'job-1');
  assert.strictEqual(job.gameId, 1);
  assert.strictEqual(job.roundId, 2);
  assert.strictEqual(job.mode, AudioMode.REVERSE);
  assert.strictEqual(job.source, source);

  expectTypeError(
      () =>
        new AudioJob({
          jobId: '',
          gameId: 1,
          roundId: 1,
          mode: AudioMode.NORMAL,
          source,
        }),
      'jobId vacío debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioJob({
          jobId: 'job-2',
          gameId: 0,
          roundId: 1,
          mode: AudioMode.NORMAL,
          source,
        }),
      'gameId inválido debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioJob({
          jobId: 'job-3',
          gameId: 1,
          roundId: 0,
          mode: AudioMode.NORMAL,
          source,
        }),
      'roundId inválido debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioJob({
          jobId: 'job-4',
          gameId: 1,
          roundId: 1,
          mode: 'UNKNOWN',
          source,
        }),
      'mode desconocido debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioJob({
          jobId: 'job-5',
          gameId: 1,
          roundId: 1,
          mode: AudioMode.NORMAL,
          source: null,
        }),
      'source ausente debe rechazarse',
  );
}

/**
 * Verifica resultados exitosos y fallidos, valores predeterminados y
 * rechazo de combinaciones contradictorias o incompletas de resource/error.
 */
function testAudioResult() {
  const success = new AudioResult({
    jobId: 'job-10',
    gameId: 2,
    roundId: 3,
    mode: AudioMode.LOW_PASS,
    ok: true,
    resource: {path: '/audio/generated/g2-r3.wav'},
  });

  assert.strictEqual(success.ok, true);
  assert.deepStrictEqual(success.resource, {
    path: '/audio/generated/g2-r3.wav',
  });
  assert.strictEqual(success.error, null);

  const failure = new AudioResult({
    jobId: 'job-11',
    gameId: 2,
    roundId: 4,
    mode: AudioMode.REVERSE,
    ok: false,
    error: 'No se pudo decodificar el audio.',
  });

  assert.strictEqual(failure.ok, false);
  assert.strictEqual(failure.resource, null);
  assert.strictEqual(failure.error, 'No se pudo decodificar el audio.');

  expectTypeError(
      () =>
        new AudioResult({
          jobId: 'job-12',
          gameId: 2,
          roundId: 5,
          mode: AudioMode.REVERSE,
          ok: true,
        }),
      'resultado exitoso sin resource debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioResult({
          jobId: 'job-13',
          gameId: 2,
          roundId: 6,
          mode: AudioMode.REVERSE,
          ok: true,
          resource: 'audio.wav',
          error: 'error contradictorio',
        }),
      'éxito con error debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioResult({
          jobId: 'job-14',
          gameId: 2,
          roundId: 7,
          mode: AudioMode.REVERSE,
          ok: false,
          resource: 'audio.wav',
          error: 'falló',
        }),
      'fallo con resource debe rechazarse',
  );

  expectTypeError(
      () =>
        new AudioResult({
          jobId: 'job-15',
          gameId: 2,
          roundId: 8,
          mode: AudioMode.REVERSE,
          ok: false,
        }),
      'fallo sin error debe rechazarse',
  );
}

/**
 * Verifica referencia de canción y valor del recurso; rechaza ejemplos de
 * modo, canción o recurso inválidos.
 */
function testPreparedRound() {
  const song = {
    title: 'Canción de prueba',
    artist: 'Artista',
  };

  const round = new PreparedRound({
    gameId: 3,
    roundId: 1,
    mode: AudioMode.NORMAL,
    song,
    resource: 'https://example.test/original.m4a',
  });

  assert.strictEqual(round.gameId, 3);
  assert.strictEqual(round.roundId, 1);
  assert.strictEqual(round.mode, AudioMode.NORMAL);
  assert.strictEqual(round.song, song);
  assert.strictEqual(
      round.resource,
      'https://example.test/original.m4a',
  );

  expectTypeError(
      () =>
        new PreparedRound({
          gameId: 3,
          roundId: 1,
          mode: 'UNKNOWN',
          song,
          resource: 'audio.wav',
        }),
      'mode desconocido debe rechazarse',
  );

  expectTypeError(
      () =>
        new PreparedRound({
          gameId: 3,
          roundId: 1,
          mode: AudioMode.NORMAL,
          song: null,
          resource: 'audio.wav',
        }),
      'song ausente debe rechazarse',
  );

  expectTypeError(
      () =>
        new PreparedRound({
          gameId: 3,
          roundId: 1,
          mode: AudioMode.NORMAL,
          song,
          resource: null,
        }),
      'resource ausente debe rechazarse',
  );
}

/**
 * Ejecuta los tres grupos; una aserción fallida impide informar PASS.
 */
function run() {
  testAudioJob();
  testAudioResult();
  testPreparedRound();

  console.log(
      '[C05] PASS: contratos AudioJob, AudioResult y PreparedRound validados.',
  );
}

run();
