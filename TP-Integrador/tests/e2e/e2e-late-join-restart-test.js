/**
 * @fileoverview E2E de late join y restart con rondas/audio (V4-C23).
 */

import {spawn} from 'child_process';
import assert from 'node:assert/strict';
import path from 'path';
import {fileURLToPath} from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_PORT = 3206;
const DEFAULT_ROUNDS = 3;
const DEFAULT_ANSWER = 'E2E C23 SONG';
const TIMEOUT_MS = 25000;
const CONNECT_SETTLE_MS = 150;
const LATE_JOIN_DELAY_MS = 220;
const PRE_RESTART_WAIT_MS = 120;
const ROUND_STEP_MS = 240;
const GAME_OVER_WAIT_MS = 450;
const POST_RESTART_WAIT_MS = 500;
const ZERO_ERRORS = 0;
const MIN_LATE_JOIN_ROUNDS = 1;
const MIN_GAME_OVERS = 2;

const PORT = Number.parseInt(process.env.C23_PORT || String(DEFAULT_PORT), 10);
const ROUNDS = Number.parseInt(
    process.env.C23_ROUNDS || String(DEFAULT_ROUNDS),
    10,
);
const ANSWER = process.env.C23_ANSWER || DEFAULT_ANSWER;

function buildServerEnv() {
  return {
    ...process.env,
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: String(ROUNDS),
    TRIVIA_TEST_START_DELAY_MS: '250',
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

function createPlayerRecord(name, ws) {
  return {
    name,
    ws,
    joined: false,
    roundsSeen: [],
    gameOverCount: 0,
  };
}

function handlePlayerMessage(player, msg, state, log) {
  if (msg.type === 'WAITING_START') {
    player.joined = true;
    log(`[STATE] ${player.name} en WAITING_START`);
  } else if (msg.type === 'INIT_GAME' || msg.type === 'NEW_SONG') {
    player.joined = true;
    const round = msg.round ?? state.currentRound;
    const hasAudioRef = Boolean(msg.audioUrl || msg.song);
    player.roundsSeen.push({round, hasAudioRef});
    log(`[ROUND] ${player.name} r=${round} audio=${hasAudioRef}`);
  } else if (msg.type === 'GAME_OVER') {
    player.gameOverCount += 1;
    log(`[GAME_OVER] ${player.name} (#${player.gameOverCount})`);
  }
}

function attachPlayerHandlers(player, state, log, reject) {
  const {name, ws} = player;
  ws.on('open', () => {
    log(`[WS] ${name} conectado -> JOIN`);
    ws.send(JSON.stringify({type: 'JOIN', username: name}));
  });
  ws.on('message', (raw) => {
    handlePlayerMessage(player, JSON.parse(raw.toString()), state, log);
  });
  ws.on('error', reject);
}

function connectPlayer(name, state, log) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const player = createPlayerRecord(name, ws);
    attachPlayerHandlers(player, state, log, reject);
    state.players.push(player);
    setTimeout(() => resolve(player), CONNECT_SETTLE_MS);
  });
}

function inspectServerLine(line, state) {
  if (/ERROR|Queue.*error|Unhandled/i.test(line)) {
    state.errors.push(line.trim());
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

function sendAnswer(player, log, tag) {
  if (player.ws.readyState === WebSocket.OPEN) {
    log(`[ANSWER:${tag}] ${player.name} responde`);
    player.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
  }
}

function sendRestartToAll(players, log, phase) {
  log(`[${phase}] Enviando RESTART`);
  for (const player of players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({type: 'RESTART'}));
    }
  }
}

async function runRoundsAndRestart(p1, p2, state, log) {
  sendRestartToAll([p1], log, 'RESTART-PRE');
  await sleep(PRE_RESTART_WAIT_MS);
  for (let r = 1; r <= ROUNDS; r += 1) {
    state.currentRound = r;
    sendAnswer(p1, log, `r${r}`);
    sendAnswer(p2, log, `r${r}`);
    await sleep(ROUND_STEP_MS);
  }
  await sleep(GAME_OVER_WAIT_MS);
  const gameOverCount = p1.gameOverCount + p2.gameOverCount;
  sendRestartToAll([p1, p2], log, 'RESTART-POST');
  await sleep(POST_RESTART_WAIT_MS);
  return gameOverCount;
}

function teardownSession(players, server) {
  for (const player of players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.close();
    }
  }
  server.kill('SIGTERM');
}

function assertScenarioOutcome(state, p1, p2, gameOverCount) {
  assert.equal(state.errors.length, ZERO_ERRORS, 'Sin errores en cola');
  assert.ok(p1.joined && p2.joined, 'Ambos jugadores deben unirse');
  assert.ok(
      p2.roundsSeen.length >= MIN_LATE_JOIN_ROUNDS,
      'Late join debe recibir rondas',
  );
  assert.ok(gameOverCount >= MIN_GAME_OVERS, 'Ambos deben llegar a GAME_OVER');
  for (const seen of [...p1.roundsSeen, ...p2.roundsSeen]) {
    assert.ok(seen.hasAudioRef, 'Cada ronda debe tener referencia de audio');
  }
}

async function runScenario() {
  const logs = [];
  const log = (line) => logs.push(`[${new Date().toISOString()}] ${line}`);
  const state = {currentRound: 1, players: [], errors: []};
  const server = startServer();
  await waitForServer(server, state);
  const p1 = await connectPlayer('Jugador-1', state, log);
  await sleep(LATE_JOIN_DELAY_MS);
  const p2 = await connectPlayer('Jugador-2-LateJoin', state, log);
  await sleep(LATE_JOIN_DELAY_MS);
  const gameOverCount = await runRoundsAndRestart(p1, p2, state, log);
  teardownSession(state.players, server);
  console.log('\n=== EVIDENCIA E2E V4-C23 ===\n' + logs.join('\n') + '\n');
  assertScenarioOutcome(state, p1, p2, gameOverCount);
}

runScenario().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
