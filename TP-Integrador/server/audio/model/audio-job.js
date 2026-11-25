import {isValidAudioMode} from './audio-mode.js';

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} debe ser un string no vacío.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} debe ser un entero >= 1.`);
  }
}

function validateJobOptions(options) {
  assertNonEmptyString(options.jobId, 'AudioJob.jobId');
  assertPositiveInteger(options.gameId, 'AudioJob.gameId');
  assertPositiveInteger(options.roundId, 'AudioJob.roundId');
  if (!isValidAudioMode(options.mode)) {
    throw new TypeError(`AudioJob.mode inválido: ${options.mode}`);
  }
  if (options.source === undefined || options.source === null) {
    throw new TypeError('AudioJob.source es obligatorio.');
  }
}

/** Contrato de entrada de un trabajo de preparación de audio. */
class AudioJob {
  constructor(options) {
    validateJobOptions(options);
    this.jobId = options.jobId;
    this.gameId = options.gameId;
    this.roundId = options.roundId;
    this.mode = options.mode;
    this.source = options.source;
  }
}

export {AudioJob};
