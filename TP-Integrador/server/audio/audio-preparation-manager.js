import {AudioJob} from './model/audio-job.js';
import {AudioMode, isValidAudioMode} from './model/audio-mode.js';

/**
 * Cantidad predeterminada de rondas futuras cubiertas por prefetch.
 * @const {number}
 */
const DEFAULT_PREFETCH_DEPTH = 3;

/**
 * Secuencia determinística de modos por ronda definida en D09.
 * @const {!Array<string>}
 */
const DEFAULT_MODE_SEQUENCE = Object.freeze([
  AudioMode.NORMAL,
  AudioMode.REVERSE,
  AudioMode.LOW_PASS,
]);

const MINIMUM_ID = 1;
const MINIMUM_DEPTH = 1;
const MINIMUM_INDEX = 0;
const INITIAL_JOB_NUMBER = 0;
const ROUND_INDEX_OFFSET = 1;

/**
 * Construye la identidad lógica de una ronda dentro de una partida.
 * @param {number} gameId Identificador de generación de partida.
 * @param {number} roundId Identificador de ronda dentro de la partida.
 * @return {string} Clave estable gameId:roundId.
 */
function buildRoundKey(gameId, roundId) {
  return `${gameId}:${roundId}`;
}

/**
 * Valida un identificador de generación de partida.
 * @param {number} gameId Identificador a validar.
 * @param {string} fieldName Nombre usado en el diagnóstico.
 */
function validateGameId(gameId, fieldName) {
  if (!Number.isInteger(gameId) || gameId < MINIMUM_ID) {
    throw new TypeError(
        `${fieldName} debe ser un entero >= ${MINIMUM_ID}.`,
    );
  }
}

/**
 * Valida que un RESTART avance desde la generación actualmente vigente.
 * @param {number} previousGameId Generación anterior.
 * @param {number} gameId Nueva generación.
 * @param {number} currentGameId Generación vigente.
 */
function validateRestartTransition(previousGameId, gameId, currentGameId) {
  validateGameId(previousGameId, 'previousGameId');
  validateGameId(gameId, 'gameId');
  if (previousGameId !== currentGameId) {
    throw new Error('previousGameId no coincide con currentGameId.');
  }
  if (gameId <= previousGameId) {
    throw new Error('RESTART debe avanzar a un gameId posterior.');
  }
}

/**
 * Normaliza las opciones recibidas por el constructor con sus valores base.
 * @param {!Object=} options Opciones crudas de inicialización.
 * @return {!Object} Configuración completa con valores por defecto aplicados.
 */
function applyDefaultOptions(options = {}) {
  return {
    workerPool: options.workerPool ?? null,
    createJobId: options.createJobId ?? null,
    initialGameId: options.initialGameId ?? MINIMUM_ID,
    preparedRoundBuffer: options.preparedRoundBuffer ?? null,
    prefetchDepth: options.prefetchDepth ?? DEFAULT_PREFETCH_DEPTH,
    modeSequence: options.modeSequence ?? DEFAULT_MODE_SEQUENCE,
    log: options.log ?? null,
  };
}

/**
 * Valida las dependencias principales del coordinador.
 * @param {!Object} config Configuración normalizada.
 * @throws {TypeError} Si workerPool o createJobId incumplen el contrato.
 */
function validateManagerOptions(config) {
  if (!config.workerPool || typeof config.workerPool.submit !== 'function') {
    throw new TypeError(
        'AudioPreparationManager.workerPool debe exponer submit().',
    );
  }
  if (config.createJobId !== null && typeof config.createJobId !== 'function') {
    throw new TypeError(
        'AudioPreparationManager.createJobId debe ser una función.',
    );
  }
  validateGameId(config.initialGameId, 'AudioPreparationManager.initialGameId');
  validatePrefetchOptions(config);
}

/**
 * Valida buffer opcional, profundidad de ventana, modos y logger.
 * @param {!Object} config Configuración normalizada.
 * @throws {TypeError} Si algún parámetro de prefetch es inválido.
 */
