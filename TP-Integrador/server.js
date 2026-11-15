const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const https = require('https');
const readline = require('readline');
const AnswerQueue = require('./game/AnswerQueue');
const GameCoordinator = require('./game/GameCoordinator');
const SessionCoordinator = require('./game/SessionCoordinator');
const {SessionState} = require('./game/SessionState');

// ALT-02 / C8: modo determinístico para pruebas automatizadas.
// No altera el modo normal; solo se activa con TRIVIA_TEST_MODE=1.
const TEST_MODE = process.env.TRIVIA_TEST_MODE === '1';
const SERVER_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const TEST_ROUNDS = Math.max(1, Number.parseInt(process.env.TRIVIA_TEST_ROUNDS || '20', 10));
const TEST_START_DELAY_MS = Math.max(100, Number.parseInt(process.env.TRIVIA_TEST_START_DELAY_MS || '1000', 10));
const TEST_SONG_TITLE = process.env.TRIVIA_TEST_SONG_TITLE || 'ALT02 TEST SONG';
const TEST_QUEUE_DRAIN_DELAY_MS = Math.max(0, Number.parseInt(process.env.TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS || '0', 10));

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({server});

app.use(express.static(path.join(__dirname, 'public')));

// ALT-03: identidad interna del jugador, separada del nombre visible.
let nextPlayerNumber = 1;
const playersById = new Map();
const playerIdBySocket = new Map();
const socketByPlayerId = new Map();

function generatePlayerId() {
  return `P${String(nextPlayerNumber++).padStart(3, '0')}`;
}

function registerPlayer(ws, displayName) {
  const playerId = generatePlayerId();
  const player = {
    playerId,
    displayName,
    score: 0,
    attempts: 0,
    connected: true,
    eligibleFromRoundId: 1,
  };

  playersById.set(playerId, player);
  playerIdBySocket.set(ws, playerId);
  socketByPlayerId.set(playerId, ws);
  return player;
}

function getPlayerBySocket(ws) {
  const playerId = playerIdBySocket.get(ws);
  return playerId ? playersById.get(playerId) : null;
}

function getCurrentRoundId() {
  return currentRound + 1;
}

function configurePlayerEligibilityOnJoin(player) {
  const sessionState = sessionCoordinator.getState();

  if (sessionState === SessionState.LOBBY) {
    player.eligibleFromRoundId = 1;
    return;
  }

  if (
    sessionState === SessionState.ROUND_ACTIVE ||
        sessionState === SessionState.BETWEEN_ROUNDS
  ) {
    player.eligibleFromRoundId = getCurrentRoundId() + 1;
    console.log(
      `[SC] LATE_JOIN [${player.playerId} | ${player.displayName}] ` +
            `en ronda ${getCurrentRoundId()}; elegible desde ronda ${player.eligibleFromRoundId}.`
    );
    return;
  }

  player.eligibleFromRoundId = Number.POSITIVE_INFINITY;
}

function isPlayerEligibleForCurrentRound(player) {
  return player.eligibleFromRoundId <= getCurrentRoundId();
}

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

