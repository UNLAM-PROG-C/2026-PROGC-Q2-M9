/**
 * Adjudicador de respuestas de una ronda (ALT-01).
 *
 * El servidor drena la cola FIFO y llama a processAnswerEvent de forma
 * secuencial. El coordinador valida el contexto y fija un único ganador
 * antes de modificar el puntaje y emitir mensajes. El orden es el de
 * recepción asignado por el servidor, no el de envío de los clientes.
 */
const BASE_SCORE = 100;
const MIN_SCORE = 10;
const ATTEMPT_PENALTY = 5;
const SEQUENCE_PAD_WIDTH = 6;

class GameCoordinator {
  /**
   * @param {!Object} options Dependencias del coordinador.
   */
  constructor(options) {
    this.assignDependencies(options);
    this.resetRoundState();
  }

  /** @param {!Object} options Dependencias del coordinador. */
  assignDependencies(options) {
    this.playersById = options.playersById;
    this.normalizeText = options.normalizeText;
    this.getRoundContext = options.getRoundContext;
    this.buildWinnerView = options.buildWinnerView;
    this.sendToPlayer = options.sendToPlayer;
    this.broadcast = options.broadcast;
    this.broadcastLeaderboard = options.broadcastLeaderboard;
    this.finishGame = options.finishGame;
    this.scheduleNextRound = options.scheduleNextRound;
    this.log = options.log || console.log;
  }

  /** Limpia la identidad de la ronda y su ganador. */
  resetRoundState() {
    this.activeRoundId = null;
    this.roundWinnerPlayerId = null;
  }

  /** @param {number} roundId Identificador de ronda, desde 1. */
  beginRound(roundId) {
    this.activeRoundId = roundId;
    this.roundWinnerPlayerId = null;
    this.log(`[GC] Ronda ${roundId} abierta para adjudicación. winner=null.`);
  }

  /** Limpia la ronda activa y el ganador. */
  resetGameState() {
    this.resetRoundState();
    this.log(
        '[GC] Estado de juego reiniciado. ' +
        'activeRoundId=null, winner=null.',
    );
  }

  /** @param {!Object} answerEvent Evento definido en answer-queue.js. */
  processAnswerEvent(answerEvent) {
    const context = this.getRoundContext();
    const sequenceLabel = this.formatSequence(answerEvent.sequence);
    if (this.discardInvalidEvent(answerEvent, context, sequenceLabel)) return;
    const player = this.playersById.get(answerEvent.playerId);
    if (this.discardMissingPlayer(answerEvent, player, sequenceLabel)) return;
    const correctSong = context.playlist[context.currentSongIndex];
    this.logAdjudication(answerEvent, player, sequenceLabel);
    if (this.isCorrectAnswer(answerEvent.answer, correctSong)) {
      this.handleCorrectAnswer(answerEvent, player, correctSong, context);
    } else this.handleWrongAnswer(answerEvent, player);
  }

  /** @param {number} sequence Secuencia de recepción. @return {string} */
  formatSequence(sequence) {
    return String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0');
  }

  /** @return {boolean} True si el evento debe descartarse. */
  discardInvalidEvent(event, context, sequenceLabel) {
    if (event.roundId === this.activeRoundId &&
        this.roundWinnerPlayerId !== null) {
      this.logPriorWinnerDiscard(event, sequenceLabel);
      return true;
    }
    if (!context.gameStarted || context.gameFinished) {
      this.logInactiveDiscard(sequenceLabel);
      return true;
    }
    return this.discardWrongRound(event, context, sequenceLabel);
  }

  /** Registra descarte por ganador previo. */
  logPriorWinnerDiscard(event, sequenceLabel) {
    this.log(
        `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `ronda ${event.roundId} ya adjudicada a ` +
        `${this.roundWinnerPlayerId}.`,
    );
  }

  /** Registra descarte por partida o ronda inactiva. */
  logInactiveDiscard(sequenceLabel) {
    this.log(
        `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        'partida/ronda no activa.',
    );
  }

  /** @return {boolean} True si el evento pertenece a otra ronda. */
  discardWrongRound(event, context, sequenceLabel) {
    const activeRoundId = context.currentRound + 1;
    if (event.roundId === activeRoundId) return false;
    this.log(
        `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `ronda ${event.roundId} ya no es la ronda activa ` +
        `${activeRoundId}.`,
    );
    return true;
  }

  /** @return {boolean} True si el jugador no existe. */
  discardMissingPlayer(event, player, sequenceLabel) {
    if (player) return false;
    this.log(
        `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `playerId ${event.playerId} inexistente.`,
    );
    return true;
  }

