import {isValidAudioMode} from './audio-mode.js';

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} debe ser un entero >= 1.`);
  }
}

function assertRequired(value, label) {
  if (value === undefined || value === null) {
    throw new TypeError(`${label} es obligatorio.`);
  }
}

function validatePreparedRound(options) {
  assertPositiveInteger(options.gameId, 'PreparedRound.gameId');
  assertPositiveInteger(options.roundId, 'PreparedRound.roundId');
  if (!isValidAudioMode(options.mode)) {
    throw new TypeError(`PreparedRound.mode inválido: ${options.mode}`);
  }
  assertRequired(options.song, 'PreparedRound.song');
  assertRequired(options.resource, 'PreparedRound.resource');
}

/** Contrato de una ronda preparada para su consumo. */
class PreparedRound {
  constructor(options) {
    validatePreparedRound(options);
    this.gameId = options.gameId;
    this.roundId = options.roundId;
    this.mode = options.mode;
    this.song = options.song;
    this.resource = options.resource;
  }
}

export {PreparedRound};
