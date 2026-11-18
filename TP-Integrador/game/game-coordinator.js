/**
 * Adjudicador de respuestas de una ronda (ALT-01).
 *
 * El servidor drena la cola FIFO y llama a processAnswerEvent de forma
 * secuencial. El coordinador valida el contexto y fija un único ganador
 * antes de modificar el puntaje y emitir mensajes. El orden es el de
 * recepción asignado por el servidor, no el de envío de los clientes.
 * No crea hilos, no implementa bloqueos ni administra sockets o timers;
 * esas responsabilidades pertenecen al servidor. La garantía de ganador
 * único depende del consumidor único y del ciclo de vida de las rondas.
 */
class GameCoordinator {
  /**
   * Recibe estado compartido y operaciones proporcionadas por el servidor.
   * Los callbacks se invocan de forma síncrona; pueden programar tareas.
   * @param {!Object} options Dependencias del coordinador.
   * @param {!Map<string, !Object>} options.playersById Jugadores por ID.
   * @param {function(string): string} options.normalizeText Normalización.
   * @param {function(): !Object} options.getRoundContext Contexto vigente.
   * @param {function(!Object): ?Object} options.buildWinnerView Vista pública.
   * @param {function(string, !Object): void} options.sendToPlayer Envío.
   * @param {function(!Object): void} options.broadcast Envío general.
   * @param {function(): void} options.broadcastLeaderboard Difunde posiciones.
   * @param {function(): void} options.finishGame Cierre de partida.
   * @param {function(number): void} options.scheduleNextRound Agenda la ronda.
   *     Recibe la demora en segundos.
   * @param {(function(string): void)=} options.log Registro opcional.
   *     Por defecto console.log.
   */
  constructor({
    playersById,
    normalizeText,
    getRoundContext,
    buildWinnerView,
    sendToPlayer,
    broadcast,
    broadcastLeaderboard,
    finishGame,
    scheduleNextRound,
    log = console.log,
  }) {
    /** @type {!Map<string, !Object>} */
    this.playersById = playersById;
    /** @type {function(string): string} */
    this.normalizeText = normalizeText;
    /** @type {function(): !Object} */
    this.getRoundContext = getRoundContext;
    /** @type {function(!Object): ?Object} */
    this.buildWinnerView = buildWinnerView;
    /** @type {function(string, !Object): void} */
    this.sendToPlayer = sendToPlayer;
    /** @type {function(!Object): void} */
    this.broadcast = broadcast;
    /** @type {function(): void} */
    this.broadcastLeaderboard = broadcastLeaderboard;
    /** @type {function(): void} */
    this.finishGame = finishGame;
    /** @type {function(number): void} */
    this.scheduleNextRound = scheduleNextRound;
    /** @type {function(string): void} */
    this.log = log;

    // ALT-01 / C7: invariante explícita de un único ganador por ronda.
    /** @type {?number} */
    this.activeRoundId = null;
    /** @type {?string} */
    this.roundWinnerPlayerId = null;
  }

  /**
   * Abre la adjudicación de una ronda y limpia su ganador anterior.
   * El servidor debe invocarlo una vez al comenzar cada ronda; no modifica
   * la cola, los puntajes ni el estado de sesión.
   * @param {number} roundId Identificador de ronda, desde 1.
   */
  beginRound(roundId) {
    this.activeRoundId = roundId;
    this.roundWinnerPlayerId = null;
    this.log(`[GC] Ronda ${roundId} abierta para adjudicación. winner=null.`);
  }

  /**
   * Limpia la ronda activa y el ganador. No reinicia jugadores, cola ni
   * sesión; el servidor realiza esas tareas por separado.
   */
  resetGameState() {
    this.activeRoundId = null;
    this.roundWinnerPlayerId = null;
    this.log(
        '[GC] Estado de juego reiniciado. ' +
      'activeRoundId=null, winner=null.',
    );
  }

