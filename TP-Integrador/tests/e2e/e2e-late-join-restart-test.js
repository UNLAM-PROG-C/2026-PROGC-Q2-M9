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
const PORT = Number.parseInt(process.env.C23_PORT || '3206', 10);
const ROUNDS = Number.parseInt(process.env.C23_ROUNDS || '3', 10);
const ANSWER = process.env.C23_ANSWER || 'E2E C23 SONG';
const TIMEOUT_MS = 25000;

function startServer() {
  return spawn('node', [path.join(ROOT_DIR, 'server.js')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      TRIVIA_TEST_MODE: '1',
      TRIVIA_TEST_ROUNDS: String(ROUNDS),
      TRIVIA_TEST_START_DELAY_MS: '250',
      TRIVIA_TEST_SONG_TITLE: ANSWER,
      TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS: '20',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function connectPlayer(name, state, log) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const player = {
      name,
      ws,
      joined: false,
      roundsSeen: [],
      gameOverCount: 0,
      waitingStartCount: 0,
    };

    ws.on('open', () => {
      log(`[WS] ${name} conectado -> JOIN`);
      ws.send(JSON.stringify({type: 'JOIN', username: name}));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'WAITING_START') {
        player.joined = true;
        player.waitingStartCount += 1;
        log(`[STATE] ${name} en WAITING_START (#${player.waitingStartCount})`);
      } else if (msg.type === 'INIT_GAME' || msg.type === 'NEW_SONG') {
        player.joined = true;
        const round = msg.round ?? state.currentRound;
        const hasAudioRef = Boolean(msg.audioUrl || msg.song);
        player.roundsSeen.push({
          round,
          type: msg.type,
          mode: msg.mode || 'NORMAL',
          hasAudioRef,
        });
        log(
            `[ROUND] ${name} r=${round} type=${msg.type} ` +
            `mode=${msg.mode || 'NORMAL'} audio=${hasAudioRef}`,
        );
      } else if (msg.type === 'GAME_OVER') {
        player.gameOverCount += 1;
        log(`[GAME_OVER] ${name} (#${player.gameOverCount})`);
      }
    });

    ws.on('error', reject);
    state.players.push(player);
    setTimeout(() => resolve(player), 150);
  });
}

function inspectLine(line, state) {
  if (/ERROR|Queue.*error|Unhandled/i.test(line)) {
    state.errors.push(line.trim());
  }
  if (/RESTART/i.test(line)) {
    state.restartEvents.push(line.trim());
  }
}

function waitForServer(server, state) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(
        () => reject(new Error('Timeout esperando inicio del servidor E2E')),
        TIMEOUT_MS,
    );
    server.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      out += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          inspectLine(line, state);
        }
      }
      if (out.includes(`http://localhost:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => {
      out += chunk.toString();
    });
  });
}

function sendAnswer(player, log, tag) {
  if (player.ws.readyState === WebSocket.OPEN) {
    log(`[ANSWER:${tag}] ${player.name} responde`);
    player.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
  }
}

async function runScenario() {
  const logs = [];
  const log = (line) => logs.push(`[${new Date().toISOString()}] ${line}`);
  const state = {
    currentRound: 1,
    players: [],
    errors: [],
    restartEvents: [],
  };

  const server = startServer();
  await waitForServer(server, state);
  log(`[SERVER] Iniciado en ${PORT}`);

  const p1 = await connectPlayer('Jugador-1', state, log);
  await new Promise((res) => setTimeout(res, 220));

  // 1) Late join de Jugador-2 mientras ya hay partida/ronda activa
  const p2 = await connectPlayer('Jugador-2-LateJoin', state, log);
  await new Promise((res) => setTimeout(res, 220));

  // 2) Enviar RESTART prematuro (no debe cortar ni romper la partida en curso)
  log('[RESTART-PRE] Enviando RESTART antes de GAME_OVER');
  p1.ws.send(JSON.stringify({type: 'RESTART'}));
  await new Promise((res) => setTimeout(res, 120));

  // 3) Resolver rondas con respuestas de ambos jugadores hasta GAME_OVER
  for (let r = 1; r <= ROUNDS; r += 1) {
    state.currentRound = r;
    sendAnswer(p1, log, `r${r}`);
    sendAnswer(p2, log, `r${r}`);
    await new Promise((res) => setTimeout(res, 240));
  }
  await new Promise((res) => setTimeout(res, 450));

  const gameOverBeforeRestart = p1.gameOverCount + p2.gameOverCount;

  // 4) Enviar RESTART tras GAME_OVER y verificar estabilidad sin errores
  log('[RESTART-POST] Enviando RESTART tras GAME_OVER');
  if (p1.ws.readyState === WebSocket.OPEN) {
    p1.ws.send(JSON.stringify({type: 'RESTART'}));
  }
  if (p2.ws.readyState === WebSocket.OPEN) {
    p2.ws.send(JSON.stringify({type: 'RESTART'}));
  }
  await new Promise((res) => setTimeout(res, 500));

  for (const p of state.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.close();
    }
  }
  server.kill('SIGTERM');

  console.log('\n=== EVIDENCIA E2E V4-C23 ===');
  logs.forEach((entry) => console.log(entry));
  console.log(`Errores: ${state.errors.length}`);
  console.log(`Eventos RESTART en log server: ${state.restartEvents.length}\n`);

  assert.equal(state.errors.length, 0, 'Sin errores en servidor/cola');
  assert.ok(p1.joined && p2.joined, 'Ambos jugadores deben unirse');
  assert.ok(p2.roundsSeen.length >= 1, 'Late join debe recibir rondas');
  assert.ok(
      gameOverBeforeRestart >= 2,
      'Ambos jugadores deben alcanzar GAME_OVER al cerrar rondas',
  );
  for (const seen of [...p1.roundsSeen, ...p2.roundsSeen]) {
    assert.ok(seen.hasAudioRef, 'Cada ronda debe mantener referencia de audio');
  }
}

runScenario().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
