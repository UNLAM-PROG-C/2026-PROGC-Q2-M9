import assert from 'node:assert/strict';
import test from 'node:test';
import {GameCoordinator} from '../game/game-coordinator.js';

function createPlayer() {
  return {playerId: 'P001', displayName: 'Ale', score: 0, attempts: 0};
}

function createContext() {
  return {
    gameStarted: true,
    gameFinished: false,
    currentRound: 0,
    currentSongIndex: 0,
    maxRounds: 2,
    delayNextRound: 1,
    playlist: [{title: 'Correcta'}, {title: 'Otra'}],
  };
}

function createOutputs(messages) {
  return {
    buildWinnerView: (player) => player,
    sendToPlayer: (_playerId, message) => messages.push(message),
    broadcast: () => {},
    broadcastLeaderboard: () => {},
    finishGame: () => {},
    scheduleNextRound: () => {},
    log: () => {},
  };
}

function createHarness() {
  const player = createPlayer();
  const context = createContext();
  const messages = [];
  const coordinator = new GameCoordinator({
    playersById: new Map([[player.playerId, player]]),
    normalizeText: (value) => String(value).toLowerCase(),
    getRoundContext: () => context,
    getMaxWrongAttempts: () => 5,
    ...createOutputs(messages),
  });
  coordinator.beginRound(1);
  return {player, messages, coordinator};
}

function createEvent(sequence, answer = 'incorrecta') {
  return {
    sequence,
    playerId: 'P001',
    roundId: 1,
    answer,
    receivedAt: sequence,
  };
}

function isAttemptLimit(message) {
  return message.type === 'ANSWER_REJECTED' &&
    message.reason === 'ATTEMPT_LIMIT_REACHED';
}

test('quinto error bloquea respuestas posteriores', () => {
  const {coordinator, player, messages} = createHarness();
  for (let sequence = 1; sequence <= 5; sequence++) {
    coordinator.processAnswerEvent(createEvent(sequence));
  }
  assert.equal(player.attempts, 5);
  assert.equal(messages.filter(isAttemptLimit).length, 1);
  coordinator.processAnswerEvent(createEvent(6, 'Correcta'));
  assert.equal(player.score, 0);
  assert.equal(player.attempts, 5);
  assert.equal(messages.filter(isAttemptLimit).length, 2);
});
