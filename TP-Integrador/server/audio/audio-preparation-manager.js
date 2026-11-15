const AudioJob = require('./model/audio-job');

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
  constructor({
    workerPool,
    createJobId = null,
    initialGameId = 1,
  }) {
    if (workerPool === null || workerPool === undefined ||
        typeof workerPool.submit !== 'function') {
      throw new TypeError(
        'AudioPreparationManager.workerPool debe exponer submit().'
      );
    }

    if (createJobId !== null && typeof createJobId !== 'function') {
      throw new TypeError(
        'AudioPreparationManager.createJobId debe ser una función.'
      );
    }

    validateGameId(
      initialGameId,
      'AudioPreparationManager.initialGameId'
    );

    /** @private {!Object} */
    this.workerPool = workerPool;

    /** @private {number} */
    this.nextJobId = 0;

    /** @private {function(): string} */
    this.createJobId = createJobId || (() => {
      this.nextJobId += 1;
      return `audio-job-${this.nextJobId}`;
    });

    /** @private {number} */
    this.currentGameId = initialGameId;

    /** @private {!Set<string>} */
    this.inFlightRoundKeys = new Set();
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
        'AudioPreparationManager.result debe ser un objeto.'
      );
    }

    validateGameId(
      result.gameId,
      'AudioPreparationManager.result.gameId'
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
    validateGameId(
      gameId,
      'AudioPreparationManager.gameId'
    );

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
    validateGameId(
      previousGameId,
      'AudioPreparationManager.previousGameId'
    );
    validateGameId(
      gameId,
      'AudioPreparationManager.gameId'
    );

    if (previousGameId !== this.currentGameId) {
      throw new Error(
        'previousGameId no coincide con currentGameId.'
      );
    }

    if (gameId <= previousGameId) {
      throw new Error(
        'RESTART debe avanzar a un gameId posterior.'
      );
    }

    this.currentGameId = gameId;

    const clearedInFlight =
      this.clearInFlightTrackingForGame(previousGameId);

    return {
      previousGameId,
      gameId,
      clearedInFlight,
    };
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
  requestPreparation({gameId, roundId, mode, source}) {
    const roundKey = buildRoundKey(gameId, roundId);

    if (this.inFlightRoundKeys.has(roundKey)) {
      return {
        accepted: false,
        reason: 'ALREADY_IN_FLIGHT',
      };
    }

    const job = new AudioJob({
      jobId: this.createJobId(),
      gameId,
      roundId,
      mode,
      source,
    });

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

    return {
      accepted: true,
      job,
      resultPromise,
    };
  }
}

module.exports = AudioPreparationManager;