  /**
   * Consume una respuesta, con el contexto obtenido al procesarla.
   * Descarta respuestas de rondas adjudicadas, inactivas o distintas de la
   * vigente, y de jugadores inexistentes. Delega el acierto o el error tras
   * normalizar el título. La elegibilidad y el registro del socket se
   * comprueban en el servidor antes de encolar; aquí no se vuelven a validar.
   * @param {!Object} answerEvent Evento definido en answer-queue.js.
   *     Se esperan sequence, playerId, roundId, answer y receivedAt.
   * @throws {TypeError} Si el normalizador recibe un valor no admitido.
   */
  processAnswerEvent(answerEvent) {
    const context = this.getRoundContext();
    const sequenceLabel = String(answerEvent.sequence).padStart(6, '0');

    // Esta guarda es deliberadamente anterior a gameStarted: si una respuesta
    // quedó en cola después del primer acierto, el rechazo se explica por la
    // invariante de ganador único y no solo por el cierre genérico de la ronda.
    if (answerEvent.roundId === this.activeRoundId &&
        this.roundWinnerPlayerId !== null) {
      this.log(
          `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `ronda ${answerEvent.roundId} ya adjudicada a ` +
        `${this.roundWinnerPlayerId}.`,
      );
      return;
    }

    if (!context.gameStarted || context.gameFinished) {
      this.log(
          `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        'partida/ronda no activa.',
      );
      return;
    }

    if (answerEvent.roundId !== context.currentRound + 1) {
      this.log(
          `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `ronda ${answerEvent.roundId} ya no es la ronda activa ` +
        `${context.currentRound + 1}.`,
      );
      return;
    }

    const player = this.playersById.get(answerEvent.playerId);
    if (!player) {
      this.log(
          `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `playerId ${answerEvent.playerId} inexistente.`,
      );
      return;
    }

    const correctSong = context.playlist[context.currentSongIndex];
    const userAnswer = this.normalizeText(answerEvent.answer);
    const correctNormalized = correctSong ?
      this.normalizeText(correctSong.title) :
      '';

    this.log(
        `[GC] ANSWER #${sequenceLabel} adjudicando para ` +
      `[${player.playerId} | ${player.displayName}] ` +
      `en ronda ${answerEvent.roundId}.`,
    );

    if (correctSong && userAnswer === correctNormalized) {
      this.handleCorrectAnswer(answerEvent, player, correctSong, context);
    } else {
      this.handleWrongAnswer(answerEvent, player);
    }
  }

  /**
   * Adjudica el primer acierto procesado y descarta posteriores aciertos.
   * Fija el ganador antes de sumar puntos o notificar. El puntaje se calcula
   * con una base de 100, menos cinco por intento previo, y un mínimo de 10.
   * Actualiza la tabla, notifica y solicita el cierre o la siguiente ronda.
   * Se invoca desde processAnswerEvent con contexto ya comprobado.
   * @param {!Object} answerEvent Evento de respuesta de la ronda.
   * @param {!Object} player Registro mutable del jugador.
   * @param {!Object} correctSong Canción seleccionada, con title.
   * @param {!Object} context Contexto de ronda obtenido del servidor;
   *     incluye currentRound, maxRounds, playlist y delayNextRound.
   */
  handleCorrectAnswer(answerEvent, player, correctSong, context) {
    const sequenceLabel = String(answerEvent.sequence).padStart(6, '0');

    // Segunda defensa de la misma invariante dentro del punto de adjudicación.
    if (this.roundWinnerPlayerId !== null) {
      this.log(
          `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `ya existe ganador ${this.roundWinnerPlayerId} ` +
        `para la ronda ${answerEvent.roundId}.`,
      );
      return;
    }

    // El coordinador fija el ganador antes de modificar score o emitir eventos.
    // Como existe un único consumidor, esta asignación define el punto de
    // adjudicación autoritativo de la ronda.
    this.roundWinnerPlayerId = player.playerId;
    this.log(
        `[GC✓] Ronda ${answerEvent.roundId} adjudicada a ` +
      `[${player.playerId} | ${player.displayName}] ` +
      `por ANSWER #${sequenceLabel}.`,
    );

    const pointsWon = Math.max(10, 100 - (player.attempts * 5));
    player.score += pointsWon;

    this.log(
        `[✓] [${player.playerId} | ${player.displayName}] ` +
      `acertó la canción "${correctSong.title}" y sumó ` +
      `${pointsWon} pts. Total: ${player.score}.`,
    );

    this.broadcastLeaderboard();

    this.sendToPlayer(player.playerId, {
      type: 'CORRECT_ANSWER',
      guess: answerEvent.answer,
      points: pointsWon,
      songTitle: correctSong.title,
    });

    this.broadcast({
      type: 'ROUND_WINNER',
      winner: this.buildWinnerView(player),
      songTitle: correctSong.title,
      points: pointsWon,
      delay: context.delayNextRound,
    });

    const isLastRound = context.currentRound + 1 >= context.maxRounds ||
            context.currentRound + 1 >= context.playlist.length;

    if (isLastRound) {
      this.finishGame();
    } else {
      this.scheduleNextRound(context.delayNextRound);
    }
  }

  /**
   * Incrementa los intentos del jugador sin cambiar su puntaje ni adjudicar.
   * Notifica potentialPoints según la fórmula vigente (attempts - 1).
   * @param {!Object} answerEvent Evento de respuesta incorrecta.
   * @param {!Object} player Registro mutable del jugador.
   */
  handleWrongAnswer(answerEvent, player) {
    player.attempts += 1;
    const potentialPoints = Math.max(10, 100 - ((player.attempts - 1) * 5));

    this.log(
        `[✗] [${player.playerId} | ${player.displayName}] ` +
      `hizo un intento erróneo: "${answerEvent.answer}". ` +
      `Intentos: ${player.attempts}.`,
    );

    this.sendToPlayer(player.playerId, {
      type: 'WRONG_ANSWER',
      guess: answerEvent.answer,
      potentialPoints,
    });
  }
}

export {GameCoordinator};
