/**
 * @fileoverview Spike C07 de la interfaz común de transformaciones PCM.
 * Aplica NORMAL, REVERSE y LOW_PASS al mismo preview real decodificado.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {performance} from 'perf_hooks';
import {fileURLToPath} from 'url';
import {AudioMode} from '../../../server/audio/model/audio-mode.js';
import {
  transformPcm,
  DEFAULT_LOW_PASS_CUTOFF_HZ,
} from '../../../server/audio/transform/audio-transform.js';
import {
  decodeToPcm,
  downloadPreview,
  encodeWav,
  fetchFirstPreview,
} from './audio-spike-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_URL =
  'https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=5';
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const FRAME_SIZE = CHANNELS * (BITS_PER_SAMPLE / 8);

async function loadPcm() {
  const song = await fetchFirstPreview(SEARCH_URL, 'C07');
  const compressed = await downloadPreview(song.previewUrl, 'C07');
  const pcm = await decodeToPcm(compressed, SAMPLE_RATE, CHANNELS);
  console.log(`[C07] PCM generado: ${pcm.length} bytes`);
  return pcm;
}

function runTransform(pcm, mode, options = {}) {
  const start = performance.now();
  const result = transformPcm({
    pcm, mode, sampleRate: SAMPLE_RATE, channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE, options,
  });
  const elapsedMs = performance.now() - start;
  const timing = `${elapsedMs.toFixed(2)} ms`;
  console.log(`[C07] ${mode}: ${result.length} bytes, ${timing}`);
  return result;
}

function validateNormal(original, normal) {
  assert.notStrictEqual(normal, original);
  assert.deepStrictEqual(normal, original, 'NORMAL debe conservar muestras.');
}

function validateReverse(original, reversed) {
  assert.strictEqual(reversed.length, original.length);
  const first = original.subarray(0, FRAME_SIZE);
  const last = original.subarray(original.length - FRAME_SIZE);
  assert.deepStrictEqual(reversed.subarray(0, FRAME_SIZE), last);
  assert.deepStrictEqual(reversed.subarray(-FRAME_SIZE), first);
}

function validateLowPass(original, lowPass) {
  assert.strictEqual(lowPass.length, original.length);
  assert.notDeepStrictEqual(lowPass, original, 'LOW_PASS debe modificar PCM.');
}

function transformAll(pcm) {
  return {
    normal: runTransform(pcm, AudioMode.NORMAL),
    reversed: runTransform(pcm, AudioMode.REVERSE),
    lowPass: runTransform(pcm, AudioMode.LOW_PASS),
  };
}

function validateModes(original, outputs) {
  validateNormal(original, outputs.normal);
  validateReverse(original, outputs.reversed);
  validateLowPass(original, outputs.lowPass);
}

function writeWav(filename, pcm) {
  const outputDirectory = path.join(__dirname, 'output');
  fs.mkdirSync(outputDirectory, {recursive: true});
  const outputPath = path.join(outputDirectory, filename);
  const wav = encodeWav(pcm, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
  fs.writeFileSync(outputPath, wav);
  console.log(`[C07] WAV generado: ${outputPath}`);
}

function writeOutputs(outputs) {
  writeWav('c07-normal.wav', outputs.normal);
  writeWav('c07-reverse.wav', outputs.reversed);
  writeWav('c07-low-pass.wav', outputs.lowPass);
}

async function main() {
  console.log(`[C07] LOW_PASS cutoff: ${DEFAULT_LOW_PASS_CUTOFF_HZ} Hz`);
  const pcm = await loadPcm();
  const outputs = transformAll(pcm);
  validateModes(pcm, outputs);
  writeOutputs(outputs);
  console.log('[C07] PASS: NORMAL, REVERSE y LOW_PASS comparten interfaz.');
}

main().catch((error) => {
  console.error(`[C07] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