function sendToPlayer(playerId, data) {
  const ws = socketByPlayerId.get(playerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function resetAllPlayerAttempts() {
  for (const player of playersById.values()) {
    player.attempts = 0;
  }
}

// V3 / C8: prepara a los jugadores conectados para una nueva partida.
// Los desconectados históricos dejan de formar parte de la nueva sesión.
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
function buildLeaderboardView() {
  return Array.from(playersById.values()).map(player => ({
    playerId: player.playerId,
    displayName: player.displayName,
    score: player.score,
    connected: player.connected,
  }));
}

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
// Los handlers WebSocket producen AnswerEvent y un consumidor único los procesa.
const answerQueue = new AnswerQueue();
let answerQueueProcessingScheduled = false;

function enqueueAnswerEvent(answerEvent) {
  answerQueue.enqueue(answerEvent);
  console.log(`[Q+] ANSWER #${String(answerEvent.sequence).padStart(6, '0')} encolado. queueSize=${answerQueue.size()}.`);
  scheduleAnswerQueueProcessing();
}

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

function processAnswerQueue() {
  try {
    while (!answerQueue.isEmpty()) {
      const answerEvent = answerQueue.dequeue();
      console.log(`[Q-] ANSWER #${String(answerEvent.sequence).padStart(6, '0')} desencolado. queueSize=${answerQueue.size()}.`);
      gameCoordinator.processAnswerEvent(answerEvent);
    }
  } finally {
    answerQueueProcessingScheduled = false;

    // Si algún productor agregó trabajo mientras se cerraba este ciclo,
    // volvemos a agendar el consumidor sin procesar fuera de la cola.
    if (!answerQueue.isEmpty()) {
      scheduleAnswerQueueProcessing();
    }
  }
}

let playlist = [];
let currentSongIndex = 0;
let currentRound = 0;
let maxRounds = 5;
let delayNextRound = 10; // segundos
let startTime = null;
let gameStarted = false;
let gameFinished = false;
// V3 / C4: SessionCoordinator refleja explícitamente
// el ciclo de vida que la aplicación ya ejecuta.
const sessionCoordinator = new SessionCoordinator();

function transitionSessionTo(nextState, reason) {
  const transition = sessionCoordinator.transitionTo(nextState);

  console.log(
    `[SC] ${transition.previousState} -> ${transition.currentState} ` +
        `(gameId=${transition.gameId}, reason=${reason})`
  );

  return transition;
}

// V3 / C5: jugadores conectados y vista pública del estado de sesión.
function getConnectedPlayerIds() {
  return Array.from(playersById.values())
      .filter(player => player.connected)
      .map(player => player.playerId);
}

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

function broadcastSessionState() {
  broadcast(buildSessionStateView());
}

let lastReadyBarrierStatus = null;

function startGameFromLobby(reason) {
  if (sessionCoordinator.getState() !== SessionState.LOBBY) {
    return false;
  }

  const connectedPlayerIds = getConnectedPlayerIds();

  if (!TEST_MODE && !sessionCoordinator.canStart(connectedPlayerIds)) {
    return false;
  }

  lastReadyBarrierStatus = null;

  transitionSessionTo(SessionState.ROUND_ACTIVE, reason);

  gameStarted = true;
  gameFinished = false;
  currentRound = 0;
  resetAllPlayerAttempts();
  gameCoordinator.beginRound(currentRound + 1);

  const initialSong = playlist[currentSongIndex];
  console.log(`\n[♫] Comienza la ronda nro ${currentRound + 1} de ${maxRounds}: La canción es "${initialSong.title}"`);

  broadcast({
    type: 'NEW_SONG',
    song: initialSong.preview,
    round: currentRound + 1,
    maxRounds,
    hint: `¡Ronda ${currentRound + 1} de ${maxRounds}! Adivina la canción`,
  });

  broadcastLeaderboard();
  broadcastSessionState();
  return true;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askConfig() {
  console.log('\n==============================================');
  console.log('   CONFIGURACIÓN DE LA PARTIDA DE TRIVIA');
  console.log('==============================================');

  const defaultTime = new Date(Date.now() + 60000);
  const defaultTimeStr = defaultTime.toTimeString().split(' ')[0].substring(0, 5);

  rl.question(`1. ¿A qué hora empezamos la primera ronda? (HH:MM) [Por defecto: ${defaultTimeStr}]: `, (ansTime) => {
    const horaInicio = ansTime.trim() || defaultTimeStr;

    rl.question('2. ¿Cuántos segundos después de que alguien adivina comienza la siguiente ronda? [Por defecto: 10]: ', (ansDelay) => {
      delayNextRound = parseInt(ansDelay) || 10;

      rl.question('3. ¿Cuántas rondas vamos a jugar? [Por defecto: 5]: ', (ansRounds) => {
        maxRounds = parseInt(ansRounds) || 5;

        const [hours, minutes] = horaInicio.split(':');
        startTime = new Date();
        startTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        if (startTime <= new Date()) {
          startTime = new Date(Date.now() + 30000);
          console.log('[!] La hora indicada ya pasó o es muy próxima. Iniciando en 30 segundos...');
        }

        console.log('\n----------------------------------------------');
        console.log('[+] ¡Configuración guardada con éxito!');
        console.log(`[+] Hora de inicio: ${startTime.toLocaleTimeString()}`);
        console.log(`[+] Demora entre rondas: ${delayNextRound} segundos`);
        console.log(`[+] Total de rondas: ${maxRounds}`);
        console.log('----------------------------------------------\n');

        rl.close();
        startServerAndGameLoop();
      });
    });
  });
}

function normalizeText(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function fetchPlaylistFromItunes() {
  return new Promise((resolve, reject) => {
    const url = 'https://itunes.apple.com/search?term=No+Te+Va+Gustar&entity=song&limit=200';

    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = json.results || [];

          const vistos = new Set();
          const filtered = [];

          for (const item of results) {
            const artist = (item.artistName || '').toLowerCase();
            const track = item.trackName || '';
            const collection = (item.collectionName || '').toLowerCase();
            const preview = item.previewUrl;

            const esEnVivo = collection.includes('vivo') || collection.includes('live') ||
                                         collection.includes('gira') || track.toLowerCase().includes('en vivo') ||
                                         track.toLowerCase().includes('live') || collection.includes('teatro');

            if (artist.includes('no te va gustar') && preview && !esEnVivo) {
              const normalizedKey = normalizeText(track);
              if (!vistos.has(normalizedKey)) {
                vistos.add(normalizedKey);
                filtered.push({
                  title: track,
                  artist: item.artistName,
                  preview: preview,
                });
              }
            }
          }

          for (let i = filtered.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
          }

          playlist = filtered;
          console.log(`[*] Playlist cargada: ${playlist.length} canciones de estudio únicas.`);
          resolve();
        } catch (e) {
          console.error('Error parseando JSON:', e);
          playlist = [
            {title: 'Despues de hora', artist: 'No Te Va Gustar', preview: 'https://audio-samples.github.io/samples/mp3/blizzard_biasedfromthetruth.mp3'},
            {title: 'Ese Maldito Momento', artist: 'No Te Va Gustar', preview: 'https://audio-samples.github.io/samples/mp3/blizzard_biasedfromthetruth.mp3'},
          ];
          resolve();
        }
      });
    }).on('error', (err) => {
      console.error('Error conectando a iTunes:', err);
      playlist = [
        {title: 'Despues de hora', artist: 'No Te Va Gustar', preview: 'https://audio-samples.github.io/samples/mp3/blizzard_biasedfromthetruth.mp3'},
      ];
      resolve();
    });
  });
}

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

