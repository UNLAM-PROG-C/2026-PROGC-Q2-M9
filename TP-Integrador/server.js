/**
 * @fileoverview Servidor HTTP y WebSocket de Trivia Musical.
 * Orquesta el ciclo de sesión, la cola FIFO y el transporte del protocolo.
 * El modo normal carga previews de iTunes que reproducen los clientes;
 * los contratos y transformaciones de audio V4 aún no integran este flujo.
 * El procesamiento de respuestas se realiza en el event loop de Node.js.
 */
import express from 'express';
import http from 'http';
import WebSocket, {WebSocketServer} from 'ws';
import path from 'path';
import https from 'https';
import readline from 'readline';
import fs from 'fs';
import {fileURLToPath} from 'url';
import {AnswerQueue} from './game/answer-queue.js';
import {GameCoordinator} from './game/game-coordinator.js';
import {SessionCoordinator} from './game/session-coordinator.js';
import {SessionState} from './game/session-state.js';

import {
  AudioPreparationManager,
} from './server/audio/audio-preparation-manager.js';
import {
  AudioWorkerPool,
} from './server/audio/audio-worker-pool.js';
import {
  PreparedRoundBuffer,
} from './server/audio/prepared-round-buffer.js';
import {
  PreviewPcmPoolAdapter,
} from './server/audio/preview-pcm-pool-adapter.js';
import {
  RoundAudioResolver,
} from './server/audio/round-audio-resolver.js';
import {AudioMode, isValidAudioMode} from './server/audio/model/audio-mode.js';
import {encodePcmToWav} from './server/audio/pcm-wav-encoder.js';
import {
  AUDIO_ROUTE_PREFIX,
  RoundAudioRegistry,
  createRoundAudioHandler,
} from './server/audio/round-audio-registry.js';
import {buildNewSongPayload} from './server/audio/round-protocol.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ALT-02 / C8: modo determinístico para pruebas automatizadas.
// No altera el modo normal; solo se activa con TRIVIA_TEST_MODE=1.
const TEST_MODE = process.env.TRIVIA_TEST_MODE === '1';
const MIN_TEST_START_DELAY_MS = 100;
const SERVER_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const TEST_ROUNDS = Math.max(
    1, Number.parseInt(process.env.TRIVIA_TEST_ROUNDS || '20', 10),
);
const TEST_START_DELAY_MS = Math.max(
    MIN_TEST_START_DELAY_MS,
    Number.parseInt(process.env.TRIVIA_TEST_START_DELAY_MS || '1000', 10),
);
const TEST_SONG_TITLE = process.env.TRIVIA_TEST_SONG_TITLE || 'ALT02 TEST SONG';
const TEST_QUEUE_DRAIN_DELAY_MS = Math.max(
    0, Number.parseInt(process.env.TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS || '0', 10),
);

const DEFAULT_CONFIG_DELAY_SECONDS = 10;
const DEFAULT_CONFIG_ROUNDS = 5;
const DEFAULT_START_OFFSET_MS = 60000;
const PAST_START_DELAY_MS = 30000;
const FORCE_NEXT_DELAY_SECONDS = 5;
const NORMAL_LOOP_INTERVAL_MS = 1000;
const TEST_LOOP_INTERVAL_MS = 10;
const MILLISECONDS_PER_SECOND = 1000;
const PLAYER_ID_PAD_WIDTH = 3;
const SEQUENCE_PAD_WIDTH = 6;
const GAME_CONFIG_PATH = path.join(__dirname, 'game-config.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({server});
const roundAudioRegistry = new RoundAudioRegistry();

app.use(express.static(path.join(__dirname, 'public')));
app.get(
    `${AUDIO_ROUTE_PREFIX}/:gameId/:roundId`,
    createRoundAudioHandler(roundAudioRegistry),
);

// ALT-03: identidad interna del jugador, separada del nombre visible.
let nextPlayerNumber = 1;
const playersById = new Map();
const playerIdBySocket = new Map();
const socketByPlayerId = new Map();

/**
 * Genera un ID interno creciente dentro de este proceso, no global.
 * @return {string} Identificador independiente del nombre visible.
 */
function generatePlayerId() {
  return `P${String(nextPlayerNumber++).padStart(PLAYER_ID_PAD_WIDTH, '0')}`;
}

/**
 * Registra un jugador nuevo y las asociaciones entre socket e ID.
 * Los nombres visibles pueden repetirse. La elegibilidad se ajusta aparte.
 * @param {!WebSocket} ws Conexión del jugador.
 * @param {string} displayName Nombre visible esperado del cliente.
 * @return {!Object} Registro mutable conservado en playersById.
 */
function registerPlayer(ws, displayName) {
  const player = createPlayerRecord(displayName);
  playersById.set(player.playerId, player);
  playerIdBySocket.set(ws, player.playerId);
  socketByPlayerId.set(player.playerId, ws);
  return player;
}

function createPlayerRecord(displayName) {
  return {
    playerId: generatePlayerId(), displayName, score: 0, attempts: 0,
    connected: true, eligibleFromRoundId: 1,
  };
}

/**
 * @param {!WebSocket} ws Conexión que se desea identificar.
 * @return {?Object|undefined} Registro asociado; null si no hay ID.
 */
function getPlayerBySocket(ws) {
  const playerId = playerIdBySocket.get(ws);
  return playerId ? playersById.get(playerId) : null;
}

/**
 * @return {number} Identificador de ronda con base 1 (currentRound + 1).
 */
function getCurrentRoundId() {
  return currentRound + 1;
}

/**
 * Actualiza la elegibilidad al ingresar según el estado de sesión.
 * En LOBBY puede jugar desde la primera ronda; durante una partida, desde
 * la siguiente. En GAME_OVER queda inhabilitado hasta el reinicio.
 * @param {!Object} player Registro mutable del jugador recién incorporado.
 */
function configurePlayerEligibilityOnJoin(player) {
  const state = sessionCoordinator.getState();
  if (state === SessionState.LOBBY) {
    player.eligibleFromRoundId = 1;
    return;
  }
  if (isActiveSessionState(state)) {
    configureLateJoinEligibility(player);
    return;
  }
  player.eligibleFromRoundId = Number.POSITIVE_INFINITY;
}

function isActiveSessionState(state) {
  return state === SessionState.ROUND_ACTIVE ||
    state === SessionState.BETWEEN_ROUNDS;
}

function configureLateJoinEligibility(player) {
  player.eligibleFromRoundId = getCurrentRoundId() + 1;
  console.log(
      `[SC] LATE_JOIN [${player.playerId} | ${player.displayName}] ` +
      `en ronda ${getCurrentRoundId()}; ` +
      `elegible desde ronda ${player.eligibleFromRoundId}.`,
  );
}

/**
 * Comprueba solo el límite de ronda; no valida conexión ni estado de sesión.
 * @param {!Object} player Registro del jugador.
 * @return {boolean} True si la ronda actual alcanza su límite de ingreso.
 */
function isPlayerEligibleForCurrentRound(player) {
  return player.eligibleFromRoundId <= getCurrentRoundId();
}

/**
 * Marca al jugador desconectado y elimina las asociaciones de transporte.
 * Conserva su registro y puntaje hasta resetPlayersForNewGame.
 * @param {!WebSocket} ws Conexión cerrada.
 * @return {?Object|undefined} Registro encontrado, si lo hay.
 */
function markPlayerDisconnected(ws) {
  const player = getPlayerBySocket(ws);
  if (player) {
    player.connected = false;
  }
  playerIdBySocket.delete(ws);
  if (player) {
    socketByPlayerId.delete(player.playerId);
  }
  return player;
}

/**
 * Envía un mensaje JSON si el socket asociado está abierto.
 * No espera confirmación de recepción ni de procesamiento del cliente.
 * @param {string} playerId Identidad interna del destinatario.
 * @param {!Object} data Mensaje serializable del protocolo.
 */
function sendToPlayer(playerId, data) {
  const ws = socketByPlayerId.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Reinicia los intentos de todos los registros, incluidos desconectados.
 * No modifica sus puntajes acumulados.
 */
function resetAllPlayerAttempts() {
  for (const player of playersById.values()) {
    player.attempts = 0;
  }
}

// V3 / C8: prepara a los jugadores conectados para una nueva partida.
// Los desconectados históricos dejan de formar parte de la nueva sesión.
/**
 * Elimina los registros históricos desconectados y reinicializa puntaje,
 * intentos y elegibilidad de los conectados, sin cambiar sus identidades.
 */
function resetPlayersForNewGame() {
  for (const [playerId, player] of playersById.entries()) {
    if (!player.connected) {
      playersById.delete(playerId);
      continue;
    }

    player.score = 0;
    player.attempts = 0;
    player.eligibleFromRoundId = 1;
  }
}

// ALT-03: proyección del estado interno hacia el protocolo del cliente.
// Se usa una lista porque displayName no es una clave única.
/**
 * Proyecta los registros al protocolo, incluidos los desconectados.
 * No ordena por puntaje: el cliente construye la vista ordenada.
 * @return {!Array<!Object>} Nueva lista de vistas públicas de jugadores.
 */
function buildLeaderboardView() {
  return Array.from(playersById.values()).map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    score: player.score,
    connected: player.connected,
  }));
}

