/**
 * @fileoverview Punto de entrada ejecutado dentro de un worker_thread (V4-C09).
 * Recibe trabajos AudioJob por mensajes, reconstruye el Buffer PCM tras el
 * structured clone, ejecuta transformPcm de forma síncrona fuera del event
 * loop principal y devuelve un AudioResult correlacionado por jobId.
 * No administra pools, colas ni estado de partidas de Trivia Musical.
 */
const {parentPort, threadId} = require('worker_threads');
const AudioJob = require('../model/audio-job');
const AudioResult = require('../model/audio-result');
const {transformPcm} = require('../transform/audio-transform');

if (!parentPort) {
  throw new Error(
    'audio-worker-thread.js debe ejecutarse dentro de un worker_thread.'
  );
}

/**
 * Valida y reconstruye el origen PCM recibido mediante structured clone.
 * @param {*} source Fuente incluida en AudioJob.source.
 * @return {!Object} Configuración PCM normalizada con Buffer local.
 * @throws {TypeError} Si el formato de origen no corresponde al contrato C09.
 */
function normalizeSource(source) {
  if (!source || source.kind !== 'PCM_BUFFER') {
    throw new TypeError('C09 requiere source.kind=PCM_BUFFER.');
  }

  if (
    source.pcm === undefined ||
    source.pcm === null ||
    typeof source.pcm === 'number' ||
    typeof source.pcm === 'boolean'
  ) {
    throw new TypeError('C09 requiere source.pcm válido.');
  }

  return {
    pcm: Buffer.from(source.pcm),
    sampleRate: source.sampleRate ?? 44100,
    channels: source.channels ?? 2,
    bitsPerSample: source.bitsPerSample ?? 16,
    options: source.options ?? {},
  };
}

/**
 * Reconstruye el contrato AudioJob, aplica transformPcm y arma AudioResult.
 * @param {!Object} rawJob Objeto plano clonado recibido por postMessage.
 * @return {!AudioResult} Resultado exitoso con el PCM transformado.
 * @throws {TypeError} Si el trabajo o los parámetros PCM son inválidos.
 */
function executeAudioJob(rawJob) {
  const job = new AudioJob(rawJob);
  const {
    pcm,
    sampleRate,
    channels,
    bitsPerSample,
    options,
  } = normalizeSource(job.source);

  const transformedPcm = transformPcm({
    pcm,
    mode: job.mode,
    sampleRate,
    channels,
    bitsPerSample,
    options,
  });

  return new AudioResult({
    jobId: job.jobId,
    gameId: job.gameId,
    roundId: job.roundId,
    mode: job.mode,
    ok: true,
    resource: {
      kind: 'PCM_BUFFER',
      pcm: transformedPcm,
      sampleRate,
      channels,
      bitsPerSample,
      threadId,
    },
  });
}

/**
 * Construye un AudioResult fallido conservando la identidad del trabajo.
 * @param {!Object} rawJob Datos del trabajo que originó el error.
 * @param {*} error Excepción capturada durante el procesamiento.
 * @return {!AudioResult} Resultado con ok=false y descripción del error.
 */
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

parentPort.on('message', (message) => {
  if (!message || message.type !== 'RUN_AUDIO_JOB') {
    return;
  }

  let result;
  try {
    result = executeAudioJob(message.job);
  } catch (error) {
    result = createFailureResult(message.job, error);
  }

  parentPort.postMessage({
    type: 'AUDIO_RESULT',
    result,
  });
});
