/**
 * @fileoverview E2E principal: READY hasta GAME_OVER con 2 jugadores (V4-C22).
 */

import {spawn} from 'child_process';
import assert from 'node:assert/strict';
import path from 'path';
import {fileURLToPath} from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_PORT = 3205;
const DEFAULT_ROUNDS = 4;
const DEFAULT_ANSWER = 'E2E C22 SONG';
const TIMEOUT_MS = 25000;
const CONNECT_SETTLE_MS = 150;
const ROUND_ANSWER_DELAY_MS = 220;
const FOLLOWER_DELAY_MS = 25;
const FINAL_DRAIN_MS = 900;
const ZERO_COUNT = 0;
const MIN_ROUNDS_SEEN = 1;
const MIN_ADJUDICATIONS = 1;
const PARITY_DIVISOR = 2;
const FIRST_ROUND = 1;

const PORT = Number.parseInt(process.env.C22_PORT || String(DEFAULT_PORT), 10);
const ROUNDS = Number.parseInt(
    process.env.C22_ROUNDS || String(DEFAULT_ROUNDS),
    10,
);
const ANSWER = process.env.C22_ANSWER || DEFAULT_ANSWER;

function buildServerEnv() {
  return {
    ...process.env,
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: String(ROUNDS),
    TRIVIA_TEST_START_DELAY_MS: '300',
    TRIVIA_TEST_SONG_TITLE: ANSWER,
    TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS: '20',
    PORT: String(PORT),
  };
}

function startServer() {
  return spawn('node', [path.join(ROOT_DIR, 'server.js')], {
    cwd: ROOT_DIR,
    env: buildServerEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createPlayerModel(name, ws) {
  return {
    name,
    ws,
    readySeen: false,
    roundsSeen: [],
    gameOver: null,
  };
}

function recordRoundMsg(player, msg, state, log) {
  const round = msg.round ?? state.currentRound;
  const already = player.roundsSeen.some((entry) => entry.round === round);
  if (!round || already) {
    return;
  }
  const hasAudioRef = Boolean(msg.audioUrl || msg.song);
  player.roundsSeen.push({round, hasAudioRef});
  log(`[ROUND] ${player.name} r=${round} audio=${hasAudioRef}`);
}

function handlePlayerMsg(player, msg, state, log) {
  if (msg.type === 'WAITING_START') {
    player.readySeen = true;
    log(`[READY] ${player.name} en espera/listo`);
  } else if (msg.type === 'INIT_GAME' || msg.type === 'NEW_SONG') {
    recordRoundMsg(player, msg, state, log);
  } else if (msg.type === 'GAME_OVER') {
    player.gameOver = msg;
    log(`[GAME_OVER] ${player.name} recibió fin de partida`);
  }
}

function createPlayer(name, state, log) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const player = createPlayerModel(name, ws);
    ws.on('open', () => {
      log(`[WS] ${name} conectado -> enviando JOIN`);
      ws.send(JSON.stringify({type: 'JOIN', username: name}));
    });
    ws.on('message', (raw) => {
      handlePlayerMsg(player, JSON.parse(raw.toString()), state, log);
    });
    ws.on('error', reject);
    state.players.push(player);
    setTimeout(() => resolve(player), CONNECT_SETTLE_MS);
  });
}

function inspectServerLine(line, state) {
  const winMatch = line.match(/Ronda (\d+) adjudicada[^\n]*ANSWER #(\d+)/);
  if (winMatch) {
    const round = Number(winMatch[1]);
    if (!state.adjudicatedRounds.includes(round)) {
      state.adjudicatedRounds.push(round);
    }
  }
  if (/ERROR|Queue.*error/i.test(line)) {
    state.queueErrors.push(line.trim());
  }
}

function processServerChunk(chunk, state, stateRef, resolve, timer) {
  stateRef.out += chunk.toString();
  for (const line of stateRef.out.split(/\r?\n/)) {
    if (line.trim()) {
      inspectServerLine(line, state);
    }
  }
  if (stateRef.out.includes(`http://localhost:${PORT}`)) {
    clearTimeout(timer);
    resolve();
  }
}

function waitForServer(server, state) {
  return new Promise((resolve, reject) => {
    const stateRef = {out: ''};
    const timer = setTimeout(
        () => reject(new Error('Timeout esperando inicio del servidor E2E')),
        TIMEOUT_MS,
    );
    server.stdout.on('data', (chunk) => {
      processServerChunk(chunk, state, stateRef, resolve, timer);
    });
    server.stderr.on('data', (chunk) => {
      stateRef.out += chunk.toString();
    });
  });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function sendAnswerIfOpen(player) {
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
  }
}

async function driveRounds(p1, p2, state) {
  for (let r = FIRST_ROUND; r <= ROUNDS; r += FIRST_ROUND) {
    state.currentRound = r;
    await sleep(ROUND_ANSWER_DELAY_MS);
    const oddRound = r % PARITY_DIVISOR === FIRST_ROUND;
    sendAnswerIfOpen(oddRound ? p1 : p2);
    await sleep(FOLLOWER_DELAY_MS);
    sendAnswerIfOpen(oddRound ? p2 : p1);
  }
}

function teardownSession(players, server) {
  for (const player of players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.close();
    }
  }
  server.kill('SIGTERM');
}

function assertAdjudications(adjudicatedRounds) {
  assert.ok(
      adjudicatedRounds.length >= MIN_ADJUDICATIONS,
      'Debe haber al menos una ronda adjudicada',
  );
  const uniqueRounds = new Set(adjudicatedRounds);
  assert.equal(
      uniqueRounds.size,
      adjudicatedRounds.length,
      'Ganador único por ronda adjudicada',
  );
}

function assertScenarioResult(state, p1, p2) {
  assert.equal(state.queueErrors.length, ZERO_COUNT, 'Sin errores de cola');
  assert.ok(p1.roundsSeen.length >= MIN_ROUNDS_SEEN, 'Jugador-1 ve rondas');
  assert.ok(p2.roundsSeen.length >= MIN_ROUNDS_SEEN, 'Jugador-2 ve rondas');
  assert.ok(
      p1.roundsSeen.every((item) => item.hasAudioRef),
      'Rondas con referencia de audio',
  );
  assertAdjudications(state.adjudicatedRounds);
  assert.ok(
      p1.gameOver || p2.gameOver,
      'Ciclo completo con llegada a GAME_OVER',
  );
}

async function runScenario() {
  const logs = [];
  const log = (line) => logs.push(`[${new Date().toISOString()}] ${line}`);
  const state = {
    currentRound: ZERO_COUNT,
    adjudicatedRounds: [],
    queueErrors: [],
    players: [],
  };
  const server = startServer();
  await waitForServer(server, state);
  const p1 = await createPlayer('Jugador-1', state, log);
  const p2 = await createPlayer('Jugador-2', state, log);
  await driveRounds(p1, p2, state);
  await sleep(FINAL_DRAIN_MS);
  teardownSession(state.players, server);
  console.log('\n=== EVIDENCIA E2E V4-C22 ===\n' + logs.join('\n') + '\n');
  assertScenarioResult(state, p1, p2);
}

runScenario().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
