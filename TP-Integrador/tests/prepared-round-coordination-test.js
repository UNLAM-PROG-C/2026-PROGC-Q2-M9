import assert from 'node:assert/strict';
import test from 'node:test';
import {AudioMode} from '../server/audio/model/audio-mode.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {PreparedRoundBuffer} from '../server/audio/prepared-round-buffer.js';

const GAME_ID = 1;
const ROUND_ONE = 1;
const ROUND_TWO = 2;
const ROUND_THREE = 3;
const ROUND_FOUR = 4;
const ZERO_COUNT = 0;
const ONE_COUNT = 1;
const TWO_COUNT = 2;
const FULL_COUNT = 3;

/**
 * Evalua si puede admitirse un nuevo trabajo segun backpressure por admision.
 * @param {!Object} state Estado actual de capacidad.
 * @param {number} state.readyCount Cantidad de rondas READY en buffer.
 * @param {number} state.inFlightCount Cantidad de trabajos IN_FLIGHT.
 * @param {number} state.capacity Capacidad maxima comprometida.
 * @return {boolean} True si hay lugar para admitir otro trabajo.
 */
function canAdmit({readyCount, inFlightCount, capacity}) {
  return readyCount + inFlightCount < capacity;
}

/**
 * Crea una ronda preparada sintetica para pruebas de coordinacion.
 * @param {number} roundId Identificador de ronda.
 * @return {!PreparedRound} Instancia valida de PreparedRound.
 */
function buildPreparedRound(roundId) {
  return new PreparedRound({
    gameId: GAME_ID,
    roundId,
    mode: AudioMode.NORMAL,
    song: {title: `Song ${roundId}`},
    resource: `mock://round-${roundId}.wav`,
  });
}

/**
 * Crea el estado de coordinacion del test sobre un PreparedRoundBuffer real.
 * @return {!Object} Estado de prueba con buffer y contador inFlight.
 */
function createState() {
  return {
    buffer: new PreparedRoundBuffer(),
    inFlight: ZERO_COUNT,
  };
}

/**
 * Calcula las metricas actuales de capacidad del estado de prueba.
 * @param {!Object} state Estado de coordinacion.
 * @return {!Object} Contadores ready, inFlight, committed y capacity.
 */
function getMetrics(state) {
  const ready = state.buffer.size;
  const inFlight = state.inFlight;
  return {
    ready,
    inFlight,
    committed: ready + inFlight,
    capacity: state.buffer.capacity,
  };
}

/**
 * Registra una linea de evidencia con el formato de C16.
 * @param {string} label Etiqueta del evento observado.
 * @param {!Object} state Estado de coordinacion.
 */
function logState(label, state) {
  const {ready, inFlight, committed, capacity} = getMetrics(state);
  console.log(
      `[C16] ${label}: READY=${ready} IN_FLIGHT=${inFlight} ` +
      `COMMITTED=${committed} CAPACITY=${capacity}`,
  );
}

/**
 * Intenta admitir un nuevo trabajo reservando capacidad logica.
 * @param {!Object} state Estado de coordinacion.
 * @return {boolean} True si el trabajo fue admitido.
 */
function admitJob(state) {
  const allowed = canAdmit({
    readyCount: state.buffer.size,
    inFlightCount: state.inFlight,
    capacity: state.buffer.capacity,
  });
  if (allowed) {
    state.inFlight += ONE_COUNT;
  }
  return allowed;
}

/**
 * Transiciona un trabajo IN_FLIGHT a READY en el buffer real.
 * @param {!Object} state Estado de coordinacion.
 * @param {number} roundId Ronda que finalizo correctamente.
 * @return {!Object} Resultado de buffer.tryAdd().
 */
function completeJob(state, roundId) {
  assert.ok(state.inFlight > ZERO_COUNT, 'Debe haber un job IN_FLIGHT.');
  const result = state.buffer.tryAdd(buildPreparedRound(roundId));
  assert.equal(result.accepted, true);
  state.inFlight -= ONE_COUNT;
  return result;
}

/**
 * Libera la reserva logica de un trabajo IN_FLIGHT fallido sin retry.
 * @param {!Object} state Estado de coordinacion.
 */
function failJob(state) {
  assert.ok(state.inFlight > ZERO_COUNT, 'Debe haber un job IN_FLIGHT.');
  state.inFlight -= ONE_COUNT;
}