/**
 * @param {?Object} player Registro ganador, si existe.
 * @return {?Object} Proyección pública del ganador o null.
 */
function buildWinnerView(player) {
  if (!player) {
    return null;
  }

  return {
    playerId: player.playerId,
    displayName: player.displayName,
    score: player.score,
  };
}

/**
 * Elige el mayor puntaje entre todos los registros de la partida.
 * En empate conserva el primero visitado en el orden del Map.
 * @return {?Object} Registro ganador o null si no hay jugadores.
 */
function getFinalWinner() {
  let winner = null;
  for (const player of playersById.values()) {
    if (!winner || player.score > winner.score) {
      winner = player;
    }
  }
  return winner;
}

// ALT-01 / C4: orden total asignado por el servidor a cada respuesta recibida.
let nextAnswerSequence = 1;

/**
 * Captura la respuesta y su contexto de recepción en el servidor.
 * La secuencia aumenta por evento admitido, no por instante de envío remoto.
 * @param {!Object} player Registro del jugador registrado y elegible.
 * @param {*} answer Valor recibido; aquí no se valida su tipo.
 * @return {!Object} AnswerEvent con sequence, playerId, roundId, answer
 *     y receivedAt en milisegundos desde la época Unix.
 */
function createAnswerEvent(player, answer) {
  return {
    sequence: nextAnswerSequence++,
    playerId: player.playerId,
    roundId: currentRound + 1,
    answer,
    receivedAt: Date.now(),
  };
}

// ALT-01 / C5: cola FIFO explícita de respuestas.
// Los handlers WebSocket producen AnswerEvent y un consumidor único
// los procesa.
const answerQueue = new AnswerQueue();
let answerQueueProcessingScheduled = false;

/**
 * Agrega la respuesta al final de la cola, registra su secuencia y agenda
 * el drenaje. No adjudica una respuesta desde el productor.
 * @param {!Object} answerEvent Evento de respuesta creado por el servidor.
 */
function enqueueAnswerEvent(answerEvent) {
  answerQueue.enqueue(answerEvent);
  const sequence = String(answerEvent.sequence)
      .padStart(SEQUENCE_PAD_WIDTH, '0');
  console.log(
      `[Q+] ANSWER #${sequence} encolado. ` +
      `queueSize=${answerQueue.size()}.`,
  );
  scheduleAnswerQueueProcessing();
}

/**
 * Agenda un único drenaje pendiente mediante una bandera del event loop.
 * Usa setImmediate en producción y permite una demora artificial en test.
 * No crea hilos ni utiliza primitivas de exclusión mutua.
 */
function scheduleAnswerQueueProcessing() {
  if (answerQueueProcessingScheduled) {
    return;
  }

  answerQueueProcessingScheduled = true;

  if (TEST_MODE && TEST_QUEUE_DRAIN_DELAY_MS > 0) {
    setTimeout(processAnswerQueue, TEST_QUEUE_DRAIN_DELAY_MS);
  } else {
    setImmediate(processAnswerQueue);
  }
}

/**
 * Drena la cola FIFO de manera síncrona y delega cada evento al coordinador.
 * La bandera se libera en finally incluso si ocurre una excepción. Si quedan
 * eventos se agenda otro drenaje; no se procesa fuera de la cola.
 * La exclusividad corresponde al flujo actual del event loop, no a un lock
 * entre hilos. Las excepciones del coordinador no se capturan aquí.
 */
