/**
 * @fileoverview Punto de entrada ejecutado dentro de un worker_thread (V4-C09).
 * Recibe AudioJob, transforma PCM fuera del event loop principal y devuelve
 * AudioResult correlacionados por jobId.
 */

import {parentPort, threadId} from 'node:worker_threads';

import {AudioJob} from '../model/audio-job.js';
import {AudioResult} from '../model/audio-result.js';
import {transformPcm} from '../transform/audio-transform.js';

const PCM_BUFFER_KIND = 'PCM_BUFFER';
const RUN_AUDIO_JOB = 'RUN_AUDIO_JOB';
const AUDIO_RESULT = 'AUDIO_RESULT';
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_BITS_PER_SAMPLE = 16;

if (!parentPort) {
  throw new Error(
      'audio-worker-thread.js debe ejecutarse dentro de un worker_thread.',
  );
}

function isInvalidPcm(pcm) {
  return pcm === undefined ||
    pcm === null ||
    typeof pcm === 'number' ||
    typeof pcm === 'boolean';
}

function validateSource(source) {
  if (!source || source.kind !== PCM_BUFFER_KIND) {
    throw new TypeError('C09 requiere source.kind=PCM_BUFFER.');
  }
  if (isInvalidPcm(source.pcm)) {
    throw new TypeError('C09 requiere source.pcm válido.');
  }
}

function normalizeSource(source) {
  validateSource(source);
  return {
    pcm: Buffer.from(source.pcm),
    sampleRate: source.sampleRate ?? DEFAULT_SAMPLE_RATE,
    channels: source.channels ?? DEFAULT_CHANNELS,
    bitsPerSample: source.bitsPerSample ?? DEFAULT_BITS_PER_SAMPLE,
    options: source.options ?? {},
  };
}

function createResource(source, transformedPcm) {
  return {
    kind: PCM_BUFFER_KIND,
    pcm: transformedPcm,
    sampleRate: source.sampleRate,
    channels: source.channels,
    bitsPerSample: source.bitsPerSample,
    threadId,
  };
}

function createSuccessResult(job, source, transformedPcm) {
  return new AudioResult({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    ok: true,
    resource: createResource(source, transformedPcm),
  });
}

function executeAudioJob(rawJob) {
  const job = new AudioJob(rawJob);
  const source = normalizeSource(job.source);
  const transformedPcm = transformPcm({
    ...source,
    mode: job.mode,
  });
  return createSuccessResult(job, source, transformedPcm);
}

function createFailureResult(rawJob, error) {
  const message = error instanceof Error ? error.message : String(error);
  return new AudioResult({
    jobId: rawJob.jobId,
    gameId: rawJob.gameId,
    roundId: rawJob.roundId,
    mode: rawJob.mode,
    ok: false,
    resource: null,
    error: message || 'Error desconocido en audio-worker-thread.',
  });
}

function processAudioJob(rawJob) {
  try {
    return executeAudioJob(rawJob);
  } catch (error) {
    return createFailureResult(rawJob, error);
  }
}

function handleMessage(message) {
  if (!message || message.type !== RUN_AUDIO_JOB) {
    return;
  }
  parentPort.postMessage({
    type: AUDIO_RESULT,
    result: processAudioJob(message.job),
  });
}

parentPort.on('message', handleMessage);