function finishGameFromAnswer() {
  transitionSessionTo(
    SessionState.GAME_OVER,
    'fin de partida por respuesta correcta'
  );

  gameStarted = false;
  gameFinished = true;

  const finalWinner = getFinalWinner();
  const winnerLabel = finalWinner
    ? `[${finalWinner.playerId} | ${finalWinner.displayName}]`
    : 'Nadie';

  broadcast({
    type: 'GAME_OVER',
    winner: buildWinnerView(finalWinner),
    leaderboard: buildLeaderboardView(),
  });
  broadcastSessionState();
  console.log(`[*] ¡Partida finalizada! Ganador: ${winnerLabel}`);
}

function scheduleNextRoundFromAnswer(delaySeconds) {
  transitionSessionTo(
    SessionState.BETWEEN_ROUNDS,
    'ronda adjudicada; esperando siguiente ronda'
  );

  gameStarted = false;

  transitionTimeout = setTimeout(() => {
    currentRound++;
    currentSongIndex = (currentSongIndex + 1) % playlist.length;

    transitionSessionTo(
      SessionState.ROUND_ACTIVE,
      'inicio de siguiente ronda'
    );

    gameStarted = true;
    resetAllPlayerAttempts();
    gameCoordinator.beginRound(currentRound + 1);

    const nextSong = playlist[currentSongIndex];
    console.log(`\n[♫] Comienza la ronda nro ${currentRound + 1} de ${maxRounds}: La canción es "${nextSong.title}"`);

    broadcast({
      type: 'NEW_SONG',
      song: nextSong.preview,
      round: currentRound + 1,
      maxRounds: maxRounds,
      hint: `¡Ronda ${currentRound + 1} de ${maxRounds}! Adivina la canción`,
    });
    broadcastLeaderboard();
  }, delaySeconds * 1000);
}

// ALT-01 / C6: único adjudicador de AnswerEvent.
// El servidor mantiene transporte/timers; el coordinador decide el resultado de cada respuesta.
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

