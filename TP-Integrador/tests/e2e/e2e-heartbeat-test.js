import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const PORT = 3223;
const URL = `ws://localhost:${PORT}`;

function buildEnv() {
  return {
    ...process.env,
    PORT: String(PORT),
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: '3',
    TRIVIA_TEST_START_DELAY_MS: '3000',
    TRIVIA_TEST_HEARTBEAT_INTERVAL_MS: '250',
  };
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], {
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.logs = '';
  server.stdout.on('data', (chunk) => {
    server.logs += chunk.toString();
  });
  return server;
}

function connectPlayer(name, autoPong = true) {
  const player = {
    ws: new WebSocket(URL, {autoPong}),
    messages: [],
    closed: false,
  };
  attachPlayerHandlers(player, name);
  return player;
}

function attachPlayerHandlers(player, name) {
  player.ws.on('open', () => {
    player.ws.send(JSON.stringify({type: 'JOIN', username: name}));
  });
  player.ws.on('message', (raw) => {
    player.messages.push(JSON.parse(raw.toString()));
  });
  player.ws.on('close', () => {
    player.closed = true;
  });
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

function latestLeaderboard(messages) {
  return messages
      .filter((item) => item.type === 'UPDATE_LEADERBOARD')
      .at(-1)?.leaderboard || [];
}

function latestSession(messages) {
  return messages
      .filter((item) => item.type === 'SESSION_STATE')
      .at(-1);
}

async function waitForServer(server) {
  await waitFor(() => server.logs.includes('Servidor web corriendo'));
}

async function waitForPair(player) {
  await waitFor(() => latestLeaderboard(player.messages).length === 2);
}

async function waitForHeartbeatRemoval(healthy, silent) {
  await waitFor(() =>
    silent.closed &&
    latestLeaderboard(healthy.messages).length === 1);
}

function assertHeartbeatResult(healthy) {
  const leaderboard = latestLeaderboard(healthy.messages);
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].displayName, 'Jugador-Sano');
  const state = latestSession(healthy.messages);
  assert.equal(state.connectedCount, 1);
}

function stopScenario(server, players) {
  players.forEach((player) => {
    if (player?.ws.readyState === WebSocket.OPEN) player.ws.close();
  });
  if (!server.killed) server.kill();
}

async function runHeartbeatScenario() {
  const server = startServer();
  let healthy;
  let silent;
  try {
    await waitForServer(server);
    healthy = connectPlayer('Jugador-Sano');
    silent = connectPlayer('Jugador-Sin-Pong', false);
    await waitForPair(healthy);
    await waitForHeartbeatRemoval(healthy, silent);
    assertHeartbeatResult(healthy);
  } finally {
    stopScenario(server, [healthy, silent]);
  }
}

test(
    'heartbeat elimina cliente que no responde pong',
    runHeartbeatScenario,
);
