const {isValidAudioMode} = require('./audio-mode');

class AudioJob {
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

    this.jobId = jobId;
    this.gameId = gameId;
    this.roundId = roundId;
    this.mode = mode;
    this.source = source;
  }
}

module.exports = AudioJob;
