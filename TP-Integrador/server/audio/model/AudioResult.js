const {isValidAudioMode} = require('./AudioMode');

class AudioResult {
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
          'AudioResult exitoso debe incluir resource.'
        );
      }

      if (error !== null) {
        throw new TypeError(
          'AudioResult exitoso no debe incluir error.'
        );
      }
    } else {
      if (resource !== null) {
        throw new TypeError(
          'AudioResult fallido no debe incluir resource.'
        );
      }

      if (typeof error !== 'string' || error.trim() === '') {
        throw new TypeError(
          'AudioResult fallido debe incluir un error no vacío.'
        );
      }
    }

    this.jobId = jobId;
    this.gameId = gameId;
    this.roundId = roundId;
    this.mode = mode;
    this.ok = ok;
    this.resource = resource;
    this.error = error;
  }
}

module.exports = AudioResult;