wss.on('connection', (ws) => {
  let username = '';
  let playerId = null;

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'JOIN') {
      if (playerId) {
        console.log(`[!] JOIN duplicado ignorado para [${playerId} | ${username}]`);
        return;
      }

      username = data.username;
      const player = registerPlayer(ws, username);
      playerId = player.playerId;
      configurePlayerEligibilityOnJoin(player);
      console.log(`[+] Usuario conectado: [${playerId} | ${username}]`);

      ws.send(JSON.stringify({
        type: 'PLAYER_REGISTERED',
        playerId: player.playerId,
        displayName: player.displayName,
      }));

      broadcastLeaderboard();
      broadcastSessionState();

      const sessionState = sessionCoordinator.getState();

      if (sessionState === SessionState.LOBBY) {
        const segundosRestantes = Math.max(0, Math.floor((startTime - Date.now()) / 1000));
        ws.send(JSON.stringify({
          type: 'WAITING_START',
          startTime: startTime.toLocaleTimeString(),
          secondsLeft: segundosRestantes,
          titles: playlist.map(s => s.title),
        }));
      } else if (sessionState === SessionState.GAME_OVER) {
        ws.send(JSON.stringify({
          type: 'GAME_OVER',
          leaderboard: buildLeaderboardView(),
          winner: buildWinnerView(getFinalWinner()),
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'WAITING_NEXT_ROUND',
          currentRound: getCurrentRoundId(),
          eligibleFromRound: player.eligibleFromRoundId,
          maxRounds,
          titles: playlist.map(s => s.title),
        }));
      }
    }

    if (data.type === 'READY') {
      const player = getPlayerBySocket(ws);

      if (!player) {
        console.log('[SC] READY ignorado: socket sin jugador registrado.');
        return;
      }

      try {
        const result = sessionCoordinator.markPlayerReady(player.playerId);

        console.log(
          `[SC] READY [${player.playerId} | ${player.displayName}] ` +
                    `(ready=${result.readyCount}/${getConnectedPlayerIds().length})`
        );

        broadcastSessionState();

        if (!TEST_MODE && Date.now() >= startTime.getTime()) {
          startGameFromLobby('inicio desde LOBBY con barrera READY satisfecha');
        }
      } catch (error) {
        console.log(
          `[SC] READY rechazado para [${player.playerId} | ${player.displayName}]: ` +
                    error.message
        );
      }

      return;
    }

    if (data.type === 'UNREADY') {
      const player = getPlayerBySocket(ws);

      if (!player) {
        console.log('[SC] UNREADY ignorado: socket sin jugador registrado.');
        return;
      }

      try {
        const result = sessionCoordinator.markPlayerNotReady(player.playerId);

        console.log(
          `[SC] UNREADY [${player.playerId} | ${player.displayName}] ` +
                    `(ready=${result.readyCount}/${getConnectedPlayerIds().length})`
        );

        broadcastSessionState();
      } catch (error) {
        console.log(
          `[SC] UNREADY rechazado para [${player.playerId} | ${player.displayName}]: ` +
                    error.message
        );
      }

      return;
    }

    if (data.type === 'ANSWER') {
      const player = getPlayerBySocket(ws);
      if (!player) {
        console.log('[!] ANSWER ignorado: socket sin jugador registrado.');
        return;
      }

      const sessionState = sessionCoordinator.getState();
      if (sessionState !== SessionState.ROUND_ACTIVE || !gameStarted || gameFinished) {
        console.log(
          `[SCx] ANSWER rechazado para [${player.playerId} | ${player.displayName}]: ` +
                    `sesión no activa para respuestas (state=${sessionState}).`
        );

        sendToPlayer(player.playerId, {
          type: 'ANSWER_REJECTED',
          reason: 'SESSION_NOT_ACTIVE',
          sessionState,
        });
        return;
      }

      if (!isPlayerEligibleForCurrentRound(player)) {
        console.log(
          `[SC] ANSWER rechazado para [${player.playerId} | ${player.displayName}]: ` +
                    `no elegible para ronda ${getCurrentRoundId()}; ` +
                    `elegible desde ronda ${player.eligibleFromRoundId}.`
        );

        sendToPlayer(player.playerId, {
          type: 'ANSWER_REJECTED',
          reason: 'NOT_ELIGIBLE_CURRENT_ROUND',
          currentRound: getCurrentRoundId(),
          eligibleFromRound: player.eligibleFromRoundId,
        });
        return;
      }

      const answerEvent = createAnswerEvent(player, data.answer);
      console.log(`[→] ANSWER #${String(answerEvent.sequence).padStart(6, '0')} recibido de [${player.playerId} | ${player.displayName}] en ronda ${answerEvent.roundId}.`);
      enqueueAnswerEvent(answerEvent);
    }
  });

  ws.on('close', () => {
    if (username) {
      const player = markPlayerDisconnected(ws);
      if (player) {
        sessionCoordinator.removePlayerReadiness(player.playerId);
        console.log(`[-] Usuario desconectado: [${player.playerId} | ${player.displayName}]`);
      } else {
        console.log(`[-] Usuario desconectado: ${username}`);
      }
      broadcastLeaderboard();
      broadcastSessionState();

      if (
        !TEST_MODE &&
                sessionCoordinator.getState() === SessionState.LOBBY &&
                Date.now() >= startTime.getTime()
      ) {
        startGameFromLobby('inicio desde LOBBY tras desconexión que satisface barrera READY');
      }
    }
  });
});

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function broadcastLeaderboard() {
  broadcast({
    type: 'UPDATE_LEADERBOARD',
    leaderboard: buildLeaderboardView(),
  });
}


