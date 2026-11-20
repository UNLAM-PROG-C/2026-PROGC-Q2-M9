/**
 * @fileoverview Cola FIFO de solicitudes de audio pendientes para V4-C12.
 */

function validateQueueRequest(request) {
  if (!request?.job ||
      typeof request.resolve !== 'function' ||
      typeof request.reject !== 'function') {
    throw new TypeError(
        'JobQueue requiere job, resolve y reject.',
    );
  }
}

class JobQueue {
  constructor() {
    this.entries = [];
  }

  getSize() {
    return this.entries.length;
  }

  isEmpty() {
    return this.entries.length === 0;
  }

  enqueue(request) {
    validateQueueRequest(request);
    this.entries.push(request);
    return this.entries.length;
  }

  dequeue() {
    return this.entries.shift() ?? null;
  }

  removeByGameId(gameId) {
    const removed = this.entries.filter(
        (entry) => entry.job.gameId === gameId,
    );
    this.entries = this.entries.filter(
        (entry) => entry.job.gameId !== gameId,
    );
    return removed;
  }
}

export {JobQueue};