function validatePrefetchOptions(config) {
  const {preparedRoundBuffer, prefetchDepth, modeSequence, log} = config;
  if (preparedRoundBuffer !== null &&
      typeof preparedRoundBuffer.has !== 'function') {
    throw new TypeError('preparedRoundBuffer debe exponer has().');
  }
  if (!Number.isInteger(prefetchDepth) || prefetchDepth < MINIMUM_DEPTH) {
    throw new TypeError(`prefetchDepth debe ser >= ${MINIMUM_DEPTH}.`);
  }
  validateSequenceAndLog(modeSequence, log);
}

/**
 * Valida la secuencia cíclica de modos y la función opcional de log.
 * @param {*} modeSequence Secuencia de modos D09.
 * @param {*} log Función opcional de registro.
 * @throws {TypeError} Si alguno de los dos valores es inválido.
 */
function validateSequenceAndLog(modeSequence, log) {
  if (!Array.isArray(modeSequence) || modeSequence.length === 0 ||
      !modeSequence.every(isValidAudioMode)) {
    throw new TypeError('AudioPreparationManager.modeSequence inválido.');
  }
  if (log !== null && typeof log !== 'function') {
    throw new TypeError('AudioPreparationManager.log debe ser función.');
  }
}

/**
 * Selecciona determinísticamente el modo de audio de una ronda (D09).
 * @param {number} roundId Identificador de ronda (base 1).
 * @param {!Array<string>=} modeSequence Secuencia cíclica de modos.
 * @return {string} Modo de audio asignado a la ronda.
 * @throws {TypeError} Si roundId o modeSequence son inválidos.
 */
function selectModeForRound(roundId, modeSequence = DEFAULT_MODE_SEQUENCE) {
  if (!Number.isInteger(roundId) || roundId < MINIMUM_ID) {
    throw new TypeError(`roundId debe ser un entero >= ${MINIMUM_ID}.`);
  }
  if (!Array.isArray(modeSequence) || modeSequence.length === 0 ||
      !modeSequence.every(isValidAudioMode)) {
    throw new TypeError('modeSequence inválido.');
  }
  const index = (roundId - ROUND_INDEX_OFFSET) % modeSequence.length;
  return modeSequence[index];
}

/**
 * Valida los identificadores numéricos de maintainPrefetchWindow.
 * @param {!Object} params Parámetros de ventana.
 * @throws {TypeError} Si gameId, currentRoundId o currentSongIndex fallan.
 */
function validatePrefetchIds(params) {
  const {gameId, currentRoundId, currentSongIndex} = params || {};
  if (!Number.isInteger(gameId) || gameId < MINIMUM_ID ||
      !Number.isInteger(currentRoundId) || currentRoundId < MINIMUM_ID) {
    throw new TypeError(`gameId y currentRoundId deben ser >= ${MINIMUM_ID}.`);
  }
  if (!Number.isInteger(currentSongIndex) ||
      currentSongIndex < MINIMUM_INDEX) {
    throw new TypeError(`currentSongIndex debe ser >= ${MINIMUM_INDEX}.`);
  }
}

/**
 * Valida la playlist y el límite de rondas de maintainPrefetchWindow.
 * @param {!Object} params Parámetros de ventana.
 * @throws {TypeError} Si playlist está vacía o maxRounds es inválido.
 */
function validatePrefetchPlaylist({playlist, maxRounds}) {
  if (!Array.isArray(playlist) || playlist.length === 0) {
    throw new TypeError('playlist debe ser un array no vacío.');
  }
  if (!Number.isInteger(maxRounds) || maxRounds < MINIMUM_ID) {
    throw new TypeError(`maxRounds debe ser un entero >= ${MINIMUM_ID}.`);
  }
}

/**
 * Valida todos los parámetros de maintainPrefetchWindow.
 * @param {!Object} params Contexto de la ronda actual.
 */
function validatePrefetchParams(params) {
  validatePrefetchIds(params);
  validatePrefetchPlaylist(params);
}

/**
 * Construye el resumen estructurado del ciclo de prefetch.
 * @param {!Object} params Parámetros recibidos.
 * @param {!Array<number>} targets Rondas futuras evaluadas.
 * @param {!Object} status Rondas ya cubiertas (ready e inFlight).
 * @param {!Array<number>} scheduled Rondas admitidas en esta ejecución.
 * @return {!Object} Resumen del estado de la ventana.
 */
