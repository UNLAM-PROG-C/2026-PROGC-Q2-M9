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

function validateIdentity(options) {
  assertNonEmptyString(options.jobId, 'AudioResult.jobId');
  assertPositiveInteger(options.gameId, 'AudioResult.gameId');
  assertPositiveInteger(options.roundId, 'AudioResult.roundId');
  if (!isValidAudioMode(options.mode)) {
    throw new TypeError(`AudioResult.mode inválido: ${options.mode}`);
  }
  if (typeof options.ok !== 'boolean') {
    throw new TypeError('AudioResult.ok debe ser boolean.');
  }
}

function validateSuccessfulResult({resource, error}) {
  if (resource === undefined || resource === null) {
    throw new TypeError('AudioResult exitoso debe incluir resource.');
  }
  if (error !== null) {
    throw new TypeError('AudioResult exitoso no debe incluir error.');
  }
}

function validateFailedResult({resource, error}) {
  if (resource !== null) {
    throw new TypeError('AudioResult fallido no debe incluir resource.');
  }
  assertNonEmptyString(error, 'AudioResult fallido error');
}

function validateResult(options) {
  validateIdentity(options);
  if (options.ok) validateSuccessfulResult(options);
  else validateFailedResult(options);
}

/** Contrato de salida de un trabajo de preparación de audio. */
class AudioResult {
  constructor(options) {
    const normalized = {resource: null, error: null, ...options};
    validateResult(normalized);
    Object.assign(this, normalized);
  }
}

export {AudioResult};
