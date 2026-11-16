/**
 * @fileoverview Wrapper del hilo principal para un worker de audio (C09).
 * Administra un único hilo trabajador persistente y reutilizable que ejecuta
 * un AudioJob por vez, correlaciona la respuesta mediante jobId y reconstruye
 * el contrato AudioResult. No implementa pools, colas ni reintentos.
 */
const path = require('path');
const {Worker} = require('worker_threads');
const AudioJob = require('../model/audio-job');
const AudioResult = require('../model/audio-result');

/**
 * Controla un trabajador individual basado en worker_threads.
 */
class AudioWorker {
  /**
   * Crea el hilo trabajador persistente y registra sus listeners.
   * @param {!Object=} options Configuración opcional del worker.
   * @param {string=} options.workerScript Ruta al script del hilo trabajador.
   */
  constructor({
    workerScript = path.join(__dirname, 'audio-worker-thread.js'),
  } = {}) {
    /** @private {!Worker} */
    this.worker = new Worker(workerScript);
    /** @private {boolean} */
    this.busy = false;
    /** @private {?Object} */
    this.currentJob = null;
    /** @private {boolean} */
    this.exited = false;
    /** @private {boolean} */
    this.closing = false;

    this.worker.on('message', (message) => this.handleMessage(message));
    this.worker.on('error', (error) => this.handleWorkerError(error));
    this.worker.on('exit', (code) => this.handleWorkerExit(code));
  }

  /**
   * @return {boolean} True si el trabajador está procesando un job.
   */
  isBusy() {
    return this.busy;
  }

  /**
   * @return {boolean} True si el hilo trabajador ya finalizó.
   */
  hasExited() {
    return this.exited;
  }

  /**
   * @return {number} Identificador interno del hilo asignado por Node.js.
   */
  getThreadId() {
    return this.worker.threadId;
  }

  /**
   * Envía un AudioJob al worker y resuelve con el AudioResult correlacionado.
   * Rechaza si el worker ya finalizó, si está ocupado o si el job es inválido.
   * @param {!AudioJob|!Object} rawJob Trabajo de audio a ejecutar.
   * @return {!Promise<!AudioResult>} Promesa con el resultado del trabajador.
   */
  run(rawJob) {
    if (this.exited) {
      return Promise.reject(new Error('AudioWorker ya terminó.'));
    }

    if (this.busy) {
      return Promise.reject(new Error('AudioWorker está ocupado.'));
    }

    let job;
    try {
      job = rawJob instanceof AudioJob ? rawJob : new AudioJob(rawJob);
    } catch (error) {
      return Promise.reject(error);
    }

    this.busy = true;

    return new Promise((resolve, reject) => {
      this.currentJob = {
        jobId: job.jobId,
        resolve,
        reject,
      };

      this.worker.postMessage({
        type: 'RUN_AUDIO_JOB',
        job,
      });
    });
  }

  /**
   * Procesa mensajes provenientes del worker y valida correlación por jobId.
   * @param {*} message Mensaje recibido desde el hilo trabajador.
   * @private
   */
  handleMessage(message) {
    if (!message || message.type !== 'AUDIO_RESULT') {
      return;
    }

    if (!this.currentJob) {
      return;
    }

    const rawResult = message.result;
    if (!rawResult || rawResult.jobId !== this.currentJob.jobId) {
      const {reject} = this.currentJob;
      const receivedId = rawResult ? rawResult.jobId : 'desconocido';
      this.clearCurrentJob();
      reject(new Error(`Resultado inesperado: ${receivedId}`));
      return;
    }

    let result;
    try {
      result = this.normalizeResult(rawResult);
    } catch (error) {
      const {reject} = this.currentJob;
      this.clearCurrentJob();
      reject(error);
      return;
    }

    const {resolve} = this.currentJob;
    this.clearCurrentJob();
    resolve(result);
  }

  /**
   * Reconstruye Buffer y contrato AudioResult tras cruzar postMessage.
   * @param {!Object} rawResult Datos clonados devueltos por el worker.
   * @return {!AudioResult} Instancia validada de AudioResult.
   * @private
   */
  normalizeResult(rawResult) {
    let resource = rawResult.resource;

    if (
      resource &&
      resource.kind === 'PCM_BUFFER' &&
      resource.pcm !== undefined &&
      resource.pcm !== null
    ) {
      resource = {
        ...resource,
        pcm: Buffer.from(resource.pcm),
      };
    }

    return new AudioResult({
      ...rawResult,
      resource,
    });
  }

  /**
   * Rechaza el trabajo en curso ante un error no controlado del hilo.
   * @param {!Error} error Error emitido por el objeto Worker.
   * @private
   */
  handleWorkerError(error) {
    if (this.currentJob) {
      const {reject} = this.currentJob;
      this.clearCurrentJob();
      reject(error);
      return;
    }

    this.clearCurrentJob();
  }

  /**
   * Actualiza estado de salida y rechaza si hubo terminación inesperada.
   * @param {number} code Código de salida del hilo trabajador.
   * @private
   */
  handleWorkerExit(code) {
    this.exited = true;

    if (!this.closing && this.currentJob) {
      const {reject} = this.currentJob;
      this.clearCurrentJob();
      reject(new Error(`AudioWorker terminó con código ${code}.`));
      return;
    }

    this.clearCurrentJob();
  }

  /**
   * Libera el estado de ocupación del trabajador tras finalizar un job.
   * @private
   */
  clearCurrentJob() {
    this.busy = false;
    this.currentJob = null;
  }

  /**
   * Finaliza de forma controlada el hilo trabajador subyacente.
   * @return {!Promise<void>} Promesa resuelta cuando el hilo termina.
   */
  async terminate() {
    if (this.exited) {
      return;
    }

    this.closing = true;
    await this.worker.terminate();
    this.exited = true;
  }
}

module.exports = AudioWorker;
