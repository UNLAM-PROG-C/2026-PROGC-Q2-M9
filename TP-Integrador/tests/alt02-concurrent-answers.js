/**
 * @fileoverview Harness ALT-02 de adjudicación concurrente.
 * Inicia un servidor aislado en modo de prueba y clientes WebSocket sin UI.
 * Todos envían la respuesta correcta conocida. La demora artificial permite
 * acumular respuestas antes del drenaje. No mide latencia de audio ni
 * simultaneidad física, y depende del formato de los logs del servidor.
 */
import {spawn} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROUNDS = Math.max(
    1, Number.parseInt(process.env.ALT02_ROUNDS || '20', 10),
);
const CLIENT_COUNT = Math.max(
    2, Number.parseInt(process.env.ALT02_CLIENTS || '2', 10),
);
const PORT = Number.parseInt(process.env.ALT02_PORT || '3199', 10);
const ANSWER = process.env.ALT02_ANSWER || 'ALT02 TEST SONG';
const START_DELAY_MS = Number.parseInt(
    process.env.ALT02_START_DELAY_MS || '1200', 10,
);
const TIMEOUT_MS = Number.parseInt(process.env.ALT02_TIMEOUT_MS || '30000', 10);
const QUEUE_DRAIN_DELAY_MS =
  Number.parseInt(process.env.ALT02_QUEUE_DRAIN_DELAY_MS || '50', 10);
const SETTLE_MS = Math.max(
    0, Number.parseInt(process.env.ALT02_SETTLE_MS || '100', 10),
);
const EXPECTED_WINNER = process.env.ALT02_EXPECTED_WINNER || null;
const LEAD_CLIENT_NUMBER = process.env.ALT02_LEAD_CLIENT ?
  Number.parseInt(process.env.ALT02_LEAD_CLIENT, 10) :
  null;
const offsetsText = process.env.ALT02_OFFSETS ||
  Array(CLIENT_COUNT).fill('0').join(',');
const OFFSETS = offsetsText.split(',').map((v) => Number.parseInt(v, 10));

if (OFFSETS.length !== CLIENT_COUNT || OFFSETS.some(Number.isNaN)) {
  throw new Error(
      `ALT02_OFFSETS debe contener ${CLIENT_COUNT} enteros, uno por cliente. ` +
    `Ejemplo: ${Array(CLIENT_COUNT).fill(0).join(',')}`,
  );
}

if (LEAD_CLIENT_NUMBER !== null &&
    (Number.isNaN(LEAD_CLIENT_NUMBER) || LEAD_CLIENT_NUMBER < 1 ||
    LEAD_CLIENT_NUMBER > CLIENT_COUNT)) {
  throw new Error(`ALT02_LEAD_CLIENT debe estar entre 1 y ${CLIENT_COUNT}.`);
}

const projectRoot = path.resolve(__dirname, '..');
const serverPath = path.join(projectRoot, 'server.js');
const answerReceipts = [];
const queueEnqueues = [];
const adjudications = [];
const rejections = [];
let serverExited = false;
let completed = false;
let finalizeScheduled = false;

