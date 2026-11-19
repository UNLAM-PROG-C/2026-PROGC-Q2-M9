import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {
  AUDIO_ROUTE_PREFIX,
  DEFAULT_CONTENT_TYPE,
  RoundAudioRegistry,
  createRoundAudioHandler,
} from '../server/audio/round-audio-registry.js';
import {
  MESSAGE_TYPE_NEW_SONG,
  buildNewSongPayload,
} from '../server/audio/round-protocol.js';

const GAME_ID = 2;
const ROUND_ONE = 1;
const ROUND_TWO = 2;
const ROUND_THREE = 3;
const MAX_ROUNDS = 5;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const PREVIEW_URL = 'https://audio-ssl.itunes.apple.com/preview-1.m4a';
const MOCK_WAV_BYTES = Buffer.from('RIFFmock-wav-data');

/**
 * Levanta un servidor Express efimero para probar el endpoint HTTP de audio.
 * @param {!RoundAudioRegistry} registry Registro a exponer.
 * @return {!Promise<!Object>} Servidor y URL base.
 */
async function startTestServer(registry) {
  const app = express();
  app.get(
      `${AUDIO_ROUTE_PREFIX}/:gameId/:roundId`,
      createRoundAudioHandler(registry),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  return {server, baseUrl: `http://127.0.0.1:${port}`};
}

/**
 * Ejecuta un bloque de prueba contra un servidor Express efimero y lo cierra.
 * @param {!RoundAudioRegistry} registry Registro a exponer.
 * @param {!Function} fn Funcion async que recibe baseUrl.
 */
async function withTestServer(registry, fn) {
  const {server, baseUrl} = await startTestServer(registry);
  try {
    await fn(baseUrl);
  } finally {
    server.close();
  }
}

test('C20-01: payload NORMAL conserva preview y compatibilidad V3', () => {
  const payload = buildNewSongPayload({
    gameId: GAME_ID, roundId: ROUND_ONE, maxRounds: MAX_ROUNDS,
    mode: AudioMode.NORMAL, resource: PREVIEW_URL,
  });
  assert.equal(payload.type, MESSAGE_TYPE_NEW_SONG);
  assert.equal(payload.gameId, GAME_ID);
  assert.equal(payload.roundId, ROUND_ONE);
  assert.equal(payload.round, ROUND_ONE);
  assert.equal(payload.mode, AudioMode.NORMAL);
  assert.equal(payload.song, PREVIEW_URL);
  assert.equal(payload.audioUrl, PREVIEW_URL);
});

test('C20-02: payload REVERSE expone URL HTTP servida por el servidor', () => {
  const payload = buildNewSongPayload({
    gameId: GAME_ID,
    roundId: ROUND_TWO,
    maxRounds: MAX_ROUNDS,
    mode: AudioMode.REVERSE,
  });
  const expectedUrl = `${AUDIO_ROUTE_PREFIX}/${GAME_ID}/${ROUND_TWO}`;
  assert.equal(payload.mode, AudioMode.REVERSE);
  assert.equal(payload.song, expectedUrl);
  assert.equal(payload.audioUrl, expectedUrl);
});

test('C20-03: payload LOW_PASS expone URL HTTP servida por el servidor', () => {
  const payload = buildNewSongPayload({
    gameId: GAME_ID,
    roundId: ROUND_THREE,
    maxRounds: MAX_ROUNDS,
    mode: AudioMode.LOW_PASS,
  });
  const expectedUrl = `${AUDIO_ROUTE_PREFIX}/${GAME_ID}/${ROUND_THREE}`;
  assert.equal(payload.mode, AudioMode.LOW_PASS);
  assert.equal(payload.song, expectedUrl);
});

test('C20-04: endpoint HTTP sirve buffer WAV', async () => {
  const registry = new RoundAudioRegistry();
  const url = registry.register({
    gameId: GAME_ID, roundId: ROUND_TWO, buffer: MOCK_WAV_BYTES,
  });
  await withTestServer(registry, async (baseUrl) => {
    const res = await fetch(`${baseUrl}${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, HTTP_OK);
    assert.ok(res.headers.get('content-type').includes(DEFAULT_CONTENT_TYPE));
    assert.deepEqual(body, MOCK_WAV_BYTES);
  });
});

test('C20-05: endpoint devuelve 404 ausente y 400 invalida', async () => {
  const registry = new RoundAudioRegistry();
  await withTestServer(registry, async (baseUrl) => {
    const missing = await fetch(
        `${baseUrl}${AUDIO_ROUTE_PREFIX}/${GAME_ID}/${ROUND_THREE}`,
    );
    const invalid = await fetch(
        `${baseUrl}${AUDIO_ROUTE_PREFIX}/abc/${ROUND_ONE}`,
    );
    assert.equal(missing.status, HTTP_NOT_FOUND);
    assert.equal(invalid.status, HTTP_BAD_REQUEST);
  });
});
