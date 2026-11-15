const {SessionState, isSessionState} = require('./SessionState');

class SessionCoordinator {
  constructor() {
    this.sessionState = SessionState.LOBBY;
    this.gameId = 1;
    this.readyPlayerIds = new Set();
  }

  getState() {
    return this.sessionState;
  }

  getGameId() {
    return this.gameId;
  }

  isInState(state) {
    return this.sessionState === state;
  }

  getReadyPlayerIds() {
    return Array.from(this.readyPlayerIds);
  }

  getReadyCount() {
    return this.readyPlayerIds.size;
  }

  isPlayerReady(playerId) {
    return this.readyPlayerIds.has(playerId);
  }

  markPlayerReady(playerId) {
    this.assertLobbyForReadyChange();

    if (!playerId) {
      throw new Error('playerId es obligatorio para marcar READY');
    }

    this.readyPlayerIds.add(playerId);

    return {
      playerId,
      ready: true,
      readyCount: this.readyPlayerIds.size,
      sessionState: this.sessionState,
      gameId: this.gameId,
    };
  }

  markPlayerNotReady(playerId) {
    this.assertLobbyForReadyChange();

    if (!playerId) {
      throw new Error('playerId es obligatorio para quitar READY');
    }

    this.readyPlayerIds.delete(playerId);

    return {
      playerId,
      ready: false,
      readyCount: this.readyPlayerIds.size,
      sessionState: this.sessionState,
      gameId: this.gameId,
    };
  }

  removePlayerReadiness(playerId) {
    if (!playerId) {
      return false;
    }

    return this.readyPlayerIds.delete(playerId);
  }

  areAllPlayersReady(playerIds) {
    if (!Array.isArray(playerIds)) {
      return false;
    }

    const uniquePlayerIds = [...new Set(playerIds)];

    if (uniquePlayerIds.length === 0) {
      return false;
    }

    return uniquePlayerIds.every(
      playerId => this.readyPlayerIds.has(playerId)
    );
  }

  canStart(playerIds) {
    return (
      this.sessionState === SessionState.LOBBY &&
            this.areAllPlayersReady(playerIds)
    );
  }

  canTransitionTo(nextState) {
    if (!isSessionState(nextState)) {
      return false;
    }

    const allowedTransitions = {
      [SessionState.LOBBY]: [
        SessionState.ROUND_ACTIVE,
      ],

      [SessionState.ROUND_ACTIVE]: [
        SessionState.BETWEEN_ROUNDS,
        SessionState.GAME_OVER,
      ],

      [SessionState.BETWEEN_ROUNDS]: [
        SessionState.ROUND_ACTIVE,
        SessionState.GAME_OVER,
      ],

      [SessionState.GAME_OVER]: [
        SessionState.LOBBY,
      ],
    };

    return allowedTransitions[this.sessionState].includes(nextState);
  }

  transitionTo(nextState) {
    if (!this.canTransitionTo(nextState)) {
      throw new Error(
        `Transición de sesión inválida: ${this.sessionState} -> ${nextState}`
      );
    }

    const previousState = this.sessionState;
    this.sessionState = nextState;

    return {
      previousState,
      currentState: this.sessionState,
      gameId: this.gameId,
    };
  }

  restartSession() {
    if (this.sessionState !== SessionState.GAME_OVER) {
      throw new Error(
        `No se puede reiniciar la sesión desde ${this.sessionState}`
      );
    }

    const previousGameId = this.gameId;

    this.gameId += 1;
    this.sessionState = SessionState.LOBBY;
    this.readyPlayerIds.clear();

    return {
      previousGameId,
      gameId: this.gameId,
      currentState: this.sessionState,
      readyCount: this.readyPlayerIds.size,
    };
  }

  assertLobbyForReadyChange() {
    if (this.sessionState !== SessionState.LOBBY) {
      throw new Error(
        `READY solo puede modificarse en LOBBY. Estado actual: ${this.sessionState}`
      );
    }
  }
}

module.exports = SessionCoordinator;