function processAnswerQueue() {
  try {
    drainAnswerQueue();
  } finally {
    answerQueueProcessingScheduled = false;
    if (!answerQueue.isEmpty()) scheduleAnswerQueueProcessing();
  }
}

function drainAnswerQueue() {
  while (!answerQueue.isEmpty()) {
    const answerEvent = answerQueue.dequeue();
    logDequeuedAnswer(answerEvent);
    gameCoordinator.processAnswerEvent(answerEvent);
  }
}

function logDequeuedAnswer(answerEvent) {
  const sequence = String(answerEvent.sequence)
      .padStart(SEQUENCE_PAD_WIDTH, '0');
  console.log(
      `[Q-] ANSWER #${sequence} desencolado. ` +
      `queueSize=${answerQueue.size()}.`,
  );
}

let playlist = [];
let currentSongIndex = 0;
let currentRound = 0;
let maxRounds = DEFAULT_CONFIG_ROUNDS;
let delayNextRound = DEFAULT_CONFIG_DELAY_SECONDS; // segundos
let startTime = null;
let gameStarted = false;
let gameFinished = false;
// V3 / C4: SessionCoordinator refleja explícitamente
// el ciclo de vida que la aplicación ya ejecuta.
const sessionCoordinator = new SessionCoordinator();
const preparedRoundBuffer = new PreparedRoundBuffer();

function createAudioPreparationManager() {
  if (TEST_MODE) {
    return null;
  }
  const workerPool = new AudioWorkerPool();
  const adapter = new PreviewPcmPoolAdapter({workerPool});
  return new AudioPreparationManager({
    workerPool: adapter,
    preparedRoundBuffer,
    initialGameId: sessionCoordinator.getGameId(),
    log: (message) => console.log(message),
  });
}

const audioPreparationManager = createAudioPreparationManager();

const roundAudioResolver = new RoundAudioResolver({
  preparedRoundBuffer,
  log: (message) => console.log(message),
});

/**
 * Delega la validación de la transición al SessionCoordinator y registra
 * su resultado. No modifica los demás datos operativos de la partida.
 * @param {string} nextState Estado de destino solicitado.
 * @param {string} reason Motivo para el log de la transición.
 * @return {!Object} Resultado de la transición informado por el coordinador.
 */
function transitionSessionTo(nextState, reason) {
  const transition = sessionCoordinator.transitionTo(nextState);

  console.log(
      `[SC] ${transition.previousState} -> ${transition.currentState} ` +
        `(gameId=${transition.gameId}, reason=${reason})`,
  );

  return transition;
}

// V3 / C5: jugadores conectados y vista pública del estado de sesión.
/**
 * @return {!Array<string>} IDs de registros actualmente conectados.
 */
function getConnectedPlayerIds() {
  return Array.from(playersById.values())
      .filter((player) => player.connected)
      .map((player) => player.playerId);
}

/**
 * Construye la vista pública de sesión y de la barrera READY.
 * canStart refleja al coordinador, no comprueba el horario de inicio.
 * @return {!Object} Mensaje SESSION_STATE con estado, generación y conteos.
 */
function buildSessionStateView() {
  const connectedPlayerIds = getConnectedPlayerIds();

  return {
    type: 'SESSION_STATE',
    sessionState: sessionCoordinator.getState(),
    gameId: sessionCoordinator.getGameId(),
    readyPlayerIds: sessionCoordinator.getReadyPlayerIds(),
    readyCount: sessionCoordinator.getReadyCount(),
    connectedCount: connectedPlayerIds.length,
    canStart: sessionCoordinator.canStart(connectedPlayerIds),
  };
}

/**
 * Difunde la vista actual de sesión a los sockets abiertos.
 */
function broadcastSessionState() {
  broadcast(buildSessionStateView());
}

/**
 * Mantiene preparada la ventana futura de audio de la partida actual.
 * TEST_MODE la omite para conservar las pruebas determinísticas sin I/O.
 * @return {?Object} Resumen de prefetch o null en TEST_MODE.
 */
function maintainAudioPrefetch() {
  if (!audioPreparationManager) {
    return null;
  }
  return audioPreparationManager.maintainPrefetchWindow({
    gameId: sessionCoordinator.getGameId(),
    currentRoundId: getCurrentRoundId(),
    currentSongIndex,
    playlist,
    maxRounds,
  });
}

/**
 * Emite la ronda actual y repone su ventana futura de preparación.
 * @return {!Object} Selección de audio utilizada por la ronda.
 */
function broadcastAndPrefetchCurrentRound() {
  const resolved = broadcastCurrentRound();
  maintainAudioPrefetch();
  return resolved;
}

/**
 * Resuelve el recurso de audio de la ronda actualmente activa.
 * @return {!Object} Selección preparada o fallback NORMAL.
 */
function resolveCurrentRoundAudio() {
  return roundAudioResolver.resolve({
    gameId: sessionCoordinator.getGameId(),
    roundId: getCurrentRoundId(),
    playlistSong: playlist[currentSongIndex],
  });
}

/**
 * Obtiene la URL original utilizable cuando no se publica audio preparado.
 * @param {!Object} resolved Selección interna de audio de la ronda.
 * @return {string} URL reproducible por el navegador.
 */
function resolveClientSongSource(resolved) {
  if (typeof resolved.resource === 'string') {
    return resolved.resource;
  }
  if (typeof resolved.resource?.url === 'string') {
    return resolved.resource.url;
  }
  return resolved.song.preview;
}

function logAudioPublishFailure(resolved, reason) {
  console.log(
      `[AUDIO_PUBLISH_FAIL] gameId=${resolved.gameId} ` +
      `roundId=${resolved.roundId} reason=${reason}`,
  );
}

function logAudioPublishSuccess(resolved, url) {
  console.log(
      `[AUDIO_PUBLISH] gameId=${resolved.gameId} ` +
      `roundId=${resolved.roundId} mode=${resolved.mode} url=${url}`,
  );
}

function publishPreparedRoundAudio(resolved) {
  if (!resolved.prepared) {
    return false;
  }
  if (resolved.resource?.kind !== 'PCM_BUFFER') {
    logAudioPublishFailure(resolved, 'INVALID_PREPARED_RESOURCE');
    return false;
  }
  return registerPreparedRoundAudio(resolved);
}

