import {isValidAudioMode} from './audio-mode.js';

/**
 * Contrato de una ronda preparada para su consumo (C05 / D03).
 *
 * Se identifica mediante gameId y roundId, sin exponer el jobId del trabajo
 * interno que la produjo. Conserva el modo, la canción y el recurso asociado.
 * El constructor no comprueba que la canción corresponda al recurso ni que
 * la ronda siga vigente o que el recurso pueda reproducirse. Esas garantías
 * corresponden a otros componentes. No copia los datos ni es inmutable.
 */
class PreparedRound {
  /**
   * @param {!Object} options Datos de la ronda preparada.
   * @param {number} options.gameId Generación de partida, entero >= 1.
   * @param {number} options.roundId Ronda dentro de la partida, entero >= 1.
   * @param {string} options.mode Uno de los modos admitidos por AudioMode.
   * @param {*} options.song Canción asociada; no admite null ni undefined.
   * @param {*} options.resource Recurso de audio; no admite null ni undefined.
   * @throws {TypeError} Si los datos no cumplen las restricciones del contrato.
   */
  constructor({gameId, roundId, mode, song, resource}) {
    if (!Number.isInteger(gameId) || gameId < 1) {
      throw new TypeError('PreparedRound.gameId debe ser un entero >= 1.');
    }

    if (!Number.isInteger(roundId) || roundId < 1) {
      throw new TypeError('PreparedRound.roundId debe ser un entero >= 1.');
    }

    if (!isValidAudioMode(mode)) {
      throw new TypeError(`PreparedRound.mode inválido: ${mode}`);
    }

    if (song === undefined || song === null) {
      throw new TypeError('PreparedRound.song es obligatorio.');
    }

    if (resource === undefined || resource === null) {
      throw new TypeError('PreparedRound.resource es obligatorio.');
    }

    /** @type {number} */
    this.gameId = gameId;
    /** @type {number} */
    this.roundId = roundId;
    /** @type {string} */
    this.mode = mode;
    /** @type {*} */
    this.song = song;
    /** @type {*} */
    this.resource = resource;
  }
}

export {PreparedRound};
