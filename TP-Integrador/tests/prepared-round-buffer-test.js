/**
 * @fileoverview Pruebas C15 del buffer acotado y direccionado por identidad.
 */
import assert from 'assert';
import {test} from 'node:test';

import {AudioMode} from '../server/audio/model/audio-mode.js';
import {PreparedRound} from '../server/audio/model/prepared-round.js';
import {PreparedRoundBuffer} from
  '../server/audio/prepared-round-buffer.js';

const EXPECTED_DEFAULT_CAPACITY = 3;
const TWO_SLOT_CAPACITY = 2;
const SINGLE_SLOT_CAPACITY = 1;
const EMPTY_SIZE = 0;
const DEFAULT_GAME_ID = 1;
const OLD_GAME_ID = 5;
const NEW_GAME_ID = 6;
const ROUND_ONE = 1;
const ROUND_TWO = 2;
const ROUND_THREE = 3;
const ROUND_FOUR = 4;
const ROUND_FIVE = 5;
const ZERO_CAPACITY = 0;
const ZERO_ID = 0;
const FRACTIONAL_CAPACITY = 2.5;
const FRACTIONAL_ID = 1.5;
const MISSING_ROUND_ID = 99;

function createRound({
  gameId = DEFAULT_GAME_ID,
  roundId,
  mode = AudioMode.NORMAL,
} = {}) {
  return new PreparedRound({
    gameId,
    roundId,
    mode,
    song: {title: `Song ${roundId}`},
    resource: {path: `/audio/g${gameId}-r${roundId}.wav`},
  });
}

function testInitialState() {
  const buffer = new PreparedRoundBuffer();
  assert.strictEqual(buffer.capacity, EXPECTED_DEFAULT_CAPACITY);
  assert.strictEqual(buffer.size, EMPTY_SIZE);
  assert.strictEqual(buffer.remainingCapacity, EXPECTED_DEFAULT_CAPACITY);
  assert.strictEqual(buffer.isEmpty(), true);
  assert.strictEqual(buffer.isFull(), false);
}

function testInvalidCapacities() {
  assert.throws(
      () => new PreparedRoundBuffer({capacity: ZERO_CAPACITY}),
      /capacity/,
  );
  assert.throws(
      () => new PreparedRoundBuffer({capacity: FRACTIONAL_CAPACITY}),
      /capacity/,
  );
}

function testAcceptsPreparedRound() {
  const buffer = new PreparedRoundBuffer();
  const round = createRound({roundId: ROUND_TWO});
  const result = buffer.tryAdd(round);
  assert.deepStrictEqual(result, {accepted: true, preparedRound: round});
  assert.strictEqual(buffer.has(DEFAULT_GAME_ID, ROUND_TWO), true);
}

function testNormalizesPlainObject() {
  const buffer = new PreparedRoundBuffer({capacity: TWO_SLOT_CAPACITY});
  const plainObject = {
    gameId: DEFAULT_GAME_ID,
    roundId: ROUND_THREE,
    mode: AudioMode.REVERSE,
    song: {title: `Song ${ROUND_THREE}`},
    resource: {path: `/audio/g${DEFAULT_GAME_ID}-r${ROUND_THREE}.wav`},
  };
  const result = buffer.tryAdd(plainObject);
  assert.strictEqual(result.accepted, true);
  assert.ok(result.preparedRound instanceof PreparedRound);
  assert.notStrictEqual(result.preparedRound, plainObject);
}

function testRejectsDuplicateBeforeFull() {
  const buffer = new PreparedRoundBuffer({capacity: SINGLE_SLOT_CAPACITY});
  const round = createRound({gameId: OLD_GAME_ID, roundId: ROUND_THREE});
  buffer.tryAdd(round);
  const duplicate = createRound({
    gameId: OLD_GAME_ID,
    roundId: ROUND_THREE,
    mode: AudioMode.REVERSE,
  });
  assert.deepStrictEqual(buffer.tryAdd(duplicate), {
    accepted: false,
    reason: 'DUPLICATE',
  });
  assert.strictEqual(buffer.get(OLD_GAME_ID, ROUND_THREE), round);
}

function testRejectsWhenFull() {
  const buffer = new PreparedRoundBuffer();
  buffer.tryAdd(createRound({roundId: ROUND_TWO}));
  buffer.tryAdd(createRound({roundId: ROUND_THREE}));
  buffer.tryAdd(createRound({roundId: ROUND_FOUR}));
  const rejected = buffer.tryAdd(createRound({roundId: ROUND_FIVE}));
  assert.deepStrictEqual(rejected, {accepted: false, reason: 'FULL'});
  assert.strictEqual(buffer.size, EXPECTED_DEFAULT_CAPACITY);
  assert.strictEqual(buffer.isFull(), true);
}