/**
 * Precarga rondas READY y reservas IN_FLIGHT respetando la invariante.
 * @param {!Object} state Estado de coordinacion.
 * @param {!Array<number>} readyRounds Rondas a dejar en estado READY.
 * @param {number} inFlightCount Cantidad de trabajos a dejar IN_FLIGHT.
 */
function seedState(state, readyRounds, inFlightCount) {
  for (const roundId of readyRounds) {
    assert.equal(admitJob(state), true);
    completeJob(state, roundId);
  }
  for (let i = ZERO_COUNT; i < inFlightCount; i += ONE_COUNT) {
    assert.equal(admitJob(state), true);
  }
}

test('C16-01: estado vacio permite admision', () => {
  const state = createState();
  const admitted = admitJob(state);
  const metrics = getMetrics(state);
  assert.equal(admitted, true);
  assert.equal(metrics.ready, ZERO_COUNT);
  assert.equal(metrics.inFlight, ONE_COUNT);
  assert.equal(metrics.committed, ONE_COUNT);
});

test('C16-02: buffer fisicamente lleno no permite admision', () => {
  const state = createState();
  seedState(state, [ROUND_ONE, ROUND_TWO, ROUND_THREE], ZERO_COUNT);
  assert.equal(admitJob(state), false);
  assert.equal(state.buffer.size, state.buffer.capacity);
  assert.equal(state.inFlight, ZERO_COUNT);
});

test('C16-03: buffer vacio con capacidad comprometida no admite', () => {
  const state = createState();
  seedState(state, [], FULL_COUNT);
  logState('inicial', state);
  assert.equal(state.buffer.isEmpty(), true);
  assert.equal(admitJob(state), false);
  assert.equal(getMetrics(state).committed, state.buffer.capacity);
});

test('C16-04: combinacion llena (1 READY + 2 IN_FLIGHT) no admite', () => {
  const state = createState();
  seedState(state, [ROUND_ONE], TWO_COUNT);
  const metrics = getMetrics(state);
  assert.equal(metrics.ready, ONE_COUNT);
  assert.equal(metrics.inFlight, TWO_COUNT);
  assert.equal(admitJob(state), false);
});

test('C16-05: un slot libre admite exactamente una vez y luego bloquea', () => {
  const state = createState();
  seedState(state, [ROUND_ONE], ONE_COUNT);
  assert.equal(admitJob(state), true);
  assert.equal(getMetrics(state).committed, state.buffer.capacity);
  assert.equal(admitJob(state), false);
});

test('C16-06: IN_FLIGHT -> READY conserva capacidad comprometida', () => {
  const state = createState();
  seedState(state, [ROUND_ONE], TWO_COUNT);
  completeJob(state, ROUND_TWO);
  const metrics = getMetrics(state);
  assert.equal(metrics.ready, TWO_COUNT);
  assert.equal(metrics.inFlight, ONE_COUNT);
  assert.equal(metrics.committed, state.buffer.capacity);
  assert.equal(admitJob(state), false);
});

test('C16-07: consumo libera capacidad y habilita nueva admision', () => {
  const state = createState();
  seedState(state, [ROUND_ONE, ROUND_TWO], ONE_COUNT);
  const consumed = state.buffer.consume(GAME_ID, ROUND_ONE);
  assert.equal(consumed?.roundId, ROUND_ONE);
  assert.equal(getMetrics(state).committed, TWO_COUNT);
  assert.equal(admitJob(state), true);
  assert.equal(getMetrics(state).committed, state.buffer.capacity);
});

test('C16-08: finalizacion fuera de orden (R4, R2, R3) y consumo', () => {
  const state = createState();
  seedState(state, [], FULL_COUNT);
  completeJob(state, ROUND_FOUR);
  logState('termina R4', state);
  completeJob(state, ROUND_TWO);
  assert.equal(state.buffer.consume(GAME_ID, ROUND_TWO)?.roundId, ROUND_TWO);
  logState('consume R2', state);
  completeJob(state, ROUND_THREE);
  assert.equal(state.buffer.has(GAME_ID, ROUND_FOUR), true);
  assert.equal(state.buffer.has(GAME_ID, ROUND_THREE), true);
});

test('C16-09: fallo en IN_FLIGHT libera reserva sin retry automatico', () => {
  const state = createState();
  seedState(state, [ROUND_ONE], TWO_COUNT);
  assert.equal(admitJob(state), false);
  failJob(state);
  assert.equal(state.buffer.size, ONE_COUNT);
  assert.equal(getMetrics(state).committed, TWO_COUNT);
  assert.equal(admitJob(state), true);
});
