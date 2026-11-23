import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const PORT = 3217;
const SERVER_URL = `ws://localhost:${PORT}`;

function startServer() {
  return spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRIVIA_TEST_MODE: '1',
      TRIVIA_TEST_ROUNDS: '2',
      TRIVIA_TEST_START_DELAY_MS: '500',
      TRIVIA_TEST_ROUND_TIMEOUT_SECONDS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForServerReady(server, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
        () => reject(new Error('Servidor no inició a tiempo')),
        timeoutMs,
    );
    server.stdout.on('data', (chunk) => {
      if (!chunk.toString().includes('Servidor web corriendo')) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

function connectClient(messages) {
  const ws = new WebSocket(SERVER_URL);
  ws.on('open', () => {
    ws.send(JSON.stringify({type: 'JOIN', username: 'Timeout-Test'}));
  });
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
  });
  return ws;
}

function waitFor(predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) return finish(timer, resolve);
      if (Date.now() - startedAt > timeoutMs) {
        finish(timer, () => reject(new Error('Timeout esperando evento')));
      }
    }, 25);
  });
}

function finish(timer, callback) {
  clearInterval(timer);
  callback();
}

function stopServer(server) {
  if (!server.killed) server.kill();
}

function assertTimeoutFlow(messages) {
  const ended = messages.filter((item) => item.type === 'ROUND_ENDED');
  assert.equal(ended.length, 2);
  assert.ok(ended.every((item) => item.reason === 'TIMEOUT'));
  const gameOver = messages.find((item) => item.type === 'GAME_OVER');
  assert.ok(gameOver);
  assert.ok(gameOver.leaderboard.every((player) => player.score === 0));
}

test('timeout termina ronda y avanza sin otorgar puntos', async () => {
  const messages = [];
  const server = startServer();
  let ws;

  try {
    await waitForServerReady(server);
    ws = connectClient(messages);
    await waitFor(() => messages.some((item) => item.type === 'GAME_OVER'));
    assertTimeoutFlow(messages);
  } finally {
    if (ws) ws.close();
    stopServer(server);
  }
});