  /** Registra el evento que será adjudicado. */
  logAdjudication(event, player, sequenceLabel) {
    this.log(
        `[GC] ANSWER #${sequenceLabel} adjudicando para ` +
        `[${player.playerId} | ${player.displayName}] ` +
        `en ronda ${event.roundId}.`,
    );
  }

  /** @return {boolean} True si la respuesta coincide con el título. */
  isCorrectAnswer(answer, correctSong) {
    if (!correctSong) return false;
    return this.normalizeText(answer) ===
      this.normalizeText(correctSong.title);
  }

  /** Adjudica el primer acierto procesado. */
  handleCorrectAnswer(answerEvent, player, correctSong, context) {
    const sequenceLabel = this.formatSequence(answerEvent.sequence);
    if (this.hasWinner(answerEvent, sequenceLabel)) return;
    this.assignWinner(answerEvent, player, sequenceLabel);
    const pointsWon = this.awardPoints(player, correctSong);
    this.broadcastLeaderboard();
    this.notifyCorrectAnswer(answerEvent, player, correctSong, pointsWon);
    this.notifyRoundWinner(player, correctSong, pointsWon, context);
    this.advanceAfterWinner(context);
  }

  /** @return {boolean} True si la ronda ya tiene ganador. */
  hasWinner(event, sequenceLabel) {
    if (this.roundWinnerPlayerId === null) return false;
    this.log(
        `[GCx] ANSWER #${sequenceLabel} descartado: ` +
        `ya existe ganador ${this.roundWinnerPlayerId} ` +
        `para la ronda ${event.roundId}.`,
    );
    return true;
  }

  /** Fija el ganador antes de modificar score o emitir eventos. */
  assignWinner(event, player, sequenceLabel) {
    this.roundWinnerPlayerId = player.playerId;
    this.log(
        `[GC✓] Ronda ${event.roundId} adjudicada a ` +
        `[${player.playerId} | ${player.displayName}] ` +
        `por ANSWER #${sequenceLabel}.`,
    );
  }

  /** @return {number} Puntos adjudicados. */
  awardPoints(player, correctSong) {
    const pointsWon = Math.max(
        MIN_SCORE,
        BASE_SCORE - (player.attempts * ATTEMPT_PENALTY),
    );
    player.score += pointsWon;
    this.logCorrectScore(player, correctSong, pointsWon);
    return pointsWon;
  }

  /** Registra el puntaje obtenido por un acierto. */
  logCorrectScore(player, correctSong, pointsWon) {
    this.log(
        `[✓] [${player.playerId} | ${player.displayName}] ` +
        `acertó la canción "${correctSong.title}" y sumó ` +
        `${pointsWon} pts. Total: ${player.score}.`,
    );
  }

  /** Notifica el acierto al jugador. */
  notifyCorrectAnswer(event, player, correctSong, pointsWon) {
    this.sendToPlayer(player.playerId, {
      type: 'CORRECT_ANSWER',
      guess: event.answer,
      points: pointsWon,
      songTitle: correctSong.title,
    });
  }

  /** Difunde el ganador de la ronda. */
  notifyRoundWinner(player, correctSong, pointsWon, context) {
    this.broadcast({
      type: 'ROUND_WINNER',
      winner: this.buildWinnerView(player),
      songTitle: correctSong.title,
      points: pointsWon,
      delay: context.delayNextRound,
    });
  }

  /** Cierra la partida o agenda la ronda siguiente. */
  advanceAfterWinner(context) {
    const nextRound = context.currentRound + 1;
    const isLastRound = nextRound >= context.maxRounds ||
      nextRound >= context.playlist.length;
    if (isLastRound) this.finishGame();
    else this.scheduleNextRound(context.delayNextRound);
  }

  /** Incrementa los intentos del jugador sin adjudicar la ronda. */
  handleWrongAnswer(answerEvent, player) {
    player.attempts += 1;
    const priorAttempts = player.attempts - 1;
    const potentialPoints = Math.max(
        MIN_SCORE,
        BASE_SCORE - (priorAttempts * ATTEMPT_PENALTY),
    );
    this.logWrongAnswer(answerEvent, player);
    this.sendToPlayer(player.playerId, {
      type: 'WRONG_ANSWER', guess: answerEvent.answer, potentialPoints,
    });
  }

  /** Registra una respuesta incorrecta. */
  logWrongAnswer(answerEvent, player) {
    this.log(
        `[✗] [${player.playerId} | ${player.displayName}] ` +
        `hizo un intento erróneo: "${answerEvent.answer}". ` +
        `Intentos: ${player.attempts}.`,
    );
  }
}

export {GameCoordinator};
