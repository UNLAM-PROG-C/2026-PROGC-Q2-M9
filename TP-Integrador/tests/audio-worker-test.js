/**
 * @fileoverview Prueba automatizada aislada para AudioWorker (V4-C09).
 * Verifica la ejecución de AudioJob en un worker_thread real, correlación
 * de AudioResult, transformación PCM, no bloqueo inmediato del hilo principal,
 * reutilización del hilo persistente y manejo de errores controlados.
 */
const assert = require('assert');
const {
  threadId: mainThreadId,
  isMainThread,
} = require('worker_threads');
const AudioWorker = require('../server/audio/workers/audio-worker');
const AudioJob = require('../server/audio/model/audio-job');
const AudioResult = require('../server/audio/model/audio-result');
const {AudioMode} = require('../server/audio/model/audio-mode');

/**
 * Construye un Buffer PCM estéreo s16le sintético de tres frames.
 * @return {!Buffer} Muestras [100, 500, 200, 600, 300, 700].
 */
function createStereoPcm() {
  const samples = [
    100, 500,
    200, 600,
    300, 700,
  ];
  const pcm = Buffer.alloc(samples.length * 2);

  samples.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * 2);
  });

  return pcm;
}

/**
 * Construye el Buffer PCM esperado tras invertir temporalmente los frames.
 * @return {!Buffer} Muestras [300, 700, 200, 600, 100, 500].
 */
function createExpectedReversePcm() {
  const samples = [
    300, 700,
    200, 600,
    100, 500,
  ];
  const pcm = Buffer.alloc(samples.length * 2);

  samples.forEach((sample, index) => {
    pcm.writeInt16LE(sample, index * 2);
  });

  return pcm;
}

/**
 * Ejecuta la batería de verificaciones de C09 y cierra el worker al salir.
 * @return {!Promise<void>}
 */
async function main() {
  assert.strictEqual(isMainThread, true);

  const worker = new AudioWorker();
  let workerThreadId;

  try {
    // 1. Ejecución en worker_thread real, correlación y no bloqueo inmediato.
    const reverseJob = new AudioJob({
      jobId: 'c09-job-1',
      gameId: 1,
      roundId: 1,
      mode: AudioMode.REVERSE,
      source: {
        kind: 'PCM_BUFFER',
        pcm: createStereoPcm(),
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        options: {},
      },
    });

    let mainContinued = false;
    const firstPromise = worker.run(reverseJob);
    assert.strictEqual(worker.isBusy(), true);
    mainContinued = true;
    assert.strictEqual(mainContinued, true);

    const firstResult = await firstPromise;
    assert.strictEqual(worker.isBusy(), false);
    assert.ok(firstResult instanceof AudioResult);
    assert.strictEqual(firstResult.jobId, reverseJob.jobId);
    assert.strictEqual(firstResult.gameId, reverseJob.gameId);
    assert.strictEqual(firstResult.roundId, reverseJob.roundId);
    assert.strictEqual(firstResult.mode, reverseJob.mode);
    assert.strictEqual(firstResult.ok, true);
    assert.strictEqual(firstResult.error, null);
    assert.strictEqual(firstResult.resource.kind, 'PCM_BUFFER');
    assert.strictEqual(Buffer.isBuffer(firstResult.resource.pcm), true);
    assert.deepStrictEqual(
      firstResult.resource.pcm,
      createExpectedReversePcm()
    );

    workerThreadId = firstResult.resource.threadId;
    assert.notStrictEqual(workerThreadId, mainThreadId);

    // 2. Reutilización del mismo hilo persistente para un segundo trabajo.
    const lowPassJob = new AudioJob({
      jobId: 'c09-job-2',
      gameId: 1,
      roundId: 2,
      mode: AudioMode.LOW_PASS,
      source: {
        kind: 'PCM_BUFFER',
        pcm: createStereoPcm(),
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        options: {cutoffHz: 1200},
      },
    });

    const secondResult = await worker.run(lowPassJob);
    assert.strictEqual(secondResult.ok, true);
    assert.strictEqual(secondResult.jobId, lowPassJob.jobId);
    assert.strictEqual(secondResult.roundId, 2);
    assert.strictEqual(secondResult.resource.threadId, workerThreadId);

    // 3. Error controlado de transformación sin matar al worker.
    const invalidJob = new AudioJob({
      jobId: 'c09-job-error',
      gameId: 1,
      roundId: 3,
      mode: AudioMode.LOW_PASS,
      source: {
        kind: 'PCM_BUFFER',
        pcm: createStereoPcm(),
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        options: {cutoffHz: 99999},
      },
    });

    const errorResult = await worker.run(invalidJob);
    assert.strictEqual(errorResult.ok, false);
    assert.strictEqual(errorResult.resource, null);
    assert.strictEqual(errorResult.jobId, invalidJob.jobId);
    assert.ok(typeof errorResult.error === 'string' && errorResult.error);
    assert.strictEqual(worker.hasExited(), false);

    // 4. Rechazo si se intenta enviar otro job mientras está ocupado.
    const busyJobA = new AudioJob({
      jobId: 'c09-busy-a',
      gameId: 2,
      roundId: 1,
      mode: AudioMode.NORMAL,
      source: {
        kind: 'PCM_BUFFER',
        pcm: createStereoPcm(),
      },
    });
    const busyJobB = new AudioJob({
      jobId: 'c09-busy-b',
      gameId: 2,
      roundId: 1,
      mode: AudioMode.NORMAL,
      source: {
        kind: 'PCM_BUFFER',
        pcm: createStereoPcm(),
      },
    });

    const pendingA = worker.run(busyJobA);
    await assert.rejects(
      () => worker.run(busyJobB),
      /ocupado/
    );
    const completedA = await pendingA;
    assert.strictEqual(completedA.jobId, busyJobA.jobId);
  } finally {
    await worker.terminate();
  }

  assert.strictEqual(worker.hasExited(), true);
  await assert.rejects(
    () => worker.run(new AudioJob({
      jobId: 'c09-after-exit',
      gameId: 2,
      roundId: 2,
      mode: AudioMode.NORMAL,
      source: {
        kind: 'PCM_BUFFER',
        pcm: createStereoPcm(),
      },
    })),
    /terminó/
  );

  console.log(`[C09] Main threadId: ${mainThreadId}`);
  console.log(`[C09] Worker threadId: ${workerThreadId}`);
  console.log('[C09] PASS: AudioJob procesado en worker_thread real.');
}

main().catch((error) => {
  console.error('[C09] FAIL:', error);
  process.exitCode = 1;
});
