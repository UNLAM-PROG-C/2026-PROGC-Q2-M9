import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const PORT = 3226;
const SONG = 'ALT02 TEST SONG';

function buildEnv() {
  return {
    ...process.env,
    PORT: String(PORT),
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: '1',
    TRIVIA_TEST_START_DELAY_MS: '900',
    TRIVIA_TEST_GAME_OVER_DISPLAY_MS: '350',
  };
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], {
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  captureServerLogs(server);
  return server;
}

function captureServerLogs(server) {
  server.logs = '';
  server.stdout.on('data', (chunk) => {
    server.logs += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    server.logs += chunk.toString();
  });
}

function connectPlayer() {
  const player = {
    ws: new WebSocket(`ws://localhost:${PORT}`),
    messages: [],
    playerId: null,
  };
  attachPlayerHandlers(player);
  return player;
}

function attachPlayerHandlers(player) {
  player.ws.on('open', () => {
    player.ws.send(JSON.stringify({type: 'JOIN', username: 'Jugador'}));
  });
  player.ws.on('message', (raw) => {
    recordMessage(player, raw);
  });
}

function recordMessage(player, raw) {
  const message = JSON.parse(raw.toString());
  player.messages.push(message);
  if (message.type === 'PLAYER_REGISTERED') {
    player.playerId = message.playerId;
  }
}

function messagesOf(player, type) {
  return player.messages.filter((message) => message.type === type);
}

function latestMessage(player, type) {
  return messagesOf(player, type).at(-1);
}

function waitFor(predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(
        () => pollCondition(predicate, startedAt, timer, resolve, reject),
        25,
    );
  });
}

function pollCondition(predicate, startedAt, timer, resolve, reject) {
  if (predicate()) {
    clearInterval(timer);
    resolve();
    return;
  }
  if (Date.now() - startedAt <= 4000) return;
  clearInterval(timer);
  reject(new Error('Timeout esperando condición'));
}

async function preparePlayer(server) {
  await waitFor(() => server.logs.includes('Servidor web corriendo'));
  const player = connectPlayer();
  await waitFor(() => Boolean(player.playerId));
  return player;
}

async function markReady(player) {
  player.ws.send(JSON.stringify({type: 'READY'}));
  await waitFor(() => {
    const state = latestMessage(player, 'SESSION_STATE');
    return state?.readyPlayerIds?.includes(player.playerId);
  });
}

async function finishGame(player) {
  await waitFor(() => messagesOf(player, 'NEW_SONG').length > 0);
  const state = latestMessage(player, 'SESSION_STATE');
  player.initialGameId = state.gameId;
  player.ws.send(JSON.stringify({type: 'ANSWER', answer: SONG}));
  await waitFor(() => messagesOf(player, 'GAME_OVER').length > 0);
}

function verifyGameOver(player) {
  const gameOver = latestMessage(player, 'GAME_OVER');
  assert.equal(gameOver.leaderboard.length, 1);
  assert.equal(gameOver.leaderboard[0].score, 100);
  assert.equal(player.ws.readyState, WebSocket.OPEN);
}

async function verifyAutomaticReset(player) {
  await waitFor(() => messagesOf(player, 'GAME_RESET').length > 0);
  await waitFor(() => {
    const state = latestMessage(player, 'SESSION_STATE');
    return state?.gameId === player.initialGameId + 1;
  });
  verifyResetState(player);
}

function verifyResetState(player) {
  const state = latestMessage(player, 'SESSION_STATE');
  const leaderboard = latestMessage(player, 'UPDATE_LEADERBOARD');
  assert.equal(state.sessionState, 'LOBBY');
  assert.equal(state.readyCount, 0);
  assert.equal(leaderboard.leaderboard[0].score, 0);
  assert.equal(player.ws.readyState, WebSocket.OPEN);
}

function closeScenario(server, player) {
  if (player?.ws.readyState === WebSocket.OPEN) player.ws.close();
  if (!server.killed) server.kill();
}

async function runAutoRestartScenario() {
  const server = startServer();
  let player;
  try {
    player = await preparePlayer(server);
    await markReady(player);
    await finishGame(player);
    verifyGameOver(player);
    await verifyAutomaticReset(player);
  } finally {
    closeScenario(server, player);
  }
}

test(
    'GAME_OVER reinicia automáticamente conservando la conexión',
    runAutoRestartScenario,
);