const server = spawn(process.execPath, [serverPath], {
  cwd: projectRoot,
  env: {
    ...process.env,
    TRIVIA_TEST_MODE: '1',
    TRIVIA_TEST_ROUNDS: String(ROUNDS),
    TRIVIA_TEST_START_DELAY_MS: String(START_DELAY_MS),
    TRIVIA_TEST_SONG_TITLE: ANSWER,
    TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS: String(QUEUE_DRAIN_DELAY_MS),
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});


const RECEIPT_PATTERN =
  /ANSWER #(\d+) recibido de \[[^|]+\| ([^\]]+)\] en ronda (\d+)\./;
const ENQUEUE_PATTERN = /\[Q\+\] ANSWER #(\d+) encolado\. queueSize=(\d+)\./;
const ADJUDICATION_PATTERN =
  /\[GC✓\] Ronda (\d+) adjudicada .* ANSWER #(\d+)\./;
const REJECTION_PATTERN =
  /\[GCx\] ANSWER #(\d+) descartado: ronda (\d+) ya adjudicada/;
const CORRECT_ANSWER_SCORE = 100;

function consumeServerText(text) {
  process.stdout.write(text);
  for (const rawLine of text.split(/\r?\n/)) {
    consumeServerLine(rawLine.trim());
  }
}

function consumeServerLine(line) {
  if (!line) return;
  recordReceipt(line);
  recordQueueEnqueue(line);
  recordAdjudication(line);
  recordRejection(line);
}

function recordReceipt(line) {
  const match = line.match(RECEIPT_PATTERN);
  if (!match) return;
  const receipt = {
    sequence: Number(match[1]),
    displayName: match[2].trim(),
    round: Number(match[3]),
  };
  answerReceipts.push(receipt);
  maybeReleaseFollowersAfterServerReceipt(receipt);
}

function recordQueueEnqueue(line) {
  const match = line.match(ENQUEUE_PATTERN);
  if (!match) return;
  queueEnqueues.push({sequence: Number(match[1]), size: Number(match[2])});
}

function recordAdjudication(line) {
  const match = line.match(ADJUDICATION_PATTERN);
  if (!match) return;
  adjudications.push({round: Number(match[1]), sequence: Number(match[2])});
}

function recordRejection(line) {
  const match = line.match(REJECTION_PATTERN);
  if (!match) return;
  rejections.push({sequence: Number(match[1]), round: Number(match[2])});
}

server.stdout.on('data', (chunk) => consumeServerText(chunk.toString()));
server.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));
server.on('exit', handleServerExit);

function handleServerExit(code) {
  serverExited = true;
  if (!completed && code !== null && code !== 0) {
    failAndExit(`El servidor terminó prematuramente con código ${code}.`);
  }
}

const clients = Array.from({length: CLIENT_COUNT}, (_, index) => ({
  index,
  name: `ALT02-C${index + 1}`,
  ws: null,
  ready: false,
  currentRound: null,
  newSongRounds: new Set(),
  winnersByRound: new Map(),
  gameOver: null,
}));

const roundReady = new Map();
const firedRounds = new Set();
const followerReleaseByRound = new Set();
const leadConfirmations = new Map();

function sendAnswer(client, delayMs = 0) {
  setTimeout(() => sendAnswerIfOpen(client), delayMs);
}

function sendAnswerIfOpen(client) {
  if (client.ws && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify({type: 'ANSWER', answer: ANSWER}));
  }
}

function maybeFire(round) {
  if (!canFireRound(round)) return;
  firedRounds.add(round);
  if (LEAD_CLIENT_NUMBER !== null) {
    fireLeader(round);
    return;
  }
  fireAllWithOffsets(round);
}

function canFireRound(round) {
  const readySet = roundReady.get(round);
  return readySet?.size === clients.length && !firedRounds.has(round);
}

function fireLeader(round) {
  const leader = clients[LEAD_CLIENT_NUMBER - 1];
  console.log(
      `[TEST] FIRE ronda ${round}: primero ${leader.name}; ` +
      'seguidores esperan confirmación del servidor.',
  );
  sendAnswer(leader);
}

function fireAllWithOffsets(round) {
  console.log(`[TEST] FIRE ronda ${round}: offsets=${OFFSETS.join('/')} ms.`);
  clients.forEach((client, index) => sendAnswer(client, OFFSETS[index]));
}

function maybeReleaseFollowersAfterServerReceipt(receipt) {
  if (!shouldReleaseFollowers(receipt)) return;
  followerReleaseByRound.add(receipt.round);
  leadConfirmations.set(receipt.round, receipt);
  logLeadConfirmation(receipt);
  releaseFollowers();
}

function shouldReleaseFollowers(receipt) {
  if (LEAD_CLIENT_NUMBER === null) return false;
  if (followerReleaseByRound.has(receipt.round)) return false;
  return receipt.displayName === clients[LEAD_CLIENT_NUMBER - 1].name;
}

function logLeadConfirmation(receipt) {
  const leader = clients[LEAD_CLIENT_NUMBER - 1];
  const sequence = String(receipt.sequence).padStart(6, '0');
  console.log(
      `[TEST] LEAD confirmado ronda ${receipt.round}: ${leader.name} obtuvo ` +
      `ANSWER #${sequence}. Liberando seguidores.`,
  );
}

