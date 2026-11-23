import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import WebSocket from 'ws';

const PORT = 3218;
const SERVER_URL = `ws://localhost:${PORT}`;

function startServer() {
  return spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TRIVIA_TEST_MODE: '1',
      TRIVIA_TEST_ROUNDS: '1',
      TRIVIA_TEST_START_DELAY_MS: '2000',
      TRIVIA_TEST_ROUND_TIMEOUT_SECONDS: '10',
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

function connectClient(name, messages) {
  const ws = new WebSocket(SERVER_URL);
  ws.on('open', () => {
    ws.send(JSON.stringify({type: 'JOIN', username: name}));
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

function hasType(messages, type) {
  return messages.some((item) => item.type === type);
}

function hasAttemptLimit(messages) {
  return messages.some((item) =>
    item.type === 'ANSWER_REJECTED' &&
    item.reason === 'ATTEMPT_LIMIT_REACHED');
}

function hasExhaustedRound(messages) {
  return messages.some((item) =>
    item.type === 'ROUND_ENDED' &&
    item.reason === 'ATTEMPTS_EXHAUSTED');
}

function sendWrongAnswers(ws, prefix) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    ws.send(JSON.stringify({
      type: 'ANSWER',
      answer: `${prefix}-${attempt}`,
    }));
  }
}

function assertNoRoundEnd(messagesA, messagesB) {
  assert.equal(hasType(messagesA, 'ROUND_ENDED'), false);
  assert.equal(hasType(messagesB, 'ROUND_ENDED'), false);
}

function assertFinalScores(messages) {
  const gameOver = messages.find((item) => item.type === 'GAME_OVER');
  assert.ok(gameOver);
  assert.ok(gameOver.leaderboard.every((player) => player.score === 0));
}

function createScenario() {
  return {
    messagesA: [],
    messagesB: [],
    server: startServer(),
    clientA: null,
    clientB: null,
  };
}

async function connectScenario(scenario) {
  await waitForServerReady(scenario.server);
  scenario.clientA =
    connectClient('Jugador-A', scenario.messagesA);
  scenario.clientB =
    connectClient('Jugador-B', scenario.messagesB);
  await waitFor(() => hasType(scenario.messagesA, 'NEW_SONG'));
  await waitFor(() => hasType(scenario.messagesB, 'NEW_SONG'));
}

async function exhaustFirstPlayer(scenario) {
  sendWrongAnswers(scenario.clientA, 'error-a');
  await waitFor(() => hasAttemptLimit(scenario.messagesA));
  assertNoRoundEnd(scenario.messagesA, scenario.messagesB);
}

async function exhaustSecondPlayer(scenario) {
  sendWrongAnswers(scenario.clientB, 'error-b');
  await waitFor(() => hasExhaustedRound(scenario.messagesA));
  await waitFor(() => hasType(scenario.messagesA, 'GAME_OVER'));
  assertFinalScores(scenario.messagesA);
}

function closeScenario(scenario) {
  if (scenario.clientA) scenario.clientA.close();
  if (scenario.clientB) scenario.clientB.close();
  stopServer(scenario.server);
}

test('ronda termina sólo cuando todos agotan intentos', async () => {
  const scenario = createScenario();
  try {
    await connectScenario(scenario);
    await exhaustFirstPlayer(scenario);
    await exhaustSecondPlayer(scenario);
  } finally {
    closeScenario(scenario);
  }
});