// Listener de comandos en la terminal del servidor en tiempo real
function setupConsoleCommands() {
  const consoleRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  function promptUser() {
    consoleRl.question('comando operador [x=avanzar ronda, r=restart tras GAME_OVER]: ', (answer) => {
      const command = answer.trim().toLowerCase();

      if (command === 'r' || command === 'restart') {
        restartGame();
      } else {
        console.log('[*] Iniciando cuenta regresiva de 5 segundos...');
        forceNextRound();
      }

      promptUser();
    });
  }

  promptUser();
}

let transitionTimeout = null;

function restartGame() {
  if (sessionCoordinator.getState() !== SessionState.GAME_OVER) {
    console.log(
      `[SCx] RESTART rechazado: estado actual=${sessionCoordinator.getState()}. ` +
            'RESTART solo es válido desde GAME_OVER.'
    );
    return false;
  }

  if (transitionTimeout) {
    clearTimeout(transitionTimeout);
    transitionTimeout = null;
  }

  const restart = sessionCoordinator.restartSession();

  gameStarted = false;
  gameFinished = false;
  currentRound = 0;
  currentSongIndex = 0;
  lastReadyBarrierStatus = null;

  resetPlayersForNewGame();
  gameCoordinator.resetGameState();

  // La hora original ya quedó atrás. Desde este punto el nuevo inicio
  // depende de que los jugadores vuelvan a atravesar la barrera READY.
  startTime = new Date();

  console.log(
    '[SCv] GAME_OVER -> LOBBY por RESTART ' +
        `(gameId=${restart.gameId}, previousGameId=${restart.previousGameId}).`
  );

  broadcast({
    type: 'GAME_RESET',
    gameId: restart.gameId,
    sessionState: SessionState.LOBBY,
    maxRounds,
    titles: playlist.map(song => song.title),
  });
  broadcastLeaderboard();
  broadcastSessionState();

  return true;
}