function releaseFollowers() {
  clients.forEach((client, index) => {
    if (index !== LEAD_CLIENT_NUMBER - 1) {
      sendAnswer(client, OFFSETS[index]);
    }
  });
}

function handleClientMessage(client, data) {
  const handlers = {
    WAITING_START: handleWaitingStart,
    NEW_SONG: handleRoundStart,
    INIT_GAME: handleRoundStart,
    ROUND_WINNER: handleRoundWinner,
    GAME_OVER: handleGameOver,
  };
  handlers[data.type]?.(client, data);
}

function handleWaitingStart(client) {
  client.ready = true;
  console.log(`[TEST] READY ${client.name}.`);
}

function handleRoundStart(client, data) {
  const round = data.round;
  if (!round || client.newSongRounds.has(round)) return;
  client.newSongRounds.add(round);
  client.currentRound = round;
  ensureRoundReady(round);
  roundReady.get(round).add(client.index);
  maybeFire(round);
}

function ensureRoundReady(round) {
  if (!roundReady.has(round)) roundReady.set(round, new Set());
}

function handleRoundWinner(client, data) {
  const round = client.currentRound;
  if (!client.winnersByRound.has(round)) {
    client.winnersByRound.set(round, []);
  }
  client.winnersByRound.get(round).push(winnerFromMessage(data));
}

function winnerFromMessage(data) {
  return {
    playerId: data.winner?.playerId || null,
    displayName: data.winner?.displayName || null,
  };
}

function handleGameOver(client, data) {
  client.gameOver = data;
  if (clients.every((item) => item.gameOver)) scheduleFinalize();
}

function connectClients() {
  clients.forEach(connectClient);
}

function connectClient(client) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  client.ws = ws;
  ws.on('open', () => sendJoin(client));
  ws.on('message', (raw) => receiveClientMessage(client, raw));
  ws.on('error', (error) => handleClientError(client, error));
}

function sendJoin(client) {
  client.ws.send(JSON.stringify({type: 'JOIN', username: client.name}));
}

function receiveClientMessage(client, raw) {
  handleClientMessage(client, JSON.parse(raw.toString()));
}

function handleClientError(client, error) {
  if (!completed) failAndExit(`${client.name}: ${error.message}`);
}

function roundReceipts(round) {
  return answerReceipts.filter((item) => item.round === round);
}

function maxQueueSizeForRound(round) {
  const sequences = new Set(roundReceipts(round).map((item) => item.sequence));
  const sizes = queueEnqueues
      .filter((item) => sequences.has(item.sequence))
      .map((item) => item.size);
  return sizes.length ? Math.max(...sizes) : 0;
}

function validate() {
  const errors = [];
  const winnerDistribution = new Map();
  for (let round = 1; round <= ROUNDS; round++) {
    validateRound(round, errors, winnerDistribution);
  }
  validateSequenceOrder(errors);
  return buildValidationResult(errors, winnerDistribution);
}

function validateRound(round, errors, distribution) {
  const winners = winnerMessagesForRound(round);
  validateWinnerMessages(round, winners, errors);
  const representative = winners.flat()[0];
  recordWinnerDistribution(representative, distribution);
  validateExpectedWinner(round, representative, errors);
  const gcItems = validateGcAdjudication(round, errors);
  const receipts = validateReceipts(round, errors);
  validateLeaderReceipt(round, receipts, errors);
  validateFirstSequence(round, receipts, gcItems, errors);
  validateQueueAndRejections(round, errors);
}

function winnerMessagesForRound(round) {
  return clients.map((client) => client.winnersByRound.get(round) || []);
}

function validateWinnerMessages(round, winners, errors) {
  winners.forEach((items, index) => {
    if (items.length !== 1) {
      errors.push(
          `Ronda ${round}: ${clients[index].name} recibió ${items.length} ` +
          'ROUND_WINNER (esperado 1).',
      );
    }
  });
  validateWinnerAgreement(round, winners.flat(), errors);
}

function validateWinnerAgreement(round, winners, errors) {
  const ids = winners.map((winner) => winner.playerId).filter(Boolean);
  if (ids.length > 0 && new Set(ids).size !== 1) {
    errors.push(
        `Ronda ${round}: los clientes no observaron el mismo ganador ` +
        `(${ids.join(', ')}).`,
    );
  }
}