function testConsumesOutOfOrderAndReusesCapacity() {
  const buffer = new PreparedRoundBuffer();
  const round2 = createRound({roundId: ROUND_TWO});
  buffer.tryAdd(createRound({roundId: ROUND_FOUR}));
  buffer.tryAdd(round2);
  buffer.tryAdd(createRound({roundId: ROUND_THREE}));
  assert.strictEqual(buffer.get(DEFAULT_GAME_ID, ROUND_TWO), round2);
  assert.strictEqual(buffer.size, EXPECTED_DEFAULT_CAPACITY);
  assert.strictEqual(buffer.consume(DEFAULT_GAME_ID, ROUND_TWO), round2);
  assert.strictEqual(buffer.has(DEFAULT_GAME_ID, ROUND_TWO), false);
  assert.strictEqual(buffer.remainingCapacity, SINGLE_SLOT_CAPACITY);
  const nextRound = createRound({roundId: ROUND_FIVE});
  assert.strictEqual(buffer.tryAdd(nextRound).accepted, true);
}

function testMissingRoundReturnsNull() {
  const buffer = new PreparedRoundBuffer();
  assert.strictEqual(buffer.get(DEFAULT_GAME_ID, MISSING_ROUND_ID), null);
  assert.strictEqual(buffer.consume(DEFAULT_GAME_ID, MISSING_ROUND_ID), null);
}

function testIdentityIncludesGameId() {
  const buffer = new PreparedRoundBuffer();
  const oldGame = createRound({gameId: OLD_GAME_ID, roundId: ROUND_ONE});
  const newGame = createRound({gameId: NEW_GAME_ID, roundId: ROUND_ONE});
  buffer.tryAdd(oldGame);
  buffer.tryAdd(newGame);
  assert.strictEqual(buffer.get(OLD_GAME_ID, ROUND_ONE), oldGame);
  assert.strictEqual(buffer.get(NEW_GAME_ID, ROUND_ONE), newGame);
}

function testClear() {
  const buffer = new PreparedRoundBuffer();
  buffer.tryAdd(createRound({roundId: ROUND_TWO}));
  buffer.clear();
  assert.strictEqual(buffer.size, EMPTY_SIZE);
  assert.strictEqual(buffer.isEmpty(), true);
  assert.strictEqual(buffer.has(DEFAULT_GAME_ID, ROUND_TWO), false);
}

function testRejectsInvalidRound() {
  const buffer = new PreparedRoundBuffer();
  const invalidRound = {
    gameId: DEFAULT_GAME_ID,
    roundId: ROUND_TWO,
    mode: 'UNKNOWN',
    song: {},
    resource: {},
  };
  assert.throws(() => buffer.tryAdd(invalidRound), /mode inválido/);
  assert.strictEqual(buffer.size, EMPTY_SIZE);
}

function testRejectsInvalidIdentities() {
  const buffer = new PreparedRoundBuffer();
  assert.throws(() => buffer.has(ZERO_ID, ROUND_ONE), TypeError);
  assert.throws(() => buffer.get(DEFAULT_GAME_ID, ZERO_ID), TypeError);
  assert.throws(
      () => buffer.consume(DEFAULT_GAME_ID, FRACTIONAL_ID),
      TypeError,
  );
}

test('empieza vacío con capacidad por defecto', testInitialState);
test('rechaza capacidades inválidas', testInvalidCapacities);
test('acepta una instancia PreparedRound', testAcceptsPreparedRound);
test('normaliza un objeto compatible', testNormalizesPlainObject);
test(
    'rechaza duplicados antes de verificar capacidad',
    testRejectsDuplicateBeforeFull,
);
test('rechaza elementos cuando está lleno', testRejectsWhenFull);
test('consume por identidad fuera de orden y reutiliza capacidad',
    testConsumesOutOfOrderAndReusesCapacity);
test('get y consume devuelven null si la ronda no existe',
    testMissingRoundReturnsNull);
test('distingue rondas de partidas diferentes', testIdentityIncludesGameId);
test('clear elimina las rondas almacenadas', testClear);
test('rechaza PreparedRound inválidos', testRejectsInvalidRound);
test('rechaza identidades inválidas', testRejectsInvalidIdentities);
