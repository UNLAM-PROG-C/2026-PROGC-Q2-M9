import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const PORT = 3222;
const URL = `ws://localhost:${PORT}`;

function buildServerEnv() {
  return {
    ...process.env,
    PORT: String(PORT),
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: '3',
    TRIVIA_TEST_START_DELAY_MS: '800',
    TRIVIA_TEST_ROUND_TIMEOUT_SECONDS: '10',
  };
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], {
    env: buildServerEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.logs = '';
  server.stdout.on('data', (chunk) => {
    server.logs += chunk.toString();
  });
  return server;
}

function connectPlayer(name) {
  const player = {ws: new WebSocket(URL), messages: []};
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

function latestSession(messages) {
  return messages
      .filter((item) => item.type === 'SESSION_STATE')
      .at(-1);
}

async function waitForServer(server) {
  await waitFor(() => server.logs.includes('Servidor web corriendo'));
}

async function waitForActive(player, connectedCount) {
  await waitFor(() => {
    const state = latestSession(player.messages);
    return state?.sessionState === 'ROUND_ACTIVE' &&
      state.connectedCount === connectedCount;
  });
}

function closePlayer(player) {
  if (player?.ws.readyState === WebSocket.OPEN) player.ws.close();
}

function stopServer(server) {
  if (!server.killed) server.kill();
}

async function verifySinglePlayerContinues(a, b) {
  await waitForActive(b, 2);
  const initial = latestSession(b.messages);
  closePlayer(a);
  await waitForActive(b, 1);
  assert.equal(latestSession(b.messages).gameId, initial.gameId);
  return initial.gameId;
}

async function verifyAbortAndLobby(server, b, initialGameId) {
  closePlayer(b);
  await waitFor(() =>
    server.logs.includes('Partida abortada por abandono total'));
  const c = connectPlayer('Jugador-C');
  await waitFor(() => latestSession(c.messages)?.sessionState === 'LOBBY');
  const state = latestSession(c.messages);
  assert.equal(state.gameId, initialGameId + 1);
  assert.equal(state.connectedCount, 1);
  return c;
}

function closeScenario(server, players) {
  players.forEach(closePlayer);
  stopServer(server);
}

async function runAbortScenario() {
  const server = startServer();
  const players = [];
  try {
    await waitForServer(server);
    players.push(connectPlayer('Jugador-A'));
    players.push(connectPlayer('Jugador-B'));
    const gameId = await verifySinglePlayerContinues(players[0], players[1]);
    players.push(
        await verifyAbortAndLobby(server, players[1], gameId),
    );
  } finally {
    closeScenario(server, players);
  }
}

test(
    'uno continúa y cero jugadores aborta a nuevo LOBBY',
    runAbortScenario,
);
