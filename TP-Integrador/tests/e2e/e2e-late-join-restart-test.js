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
    };

    ws.on('open', () => {
      log(`[WS] ${name} conectado -> JOIN`);
      ws.send(JSON.stringify({type: 'JOIN', username: name}));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'WAITING_START') {
        player.joined = true;
        log(`[STATE] ${name} en espera/listo`);
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
  if (/RESTART|restart/i.test(line)) {
    state.restartLogs.push(line.trim());
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

async function runScenario() {
  const logs = [];
  const log = (line) => logs.push(`[${new Date().toISOString()}] ${line}`);
  const state = {
    currentRound: 1,
    players: [],
    errors: [],
    restartLogs: [],
  };

  const server = startServer();
  await waitForServer(server, state);
  log(`[SERVER] Iniciado en ${PORT}`);

  const p1 = await connectPlayer('Jugador-1', state, log);
  await new Promise((res) => setTimeout(res, 180));

  // Late join de Jugador-2 con partida/ronda activa
  const p2 = await connectPlayer('Jugador-2-LateJoin', state, log);
  await new Promise((res) => setTimeout(res, 350));

  if (p1.ws.readyState === WebSocket.OPEN) {
    p1.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
  }
  await new Promise((res) => setTimeout(res, 120));

  // Solicitar RESTART (incluso con actividad/transición en curso)
  log('[RESTART] Solicitando RESTART en sesión');
  if (p1.ws.readyState === WebSocket.OPEN) {
    p1.ws.send(JSON.stringify({type: 'RESTART'}));
  }
  if (p2.ws.readyState === WebSocket.OPEN) {
    p2.ws.send(JSON.stringify({type: 'RESTART'}));
  }
  await new Promise((res) => setTimeout(res, 800));

  for (const p of state.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.close();
    }
  }
  server.kill('SIGTERM');

  console.log('\n=== EVIDENCIA E2E V4-C23 ===');
  logs.forEach((entry) => console.log(entry));
  console.log(`Errores: ${state.errors.length}\n`);

  assert.equal(state.errors.length, 0, 'Sin errores en servidor/cola');
  assert.ok(p1.joined, 'Jugador-1 debe quedar registrado');
  assert.ok(p2.joined, 'Jugador-2 (late join) debe quedar registrado');
  assert.ok(
      p1.roundsSeen.length + p2.roundsSeen.length >= 1,
      'Debe observarse flujo de rondas/audio durante la sesión',
  );
  for (const seen of [...p1.roundsSeen, ...p2.roundsSeen]) {
    assert.ok(seen.hasAudioRef, 'Cada ronda debe tener referencia de audio');
  }
}

runScenario().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