function forceNextRound() {
  if (!gameStarted && !gameFinished) {
    console.log('[!] La partida aún no comenzó.');
    return;
  }
  if (gameFinished) {
    console.log('[!] La partida ya finalizó.');
    return;
  }

  transitionSessionTo(
    SessionState.BETWEEN_ROUNDS,
    'avance forzado por operador'
  );

  // Forzar fin de ronda actual
  gameStarted = false;
  if (transitionTimeout) {
    clearTimeout(transitionTimeout);
  }

  console.log('[*] Ronda adelantada por el operador del servidor.');

  broadcast({
    type: 'ROUND_WINNER',
    winner: {playerId: null, displayName: 'Nadie (Operador adelantó)', score: 0},
    songTitle: playlist[currentSongIndex].title,
    points: 0,
    delay: 5, // Forzar 5 segundos
  });

  // Programar la siguiente ronda en 5 segundos
  transitionTimeout = setTimeout(() => {
    currentRound++;
    if (currentRound >= maxRounds || currentRound >= playlist.length) {
      transitionSessionTo(
        SessionState.GAME_OVER,
        'fin de partida tras avance forzado'
      );
      gameFinished = true;
      const finalWinner = getFinalWinner();
      const winnerLabel = finalWinner
        ? `[${finalWinner.playerId} | ${finalWinner.displayName}]`
        : 'Nadie';
      broadcast({
        type: 'GAME_OVER',
        winner: buildWinnerView(finalWinner),
        leaderboard: buildLeaderboardView(),
      });
      broadcastSessionState();
      console.log(`[*] ¡Partida finalizada! Ganador: ${winnerLabel}`);
    } else {
      currentSongIndex = (currentSongIndex + 1) % playlist.length;

      transitionSessionTo(
        SessionState.ROUND_ACTIVE,
        'inicio de siguiente ronda tras avance forzado'
      );

      gameStarted = true;
      resetAllPlayerAttempts();
      gameCoordinator.beginRound(currentRound + 1);
      const nextSong = playlist[currentSongIndex];
      console.log(`\n[♫] Comienza la ronda nro ${currentRound + 1} de ${maxRounds}: La canción es "${nextSong.title}"`);

      broadcast({
        type: 'NEW_SONG',
        song: nextSong.preview,
        round: currentRound + 1,
        maxRounds: maxRounds,
        hint: `¡Ronda ${currentRound + 1} de ${maxRounds}! Adivina la canción`,
      });
      broadcastLeaderboard();
    }
  }, 5000);
}

function startServerAndGameLoop() {
  if (!TEST_MODE) {
    setupConsoleCommands();
  }

  server.listen(SERVER_PORT, () => {
    console.log(`[*] Servidor web corriendo en http://localhost:${SERVER_PORT}`);
    console.log(`[*] Esperando la hora de inicio (${startTime.toLocaleTimeString()}) para disparar la primera ronda...`);
  });

  const timer = setInterval(() => {
    const now = new Date();

    if (!gameStarted && !gameFinished && now >= startTime) {
      const connectedPlayerIds = getConnectedPlayerIds();

      if (!TEST_MODE && !sessionCoordinator.canStart(connectedPlayerIds)) {
        const readyBarrierStatus =
          `${sessionCoordinator.getReadyCount()}/${connectedPlayerIds.length}`;

        if (lastReadyBarrierStatus !== readyBarrierStatus) {
          console.log(
            `[SC] START pendiente: READY ${readyBarrierStatus}.`
          );

          lastReadyBarrierStatus = readyBarrierStatus;
        }

        return;
      }

      startGameFromLobby(
        TEST_MODE
          ? 'inicio automatico de prueba ALT-02'
          : 'inicio programado con barrera READY satisfecha'
      );

      clearInterval(timer);
    }
  }, TEST_MODE ? 10 : 1000);
}

function startDeterministicTestMode() {
  // Una entrada por ronda evita que la condición de fin dependa del tamaño
  // de una playlist externa. Todas comparten la misma respuesta conocida.
  playlist = Array.from({length: TEST_ROUNDS}, (_, index) => ({
    title: TEST_SONG_TITLE,
    artist: 'ALT-02 Test Harness',
    preview: `https://example.invalid/alt02-test-${index + 1}.mp3`,
  }));

  currentSongIndex = 0;
  currentRound = 0;
  maxRounds = TEST_ROUNDS;
  delayNextRound = 0;
  gameStarted = false;
  gameFinished = false;
  startTime = new Date(Date.now() + TEST_START_DELAY_MS);

  // readline se crea al iniciar el proceso para el modo normal. En modo test
  // no se usa, por lo que se cierra para que no interfiera con el harness.
  rl.close();

  console.log(`[TEST] Modo ALT-02 activo: rounds=${TEST_ROUNDS}, answer="${TEST_SONG_TITLE}", port=${SERVER_PORT}.`);
  console.log(`[TEST] Inicio automático en ${TEST_START_DELAY_MS} ms; iTunes y configuración interactiva deshabilitados.`);
  if (TEST_QUEUE_DRAIN_DELAY_MS > 0) {
    console.log(`[TEST] Drenaje de AnswerQueue demorado ${TEST_QUEUE_DRAIN_DELAY_MS} ms para ejercitar colisiones controladas.`);
  }

  startServerAndGameLoop();
}

if (TEST_MODE) {
  startDeterministicTestMode();
} else {
  fetchPlaylistFromItunes().then(() => {
    askConfig();
  });
}
