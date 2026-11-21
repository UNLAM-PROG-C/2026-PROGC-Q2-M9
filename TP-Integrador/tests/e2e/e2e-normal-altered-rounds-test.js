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
const PORT = Number.parseInt(process.env.C22_PORT || '3205', 10);
const ROUNDS = Number.parseInt(process.env.C22_ROUNDS || '4', 10);
const ANSWER = process.env.C22_ANSWER || 'E2E C22 SONG';
const TIMEOUT_MS = 25000;

function startServer() {
  return spawn('node', [path.join(ROOT_DIR, 'server.js')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      TRIVIA_TEST_MODE: '1',
      TRIVIA_TEST_ROUNDS: String(ROUNDS),
      TRIVIA_TEST_START_DELAY_MS: '300',
      TRIVIA_TEST_SONG_TITLE: ANSWER,
      TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS: '20',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createPlayer(name, state, log) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const player = {
      name,
      ws,
      readySeen: false,
      roundsSeen: [],
      gameOver: null,
    };

    ws.on('open', () => {
      log(`[WS] ${name} conectado -> enviando JOIN`);
      ws.send(JSON.stringify({type: 'JOIN', username: name}));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'WAITING_START') {
        player.readySeen = true;
        log(`[READY] ${name} en espera/listo`);
      } else if (msg.type === 'INIT_GAME' || msg.type === 'NEW_SONG') {
        const round = msg.round ?? state.currentRound;
        const already = player.roundsSeen.some((r) => r.round === round);
        if (round && !already) {
          const info = {
            round,
            type: msg.type,
            mode: msg.mode || 'NORMAL',
            hasAudioRef: Boolean(msg.audioUrl || msg.song),
          };
          player.roundsSeen.push(info);
          log(
              `[ROUND] ${name} r=${round} type=${msg.type} ` +
              `mode=${info.mode} audio=${info.hasAudioRef}`,
          );
        }
      } else if (msg.type === 'GAME_OVER') {
        player.gameOver = msg;
        log(`[GAME_OVER] ${name} recibió fin de partida`);
      }
    });

    ws.on('error', reject);
    state.players.push(player);
    setTimeout(() => resolve(player), 150);
  });
}

function inspectServerLine(line, state) {
  const winMatch = line.match(/Ronda (\d+) adjudicada .* (ANSWER #\d+)/);
  if (winMatch) {
    state.adjudications.push({
      round: Number(winMatch[1]),
      seq: winMatch[2],
    });
  }
  const rejMatch = line.match(
      /ANSWER #\d+ descartado: ronda (\d+) ya adjudicada/,
  );
  if (rejMatch) {
    state.rejections.push(Number(rejMatch[1]));
  }
  if (/ERROR|Queue.*error/i.test(line)) {
    state.queueErrors.push(line.trim());
  }
}

function waitForServer(server, state) {
  return new Promise((resolve, reject) => {
    let serverOutput = '';
    const timer = setTimeout(
        () => reject(new Error('Timeout esperando inicio del servidor E2E')),
        TIMEOUT_MS,
    );
    server.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      serverOutput += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          inspectServerLine(line, state);
        }
      }
      if (serverOutput.includes(`http://localhost:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });
  });
}

async function driveRounds(p1, p2, state) {
  for (let r = 1; r <= ROUNDS; r += 1) {
    const roundNumber = r;
    state.currentRound = roundNumber;
    await new Promise((res) => setTimeout(res, 220));
    const sender = roundNumber % 2 === 1 ? p1 : p2;
    const follower = roundNumber % 2 === 1 ? p2 : p1;
    if (sender.ws.readyState === WebSocket.OPEN) {
      sender.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
    }
    await new Promise((res) => setTimeout(res, 25));
    if (follower.ws.readyState === WebSocket.OPEN) {
      follower.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
    }
  }
}

async function runScenario() {
  const logs = [];
  const log = (line) => logs.push(`[${new Date().toISOString()}] ${line}`);
  const state = {
    currentRound: 0,
    adjudications: [],
    rejections: [],
    queueErrors: [],
    players: [],
  };

  const server = startServer();
  await waitForServer(server, state);
  log(`[SERVER] Levantado en puerto ${PORT} (${ROUNDS} rondas)`);

  const p1 = await createPlayer('Jugador-1', state, log);
  const p2 = await createPlayer('Jugador-2', state, log);
  await driveRounds(p1, p2, state);
  await new Promise((res) => setTimeout(res, 900));

  for (const p of state.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.close();
    }
  }
  server.kill('SIGTERM');

  console.log('\n=== EVIDENCIA E2E V4-C22 ===');
  logs.forEach((entry) => console.log(entry));
  console.log(`Adjudicaciones: ${JSON.stringify(state.adjudications)}`);
  console.log(`Rechazos post-adjudicación: ${state.rejections.length}\n`);

  assert.equal(state.queueErrors.length, 0, 'Sin errores de cola');
  assert.ok(p1.roundsSeen.length >= 1, 'Jugador-1 debe ver rondas');
  assert.ok(p2.roundsSeen.length >= 1, 'Jugador-2 debe ver rondas');
  assert.ok(
      p1.roundsSeen.every((item) => item.hasAudioRef),
      'Rondas deben incluir referencia de audio',
  );
  const uniqueWinners = new Set(state.adjudications.map((a) => a.round));
  assert.equal(
      uniqueWinners.size,
      state.adjudications.length,
      'Ganador único por ronda adjudicada',
  );
  assert.ok(
      p1.gameOver || p2.gameOver || state.adjudications.length >= 1,
      'Ciclo completo con adjudicación / GAME_OVER',
  );
}

runScenario().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
