/**
 * @fileoverview Spike C03 de viabilidad del stack de audio.
 * Comprueba preview real de iTunes y decodificación FFmpeg a PCM.
 */
import {
  decodeToPcm,
  downloadPreview,
  fetchFirstPreview,
  ffmpegPath,
} from './audio/audio-spike-helpers.js';

const SEARCH_URL =
  'https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=5';
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

function logPcmSummary(pcm) {
  const frameSize = BYTES_PER_SAMPLE * CHANNELS;
  const durationSeconds = pcm.length / frameSize / SAMPLE_RATE;
  console.log(`[C03] PCM generado: ${pcm.length} bytes`);
  console.log(
      `[C03] Formato PCM: signed ${BITS_PER_SAMPLE}-bit little-endian, ` +
      `${CHANNELS} canales, ${SAMPLE_RATE} Hz`,
  );
  console.log(`[C03] Duración PCM aproximada: ${durationSeconds.toFixed(2)} s`);
}

async function main() {
  console.log(`[C03] FFmpeg: ${ffmpegPath}`);
  const song = await fetchFirstPreview(SEARCH_URL, 'C03');
  const compressed = await downloadPreview(song.previewUrl, 'C03');
  const pcm = await decodeToPcm(compressed, SAMPLE_RATE, CHANNELS);
  logPcmSummary(pcm);
  console.log('[C03] PASS: preview real -> fetch Node -> FFmpeg -> PCM.');
}

main().catch((error) => {
  console.error(`[C03] FAIL: ${error.message}`);
  process.exitCode = 1;
});
