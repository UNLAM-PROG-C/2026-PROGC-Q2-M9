import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const TIMEOUT_PORT = 3224;
const RESET_PORT = 3225;

function buildEnv(port, timeoutMs, warningMs) {
  return {
    ...process.env,
    PORT: String(port),
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: '3',
    TRIVIA_TEST_START_DELAY_MS: '5000',
    TRIVIA_TEST_READY_TIMEOUT_MS: String(timeoutMs),
    TRIVIA_TEST_READY_WARNING_MS: String(warningMs),
  };
}

function startServer(port, timeoutMs, warningMs) {
  const server = spawn(process.execPath, ['server.js'], {
    env: buildEnv(port, timeoutMs, warningMs),
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
}

function connectPlayer(port, name) {
  const player = {
    ws: new WebSocket(`ws://localhost:${port}`),
    messages: [],
    closed: false,
    closeCode: null,
    playerId: null,
  };
  attachPlayerHandlers(player, name);
  return player;
}

function attachPlayerHandlers(player, name) {
  player.ws.on('open', () => sendJoin(player, name));
  player.ws.on('message', (raw) => recordMessage(player, raw));
  player.ws.on('close', (code) => {
    player.closed = true;
    player.closeCode = code;
  });
}

function sendJoin(player, name) {
  player.ws.send(JSON.stringify({type: 'JOIN', username: name}));
}

function recordMessage(player, raw) {
  const message = JSON.parse(raw.toString());
  player.messages.push(message);
  if (message.type === 'PLAYER_REGISTERED') {
    player.playerId = message.playerId;
  }
}

function sendReadyAction(player, type) {
  player.ws.send(JSON.stringify({type}));
}

function hasMessage(player, type) {
  return player.messages.some((message) => message.type === type);
}

function latestSession(player) {
  return player.messages
      .filter((message) => message.type === 'SESSION_STATE')
      .at(-1);
}

function waitFor(predicate, timeoutMs = 4000) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(server) {
  await waitFor(() => server.logs.includes('Servidor web corriendo'));
}

async function waitForRegistered(player) {
  await waitFor(() => Boolean(player.playerId));
}

async function waitForReadyState(player, expected) {
  await waitFor(() => {
    const readyIds = latestSession(player)?.readyPlayerIds || [];
    return readyIds.includes(player.playerId) === expected;
  });
}

function closePlayer(player) {
  if (player?.ws.readyState === WebSocket.OPEN) player.ws.close();
}

function stopServer(server) {
  if (!server.killed) server.kill();
}

async function verifyReadyTimeout(player) {
  await waitFor(() => hasMessage(player, 'READY_WARNING'));
  assert.equal(player.closed, false);
  await waitFor(() => hasMessage(player, 'READY_TIMEOUT'));
  await waitFor(() => player.closed);
  assert.equal(player.closeCode, 4000);
}

async function runTimeoutScenario() {
  const server = startServer(TIMEOUT_PORT, 700, 250);
  let player;
  try {
    await waitForServer(server);
    player = connectPlayer(TIMEOUT_PORT, 'Jugador-Timeout');
    await waitForRegistered(player);
    await verifyReadyTimeout(player);
  } finally {
    closePlayer(player);
    stopServer(server);
  }
}

async function prepareUnreadyScenario(server) {
  await waitForServer(server);
  const player = connectPlayer(RESET_PORT, 'Jugador-UNREADY');
  await waitForRegistered(player);
  sendReadyAction(player, 'READY');
  await waitForReadyState(player, true);
  await sleep(700);
  sendReadyAction(player, 'UNREADY');
  await waitForReadyState(player, false);
  return player;
}

async function verifyRestartedDeadline(player) {
  await sleep(650);
  assert.equal(player.closed, false);
  assert.equal(hasMessage(player, 'READY_TIMEOUT'), false);
  await waitFor(() => hasMessage(player, 'READY_WARNING'));
  await waitFor(() => hasMessage(player, 'READY_TIMEOUT'));
  await waitFor(() => player.closed);
  assert.equal(player.closeCode, 4000);
}

async function runUnreadyScenario() {
  const server = startServer(RESET_PORT, 1200, 300);
  let player;
  try {
    player = await prepareUnreadyScenario(server);
    await verifyRestartedDeadline(player);
  } finally {
    closePlayer(player);
    stopServer(server);
  }
}

test(
    'READY warning y timeout excluyen jugador no listo',
    runTimeoutScenario,
);

test(
    'UNREADY reinicia el plazo completo de READY',
    runUnreadyScenario,
);
