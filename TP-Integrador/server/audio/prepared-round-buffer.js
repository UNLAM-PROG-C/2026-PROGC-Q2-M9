import {PreparedRound} from './model/prepared-round.js';

const DEFAULT_CAPACITY = 3;
const MINIMUM_CAPACITY = 1;
const MINIMUM_ID = 1;
const EMPTY_SIZE = 0;

class PreparedRoundBuffer {
  constructor({capacity = DEFAULT_CAPACITY} = {}) {
    if (!Number.isInteger(capacity) || capacity < MINIMUM_CAPACITY) {
      throw new TypeError(
          'PreparedRoundBuffer.capacity debe ser un entero >= ' +
          `${MINIMUM_CAPACITY}.`,
      );
    }

    this.capacity = capacity;
    this.rounds = new Map();
  }

  get size() {
    return this.rounds.size;
  }

  get remainingCapacity() {
    return this.capacity - this.rounds.size;
  }

  isFull() {
    return this.rounds.size >= this.capacity;
  }

  isEmpty() {
    return this.rounds.size === EMPTY_SIZE;
  }

  tryAdd(value) {
    const preparedRound = this.normalizePreparedRound(value);
    const key = this.buildKey(preparedRound.gameId, preparedRound.roundId);
    const reason = this.getRejectionReason(key);

    if (reason) {
      return {accepted: false, reason};
    }

    this.rounds.set(key, preparedRound);
    return {accepted: true, preparedRound};
  }

  has(gameId, roundId) {
    this.validateIdentity(gameId, roundId);
    return this.rounds.has(this.buildKey(gameId, roundId));
  }

  get(gameId, roundId) {
    this.validateIdentity(gameId, roundId);
    return this.rounds.get(this.buildKey(gameId, roundId)) ?? null;
  }

  consume(gameId, roundId) {
    const preparedRound = this.get(gameId, roundId);

    if (preparedRound === null) {
      return null;
    }

    this.rounds.delete(this.buildKey(gameId, roundId));
    return preparedRound;
  }

  clear() {
    this.rounds.clear();
  }

  normalizePreparedRound(value) {
    return value instanceof PreparedRound ? value : new PreparedRound(value);
  }

  buildKey(gameId, roundId) {
    return `${gameId}:${roundId}`;
  }

  getRejectionReason(key) {
    if (this.rounds.has(key)) {
      return 'DUPLICATE';
    }

    return this.isFull() ? 'FULL' : null;
  }

  validateIdentity(gameId, roundId) {
    if (!Number.isInteger(gameId) || gameId < MINIMUM_ID) {
      throw new TypeError(`gameId debe ser un entero >= ${MINIMUM_ID}.`);
    }

    if (!Number.isInteger(roundId) || roundId < MINIMUM_ID) {
      throw new TypeError(`roundId debe ser un entero >= ${MINIMUM_ID}.`);
    }
  }
}

export {PreparedRoundBuffer};
