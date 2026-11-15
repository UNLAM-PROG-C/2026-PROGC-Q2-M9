const {isValidAudioMode} = require('./audio-mode');

class PreparedRound {
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

    this.gameId = gameId;
    this.roundId = roundId;
    this.mode = mode;
    this.song = song;
    this.resource = resource;
  }
}

module.exports = PreparedRound;
