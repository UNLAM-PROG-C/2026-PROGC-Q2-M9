/**
 * @fileoverview Convierte previews comprimidos a fuentes PCM para audio V4.
 */

import {spawn} from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const USER_AGENT = 'TriviaMusical-V4/1.0';

const FFMPEG_ARGS = Object.freeze([
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  'pipe:0',
  '-f',
  's16le',
  '-acodec',
  'pcm_s16le',
  '-ac',
  String(CHANNELS),
  '-ar',
  String(SAMPLE_RATE),
  'pipe:1',
]);

function validatePreviewUrl(previewUrl) {
  if (typeof previewUrl !== 'string' || previewUrl.length === 0) {
    throw new TypeError('previewUrl debe ser un string no vacío.');
  }
}

async function downloadPreview(previewUrl) {
  validatePreviewUrl(previewUrl);
  const response = await fetch(previewUrl, {
    headers: {'User-Agent': USER_AGENT},
  });
  if (!response.ok) {
    throw new Error(`Preview respondió HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('El preview descargado está vacío.');
  }
  return bytes;
}

function createDecoder() {
  return spawn(ffmpegPath, FFMPEG_ARGS, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function settleDecoder(code, stdout, stderr, resolve, reject) {
  if (code !== 0) {
    const detail = Buffer.concat(stderr).toString('utf8');
    reject(new Error(`FFmpeg terminó con código ${code}: ${detail}`));
    return;
  }
  const pcm = Buffer.concat(stdout);
  if (pcm.length === 0) {
    reject(new Error('FFmpeg no produjo muestras PCM.'));
    return;
  }
  resolve(pcm);
}

function decodeToPcm(inputBytes) {
  return new Promise((resolve, reject) => {
    const decoder = createDecoder();
    const stdout = [];
    const stderr = [];
    decoder.stdout.on('data', (chunk) => stdout.push(chunk));
    decoder.stderr.on('data', (chunk) => stderr.push(chunk));
    decoder.on('error', reject);
    decoder.on('close', (code) => {
      settleDecoder(code, stdout, stderr, resolve, reject);
    });
    decoder.stdin.end(inputBytes);
  });
}

function createPcmSource(pcm) {
  return {
    kind: 'PCM_BUFFER',
    pcm,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    options: {},
  };
}

async function loadPreviewPcmSource(previewUrl) {
  const compressed = await downloadPreview(previewUrl);
  const pcm = await decodeToPcm(compressed);
  return createPcmSource(pcm);
}

export {loadPreviewPcmSource};