function registerPreparedRoundAudio(resolved) {
  try {
    const buffer = encodePcmToWav(resolved.resource);
    const url = roundAudioRegistry.register({
      gameId: resolved.gameId, roundId: resolved.roundId, buffer,
    });
    logAudioPublishSuccess(resolved, url);
    return true;
  } catch (error) {
    logAudioPublishFailure(resolved, error.message);
    return false;
  }
}

function normalizePublishedRound(resolved, servedByServer) {
  if (servedByServer || !resolved.prepared) {
    return resolved;
  }
  return {
    ...resolved, mode: AudioMode.NORMAL, prepared: false,
    resource: resolved.song.preview,
  };
}

function buildRoundPayload(resolved) {
  const servedByServer = publishPreparedRoundAudio(resolved);
  const clientRound = normalizePublishedRound(resolved, servedByServer);
  const resource = servedByServer ? '' : resolveClientSongSource(clientRound);
  return buildNewSongPayload({
    gameId: clientRound.gameId, roundId: clientRound.roundId, maxRounds,
    mode: clientRound.mode, prepared: clientRound.prepared,
    resource, servedByServer, artist: clientRound.song.artist,
  });
}

/**
 * Resuelve y difunde el audio de la ronda actualmente activa.
 * @return {!Object} Selección de audio utilizada.
 */
function broadcastCurrentRound() {
  const resolved = resolveCurrentRoundAudio();
  broadcast(buildRoundPayload(resolved));
  return resolved;
}


let lastReadyBarrierStatus = null;

/**
 * Inicia la primera ronda si está en LOBBY y la barrera permite avanzar.
 * El modo de prueba omite READY. Los llamadores verifican el horario;
 * esta función no lo hace ni comprueba que la playlist tenga canciones.
 * Reinicia intentos, abre la ronda y difunde NEW_SONG y el estado público.
 * @param {string} reason Motivo del inicio para la traza de sesión.
 * @return {boolean} True si se inició; false si rechazó las precondiciones.
 */
function startGameFromLobby(reason) {
  if (!canStartGameFromLobby()) return false;
  lastReadyBarrierStatus = null;
  transitionSessionTo(SessionState.ROUND_ACTIVE, reason);
  initializeFirstRound();
  logCurrentRoundStart();
  broadcastAndPrefetchCurrentRound();
  broadcastLeaderboard();
  broadcastSessionState();
  return true;
}

function canStartGameFromLobby() {
  if (sessionCoordinator.getState() !== SessionState.LOBBY) return false;
  if (TEST_MODE) return true;
  return sessionCoordinator.canStart(getConnectedPlayerIds());
}

function initializeFirstRound() {
  gameStarted = true;
  gameFinished = false;
  currentRound = 0;
  resetAllPlayerAttempts();
  gameCoordinator.beginRound(currentRound + 1);
}

function logCurrentRoundStart() {
  const song = playlist[currentSongIndex];
  console.log(
      `\n[♫] Comienza la ronda nro ${currentRound + 1} de ${maxRounds}: ` +
      `La canción es "${song.title}"`,
  );
}

/**
 * Lee config/game-config.json y aplica parámetros de partida y bandas.
 */
function loadGameConfig() {
  const config = readGameConfigFile();
  delayNextRound = config.delayNextRound ?? DEFAULT_CONFIG_DELAY_SECONDS;
  maxRounds = config.maxRounds ?? DEFAULT_CONFIG_ROUNDS;
  applyConfiguredBandUrls(config);
  applyConfiguredAudioModes(config);
  startTime = resolveConfiguredStartTime(config);
  adjustPastStartTime();
  printSavedConfig();
}

function resolveConfiguredAudioModes(config) {
  const modes = config.enabledAudioModes;
  if (!Array.isArray(modes) || modes.length === 0) return null;
  const validModes = modes.filter((mode) => isValidAudioMode(mode));
  return validModes.length > 0 ? validModes : [AudioMode.NORMAL];
}

