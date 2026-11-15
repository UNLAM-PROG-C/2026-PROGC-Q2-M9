const {SessionState, isSessionState} = require('./session-state');

/**
 * Gestiona el ciclo de vida y la barrera READY de una partida (V3).
 *
 * Conserva el estado de sesión, su generación y los IDs listos. El servidor
 * determina qué jugadores están conectados y en qué momento puede iniciar
 * una partida; este componente no controla horarios, sockets, puntajes,
 * cola de respuestas ni reproducción. No implementa sincronización entre
 * hilos: sus operaciones se usan desde el flujo de eventos del servidor.
 */
class SessionCoordinator {
  constructor() {
    /** @type {string} */
    this.sessionState = SessionState.LOBBY;
    /** @type {number} */
    this.gameId = 1;
    /** @type {!Set<string>} */
    this.readyPlayerIds = new Set();
  }

  /**
   * @return {string} Estado de sesión vigente.
   */
  getState() {
    return this.sessionState;
  }

  /**
   * @return {number} Generación vigente; comienza en 1.
   */
  getGameId() {
    return this.gameId;
  }

  /**
   * Compara el estado sin realizar una transición.
   * @param {string} state Estado a comparar.
   * @return {boolean} True si coincide con el estado vigente.
   */
  isInState(state) {
    return this.sessionState === state;
  }

  /**
   * Devuelve una copia de los IDs listos, no el Set interno.
   * @return {!Array<string>} IDs registrados como READY.
   */
  getReadyPlayerIds() {
    return Array.from(this.readyPlayerIds);
  }

  /**
   * @return {number} Cantidad de IDs listos, no de jugadores conectados.
   */
  getReadyCount() {
    return this.readyPlayerIds.size;
  }

  /**
   * @param {string} playerId ID interno del jugador.
   * @return {boolean} True si el ID está registrado como READY.
   */
  isPlayerReady(playerId) {
    return this.readyPlayerIds.has(playerId);
  }

  /**
   * Agrega un ID a la barrera READY. Repetirlo no aumenta el contador.
   * No comprueba que el jugador exista o esté conectado; lo hace el servidor.
   * @param {string} playerId ID interno no vacío.
   * @return {!Object} ID, ready=true, readyCount, sessionState y gameId.
   * @throws {Error} Si la sesión no está en LOBBY o el ID es falso.
   */
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

  /**
   * Quita un ID de la barrera READY, aunque no estuviera registrado.
   * @param {string} playerId ID interno no vacío.
   * @return {!Object} ID, ready=false, readyCount, sessionState y gameId.
   * @throws {Error} Si la sesión no está en LOBBY o el ID es falso.
   */
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

  /**
   * Elimina READY al desconectarse un jugador, sin exigir estado LOBBY.
   * @param {string} playerId ID interno del jugador.
   * @return {boolean} True si se eliminó un ID existente.
   */
  removePlayerReadiness(playerId) {
    if (!playerId) {
      return false;
    }

    return this.readyPlayerIds.delete(playerId);
  }

  /**
   * Comprueba la barrera para los IDs proporcionados por el servidor.
   * Elimina duplicados; una lista vacía o un valor que no sea array no
   * satisface la barrera. No exige que el Set no contenga otros IDs.
   * @param {!Array<string>} playerIds IDs a verificar.
   * @return {boolean} True si todos los IDs de la lista no vacía están listos.
   */
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

  /**
   * Comprueba LOBBY y la barrera READY; no cambia el estado ni evalúa horarios.
   * @param {!Array<string>} playerIds IDs de los jugadores a considerar.
   * @return {boolean} True si se cumplen ambas condiciones.
   */
  canStart(playerIds) {
    return (
      this.sessionState === SessionState.LOBBY &&
            this.areAllPlayersReady(playerIds)
    );
  }

  /**
   * Consulta las transiciones admitidas desde el estado vigente.
   * No valida horarios ni la barrera READY, ni modifica la sesión.
   * @param {string} nextState Estado de destino.
   * @return {boolean} True si el destino y la transición son válidos.
   */
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

  /**
   * Aplica una transición permitida; no realiza acciones de entrada/salida.
   * Ir de GAME_OVER a LOBBY aquí no incrementa gameId ni limpia READY.
   * Para reiniciar una partida se utiliza restartSession.
   * @param {string} nextState Estado de destino.
   * @return {!Object} previousState, currentState y gameId.
   * @throws {Error} Si la transición no está permitida.
   */
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

  /**
   * Desde GAME_OVER, incrementa la generación, vuelve a LOBBY y limpia READY.
   * El servidor debe reiniciar el resto de los datos de la partida.
   * @return {!Object} previousGameId, gameId, currentState y readyCount.
   * @throws {Error} Si la sesión no está en GAME_OVER.
   */
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

  /**
   * Valida la precondición para marcar o quitar READY voluntariamente.
   * @throws {Error} Si la sesión no está en LOBBY.
   */
  assertLobbyForReadyChange() {
    if (this.sessionState !== SessionState.LOBBY) {
      throw new Error(
        'READY solo puede modificarse en LOBBY. ' +
        `Estado actual: ${this.sessionState}`
      );
    }
  }
}

module.exports = SessionCoordinator;
