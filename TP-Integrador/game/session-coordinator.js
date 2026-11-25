import {SessionState, isSessionState} from './session-state.js';

const ALLOWED_TRANSITIONS = Object.freeze({
  [SessionState.LOBBY]: [SessionState.ROUND_ACTIVE],
  [SessionState.ROUND_ACTIVE]: [
    SessionState.BETWEEN_ROUNDS,
    SessionState.GAME_OVER,
  ],
  [SessionState.BETWEEN_ROUNDS]: [
    SessionState.ROUND_ACTIVE,
    SessionState.GAME_OVER,
  ],
  [SessionState.GAME_OVER]: [SessionState.LOBBY],
});

/** Gestiona el ciclo de vida y la barrera READY de una partida (V3). */
class SessionCoordinator {
  constructor() {
    this.sessionState = SessionState.LOBBY;
    this.gameId = 1;
    this.readyPlayerIds = new Set();
  }

  /** @return {string} Estado de sesión vigente. */
  getState() {
    return this.sessionState;
  }

  /** @return {number} Generación vigente. */
  getGameId() {
    return this.gameId;
  }

  /** @return {boolean} True si coincide con el estado vigente. */
  isInState(state) {
    return this.sessionState === state;
  }

  /** @return {!Array<string>} IDs registrados como READY. */
  getReadyPlayerIds() {
    return Array.from(this.readyPlayerIds);
  }

  /** @return {number} Cantidad de IDs listos. */
  getReadyCount() {
    return this.readyPlayerIds.size;
  }

  /** @return {boolean} True si el ID está registrado como READY. */
  isPlayerReady(playerId) {
    return this.readyPlayerIds.has(playerId);
  }

  /** Agrega un ID a la barrera READY. */
  markPlayerReady(playerId) {
    this.assertLobbyForReadyChange();
    this.assertPlayerId(playerId, 'marcar READY');
    this.readyPlayerIds.add(playerId);
    return this.buildReadyResult(playerId, true);
  }

  /** Quita un ID de la barrera READY. */
  markPlayerNotReady(playerId) {
    this.assertLobbyForReadyChange();
    this.assertPlayerId(playerId, 'quitar READY');
    this.readyPlayerIds.delete(playerId);
    return this.buildReadyResult(playerId, false);
  }

  /** @return {!Object} Resultado común de una operación READY. */
  buildReadyResult(playerId, ready) {
    return {
      playerId,
      ready,
      readyCount: this.readyPlayerIds.size,
      sessionState: this.sessionState,
      gameId: this.gameId,
    };
  }

  /** Valida un identificador para cambios READY. */
  assertPlayerId(playerId, action) {
    if (!playerId) {
      throw new Error(`playerId es obligatorio para ${action}`);
    }
  }

  /** Elimina READY al desconectarse un jugador. */
  removePlayerReadiness(playerId) {
    if (!playerId) return false;
    return this.readyPlayerIds.delete(playerId);
  }

  /** Comprueba la barrera para los IDs proporcionados por el servidor. */
  areAllPlayersReady(playerIds) {
    if (!Array.isArray(playerIds)) return false;
    const uniquePlayerIds = [...new Set(playerIds)];
    if (uniquePlayerIds.length === 0) return false;
    return uniquePlayerIds.every(
        (playerId) => this.readyPlayerIds.has(playerId),
    );
  }

  /** Comprueba LOBBY y la barrera READY. */
  canStart(playerIds) {
    return this.sessionState === SessionState.LOBBY &&
      this.areAllPlayersReady(playerIds);
  }

  /** Consulta las transiciones admitidas desde el estado vigente. */
  canTransitionTo(nextState) {
    if (!isSessionState(nextState)) return false;
    return ALLOWED_TRANSITIONS[this.sessionState].includes(nextState);
  }

  /** Aplica una transición permitida. */
  transitionTo(nextState) {
    this.assertTransition(nextState);
    const previousState = this.sessionState;
    this.sessionState = nextState;
    return this.buildTransitionResult(previousState);
  }

  /** Valida que la transición solicitada sea válida. */
  assertTransition(nextState) {
    if (!this.canTransitionTo(nextState)) {
      throw new Error(
          `Transición de sesión inválida: ${this.sessionState} -> ${nextState}`,
      );
    }
  }

  /** @return {!Object} Resultado de una transición. */
  buildTransitionResult(previousState) {
    return {
      previousState,
      currentState: this.sessionState,
      gameId: this.gameId,
    };
  }

  /** Reinicia una sesión finalizada. */
  restartSession() {
    this.assertGameOver();
    const previousGameId = this.gameId;
    this.gameId += 1;
    this.sessionState = SessionState.LOBBY;
    this.readyPlayerIds.clear();
    return this.buildRestartResult(previousGameId);
  }

  /** Exige GAME_OVER para reiniciar. */
  assertGameOver() {
    if (this.sessionState !== SessionState.GAME_OVER) {
      throw new Error(
          `No se puede reiniciar la sesión desde ${this.sessionState}`,
      );
    }
  }

  /** @return {!Object} Resultado de restartSession. */
  buildRestartResult(previousGameId) {
    return {
      previousGameId,
      gameId: this.gameId,
      currentState: this.sessionState,
      readyCount: this.readyPlayerIds.size,
    };
  }

  /** Valida la precondición para modificar READY. */
  assertLobbyForReadyChange() {
    if (this.sessionState !== SessionState.LOBBY) {
      throw new Error(
          'READY solo puede modificarse en LOBBY. ' +
          `Estado actual: ${this.sessionState}`,
      );
    }
  }
}

export {SessionCoordinator};
