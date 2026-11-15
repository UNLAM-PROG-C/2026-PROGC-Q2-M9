import {AudioJob} from './model/audio-job.js';

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
 * Coordinates creation and delegation of audio preparation jobs (C14).
 *
 * The manager owns logical IN_FLIGHT tracking by gameId and roundId. It does
 * not transform audio, schedule prefetch windows, manage restart cleanup or
 * publish PreparedRound instances.
 */
class AudioPreparationManager {
  /**
   * @param {!Object} options Manager dependencies.
   * @param {!Object} options.workerPool Object exposing submit(AudioJob).
   * @param {?function(): string=} options.createJobId Optional job ID factory.
   * @throws {TypeError} If required dependencies do not satisfy the contract.
   */
  constructor({workerPool, createJobId = null}) {
    if (workerPool === null || workerPool === undefined ||
        typeof workerPool.submit !== 'function') {
      throw new TypeError(
          'AudioPreparationManager.workerPool debe exponer submit().',
      );
    }

    if (createJobId !== null && typeof createJobId !== 'function') {
      throw new TypeError(
          'AudioPreparationManager.createJobId debe ser una función.',
      );
    }

    /** @private {!Object} */
    this.workerPool = workerPool;

    /** @private {number} */
    this.nextJobId = 0;

    /** @private {function(): string} */
    this.createJobId = createJobId || (() => {
      this.nextJobId += 1;
      return `audio-job-${this.nextJobId}`;
    });

    /** @private {!Set<string>} */
    this.inFlightRoundKeys = new Set();
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

export {AudioPreparationManager};
