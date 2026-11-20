/**
 * @fileoverview Adapta preview URL a PCM antes del AudioWorkerPool.
 */

import {AudioJob} from './model/audio-job.js';
import {
  loadPreviewPcmSource,
} from './preview-pcm-source.js';

function validatePool(workerPool) {
  if (!workerPool ||
      typeof workerPool.submit !== 'function' ||
      typeof workerPool.cancelQueuedByGameId !== 'function') {
    throw new TypeError(
        'PreviewPcmPoolAdapter requiere un workerPool válido.',
    );
  }
}

function validateLoader(loadSource) {
  if (typeof loadSource !== 'function') {
    throw new TypeError('loadSource debe ser una función.');
  }
}

function normalizeJob(rawJob) {
  return rawJob instanceof AudioJob ?
    rawJob :
    new AudioJob(rawJob);
}

function getPreviewUrl(source) {
  const previewUrl = source?.preview;
  if (typeof previewUrl !== 'string' || previewUrl.length === 0) {
    throw new TypeError(
        'AudioJob.source.preview debe ser un string no vacío.',
    );
  }
  return previewUrl;
}

function createCancellationError(job) {
  return new Error(
      `AudioJob ${job.jobId} cancelado para gameId=${job.gameId}.`,
  );
}

function createPreparedJob(job, source) {
  return new AudioJob({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    source,
  });
}

class PreviewPcmPoolAdapter {
  constructor({
    workerPool,
    loadSource = loadPreviewPcmSource,
  }) {
    validatePool(workerPool);
    validateLoader(loadSource);
    this.workerPool = workerPool;
    this.loadSource = loadSource;
    this.cancelledGameIds = new Set();
  }

  ensureNotCancelled(job) {
    if (this.cancelledGameIds.has(job.gameId)) {
      throw createCancellationError(job);
    }
  }

  async prepareJob(job) {
    this.ensureNotCancelled(job);
    const previewUrl = getPreviewUrl(job.source);
    const source = await this.loadSource(previewUrl);
    this.ensureNotCancelled(job);
    return createPreparedJob(job, source);
  }

  async submit(rawJob) {
    const job = normalizeJob(rawJob);
    const preparedJob = await this.prepareJob(job);
    return this.workerPool.submit(preparedJob);
  }

  cancelQueuedByGameId(gameId) {
    this.cancelledGameIds.add(gameId);
    return this.workerPool.cancelQueuedByGameId(gameId);
  }

  terminate() {
    if (typeof this.workerPool.terminate !== 'function') {
      return Promise.resolve();
    }
    return this.workerPool.terminate();
  }
}

export {PreviewPcmPoolAdapter};
