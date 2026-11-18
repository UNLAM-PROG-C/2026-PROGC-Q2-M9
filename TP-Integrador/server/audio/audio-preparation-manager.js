import {AudioJob} from './model/audio-job.js';

/**
 * Validates one game generation identifier.
 * @param {number} gameId Game generation identifier.
 * @param {string} fieldName Name used in the diagnostic message.
 * @throws {TypeError} If gameId is not an integer >= 1.
 */
function validateGameId(gameId, fieldName) {
  if (!Number.isInteger(gameId) || gameId < 1) {
    throw new TypeError(`${fieldName} debe ser un entero >= 1.`);
  }
}

function validateWorkerPool(workerPool) {
  if (!workerPool || typeof workerPool.submit !== 'function') {
    throw new TypeError(
        'AudioPreparationManager.workerPool debe exponer submit().',
    );
  }
}

function validateCreateJobId(createJobId) {
  if (createJobId !== null && typeof createJobId !== 'function') {
    throw new TypeError(
        'AudioPreparationManager.createJobId debe ser una función.',
    );
  }
}

function validateRestartTransition(previousGameId, gameId, currentGameId) {
  validateGameId(previousGameId, 'AudioPreparationManager.previousGameId');
  validateGameId(gameId, 'AudioPreparationManager.gameId');
  if (previousGameId !== currentGameId) {
    throw new Error('previousGameId no coincide con currentGameId.');
  }
  if (gameId <= previousGameId) {
    throw new Error('RESTART debe avanzar a un gameId posterior.');
  }
}

function buildRestartSummary(
    previousGameId,
    gameId,
    cancelledQueued,
    clearedInFlight,
) {
  return {previousGameId, gameId, cancelledQueued, clearedInFlight};
}

/**
 * Builds the logical identity used to track one round inside one game.
 * @param {number} gameId Game generation identifier.
 * @param {number} roundId Round identifier inside the game.
 * @return {string} Stable game and round key.
 */
function buildRoundKey(gameId, roundId) {
  return `${gameId}:${roundId}`;
}

/**
 * Coordinates creation and delegation of audio preparation jobs.
 *
 * The manager owns logical IN_FLIGHT tracking by gameId and roundId. It also
 * tracks the current game generation so results from older games can be
 * identified as stale after a restart.
 *
 * It does not transform audio or terminate workers.
 */
class AudioPreparationManager {
  /**
   * @param {!Object} options Manager dependencies.
   * @param {!Object} options.workerPool Object exposing submit(AudioJob).
   * @param {?function(): string=} options.createJobId Optional job ID factory.
   * @param {number=} options.initialGameId Initial game generation.
   * @throws {TypeError} If dependencies or initialGameId are invalid.
   */

  constructor({workerPool, createJobId = null, initialGameId = 1}) {
    validateWorkerPool(workerPool);
    validateCreateJobId(createJobId);
    validateGameId(
        initialGameId,
        'AudioPreparationManager.initialGameId',
    );
    this.workerPool = workerPool;
    this.nextJobId = 0;
    this.createJobId = createJobId || (() => this.generateJobId());
    this.currentGameId = initialGameId;
    this.inFlightRoundKeys = new Set();
  }

  generateJobId() {
    this.nextJobId += 1;
    return `audio-job-${this.nextJobId}`;
  }


  /**
   * Returns the current logical game generation.
   * @return {number} Current gameId.
   */
  getCurrentGameId() {
    return this.currentGameId;
  }

  /**
   * Reports whether a gameId belongs to the current generation.
   * @param {number} gameId Game generation identifier.
   * @return {boolean} True when gameId is the current generation.
   */
  isCurrentGame(gameId) {
    return gameId === this.currentGameId;
  }

  /**
   * Reports whether an AudioResult belongs to an obsolete game generation.
   * @param {!Object} result AudioResult or compatible result object.
   * @return {boolean} True when the result belongs to an older generation.
   * @throws {TypeError} If result or its gameId is invalid.
   */
  isStaleResult(result) {
    if (result === null || typeof result !== 'object') {
      throw new TypeError(
          'AudioPreparationManager.result debe ser un objeto.',
      );
    }

    validateGameId(
        result.gameId,
        'AudioPreparationManager.result.gameId',
    );

    return !this.isCurrentGame(result.gameId);
  }

