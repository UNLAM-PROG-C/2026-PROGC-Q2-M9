import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const ANSWER = 'T4 DISCONNECT SONG';
const START_DELAY_MS = '800';
const ROUND_TIMEOUT_SECONDS = '2';

function buildEnv(port, extra = {}) {
  return {
    ...process.env,
    PORT: String(port),
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: '2',
    TRIVIA_TEST_START_DELAY_MS: START_DELAY_MS,
    TRIVIA_TEST_ROUND_TIMEOUT_SECONDS: ROUND_TIMEOUT_SECONDS,
    TRIVIA_TEST_SONG_TITLE: ANSWER,
    ...extra,
  };
}

function startServer(port, extra = {}) {
  const server = spawn(process.execPath, ['server.js'], {
    env: buildEnv(port, extra),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.logs = '';
  server.stdout.on('data', (chunk) => {
    server.logs += chunk.toString();
  });
  return server;
}

function connectPlayer(port, name) {
  const player = {
    ws: new WebSocket(`ws://localhost:${port}`),
    messages: [],
  };
  player.ws.on('open', () => {
    player.ws.send(JSON.stringify({type: 'JOIN', username: name}));
  });
  player.ws.on('message', (raw) => {
    player.messages.push(JSON.parse(raw.toString()));
  });
  return player;
}

function waitFor(predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) return finish(timer, resolve);
      if (Date.now() - startedAt > timeoutMs) {
        finish(timer, () => reject(new Error('Timeout esperando condición')));
      }
    }, 25);
  });
}

function finish(timer, callback) {
  clearInterval(timer);
  callback();
}

function stopScenario(server, players) {
  players.forEach((player) => {
    if (player?.ws.readyState === WebSocket.OPEN) player.ws.close();
  });
  if (!server.killed) server.kill();
}

function latestLeaderboard(messages) {
  const updates = messages.filter((item) =>
    item.type === 'UPDATE_LEADERBOARD');
  return updates.at(-1)?.leaderboard || [];
}

function hasRound(messages, round) {
  return messages.some((item) =>
    (item.type === 'NEW_SONG' || item.type === 'INIT_GAME') &&
    (item.round ?? item.roundId) === round);
}

async function waitForServer(server) {
  await waitFor(() => server.logs.includes('Servidor web corriendo'));
}

async function waitForTwoPlayers(player) {
  await waitFor(() => latestLeaderboard(player.messages).length === 2);
}

async function startPair(port, extra = {}) {
  const server = startServer(port, extra);
  await waitForServer(server);
  const a = connectPlayer(port, 'Jugador-A');
  const b = connectPlayer(port, 'Jugador-B');
  await waitForTwoPlayers(b);
  return {server, a, b};
}

async function testLeaderboardRemoval() {
  const {server, a, b} = await startPair(3219);
  try {
    a.ws.close();
    await waitFor(() => latestLeaderboard(b.messages).length === 1);
    const leaderboard = latestLeaderboard(b.messages);
    assert.equal(leaderboard[0].displayName, 'Jugador-B');
  } finally {
    stopScenario(server, [a, b]);
  }
}

async function scoreFirstRound(player) {
  await waitFor(() => hasRound(player.messages, 1));
  const answer = JSON.stringify({type: 'ANSWER', answer: ANSWER});
  player.ws.send(answer);
  await waitFor(() =>
    player.messages.some((item) => item.type === 'ROUND_WINNER'));
}

function assertFinalWinnerIsConnected(messages) {
  const gameOver = messages.find((item) => item.type === 'GAME_OVER');
  assert.equal(gameOver.leaderboard.length, 1);
  assert.equal(gameOver.leaderboard[0].displayName, 'Jugador-B');
  assert.equal(gameOver.winner.displayName, 'Jugador-B');
  assert.equal(gameOver.winner.score, 0);
}

async function testDisconnectedWinnerExcluded() {
  const {server, a, b} = await startPair(3220);
  try {
    await scoreFirstRound(a);
    await waitFor(() => hasRound(b.messages, 2));
    a.ws.close();
    await waitFor(() =>
      b.messages.some((item) => item.type === 'GAME_OVER'));
    assertFinalWinnerIsConnected(b.messages);
  } finally {
    stopScenario(server, [a, b]);
  }
}

async function sendQueuedAnswerThenDisconnect(server, player) {
  const answer = JSON.stringify({type: 'ANSWER', answer: ANSWER});
  player.ws.send(answer);
  await waitFor(() => server.logs.includes('[Q+] ANSWER'));
  player.ws.close();
  await waitFor(() => server.logs.includes('está desconectado'));
}

function assertQueuedAnswerDidNotScore(messages) {
  const won = messages.some((item) => item.type === 'ROUND_WINNER');
  assert.equal(won, false);
  const leaderboard = latestLeaderboard(messages);
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].displayName, 'Jugador-B');
  assert.equal(leaderboard[0].score, 0);
}

async function testQueuedAnswerDiscarded() {
  const extra = {TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS: '400'};
  const {server, a, b} = await startPair(3221, extra);
  try {
    await waitFor(() => hasRound(a.messages, 1));
    await sendQueuedAnswerThenDisconnect(server, a);
    assertQueuedAnswerDidNotScore(b.messages);
  } finally {
    stopScenario(server, [a, b]);
  }
}

test(
    'desconectado desaparece del leaderboard',
    testLeaderboardRemoval,
);

test(
    'desconectado no puede ser ganador final',
    testDisconnectedWinnerExcluded,
);

test(
    'respuesta encolada de desconectado se descarta',
    testQueuedAnswerDiscarded,
);
