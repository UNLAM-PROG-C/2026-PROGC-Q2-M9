import {isValidAudioMode} from './audio-mode.js';

/**
 * Contrato de entrada de un trabajo de preparación de audio (C05 / D03).
 *
 * Identifica el trabajo y la ronda para la que se solicita audio. gameId
 * identifica la generación de partida y permite a otros componentes detectar
 * resultados obsoletos tras un reinicio. Esta clase no realiza esa detección,
 * no descarga ni transforma audio y no ejecuta el trabajo.
 * Valida las restricciones mínimas del contrato; no impone un formato de
 * source, no garantiza unicidad de los identificadores y no es inmutable.
 */
class AudioJob {
  /**
   * @param {!Object} options Datos del trabajo solicitado.
   * @param {string} options.jobId Identificador no vacío ni solo espacios.
   * @param {number} options.gameId Generación de partida, entero >= 1.
   * @param {number} options.roundId Ronda dentro de la partida, entero >= 1.
   * @param {string} options.mode NORMAL, REVERSE o LOW_PASS.
   * @param {*} options.source Entrada de audio; no admite null ni undefined.
   * @throws {TypeError} Si faltan datos o no cumplen las restricciones.
   */
  constructor({jobId, gameId, roundId, mode, source}) {
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new TypeError('AudioJob.jobId debe ser un string no vacío.');
    }

    if (!Number.isInteger(gameId) || gameId < 1) {
      throw new TypeError('AudioJob.gameId debe ser un entero >= 1.');
    }

    if (!Number.isInteger(roundId) || roundId < 1) {
      throw new TypeError('AudioJob.roundId debe ser un entero >= 1.');
    }

    if (!isValidAudioMode(mode)) {
      throw new TypeError(`AudioJob.mode inválido: ${mode}`);
    }

    if (source === undefined || source === null) {
      throw new TypeError('AudioJob.source es obligatorio.');
    }

    /** @type {string} */
    this.jobId = jobId;
    /** @type {number} */
    this.gameId = gameId;
    /** @type {number} */
    this.roundId = roundId;
    /** @type {string} */
    this.mode = mode;
    /** @type {*} */
    this.source = source;
  }
}

export {AudioJob};
