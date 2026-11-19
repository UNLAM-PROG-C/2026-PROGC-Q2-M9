import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioPreparationManager,
  DEFAULT_MODE_SEQUENCE,
  DEFAULT_PREFETCH_DEPTH,
  selectModeForRound,
} from '../server/audio/audio-preparation-manager.js';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';

const GAME_ID_ONE = 1;
const GAME_ID_TWO = 2;
const ROUND_ONE = 1;
const ROUND_TWO = 2;
const ROUND_THREE = 3;
const ROUND_FOUR = 4;
const ROUND_FIVE = 5;
const INDEX_ZERO = 0;
const INDEX_ONE = 1;
const INDEX_TWO = 2;
const MAX_ROUNDS_EIGHT = 8;
const MAX_ROUNDS_THREE = 3;
const CUSTOM_DEPTH_TWO = 2;
const EXPECTED_TWO_JOBS = 2;

/**
 * Crea una playlist sintética para pruebas determinísticas.
 * @param {number} count Cantidad de canciones.
 * @return {!Array<!Object>} Lista de canciones simuladas.
 */
function createPlaylist(count) {
  return Array.from({length: count}, (_, index) => ({
    id: `song-${index + ROUND_ONE}`,
    title: `Canción ${index + ROUND_ONE}`,
    preview: `https://example.invalid/song-${index + ROUND_ONE}.mp3`,
  }));
}

/**
 * Crea un pool controlado que permite resolver o rechazar jobs a demanda.
 * @return {!Object} Doble de pool con jobs y controles manuales.
 */
function createControlledPool() {
  const jobs = [];
  const pending = new Map();
  return {
    jobs,
    submit(job) {
      jobs.push(job);
      return new Promise((resolve, reject) => {
        pending.set(job.jobId, {resolve, reject});
      });
    },
    resolveJob(jobId, value = {ok: true}) {
      pending.get(jobId).resolve(value);
    },
    rejectJob(jobId, error = new Error('fallo simulado')) {
      pending.get(jobId).reject(error);
    },
  };
}

/**
 * Crea el conjunto de dependencias para un escenario de prefetch.
 * @param {!Object=} options Configuración opcional del entorno de prueba.
 * @return {!Object} Pool, buffer, logs y manager listos para usar.
 */
function createPrefetchHarness(options = {}) {
  const pool = createControlledPool();
  const buffer = new PreparedRoundBuffer({
    capacity: options.capacity ?? DEFAULT_PREFETCH_DEPTH,
  });
  const logs = [];
  const manager = new AudioPreparationManager({
    workerPool: pool,
    preparedRoundBuffer: buffer,
    prefetchDepth: options.prefetchDepth ?? DEFAULT_PREFETCH_DEPTH,
    modeSequence: options.modeSequence ?? DEFAULT_MODE_SEQUENCE,
    log: (entry) => logs.push(entry),
  });
  return {pool, buffer, logs, manager};
}

/**
 * Inserta una ronda preparada en el buffer de prueba.
 * @param {!PreparedRoundBuffer} buffer Instancia del buffer.
 * @param {number} gameId Identificador de partida.
 * @param {number} roundId Identificador de ronda.
 * @param {!Object} song Canción asociada.
 */
function addReadyRound(buffer, gameId, roundId, song) {
  buffer.tryAdd(new PreparedRound({
    gameId,
    roundId,
    mode: selectModeForRound(roundId),
    song,
    resource: {url: song.preview},
  }));
}

test('P01: ventana vacía programa N+1, N+2 y N+3 con índice circular', () => {
  const {pool, logs, manager} = createPrefetchHarness();
  const playlist = createPlaylist(ROUND_THREE);
  const summary = manager.maintainPrefetchWindow({
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_ONE,
    currentSongIndex: INDEX_ONE,
    playlist,
    maxRounds: MAX_ROUNDS_EIGHT,
  });
  assert.deepEqual(summary.scheduled, [ROUND_TWO, ROUND_THREE, ROUND_FOUR]);
  assert.equal(pool.jobs[INDEX_ZERO].source.id, 'song-3');
  assert.equal(pool.jobs[INDEX_ONE].source.id, 'song-1');
  assert.equal(pool.jobs[INDEX_TWO].source.id, 'song-2');
  assert.equal(logs.length, ROUND_ONE);
});

test('P02: llamadas repetidas son idempotentes y no duplican IN_FLIGHT', () => {
  const {pool, manager} = createPrefetchHarness();
  const params = {
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_ONE,
    currentSongIndex: INDEX_ZERO,
    playlist: createPlaylist(ROUND_FIVE),
    maxRounds: MAX_ROUNDS_EIGHT,
  };
  manager.maintainPrefetchWindow(params);
  const second = manager.maintainPrefetchWindow(params);
  assert.deepEqual(second.scheduled, []);
  assert.deepEqual(second.inFlight, [ROUND_TWO, ROUND_THREE, ROUND_FOUR]);
  assert.equal(pool.jobs.length, DEFAULT_PREFETCH_DEPTH);
});

