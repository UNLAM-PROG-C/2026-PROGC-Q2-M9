/**
 * @fileoverview Spike C06: preview real, FFmpeg, REVERSE y salida WAV.
 * Mide una ejecución de la inversión, no un benchmark ni paralelismo.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {performance} from 'perf_hooks';
import {fileURLToPath} from 'url';
import {
  decodeToPcm,
  downloadPreview,
  encodeWav,
  fetchFirstPreview,
  ffmpegPath,
  reversePcmFrames,
} from './audio-spike-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_URL =
  'https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=5';
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const FRAME_SIZE = CHANNELS * BYTES_PER_SAMPLE;

async function loadPcm() {
  const song = await fetchFirstPreview(SEARCH_URL, 'C06');
  const compressed = await downloadPreview(song.previewUrl, 'C06');
  const pcm = await decodeToPcm(compressed, SAMPLE_RATE, CHANNELS);
  assert.strictEqual(pcm.length % FRAME_SIZE, 0, 'PCM con frame incompleto.');
  return pcm;
}

function logPcmSummary(pcm) {
  const durationSeconds = pcm.length / FRAME_SIZE / SAMPLE_RATE;
  console.log(`[C06] PCM generado: ${pcm.length} bytes`);
  console.log(
      `[C06] PCM: ${BITS_PER_SAMPLE}-bit LE, ${CHANNELS} canales, ` +
      `${SAMPLE_RATE} Hz`,
  );
  console.log(`[C06] Duración aproximada: ${durationSeconds.toFixed(2)} s`);
}

function verifyReverse(original, reversed) {
  assert.strictEqual(reversed.length, original.length);
  const first = original.subarray(0, FRAME_SIZE);
  const last = original.subarray(original.length - FRAME_SIZE);
  assert.deepStrictEqual(reversed.subarray(0, FRAME_SIZE), last);
  assert.deepStrictEqual(reversed.subarray(-FRAME_SIZE), first);
}

function runReverse(pcm) {
  const start = performance.now();
  const reversed = reversePcmFrames(pcm, FRAME_SIZE);
  const elapsedMs = performance.now() - start;
  verifyReverse(pcm, reversed);
  const timing = `[C06] REVERSE JavaScript: ${elapsedMs.toFixed(2)} ms`;
  console.log(timing);
  return reversed;
}

function writeOutput(reversed) {
  const outputDirectory = path.join(__dirname, 'output');
  fs.mkdirSync(outputDirectory, {recursive: true});
  const outputPath = path.join(outputDirectory, 'c06-reverse.wav');
  const wav = encodeWav(reversed, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
  fs.writeFileSync(outputPath, wav);
  console.log(`[C06] WAV generado: ${wav.length} bytes`);
  console.log(`[C06] Archivo reproducible: ${outputPath}`);
}

async function main() {
  console.log(`[C06] FFmpeg: ${ffmpegPath}`);
  const pcm = await loadPcm();
  logPcmSummary(pcm);
  const reversed = runReverse(pcm);
  console.log('[C06] Verificación estructural PASS: frames invertidos.');
  writeOutput(reversed);
  console.log('[C06] PASS: preview real -> decode PCM -> REVERSE -> WAV.');
}

main().catch((error) => {
  console.error(`[C06] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
