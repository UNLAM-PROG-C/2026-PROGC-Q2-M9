import {isValidAudioMode} from './audio-mode.js';

/**
 * Contrato de salida de un trabajo de preparación de audio (C05 / D03).
 *
 * Relaciona el resultado con jobId, gameId y roundId. Un resultado exitoso
 * contiene un recurso no nulo y ningún error; uno fallido no contiene recurso
 * y describe el error mediante un texto no vacío. El constructor valida estas
 * invariantes, pero no comprueba si el recurso es reproducible, si el trabajo
 * exista ni que la generación siga vigente. No realiza I/O y no es inmutable.
 */
class AudioResult {
  /**
   * @param {!Object} options Datos del resultado.
   * @param {string} options.jobId ID del trabajo, no vacío ni solo espacios.
   * @param {number} options.gameId Generación de partida, entero >= 1.
   * @param {number} options.roundId Ronda dentro de la partida, entero >= 1.
   * @param {string} options.mode Uno de los modos admitidos por AudioMode.
   * @param {boolean} options.ok Indica si el procesamiento fue exitoso.
   * @param {*=} options.resource Recurso si ok es true; null en caso contrario.
   *     Por defecto es null; no se valida su representación concreta.
   * @param {?string=} options.error Error no vacío si ok es false; en caso
   *     contrario debe ser null. Por defecto es null.
   * @throws {TypeError} Si los datos no cumplen las restricciones del contrato.
   */
  constructor({
    jobId,
    gameId,
    roundId,
    mode,
    ok,
    resource = null,
    error = null,
  }) {
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new TypeError('AudioResult.jobId debe ser un string no vacío.');
    }

    if (!Number.isInteger(gameId) || gameId < 1) {
      throw new TypeError('AudioResult.gameId debe ser un entero >= 1.');
    }

    if (!Number.isInteger(roundId) || roundId < 1) {
      throw new TypeError('AudioResult.roundId debe ser un entero >= 1.');
    }

    if (!isValidAudioMode(mode)) {
      throw new TypeError(`AudioResult.mode inválido: ${mode}`);
    }

    if (typeof ok !== 'boolean') {
      throw new TypeError('AudioResult.ok debe ser boolean.');
    }

    if (ok) {
      if (resource === undefined || resource === null) {
        throw new TypeError(
            'AudioResult exitoso debe incluir resource.',
        );
      }

      if (error !== null) {
        throw new TypeError(
            'AudioResult exitoso no debe incluir error.',
        );
      }
    } else {
      if (resource !== null) {
        throw new TypeError(
            'AudioResult fallido no debe incluir resource.',
        );
      }

      if (typeof error !== 'string' || error.trim() === '') {
        throw new TypeError(
            'AudioResult fallido debe incluir un error no vacío.',
        );
      }
    }

    /** @type {string} */
    this.jobId = jobId;
    /** @type {number} */
    this.gameId = gameId;
    /** @type {number} */
    this.roundId = roundId;
    /** @type {string} */
    this.mode = mode;
    /** @type {boolean} */
    this.ok = ok;
    /** @type {*} */
    this.resource = resource;
    /** @type {?string} */
    this.error = error;
  }
}

export {AudioResult};