function applyConfiguredAudioModes(config) {
  const configuredModes = resolveConfiguredAudioModes(config);
  if (!configuredModes || !audioPreparationManager) return;
  audioPreparationManager.setModeSequence(configuredModes);
}
function readGameConfigFile() {
  if (!fs.existsSync(GAME_CONFIG_PATH)) {
    return {};
  }
  const raw = fs.readFileSync(GAME_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function applyConfiguredBandUrls(config) {
  const urls = config.itunesSearchUrls;
  if (!Array.isArray(urls)) return;
  const validUrls = urls.filter(
      (url) => typeof url === 'string' && url.trim().length > 0,
  );
  if (validUrls.length > 0) {
    itunesSearchUrls = validUrls;
  }
}

function resolveConfiguredStartTime(config) {
  if (typeof config.startTime === 'string' && config.startTime.trim()) {
    return parseStartTime(config.startTime.trim());
  }
  const delayMs = Number.isFinite(config.startDelaySeconds) ?
    config.startDelaySeconds * MILLISECONDS_PER_SECOND :
    DEFAULT_START_OFFSET_MS;
  return new Date(Date.now() + delayMs);
}

function parseStartTime(startValue) {
  const [hours, minutes] = startValue.split(':');
  const configured = new Date();
  configured.setHours(
      Number.parseInt(hours, 10), Number.parseInt(minutes, 10), 0, 0,
  );
  return configured;
}

function adjustPastStartTime() {
  if (startTime > new Date()) return;
  startTime = new Date(Date.now() + PAST_START_DELAY_MS);
  console.log(
      '[!] La hora indicada ya pasó o es muy próxima. ' +
      'Iniciando en 30 segundos...',
  );
}

function printSavedConfig() {
  console.log('\n----------------------------------------------');
  console.log(`[+] Configuración cargada desde ${GAME_CONFIG_PATH}`);
  console.log(`[+] Hora de inicio: ${startTime.toLocaleTimeString()}`);
  console.log(`[+] Demora entre rondas: ${delayNextRound} segundos`);
  console.log(`[+] Total de rondas: ${maxRounds}`);
  console.log(`[+] Links de bandas cargados: ${itunesSearchUrls.length}`);
  console.log('----------------------------------------------\n');
}


/**
 * Normaliza texto para comparar títulos sin mayúsculas ni marcas diacríticas
 * combinantes del intervalo eliminado. No comprueba el tipo de entrada.
 * @param {string} text Texto a normalizar.
 * @return {string} Texto normalizado sin espacios en los extremos.
 */
function normalizeText(text) {
  return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
}

/**
 * Consulta iTunes mediante HTTPS y reemplaza la playlist compartida.
 * Filtra por artista y preview, descarta ciertos títulos y álbumes en vivo,
 * elimina duplicados por título normalizado y mezcla el resultado.
 * Ante errores de parseo o de la solicitud utiliza canciones de respaldo.
 * No descarga audio, no valida su reproducción ni garantiza una lista no vacía.
 * @return {!Promise<void>} Promesa que se resuelve al cargar la playlist.
 */
const DEFAULT_ITUNES_SEARCH_URLS = [
  'https://itunes.apple.com/search?term=No+Te+Va+Gustar&entity=song&limit=200',
  'https://itunes.apple.com/search?term=Soda+Stereo&entity=song&limit=200',
  'https://itunes.apple.com/search?term=Los+Piojos&entity=song&limit=200',
  'https://itunes.apple.com/search?term=Divididos&entity=song&limit=200',
];
let itunesSearchUrls = [...DEFAULT_ITUNES_SEARCH_URLS];
const FALLBACK_PREVIEW_URL =
  'https://audio-samples.github.io/samples/mp3/' +
  'blizzard_biasedfromthetruth.mp3';

function fetchPlaylistFromItunes() {
  const index = Math.floor(Math.random() * itunesSearchUrls.length);
  const url = itunesSearchUrls[index];
  const artist = new URL(url).searchParams.get('term');
  console.log(`[*] Artista seleccionado: ${artist}.`);
  return new Promise(
      (resolve) => requestItunesPlaylist(url, artist, resolve),
  );
}

function requestItunesPlaylist(url, artist, resolve) {
  https.get(url, (res) => {
    collectItunesResponse(res, artist, resolve);
  }).on('error', (error) => handleItunesRequestError(error, resolve));
}

function collectItunesResponse(res, artist, resolve) {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => processItunesResponse(data, artist, resolve));
}

function processItunesResponse(data, artist, resolve) {
  try {
    const results = JSON.parse(data).results || [];
    playlist = buildStudioPlaylist(results, artist);
    console.log(
        `[*] Playlist cargada: ${playlist.length} ` +
        'canciones de estudio únicas.',
    );
  } catch (error) {
    handleItunesParseError(error);
  }
  resolve();
}

function buildStudioPlaylist(results, artist) {
  const seen = new Set();
  const filtered = [];
  for (const item of results) addStudioTrack(item, artist, seen, filtered);
  shuffleArray(filtered);
  return filtered;
}

function addStudioTrack(item, artist, seen, filtered) {
  const track = item.trackName || '';
  if (!isEligibleStudioTrack(item, track, artist)) return;
  const normalizedKey = normalizeText(track);
  if (seen.has(normalizedKey)) return;
  seen.add(normalizedKey);
  filtered.push({
    title: track, artist: item.artistName, preview: item.previewUrl,
  });
}

function isEligibleStudioTrack(item, track, artist) {
  const trackArtist = (item.artistName || '').toLowerCase();
  const collection = (item.collectionName || '').toLowerCase();
  return trackArtist.includes(artist.toLowerCase()) &&
    Boolean(item.previewUrl) &&
    !isLiveRecording(collection, track.toLowerCase());
}

function isLiveRecording(collection, track) {
  const collectionMarkers = ['vivo', 'live', 'gira', 'teatro'];
  const trackMarkers = ['en vivo', 'live'];
  return collectionMarkers.some((value) => collection.includes(value)) ||
    trackMarkers.some((value) => track.includes(value));
}

function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
}

function handleItunesParseError(error) {
  console.error('Error parseando JSON:', error);
  playlist = [
    buildFallbackSong('Despues de hora'),
    buildFallbackSong('Ese Maldito Momento'),
  ];
}

function handleItunesRequestError(error, resolve) {
  console.error('Error conectando a iTunes:', error);
  playlist = [buildFallbackSong('Despues de hora')];
  resolve();
}

function buildFallbackSong(title) {
  return {title, artist: 'No Te Va Gustar', preview: FALLBACK_PREVIEW_URL};
}

/**
 * Expone al coordinador el contexto operativo vigente.
 * La playlist se comparte por referencia; no se genera una copia profunda.
 * @return {!Object} Flags, índices, límites, demora y playlist actuales.
 */
function getRoundContext() {
  return {
    gameStarted,
    gameFinished,
    currentRound,
    currentSongIndex,
    maxRounds,
    delayNextRound,
    playlist,
  };
}

/**
 * Finaliza la partida tras la adjudicación de la última ronda.
 * Actualiza la sesión y los flags, calcula el ganador y difunde los resultados.
 * No elimina registros de jugadores ni crea una nueva generación.
 */
function finishGameFromAnswer() {
  finishCurrentGame('fin de partida por respuesta correcta');
}

function finishCurrentGame(reason) {
  transitionSessionTo(SessionState.GAME_OVER, reason);
  gameStarted = false;
  gameFinished = true;
  const finalWinner = getFinalWinner();
  broadcastGameOver(finalWinner);
  broadcastSessionState();
  console.log(`[*] ¡Partida finalizada! Ganador: ${winnerLabel(finalWinner)}`);
}

function broadcastGameOver(finalWinner) {
  broadcast({
    type: 'GAME_OVER',
    winner: buildWinnerView(finalWinner),
    leaderboard: buildLeaderboardView(),
  });
}

function winnerLabel(winner) {
  if (!winner) return 'Nadie';
  return `[${winner.playerId} | ${winner.displayName}]`;
}

/**
 * Pasa a BETWEEN_ROUNDS y programa la próxima canción mediante un timeout.
 * Al vencer incrementa ronda e índice, reinicia intentos y abre la ronda.
 * La pausa es un mínimo solicitado al event loop, no un plazo exacto.
 * @param {number} delaySeconds Demora solicitada en segundos.
 */
function scheduleNextRoundFromAnswer(delaySeconds) {
  transitionSessionTo(
      SessionState.BETWEEN_ROUNDS,
      'ronda adjudicada; esperando siguiente ronda',
  );
  gameStarted = false;
  transitionTimeout = setTimeout(
      startNextRoundAfterAnswer,
      delaySeconds * MILLISECONDS_PER_SECOND,
  );
}