function buildPrefetchSummary(params, targets, status, scheduled) {
  return {
    gameId: params.gameId,
    currentRoundId: params.currentRoundId,
    targets,
    ready: status.ready,
    inFlight: status.inFlight,
    scheduled,
  };
}

/**
 * Coordina admisión y prefetch deslizante de trabajos de audio (C14/C17).
 */
class AudioPreparationManager {
  /**
   * @param {!Object} options Dependencias y parámetros de prefetch.
   */
  constructor(options = {}) {
    const config = applyDefaultOptions(options);
    validateManagerOptions(config);
    this.workerPool = config.workerPool;
    this.preparedRoundBuffer = config.preparedRoundBuffer;
    this.prefetchDepth = config.prefetchDepth;
    this.modeSequence = [...config.modeSequence];
    this.log = config.log;
    this.nextJobId = INITIAL_JOB_NUMBER;
    this.createJobId = config.createJobId || (() => this.buildDefaultJobId());
    this.currentGameId = config.initialGameId;
    this.inFlightRoundKeys = new Set();
  }

  /**
   * Genera un identificador incremental por defecto para AudioJob.
   * @return {string} Identificador único dentro del manager.
   * @private
   */
  buildDefaultJobId() {
    this.nextJobId += 1;
    return `audio-job-${this.nextJobId}`;
  }

  /**
   * @return {number} Generación de partida actualmente vigente.
   */
  getCurrentGameId() {
    return this.currentGameId;
  }

  /**
   * @param {number} gameId Generación que se desea comparar.
   * @return {boolean} True si corresponde a la partida vigente.
   */
  isCurrentGame(gameId) {
    return gameId === this.currentGameId;
  }

  /**
   * @param {!Object} result AudioResult o resultado compatible.
   * @return {boolean} True si pertenece a una generación obsoleta.
   */
  isStaleResult(result) {
    if (!result || typeof result !== 'object') {
      throw new TypeError('result debe ser un objeto.');
    }
    validateGameId(result.gameId, 'AudioPreparationManager.result.gameId');
    return !this.isCurrentGame(result.gameId);
  }

  /**
   * Clasifica un resultado según la generación actualmente vigente.
   * @param {!Object} result AudioResult o resultado compatible.
   * @return {!Object} Clasificación para la posterior publicación.
   */
  handleAudioResult(result) {
    if (this.isStaleResult(result)) {
      return {
        accepted: false,
        reason: 'STALE_GAME',
        result,
      };
    }
    return {accepted: true, result};
  }