  /**
   * Classifies a completed result against the current game generation.
   *
   * A stale result is technically completed but must not be published to the
   * current game. This method does not convert results into PreparedRound
   * instances; that publication step belongs to later integration tasks.
   *
   * @param {!Object} result AudioResult or compatible result object.
   * @return {!Object} Classification for subsequent publication logic.
   */
  handleAudioResult(result) {
    if (this.isStaleResult(result)) {
      return {
        accepted: false,
        reason: 'STALE_GAME',
        result,
      };
    }

    return {
      accepted: true,
      result,
    };
  }

  /**
   * Reports whether one logical round already has admitted preparation work.
   * @param {number} gameId Game generation identifier.
   * @param {number} roundId Round identifier inside the game.
   * @return {boolean} True while the round is IN_FLIGHT.
   */
  isInFlight(gameId, roundId) {
    return this.inFlightRoundKeys.has(buildRoundKey(gameId, roundId));
  }

  /**
   * Returns the number of logical rounds currently being prepared.
   * @return {number} Number of IN_FLIGHT round keys.
   */
  getInFlightCount() {
    return this.inFlightRoundKeys.size;
  }

  /**
   * Removes logical IN_FLIGHT tracking for one game generation.
   *
   * This does not stop physical work already running in a worker.
   *
   * @param {number} gameId Game generation to remove.
   * @return {number} Number of logical round keys removed.
   */
  clearInFlightTrackingForGame(gameId) {
    validateGameId(gameId, 'AudioPreparationManager.gameId');
    const prefix = `${gameId}:`;
    let removed = 0;
    for (const roundKey of this.inFlightRoundKeys) {
      if (!roundKey.startsWith(prefix)) {
        continue;
      }
      this.inFlightRoundKeys.delete(roundKey);
      removed += 1;
    }
    return removed;
  }

  /**
   * Applies the logical generation change produced by a game restart.
   *
   * Queue cancellation and PreparedRoundBuffer cleanup are added when the
   * real C12 and C15 components are available.
   *
   * @param {!Object} options Restart identifiers from SessionCoordinator.
   * @param {number} options.previousGameId Previous game generation.
   * @param {number} options.gameId New game generation.
   * @return {!Object} Logical cleanup summary.
   * @throws {Error} If the restart does not advance the expected generation.
   */
  handleGameRestart({previousGameId, gameId}) {
    validateRestartTransition(
        previousGameId, gameId, this.currentGameId,
    );
    this.currentGameId = gameId;
    const cancelledQueued =
      this.workerPool.cancelQueuedByGameId(previousGameId);
    const clearedInFlight =
      this.clearInFlightTrackingForGame(previousGameId);
    return buildRestartSummary(
        previousGameId, gameId, cancelledQueued, clearedInFlight,
    );
  }

  /**
   * Creates and delegates one AudioJob unless the round is already IN_FLIGHT.
   * @param {!Object} options Preparation request.
   * @param {number} options.gameId Game generation identifier.
   * @param {number} options.roundId Round identifier inside the game.
   * @param {string} options.mode Audio mode from AudioMode.
   * @param {*} options.source Opaque audio source consumed by later stages.
   * @return {!Object} Admission result and, when accepted, job and Promise.
   */
  createAudioJob({gameId, roundId, mode, source}) {
    return new AudioJob({
      jobId: this.createJobId(),
      gameId,
      roundId,
      mode,
      source,
    });
  }

  submitToPool(job, roundKey) {
    try {
      return this.workerPool.submit(job);
    } catch (error) {
      this.inFlightRoundKeys.delete(roundKey);
      throw error;
    }
  }

  trackResult(submitted, roundKey) {
    return Promise.resolve(submitted).finally(() => {
      this.inFlightRoundKeys.delete(roundKey);
    });
  }

  acceptJob(job, roundKey) {
    this.inFlightRoundKeys.add(roundKey);
    const submitted = this.submitToPool(job, roundKey);
    const resultPromise = this.trackResult(submitted, roundKey);
    return {accepted: true, job, resultPromise};
  }

  requestPreparation({gameId, roundId, mode, source}) {
    const roundKey = buildRoundKey(gameId, roundId);
    if (this.inFlightRoundKeys.has(roundKey)) {
      return {
        accepted: false,
        reason: 'ALREADY_IN_FLIGHT',
      };
    }
    const job = this.createAudioJob({gameId, roundId, mode, source});
    return this.acceptJob(job, roundKey);
  }
}

export {AudioPreparationManager};
