/**
 * Estados de sesión reconocidos por el coordinador.
 * El objeto está congelado; las transiciones se controlan por separado.
 * @enum {string}
 */
const SessionState = Object.freeze({
  /**
   * Espera de jugadores y barrera READY.
   */
  LOBBY: 'LOBBY',
  /**
   * Ronda activa; el servidor comprueba la elegibilidad de cada respuesta.
   */
  ROUND_ACTIVE: 'ROUND_ACTIVE',
  /**
   * Espera entre rondas, sin adjudicar nuevas respuestas.
   */
  BETWEEN_ROUNDS: 'BETWEEN_ROUNDS',
  /**
   * Partida finalizada; permite solicitar reinicio.
   */
  GAME_OVER: 'GAME_OVER',
});

/**
 * Comprueba pertenencia al conjunto de estados, no una transición.
 * @param {*} value Valor a comprobar.
 * @return {boolean} True si es uno de los estados reconocidos.
 */
function isSessionState(value) {
  return Object.values(SessionState).includes(value);
}

export {
  SessionState,
  isSessionState,
};