function startNextRoundAfterAnswer() {
  advanceRoundIndices();
  transitionSessionTo(SessionState.ROUND_ACTIVE, 'inicio de siguiente ronda');
  activateCurrentRound();
  logCurrentRoundStart();
  broadcastAndPrefetchCurrentRound();
  broadcastLeaderboard();
}

function advanceRoundIndices() {
  currentRound += 1;
  currentSongIndex = (currentSongIndex + 1) % playlist.length;
}

function activateCurrentRound() {
  gameStarted = true;
  resetAllPlayerAttempts();
  gameCoordinator.beginRound(currentRound + 1);
}

// ALT-01 / C6: único adjudicador de AnswerEvent.
// El servidor mantiene transporte/timers; el coordinador decide el resultado
// de cada respuesta.
const gameCoordinator = new GameCoordinator({
  playersById,
  normalizeText,
  getRoundContext,
  buildWinnerView,
  sendToPlayer,
  broadcast,
  broadcastLeaderboard,
  finishGame: finishGameFromAnswer,
  scheduleNextRound: scheduleNextRoundFromAnswer,
});

/**
 * Registra los handlers de cada conexión WebSocket.
 * JOIN asigna identidad; READY y UNREADY modifican la barrera. ANSWER valida
 * registro, estado y elegibilidad antes de encolar para adjudicación.
 * El cierre retira el transporte y READY, pero conserva el registro histórico.
 * Los mensajes se interpretan como JSON; no hay validación completa de esquema.
 */
wss.on('connection', (ws) => handleConnection(ws));

function handleConnection(ws) {
  const context = {username: '', playerId: null};
  ws.on('message', (message) => handleSocketMessage(ws, context, message));
  ws.on('close', () => handleSocketClose(ws, context));
}

function handleSocketMessage(ws, context, message) {
  const data = JSON.parse(message);
  if (data.type === 'JOIN') handleJoin(ws, context, data);
  if (data.type === 'READY') handleReadyChange(ws, true);
  if (data.type === 'UNREADY') handleReadyChange(ws, false);
  if (data.type === 'ANSWER') handleAnswer(ws, data);
}

function handleJoin(ws, context, data) {
  if (context.playerId) {
    logDuplicateJoin(context);
    return;
  }
  const player = registerJoinedPlayer(ws, context, data.username);
  notifyPlayerRegistered(ws, player);
  broadcastLeaderboard();
  broadcastSessionState();
  sendJoinState(ws, player);
}

function logDuplicateJoin(context) {
  console.log(
      '[!] JOIN duplicado ignorado para ' +
      `[${context.playerId} | ${context.username}]`,
  );
}

function registerJoinedPlayer(ws, context, username) {
  context.username = username;
  const player = registerPlayer(ws, username);
  context.playerId = player.playerId;
  configurePlayerEligibilityOnJoin(player);
  console.log(
      `[+] Usuario conectado: [${player.playerId} | ${username}]`,
  );
  return player;
}

function notifyPlayerRegistered(ws, player) {
  ws.send(JSON.stringify({
    type: 'PLAYER_REGISTERED',
    playerId: player.playerId,
    displayName: player.displayName,
  }));
}

function sendJoinState(ws, player) {
  const state = sessionCoordinator.getState();
  if (state === SessionState.LOBBY) sendWaitingStart(ws);
  else if (state === SessionState.GAME_OVER) sendGameOver(ws);
  else sendWaitingNextRound(ws, player);
}

function sendWaitingStart(ws) {
  const remainingMs = startTime - Date.now();
  const secondsLeft = Math.max(
      0, Math.floor(remainingMs / MILLISECONDS_PER_SECOND),
  );
  ws.send(JSON.stringify({
    type: 'WAITING_START',
    startTime: startTime.toLocaleTimeString(),
    secondsLeft,
    titles: playlist.map((song) => song.title),
  }));
}

function sendGameOver(ws) {
  ws.send(JSON.stringify({
    type: 'GAME_OVER',
    leaderboard: buildLeaderboardView(),
    winner: buildWinnerView(getFinalWinner()),
  }));
}

function sendWaitingNextRound(ws, player) {
  ws.send(JSON.stringify({
    type: 'WAITING_NEXT_ROUND',
    currentRound: getCurrentRoundId(),
    eligibleFromRound: player.eligibleFromRoundId,
    maxRounds,
    titles: playlist.map((song) => song.title),
  }));
}

function handleReadyChange(ws, ready) {
  const player = getPlayerBySocket(ws);
  if (!player) {
    logMissingReadyPlayer(ready);
    return;
  }
  try {
    const result = updatePlayerReady(player, ready);
    logReadyChange(player, result, ready);
    broadcastSessionState();
    maybeStartAfterReady(ready);
  } catch (error) {
    logReadyError(player, error, ready);
  }
}

function logMissingReadyPlayer(ready) {
  const action = ready ? 'READY' : 'UNREADY';
  console.log(`[SC] ${action} ignorado: socket sin jugador registrado.`);
}

function updatePlayerReady(player, ready) {
  if (ready) return sessionCoordinator.markPlayerReady(player.playerId);
  return sessionCoordinator.markPlayerNotReady(player.playerId);
}

function logReadyChange(player, result, ready) {
  const action = ready ? 'READY' : 'UNREADY';
  console.log(
      `[SC] ${action} [${player.playerId} | ${player.displayName}] ` +
      `(ready=${result.readyCount}/${getConnectedPlayerIds().length})`,
  );
}

function maybeStartAfterReady(ready) {
  if (!ready || TEST_MODE || Date.now() < startTime.getTime()) return;
  startGameFromLobby('inicio desde LOBBY con barrera READY satisfecha');
}

function logReadyError(player, error, ready) {
  const action = ready ? 'READY' : 'UNREADY';
  console.log(
      `[SC] ${action} rechazado para ` +
      `[${player.playerId} | ${player.displayName}]: ${error.message}`,
  );
}

function handleAnswer(ws, data) {
  const player = getPlayerBySocket(ws);
  if (!player) {
    console.log('[!] ANSWER ignorado: socket sin jugador registrado.');
    return;
  }
  if (rejectInactiveAnswer(player)) return;
  if (rejectIneligibleAnswer(player)) return;
  const answerEvent = createAnswerEvent(player, data.answer);
  logReceivedAnswer(answerEvent, player);
  enqueueAnswerEvent(answerEvent);
}