  /**
   * Elimina el tracking lógico de trabajos de una generación.
   * No cancela trabajo físico RUNNING.
   * @param {number} gameId Generación que debe limpiarse.
   * @return {number} Cantidad de entradas eliminadas.
   */
  clearInFlightTrackingForGame(gameId) {
    validateGameId(gameId, 'AudioPreparationManager.gameId');
    const prefix = `${gameId}:`;
    let removed = 0;
    for (const roundKey of this.inFlightRoundKeys) {
      if (roundKey.startsWith(prefix)) {
        this.inFlightRoundKeys.delete(roundKey);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Verifica las capacidades requeridas únicamente por RESTART.
   * @private
   */
  validateRestartCapabilities() {
    if (typeof this.workerPool.cancelQueuedByGameId !== 'function') {
      throw new TypeError('workerPool debe exponer cancelQueuedByGameId().');
    }
    if (this.preparedRoundBuffer !== null &&
        typeof this.preparedRoundBuffer.clear !== 'function') {
      throw new TypeError('preparedRoundBuffer debe exponer clear().');
    }
  }

  /**
   * Limpia el estado de audio obsoleto al avanzar la generación de partida.
   * Los trabajos RUNNING no son terminados.
   * @param {!Object} options Identificadores informados por SessionCoordinator.
   * @return {!Object} Resumen de la limpieza realizada.
   */
  handleGameRestart({previousGameId, gameId}) {
    validateRestartTransition(previousGameId, gameId, this.currentGameId);
    this.validateRestartCapabilities();
    const cancelledQueued =
      this.workerPool.cancelQueuedByGameId(previousGameId);
    const clearedInFlight =
      this.clearInFlightTrackingForGame(previousGameId);
    this.preparedRoundBuffer?.clear();
    this.currentGameId = gameId;
    return {previousGameId, gameId, cancelledQueued, clearedInFlight};
  }

  /**
   * Indica si una ronda lógica tiene una preparación admitida en curso.
   * @param {number} gameId Identificador de generación de partida.
   * @param {number} roundId Identificador de ronda.
   * @return {boolean} True mientras la ronda figure como IN_FLIGHT.
   */
  isInFlight(gameId, roundId) {
    return this.inFlightRoundKeys.has(buildRoundKey(gameId, roundId));
  }

  /**
   * @return {number} Cantidad de rondas lógicas actualmente IN_FLIGHT.
   */
  getInFlightCount() {
    return this.inFlightRoundKeys.size;
  }

  /**
   * Indica si una ronda ya existe como READY en el buffer configurado.
   * @param {number} gameId Identificador de generación de partida.
   * @param {number} roundId Identificador de ronda.
   * @return {boolean} True si existe en preparedRoundBuffer.
   */
  isReady(gameId, roundId) {
    if (!this.preparedRoundBuffer) {
      return false;
    }
    return this.preparedRoundBuffer.has(gameId, roundId);
  }

  /**
   * Indica si una ronda futura ya está cubierta (READY o IN_FLIGHT).
   * @param {number} gameId Identificador de generación de partida.
   * @param {number} roundId Identificador de ronda.
   * @return {boolean} True si no debe programarse un nuevo trabajo.
   */
  isRoundCovered(gameId, roundId) {
    return this.isReady(gameId, roundId) || this.isInFlight(gameId, roundId);
  }

  /**
   * Crea y delega un AudioJob salvo que la ronda ya esté IN_FLIGHT (C14).
   * @param {!Object} options Datos de la solicitud individual.
   * @return {!Object} Resultado de admisión con job y resultPromise.
   */
  requestPreparation({gameId, roundId, mode, source}) {
    const roundKey = buildRoundKey(gameId, roundId);
    if (this.inFlightRoundKeys.has(roundKey)) {
      return {accepted: false, reason: 'ALREADY_IN_FLIGHT'};
    }
    const job = new AudioJob({
      jobId: this.createJobId(),
      gameId,
      roundId,
      mode,
      source,
    });
    return this.dispatchJob(roundKey, job);
  }

  /**
   * Registra IN_FLIGHT, envía el trabajo al pool y limpia al finalizar.
   * @param {string} roundKey Clave gameId:roundId.
   * @param {!AudioJob} job Trabajo validado a ejecutar.
   * @return {!Object} Resultado aceptado con job y promesa encadenada.
   * @private
   */
  dispatchJob(roundKey, job) {
    this.inFlightRoundKeys.add(roundKey);
    let submitted;
    try {
      submitted = this.workerPool.submit(job);
    } catch (error) {
      this.inFlightRoundKeys.delete(roundKey);
      throw error;
    }
    const resultPromise = Promise.resolve(submitted).finally(() => {
      this.inFlightRoundKeys.delete(roundKey);
    });
    resultPromise.catch(() => {});
    return {accepted: true, job, resultPromise};
  }

  /**
   * Mantiene cubierta la ventana deslizante N+1..N+depth sin bloquear (C17).
   * @param {!Object} params Contexto operativo de la ronda actual.
   * @return {!Object} Resumen de ventana objetivo, cubiertas y programadas.
   */
  maintainPrefetchWindow(params) {
    validatePrefetchParams(params);
    const targets = this.computeTargetRounds(
        params.currentRoundId,
        params.maxRounds,
    );
    const status = this.classifyTargets(params.gameId, targets);
    const scheduled = this.scheduleMissingTargets(params, targets);
    const summary = buildPrefetchSummary(params, targets, status, scheduled);
    this.emitPrefetchLog(summary);
    return summary;
  }

  /**
   * Calcula las rondas futuras dentro de prefetchDepth y hasta maxRounds.
   * @param {number} currentRoundId Ronda actual en juego.
   * @param {number} maxRounds Total de rondas de la partida.
   * @return {!Array<number>} Lista ordenada de roundId objetivo.
   * @private
   */
  computeTargetRounds(currentRoundId, maxRounds) {
    const targets = [];
    for (let offset = 1; offset <= this.prefetchDepth; offset += 1) {
      const targetRoundId = currentRoundId + offset;
      if (targetRoundId <= maxRounds) {
        targets.push(targetRoundId);
      }
    }
    return targets;
  }

  /**
   * Clasifica las rondas objetivo que ya están READY o IN_FLIGHT.
   * @param {number} gameId Generación de partida vigente.
   * @param {!Array<number>} targets Rondas futuras de la ventana.
   * @return {{ready: !Array<number>, inFlight: !Array<number>}} Listas previas.
   * @private
   */
  classifyTargets(gameId, targets) {
    const ready = targets.filter((roundId) => this.isReady(gameId, roundId));
    const inFlight = targets.filter(
        (roundId) => !this.isReady(gameId, roundId) &&
            this.isInFlight(gameId, roundId),
    );
    return {ready, inFlight};
  }

  /**
   * Programa secuencialmente las rondas objetivo que aún falten cubrir.
   * @param {!Object} params Parámetros de partida y playlist.
   * @param {!Array<number>} targets Rondas futuras objetivo.
   * @return {!Array<number>} Rondas admitidas en este ciclo.
   * @private
   */
  scheduleMissingTargets(params, targets) {
    const scheduled = [];
    for (const targetRoundId of targets) {
      if (this.scheduleTargetIfMissing(params, targetRoundId)) {
        scheduled.push(targetRoundId);
      }
    }
    return scheduled;
  }

  /**
   * Construye los parámetros de preparación para una ronda futura.
   * @param {!Object} params Parámetros de partida y playlist.
   * @param {number} targetRoundId Ronda futura candidata.
   * @return {!Object} Parámetros para requestPreparation.
   * @private
   */
  buildTargetPreparation(params, targetRoundId) {
    const {gameId, currentRoundId, currentSongIndex, playlist} = params;
    const offset = targetRoundId - currentRoundId;
    const songIndex = (currentSongIndex + offset) % playlist.length;
    return {
      gameId,
      roundId: targetRoundId,
      mode: selectModeForRound(targetRoundId, this.modeSequence),
      source: playlist[songIndex],
    };
  }

  /**
   * Admite una ronda futura si no está cubierta ni excede la capacidad.
   * @param {!Object} params Parámetros de partida y playlist.
   * @param {number} targetRoundId Ronda futura candidata.
   * @return {boolean} True si se envió un nuevo AudioJob.
   * @private
   */
  scheduleTargetIfMissing(params, targetRoundId) {
    const {gameId} = params;
    if (this.isRoundCovered(gameId, targetRoundId) ||
      this.hasReachedCapacity()) {
      return false;
    }
    const request = this.buildTargetPreparation(params, targetRoundId);
    return this.requestPreparation(request).accepted;
  }

  /**
   * Comprueba que READY + IN_FLIGHT no supere la capacidad comprometible.
   * @return {boolean} True si no queda margen para admitir otro trabajo.
   * @private
   */
  hasReachedCapacity() {
    if (this.preparedRoundBuffer) {
      const committed =
          this.preparedRoundBuffer.size + this.getInFlightCount();
      return committed >= this.preparedRoundBuffer.capacity;
    }
    return this.getInFlightCount() >= this.prefetchDepth;
  }

  /**
   * Emite la traza estructurada de prefetch si se configuró un logger.
   * @param {!Object} summary Resultado de maintainPrefetchWindow.
   * @private
   */
  emitPrefetchLog(summary) {
    if (!this.log) {
      return;
    }
    const text = `[PREFETCH] gameId=${summary.gameId} ` +
        `currentRound=${summary.currentRoundId} ` +
        `target=[${summary.targets.join(',')}] ` +
        `ready=[${summary.ready.join(',')}] ` +
        `inFlight=[${summary.inFlight.join(',')}] ` +
        `scheduled=[${summary.scheduled.join(',')}]`;
    this.log(text);
  }
}

export {
  AudioPreparationManager,
  DEFAULT_PREFETCH_DEPTH,
  DEFAULT_MODE_SEQUENCE,
  selectModeForRound,
};
