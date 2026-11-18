/**
 * @fileoverview Pool fijo y reutilizable de AudioWorker para V4-C11.
 */

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

  isAvailable(worker) {
    return !worker.hasExited() && !worker.isBusy();
  }

  findAvailableWorker() {
    return this.workers.find(
        (worker) => this.isAvailable(worker),
    ) ?? null;
  }

  submit(job) {
    const worker = this.findAvailableWorker();
    if (!worker) {
      return Promise.reject(
          new Error('AudioWorkerPool sin capacidad disponible.'),
      );
    }
    return worker.run(job);
  }

  async terminate() {
    await Promise.all(
        this.workers.map((worker) => worker.terminate()),
    );
  }
}

export {AudioWorkerPool, DEFAULT_POOL_SIZE};