function recordWinnerDistribution(winner, distribution) {
  if (!winner?.displayName) return;
  const current = distribution.get(winner.displayName) || 0;
  distribution.set(winner.displayName, current + 1);
}

function validateExpectedWinner(round, winner, errors) {
  if (!EXPECTED_WINNER || winner?.displayName === EXPECTED_WINNER) return;
  const actual = winner?.displayName || 'ninguno';
  errors.push(
      `Ronda ${round}: ganador=${actual}; esperado=${EXPECTED_WINNER}.`,
  );
}

function validateGcAdjudication(round, errors) {
  const items = adjudications.filter((item) => item.round === round);
  if (items.length !== 1) {
    errors.push(
        `Ronda ${round}: GameCoordinator adjudicó ${items.length} ` +
        'ganadores (esperado 1).',
    );
  }
  return items;
}

function validateReceipts(round, errors) {
  const receipts = roundReceipts(round);
  if (receipts.length !== CLIENT_COUNT) {
    errors.push(
        `Ronda ${round}: llegaron ${receipts.length} ANSWER al servidor; ` +
        `esperados=${CLIENT_COUNT}.`,
    );
  }
  return receipts;
}

function validateLeaderReceipt(round, receipts, errors) {
  if (LEAD_CLIENT_NUMBER === null) return;
  const leader = clients[LEAD_CLIENT_NUMBER - 1];
  const confirmation = leadConfirmations.get(round);
  if (!confirmation) {
    errors.push(`Ronda ${round}: no se confirmó líder ${leader.name}.`);
    return;
  }
  validateFirstLeaderReceipt(round, receipts, leader, errors);
}

function validateFirstLeaderReceipt(round, receipts, leader, errors) {
  if (!receipts.length) return;
  const first = receipts.reduce((best, item) =>
    item.sequence < best.sequence ? item : best,
  );
  if (first.displayName !== leader.name) {
    errors.push(
        `Ronda ${round}: primera recepción=${first.displayName}; ` +
        `líder esperado=${leader.name}.`,
    );
  }
}

function validateFirstSequence(round, receipts, gcItems, errors) {
  if (!receipts.length || gcItems.length !== 1) return;
  const first = Math.min(...receipts.map((item) => item.sequence));
  if (gcItems[0].sequence !== first) {
    errors.push(
        `Ronda ${round}: adjudicado #${gcItems[0].sequence}; ` +
        `primero recibido #${first}.`,
    );
  }
}

function validateQueueAndRejections(round, errors) {
  const maxQueueSize = maxQueueSizeForRound(round);
  if (maxQueueSize < CLIENT_COUNT) {
    errors.push(
        `Ronda ${round}: maxQueueSize=${maxQueueSize}; ` +
        `esperado>=${CLIENT_COUNT}.`,
    );
  }
  validateRejections(round, errors);
}

function validateRejections(round, errors) {
  const count = rejections.filter((item) => item.round === round).length;
  if (count !== CLIENT_COUNT - 1) {
    errors.push(
        `Ronda ${round}: descartes=${count}; esperados=${CLIENT_COUNT - 1}.`,
    );
  }
}

function validateSequenceOrder(errors) {
  const sequences = answerReceipts.map((item) => item.sequence);
  if (new Set(sequences).size !== sequences.length) {
    errors.push('Hay sequence duplicadas en los ANSWER recibidos.');
  }
  validateMonotonicSequences(sequences, errors);
}

function validateMonotonicSequences(sequences, errors) {
  for (let index = 1; index < sequences.length; index++) {
    if (sequences[index] <= sequences[index - 1]) {
      errors.push(
          `Sequence no monotónica: ${sequences[index - 1]} -> ` +
          `${sequences[index]}.`,
      );
      return;
    }
  }
}

function buildValidationResult(errors, winnerDistribution) {
  const sequences = answerReceipts.map((item) => item.sequence);
  const totalScore = validateTotalScore(errors);
  const globalMaxQueueSize = queueEnqueues.length ?
    Math.max(...queueEnqueues.map((item) => item.size)) : 0;
  return {
    errors, totalScore, sequences, winnerDistribution, globalMaxQueueSize,
  };
}