test('P03 y P04: omite READY e IN_FLIGHT y programa solo faltantes', () => {
  const {pool, buffer, manager} = createPrefetchHarness();
  const playlist = createPlaylist(ROUND_FIVE);
  addReadyRound(buffer, GAME_ID_ONE, ROUND_TWO, playlist[INDEX_ONE]);
  manager.requestPreparation({
    gameId: GAME_ID_ONE,
    roundId: ROUND_THREE,
    mode: AudioMode.LOW_PASS,
    source: playlist[INDEX_TWO],
  });
  const summary = manager.maintainPrefetchWindow({
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_ONE,
    currentSongIndex: INDEX_ZERO,
    playlist,
    maxRounds: MAX_ROUNDS_EIGHT,
  });
  assert.deepEqual(summary.ready, [ROUND_TWO]);
  assert.deepEqual(summary.inFlight, [ROUND_THREE]);
  assert.deepEqual(summary.scheduled, [ROUND_FOUR]);
  assert.equal(pool.jobs.length, EXPECTED_TWO_JOBS);
});

test('P05: al consumir N+1 y avanzar ventana se programa N+4', () => {
  const {buffer, manager} = createPrefetchHarness();
  const playlist = createPlaylist(MAX_ROUNDS_EIGHT);
  addReadyRound(buffer, GAME_ID_ONE, ROUND_TWO, playlist[INDEX_ONE]);
  addReadyRound(buffer, GAME_ID_ONE, ROUND_THREE, playlist[INDEX_TWO]);
  addReadyRound(buffer, GAME_ID_ONE, ROUND_FOUR, playlist[ROUND_THREE]);
  buffer.consume(GAME_ID_ONE, ROUND_TWO);
  const summary = manager.maintainPrefetchWindow({
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_TWO,
    currentSongIndex: INDEX_ONE,
    playlist,
    maxRounds: MAX_ROUNDS_EIGHT,
  });
  assert.deepEqual(summary.scheduled, [ROUND_FIVE]);
});

test('P06: cerca de maxRounds no excede el final de partida', () => {
  const {manager} = createPrefetchHarness();
  const summary = manager.maintainPrefetchWindow({
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_TWO,
    currentSongIndex: INDEX_ONE,
    playlist: createPlaylist(ROUND_FIVE),
    maxRounds: MAX_ROUNDS_THREE,
  });
  assert.deepEqual(summary.targets, [ROUND_THREE]);
  assert.deepEqual(summary.scheduled, [ROUND_THREE]);
});

test('P07 y D06: out-of-order y fallo sin retry automático', async () => {
  const {pool, buffer, manager} = createPrefetchHarness();
  const playlist = createPlaylist(ROUND_FIVE);
  manager.maintainPrefetchWindow({
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_ONE,
    currentSongIndex: INDEX_ZERO,
    playlist,
    maxRounds: MAX_ROUNDS_EIGHT,
  });
  addReadyRound(buffer, GAME_ID_ONE, ROUND_FOUR, playlist[ROUND_THREE]);
  pool.resolveJob(pool.jobs[INDEX_TWO].jobId);
  pool.rejectJob(pool.jobs[INDEX_ZERO].jobId);
  await Promise.resolve();
  assert.equal(manager.isInFlight(GAME_ID_ONE, ROUND_TWO), false);
  assert.equal(buffer.has(GAME_ID_ONE, ROUND_FOUR), true);
  assert.equal(pool.jobs.length, DEFAULT_PREFETCH_DEPTH);
});

test('P08: gameId nuevo no colisiona con roundId ya preparado', () => {
  const {buffer, manager} = createPrefetchHarness({capacity: ROUND_FOUR});
  const playlist = createPlaylist(ROUND_FIVE);
  addReadyRound(buffer, GAME_ID_ONE, ROUND_TWO, playlist[INDEX_ONE]);
  const summary = manager.maintainPrefetchWindow({
    gameId: GAME_ID_TWO,
    currentRoundId: ROUND_ONE,
    currentSongIndex: INDEX_ZERO,
    playlist,
    maxRounds: MAX_ROUNDS_EIGHT,
  });
  assert.deepEqual(summary.scheduled, [ROUND_TWO, ROUND_THREE, ROUND_FOUR]);
});

test('P09: selecciona modos determinísticamente según D09', () => {
  assert.deepEqual(DEFAULT_MODE_SEQUENCE, [
    AudioMode.NORMAL,
    AudioMode.REVERSE,
    AudioMode.LOW_PASS,
  ]);
  assert.equal(selectModeForRound(ROUND_ONE), AudioMode.NORMAL);
  assert.equal(selectModeForRound(ROUND_TWO), AudioMode.REVERSE);
  assert.equal(selectModeForRound(ROUND_THREE), AudioMode.LOW_PASS);
  assert.equal(selectModeForRound(ROUND_FOUR), AudioMode.NORMAL);
});

test('P10: respeta prefetchDepth configurable y límite de capacidad', () => {
  const {manager} = createPrefetchHarness({prefetchDepth: CUSTOM_DEPTH_TWO});
  const summary = manager.maintainPrefetchWindow({
    gameId: GAME_ID_ONE,
    currentRoundId: ROUND_ONE,
    currentSongIndex: INDEX_ZERO,
    playlist: createPlaylist(ROUND_FIVE),
    maxRounds: MAX_ROUNDS_EIGHT,
  });
  assert.deepEqual(summary.targets, [ROUND_TWO, ROUND_THREE]);
  assert.deepEqual(summary.scheduled, [ROUND_TWO, ROUND_THREE]);
});
