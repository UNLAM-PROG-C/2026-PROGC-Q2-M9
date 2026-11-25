/**
 * @fileoverview Wrapper del hilo principal para un worker de audio (C09).
 * Administra un único hilo trabajador persistente y reutilizable que ejecuta
 * un AudioJob por vez y correlaciona la respuesta mediante jobId.
 */

import {Worker} from 'node:worker_threads';

import {AudioJob} from '../model/audio-job.js';
import {AudioResult} from '../model/audio-result.js';

const WORKER_SCRIPT_URL = new URL('./audio-worker-thread.js', import.meta.url);
const RUN_AUDIO_JOB = 'RUN_AUDIO_JOB';
const AUDIO_RESULT = 'AUDIO_RESULT';
const PCM_BUFFER_KIND = 'PCM_BUFFER';
const UNKNOWN_JOB_ID = 'desconocido';
const WORKER_UNAVAILABLE_ERROR =
  'AudioWorker no está disponible (terminó, falló o se está cerrando).';
const TERMINATE_ACTIVE_JOB_ERROR =
  'AudioWorker terminado mientras procesaba un job.';

class AudioWorker {
  constructor({workerScript = WORKER_SCRIPT_URL} = {}) {
    this.worker = new Worker(workerScript);
    this.busy = false;
    this.currentJob = null;
    this.exited = false;
    this.closing = false;
    this.fatalError = null;
    this.registerListeners();
  }

  registerListeners() {
    this.worker.on('message', (message) => this.handleMessage(message));
    this.worker.on('error', (error) => this.handleWorkerError(error));
    this.worker.on('exit', (code) => this.handleWorkerExit(code));
  }

  onExit(listener) {
    this.worker.on('exit', listener);
  }

  isBusy() {
    return this.busy;
  }

  hasExited() {
    return this.exited;
  }

  isHealthy() {
    return !this.exited && !this.fatalError;
  }

  isAvailable() {
    return this.isHealthy() && !this.busy && !this.closing;
  }

  getThreadId() {
    return this.worker.threadId;
  }

  ensureAvailable() {
    if (!this.isHealthy() || this.closing) {
      throw new Error(WORKER_UNAVAILABLE_ERROR);
    }
    if (this.busy) {
      throw new Error('AudioWorker está ocupado.');
    }
  }

  normalizeJob(rawJob) {
    return rawJob instanceof AudioJob ? rawJob : new AudioJob(rawJob);
  }

  run(rawJob) {
    try {
      this.ensureAvailable();
      const job = this.normalizeJob(rawJob);
      return this.dispatchJob(job);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  dispatchJob(job) {
    this.busy = true;
    return new Promise((resolve, reject) => {
      this.currentJob = {jobId: job.jobId, resolve, reject};
      this.sendJob(job, reject);
    });
  }

  sendJob(job, reject) {
    try {
      this.worker.postMessage({type: RUN_AUDIO_JOB, job});
    } catch (error) {
      this.clearCurrentJob();
      reject(error);
    }
  }

  handleMessage(message) {
    if (!this.isExpectedMessage(message) || !this.currentJob) {
      return;
    }
    if (!this.hasExpectedJobId(message.result)) {
      this.rejectUnexpectedResult(message.result);
      return;
    }
    this.resolveCurrentJob(message.result);
  }

  isExpectedMessage(message) {
    return Boolean(message) && message.type === AUDIO_RESULT;
  }

  hasExpectedJobId(rawResult) {
    return Boolean(rawResult) &&
      rawResult.jobId === this.currentJob.jobId;
  }

  rejectUnexpectedResult(rawResult) {
    const receivedId = rawResult?.jobId ?? UNKNOWN_JOB_ID;
    const error = new Error(`Resultado inesperado: ${receivedId}`);
    this.rejectCurrentJob(error);
  }

  resolveCurrentJob(rawResult) {
    try {
      const result = this.normalizeResult(rawResult);
      const {resolve} = this.currentJob;
      this.clearCurrentJob();
      resolve(result);
    } catch (error) {
      this.rejectCurrentJob(error);
    }
  }

  normalizeResult(rawResult) {
    return new AudioResult({
      ...rawResult,
      resource: this.normalizeResource(rawResult.resource),
    });
  }

  normalizeResource(resource) {
    if (!resource || resource.kind !== PCM_BUFFER_KIND) {
      return resource;
    }
    if (resource.pcm === undefined || resource.pcm === null) {
      return resource;
    }
    return {...resource, pcm: Buffer.from(resource.pcm)};
  }

  rejectCurrentJob(error) {
    if (!this.currentJob) {
      this.clearCurrentJob();
      return;
    }
    const {reject} = this.currentJob;
    this.clearCurrentJob();
    reject(error);
  }

  handleWorkerError(error) {
    this.fatalError = error;
    this.rejectCurrentJob(error);
  }

  handleWorkerExit(code) {
    this.exited = true;
    if (!this.closing && this.currentJob) {
      this.rejectCurrentJob(
          new Error(`AudioWorker terminó con código ${code}.`),
      );
      return;
    }
    this.clearCurrentJob();
  }

  clearCurrentJob() {
    this.busy = false;
    this.currentJob = null;
  }

  rejectActiveJobOnTerminate() {
    if (!this.currentJob) {
      return;
    }
    this.rejectCurrentJob(new Error(TERMINATE_ACTIVE_JOB_ERROR));
  }

  async terminate() {
    if (this.exited) {
      return;
    }
    this.closing = true;
    this.rejectActiveJobOnTerminate();
    await this.worker.terminate();
    this.exited = true;
  }
}

export {AudioWorker};