function validateTotalScore(errors) {
  const leaderboard = clients[0].gameOver?.leaderboard || [];
  const total = leaderboard.reduce(
      (sum, player) => sum + Number(player.score || 0), 0,
  );
  const expected = ROUNDS * CORRECT_ANSWER_SCORE;
  if (total !== expected) {
    errors.push(`Score total=${total}; esperado=${expected}.`);
  }
  return total;
}

function scheduleFinalize() {
  if (completed || finalizeScheduled) return;
  finalizeScheduled = true;
  setTimeout(finalize, SETTLE_MS);
}

function finalize() {
  if (completed) return;
  completed = true;
  const result = validate();
  logResult(result);
  cleanup();
  process.exitCode = result.errors.length ? 1 : 0;
}

function logResult(result) {
  console.log('\n=== ALT-02 RESULTADO ===');
  logScenarioMetrics(result);
  logWinnerMetrics(result);
  logErrorMetrics(result.errors);
  logValidationErrors(result.errors);
}

function logScenarioMetrics(result) {
  console.log(`Rondas: ${ROUNDS}`);
  console.log(`Clientes: ${clients.length}`);
  console.log(`Offsets seguidores: ${OFFSETS.join('/')} ms`);
  logLeaderMetric();
  console.log(`Queue drain delay (test only): ${QUEUE_DRAIN_DELAY_MS} ms`);
  console.log(`Max queueSize observado: ${result.globalMaxQueueSize}`);
  console.log(`ANSWER recibidos: ${answerReceipts.length}`);
}

function logLeaderMetric() {
  if (LEAD_CLIENT_NUMBER !== null) {
    console.log(
        'Lead confirmado por recepción del servidor: ' +
        `ALT02-C${LEAD_CLIENT_NUMBER}`,
    );
  }
}

function logWinnerMetrics(result) {
  console.log(`Sequences: ${sequenceRange(result.sequences)}`);
  console.log(`Adjudicaciones GC: ${adjudications.length}`);
  console.log(`Descartes por ganador previo: ${rejections.length}`);
  console.log(`Score total: ${result.totalScore}`);
  const distribution = winnerDistributionText(result.winnerDistribution);
  console.log(`Ganadores: ${distribution}`);
  if (EXPECTED_WINNER) console.log(`Ganador esperado: ${EXPECTED_WINNER}`);
}

function sequenceRange(sequences) {
  if (!sequences.length) return 'ninguna';
  return `${sequences[0]}..${sequences[sequences.length - 1]}`;
}

function winnerDistributionText(distribution) {
  return [...distribution.entries()]
      .map(([name, count]) => `${name}=${count}`)
      .join(', ') || 'sin datos';
}

function logErrorMetrics(errors) {
  const doubleWinner = errors.filter((e) => e.includes('adjudicó')).length;
  const mismatch = errors.filter((e) => e.includes('mismo ganador')).length;
  console.log(`doubleWinner: ${doubleWinner}`);
  console.log(`clientMismatch: ${mismatch}`);
  console.log(`PASS: ${errors.length === 0 ? `${ROUNDS}/${ROUNDS}` : 'NO'}`);
}

function logValidationErrors(errors) {
  if (!errors.length) return;
  console.log('\nErrores:');
  errors.forEach((error) => console.log(`- ${error}`));
}

function cleanup() {
  clients.forEach(closeClient);
  if (!serverExited) server.kill();
}

function closeClient(client) {
  if (client.ws && client.ws.readyState === WebSocket.OPEN) {
    client.ws.close();
  }
}

function failAndExit(message) {
  if (completed) return;
  completed = true;
  console.error(`\n[TEST][FAIL] ${message}`);
  cleanup();
  process.exitCode = 1;
}

const timeout = setTimeout(
    () => failAndExit(`Timeout global de ${TIMEOUT_MS} ms.`), TIMEOUT_MS,
);
timeout.unref();

let serverBuffer = '';
server.stdout.on('data', handleServerStartupOutput);

function handleServerStartupOutput(chunk) {
  serverBuffer += chunk.toString();
  const readyText = `Servidor web corriendo en http://localhost:${PORT}`;
  if (serverBuffer.includes(readyText) && clients.every((c) => !c.ws)) {
    connectClients();
  }
}

process.on('SIGINT', handleSigint);

function handleSigint() {
  cleanup();
  process.exit(130);
}