function rejectInactiveAnswer(player) {
  const state = sessionCoordinator.getState();
  if (state === SessionState.ROUND_ACTIVE && gameStarted && !gameFinished) {
    return false;
  }
  console.log(
      '[SCx] ANSWER rechazado para ' +
      `[${player.playerId} | ${player.displayName}]: ` +
      `sesión no activa para respuestas (state=${state}).`,
  );
  sendInactiveAnswerRejection(player, state);
  return true;
}

function sendInactiveAnswerRejection(player, sessionState) {
  sendToPlayer(player.playerId, {
    type: 'ANSWER_REJECTED',
    reason: 'SESSION_NOT_ACTIVE',
    sessionState,
  });
}

function rejectIneligibleAnswer(player) {
  if (isPlayerEligibleForCurrentRound(player)) return false;
  console.log(
      '[SC] ANSWER rechazado para ' +
      `[${player.playerId} | ${player.displayName}]: ` +
      `no elegible para ronda ${getCurrentRoundId()}; ` +
      `elegible desde ronda ${player.eligibleFromRoundId}.`,
  );
  sendIneligibleAnswerRejection(player);
  return true;
}

function sendIneligibleAnswerRejection(player) {
  sendToPlayer(player.playerId, {
    type: 'ANSWER_REJECTED',
    reason: 'NOT_ELIGIBLE_CURRENT_ROUND',
    currentRound: getCurrentRoundId(),
    eligibleFromRound: player.eligibleFromRoundId,
  });
}

function logReceivedAnswer(answerEvent, player) {
  const sequence = String(answerEvent.sequence)
      .padStart(SEQUENCE_PAD_WIDTH, '0');
  console.log(
      `[→] ANSWER #${sequence} recibido de ` +
      `[${player.playerId} | ${player.displayName}] ` +
      `en ronda ${answerEvent.roundId}.`,
  );
}

function handleSocketClose(ws, context) {
  if (!context.username) return;
  const player = markPlayerDisconnected(ws);
  if (player) disconnectRegisteredPlayer(player);
  else console.log(`[-] Usuario desconectado: ${context.username}`);
  broadcastLeaderboard();
  broadcastSessionState();
  maybeStartAfterDisconnect();
}

function disconnectRegisteredPlayer(player) {
  sessionCoordinator.removePlayerReadiness(player.playerId);
  console.log(
      '[-] Usuario desconectado: ' +
      `[${player.playerId} | ${player.displayName}]`,
  );
}

function maybeStartAfterDisconnect() {
  const lobby = sessionCoordinator.getState() === SessionState.LOBBY;
  if (TEST_MODE || !lobby || Date.now() < startTime.getTime()) return;
  startGameFromLobby(
      'inicio desde LOBBY tras desconexión que satisface barrera READY',
  );
}

/**
 * Difunde el mensaje a todos los sockets abiertos, aun sin JOIN registrado.
 * No garantiza recepción simultánea ni reproducción sincronizada.
 * @param {!Object} data Mensaje del protocolo serializable como JSON.
 */
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

/**
 * Difunde UPDATE_LEADERBOARD con la proyección actual de los jugadores.
 */
function broadcastLeaderboard() {
  broadcast({
    type: 'UPDATE_LEADERBOARD',
    leaderboard: buildLeaderboardView(),
  });
}


// Listener de comandos en la terminal del servidor en tiempo real
/**
 * Inicia la lectura recurrente de comandos del operador.
 * r/restart solicita reiniciar; cualquier otro ingreso sigue el camino de
 * avance forzado. El reinicio y avance validan sus propios estados.
 */
function setupConsoleCommands() {
  const consoleRl = readline.createInterface({
    input: process.stdin, output: process.stdout, prompt: '',
  });
  promptOperator(consoleRl);
}

function promptOperator(consoleRl) {
  const question = 'comando operador ' +
    '[x=avanzar ronda, r=restart tras GAME_OVER]: ';
  consoleRl.question(question, (answer) => {
    handleOperatorCommand(answer);
    promptOperator(consoleRl);
  });
}

function handleOperatorCommand(answer) {
  const command = answer.trim().toLowerCase();
  if (command === 'r' || command === 'restart') {
    restartGame();
    return;
  }
  console.log('[*] Iniciando cuenta regresiva de 5 segundos...');
  forceNextRound();
}

let transitionTimeout = null;

/**
 * Reinicia desde GAME_OVER: cancela el timer de transición, incrementa la
 * generación de sesión y limpia READY por medio del coordinador de sesión.
 * Conserva conexiones vigentes y playlist; reinicia índices, intentos,
 * puntajes y adjudicador. La hora deja de impedir el inicio por READY.
 * No vacía explícitamente AnswerQueue ni reinicia las secuencias de respuesta.
 * @return {boolean} True si se reinició; false si el estado no lo permite.
 */
function restartGame() {
  if (!canRestartGame()) return false;
  clearTransitionTimeout();
  const restart = sessionCoordinator.restartSession();
  resetAudioForRestart(restart);
  resetGameRuntimeState();
  logGameRestart(restart);
  broadcastGameReset(restart);
  return true;
}

function canRestartGame() {
  if (sessionCoordinator.getState() === SessionState.GAME_OVER) return true;
  console.log(
      '[SCx] RESTART rechazado: ' +
      `estado actual=${sessionCoordinator.getState()}. ` +
      'RESTART solo es válido desde GAME_OVER.',
  );
  return false;
}

function clearTransitionTimeout() {
  if (!transitionTimeout) return;
  clearTimeout(transitionTimeout);
  transitionTimeout = null;
}

function resetAudioForRestart(restart) {
  audioPreparationManager?.handleGameRestart(restart);
  roundAudioRegistry.clear();
}

function resetGameRuntimeState() {
  gameStarted = false;
  gameFinished = false;
  currentRound = 0;
  currentSongIndex = 0;
  lastReadyBarrierStatus = null;
  resetPlayersForNewGame();
  gameCoordinator.resetGameState();
  startTime = new Date();
}

function logGameRestart(restart) {
  console.log(
      '[SCv] GAME_OVER -> LOBBY por RESTART ' +
      `(gameId=${restart.gameId}, previousGameId=${restart.previousGameId}).`,
  );
}

