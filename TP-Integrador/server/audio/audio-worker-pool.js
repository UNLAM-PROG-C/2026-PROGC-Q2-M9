/**
 * @fileoverview Pool fijo y reutilizable de AudioWorker para V4-C11/C12.
 */

import {JobQueue} from './job-queue.js';
import {AudioWorker} from './workers/audio-worker.js';

const DEFAULT_POOL_SIZE = 3;
const REQUIRED_WORKER_METHODS = [
  'isBusy',
  'hasExited',
  'run',
  'terminate',
];

function validatePoolSize(size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError(
        'AudioWorkerPool.size debe ser un entero positivo.',
    );
  }
}

function validateWorkerFactory(createWorker) {
  if (typeof createWorker !== 'function') {
    throw new TypeError(
        'AudioWorkerPool.createWorker debe ser una función.',
    );
  }
}

function validateWorker(worker) {
  const missing = REQUIRED_WORKER_METHODS.find(
      (method) => typeof worker?.[method] !== 'function',
  );
  if (missing) {
    throw new TypeError(
        `AudioWorker inválido: falta ${missing}().`,
    );
  }
}

function createWorkerInstance(createWorker) {
  const worker = createWorker();
  validateWorker(worker);
  return worker;
}

function createCancellationError(job) {
  return new Error(
      `AudioJob ${job.jobId} cancelado para gameId=${job.gameId}.`,
  );
}

class AudioWorkerPool {
  constructor({
    size = DEFAULT_POOL_SIZE,
    createWorker = () => new AudioWorker(),
  } = {}) {
    validatePoolSize(size);
    validateWorkerFactory(createWorker);
    this.workers = Array.from(
        {length: size},
        () => createWorkerInstance(createWorker),
    );
    this.queue = new JobQueue();
  }

  getSize() {
    return this.workers.length;
  }

  getActiveCount() {
    return this.workers.filter((worker) => worker.isBusy()).length;
  }

  getAvailableCount() {
    return this.workers.filter((worker) => this.isAvailable(worker)).length;
  }

  getQueuedCount() {
    return this.queue.getSize();
  }

  isAvailable(worker) {
    return !worker.hasExited() && !worker.isBusy();
  }

  findAvailableWorker() {
    return this.workers.find(
        (worker) => this.isAvailable(worker),
    ) ?? null;
  }

  submit(job) {
    return new Promise((resolve, reject) => {
      const request = {job, resolve, reject};
      const worker = this.findAvailableWorker();
      if (!worker) {
        this.queue.enqueue(request);
        return;
      }
      this.runRequest(worker, request);
    });
  }

  runRequest(worker, request) {
    let execution;
    try {
      execution = worker.run(request.job);
    } catch (error) {
      request.reject(error);
      this.dispatchNext();
      return;
    }
    Promise.resolve(execution)
        .then(request.resolve, request.reject)
        .finally(() => this.dispatchNext());
  }

  dispatchNext() {
    const worker = this.findAvailableWorker();
    if (!worker) {
      return;
    }
    const request = this.queue.dequeue();
    if (request) {
      this.runRequest(worker, request);
    }
  }

  cancelQueuedByGameId(gameId) {
    const removed = this.queue.removeByGameId(gameId);
    for (const request of removed) {
      request.reject(createCancellationError(request.job));
    }
    return removed.length;
  }

  async terminate() {
    await Promise.all(
        this.workers.map((worker) => worker.terminate()),
    );
  }
}

export {AudioWorkerPool, DEFAULT_POOL_SIZE};