function broadcastGameReset(restart) {
  broadcast({
    type: 'GAME_RESET', gameId: restart.gameId,
    sessionState: SessionState.LOBBY, maxRounds,
    titles: playlist.map((song) => song.title),
  });
  broadcastLeaderboard();
  broadcastSessionState();
}

/**
 * Permite al operador adelantar una ronda activa sin adjudicar puntos.
 * Cancela el timeout previo, anuncia ganador ficticio y espera cinco segundos.
 * Luego finaliza por límite de rondas o playlist, o abre la siguiente ronda.
 */
function forceNextRound() {
  if (!canForceNextRound()) return;
  transitionSessionTo(
      SessionState.BETWEEN_ROUNDS, 'avance forzado por operador',
  );
  gameStarted = false;
  clearTransitionTimeout();
  console.log('[*] Ronda adelantada por el operador del servidor.');
  broadcastForcedRoundWinner();
  transitionTimeout = setTimeout(
      completeForcedAdvance, FORCE_NEXT_DELAY_SECONDS * MILLISECONDS_PER_SECOND,
  );
}

function canForceNextRound() {
  if (!gameStarted && !gameFinished) {
    console.log('[!] La partida aún no comenzó.');
    return false;
  }
  if (gameFinished) {
    console.log('[!] La partida ya finalizó.');
    return false;
  }
  return true;
}

function broadcastForcedRoundWinner() {
  broadcast({
    type: 'ROUND_WINNER',
    winner: {
      playerId: null, displayName: 'Nadie (Operador adelantó)', score: 0,
    },
    songTitle: playlist[currentSongIndex].title,
    points: 0, delay: FORCE_NEXT_DELAY_SECONDS,
  });
}

function completeForcedAdvance() {
  currentRound += 1;
  if (isGameLimitReached()) {
    finishCurrentGame('fin de partida tras avance forzado');
    return;
  }
  currentSongIndex = (currentSongIndex + 1) % playlist.length;
  openForcedRound();
  logCurrentRoundStart();
  broadcastAndPrefetchCurrentRound();
  broadcastLeaderboard();
}

function openForcedRound() {
  transitionSessionTo(
      SessionState.ROUND_ACTIVE,
      'inicio de siguiente ronda tras avance forzado',
  );
  activateCurrentRound();
}

function isGameLimitReached() {
  return currentRound >= maxRounds || currentRound >= playlist.length;
}

/**
 * Abre el servidor HTTP y agenda la comprobación del inicio programado.
 * En modo normal exige READY; en test omite esa barrera. El intervalo se
 * cancela cuando el flujo de comprobación invoca el inicio desde LOBBY.
 * El reinicio posterior utiliza los handlers READY y desconexión.
 */
function startServerAndGameLoop() {
  if (!TEST_MODE) setupConsoleCommands();
  server.listen(SERVER_PORT, logServerStarted);
  const interval = TEST_MODE ? TEST_LOOP_INTERVAL_MS : NORMAL_LOOP_INTERVAL_MS;
  const timer = setInterval(() => checkScheduledStart(timer), interval);
}

function logServerStarted() {
  console.log(`[*] Servidor web corriendo en http://localhost:${SERVER_PORT}`);
  console.log(
      '[*] Esperando la hora de inicio ' +
      `(${startTime.toLocaleTimeString()}) para disparar la primera ronda...`,
  );
}

function checkScheduledStart(timer) {
  if (gameStarted || gameFinished || new Date() < startTime) return;
  if (!canPassReadyBarrier()) return;
  startGameFromLobby(scheduledStartReason());
  clearInterval(timer);
}

function canPassReadyBarrier() {
  if (TEST_MODE) return true;
  const connectedIds = getConnectedPlayerIds();
  if (sessionCoordinator.canStart(connectedIds)) return true;
  logPendingReadyBarrier(connectedIds.length);
  return false;
}

function logPendingReadyBarrier(connectedCount) {
  const status = `${sessionCoordinator.getReadyCount()}/${connectedCount}`;
  if (lastReadyBarrierStatus === status) return;
  console.log(`[SC] START pendiente: READY ${status}.`);
  lastReadyBarrierStatus = status;
}

function scheduledStartReason() {
  if (TEST_MODE) return 'inicio automatico de prueba ALT-02';
  return 'inicio programado con barrera READY satisfecha';
}

/**
 * Prepara una playlist sintética de respuestas conocidas para ALT-02.
 * Omite iTunes y la configuración interactiva, cierra readline y arranca el
 * servidor con demora y rondas configurables. No proporciona audio real.
 */
function startDeterministicTestMode() {
  playlist = buildDeterministicPlaylist();
  resetDeterministicState();
  logDeterministicMode();
  startServerAndGameLoop();
}

function buildDeterministicPlaylist() {
  return Array.from({length: TEST_ROUNDS}, (_, index) => ({
    title: TEST_SONG_TITLE,
    artist: 'ALT-02 Test Harness',
    preview: `https://example.invalid/alt02-test-${index + 1}.mp3`,
  }));
}

function resetDeterministicState() {
  currentSongIndex = 0;
  currentRound = 0;
  maxRounds = TEST_ROUNDS;
  delayNextRound = 0;
  gameStarted = false;
  gameFinished = false;
  startTime = new Date(Date.now() + TEST_START_DELAY_MS);
}

function logDeterministicMode() {
  console.log(
      `[TEST] Modo ALT-02 activo: rounds=${TEST_ROUNDS}, ` +
      `answer="${TEST_SONG_TITLE}", port=${SERVER_PORT}.`,
  );
  console.log(
      `[TEST] Inicio automático en ${TEST_START_DELAY_MS} ms; ` +
      'iTunes y configuración interactiva deshabilitados.',
  );
  logTestQueueDelay();
}

function logTestQueueDelay() {
  if (TEST_QUEUE_DRAIN_DELAY_MS <= 0) return;
  console.log(
      '[TEST] Drenaje de AnswerQueue demorado ' +
      `${TEST_QUEUE_DRAIN_DELAY_MS} ms para ejercitar ` +
      'colisiones controladas.',
  );
}

if (TEST_MODE) {
  startDeterministicTestMode();
} else {
  loadGameConfig();
  fetchPlaylistFromItunes().then(() => {
    startServerAndGameLoop();
  });
}
