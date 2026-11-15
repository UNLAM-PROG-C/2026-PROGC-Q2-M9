const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {performance} = require('perf_hooks');
const ffmpegPath = require('ffmpeg-static');

const {AudioMode} = require('../../../server/audio/model/AudioMode');
const {
  transformPcm,
  DEFAULT_LOW_PASS_CUTOFF_HZ,
} = require('../../../server/audio/transform/AudioTransform');

const SEARCH_URL =
  'https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=5';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const FRAME_SIZE = CHANNELS * BYTES_PER_SAMPLE;

async function fetchPreview() {
  const searchResponse = await fetch(SEARCH_URL, {
    headers: {
      'User-Agent': 'TriviaMusical-V4/1.0',
    },
  });

  if (!searchResponse.ok) {
    throw new Error(
      `iTunes Search API respondió HTTP ${searchResponse.status}`
    );
  }

  const data = await searchResponse.json();
  const song = data.results.find((item) => item.previewUrl);

  if (!song) {
    throw new Error('No se encontró una canción con previewUrl.');
  }

  console.log(
    `[C07] Preview seleccionado: ${song.artistName} - ${song.trackName}`
  );

  const previewResponse = await fetch(song.previewUrl, {
    headers: {
      'User-Agent': 'TriviaMusical-V4/1.0',
    },
  });

  if (!previewResponse.ok) {
    throw new Error(
      `El preview respondió HTTP ${previewResponse.status}`
    );
  }

  const compressed = Buffer.from(await previewResponse.arrayBuffer());

  if (compressed.length === 0) {
    throw new Error('El preview descargado está vacío.');
  }

  console.log(`[C07] Preview descargado: ${compressed.length} bytes`);

  return compressed;
}

function decodeToPcm(compressed) {
  return new Promise((resolve, reject) => {
    const args = [
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
    ];

    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout = [];
    const stderr = [];

    ffmpeg.stdout.on('data', (chunk) => stdout.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => stderr.push(chunk));
    ffmpeg.on('error', reject);

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `FFmpeg terminó con código ${code}: ` +
            `${Buffer.concat(stderr).toString('utf8')}`
          )
        );
        return;
      }

      const pcm = Buffer.concat(stdout);

      if (pcm.length === 0) {
        reject(new Error('FFmpeg no produjo PCM.'));
        return;
      }

      resolve(pcm);
    });

    ffmpeg.stdin.end(compressed);
  });
}

function encodeWav(pcm) {
  const header = Buffer.alloc(44);

  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;

  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 4, 'ascii');

  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function runTransform(pcm, mode, options = {}) {
  const start = performance.now();

  const result = transformPcm({
    pcm,
    mode,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    options,
  });

  const elapsedMs = performance.now() - start;

  console.log(
    `[C07] ${mode}: ${result.length} bytes, ${elapsedMs.toFixed(2)} ms`
  );

  return result;
}

function validateModes(original, normal, reversed, lowPass) {
  assert.notStrictEqual(
    normal,
    original,
    'NORMAL debe devolver un Buffer independiente.'
  );

  assert.deepStrictEqual(
    normal,
    original,
    'NORMAL debe conservar las muestras.'
  );

  assert.strictEqual(reversed.length, original.length);
  assert.strictEqual(lowPass.length, original.length);

  const firstOriginal = original.subarray(0, FRAME_SIZE);
  const lastOriginal = original.subarray(original.length - FRAME_SIZE);

  assert.deepStrictEqual(
    reversed.subarray(0, FRAME_SIZE),
    lastOriginal,
    'REVERSE debe comenzar con el último frame original.'
  );

  assert.deepStrictEqual(
    reversed.subarray(reversed.length - FRAME_SIZE),
    firstOriginal,
    'REVERSE debe terminar con el primer frame original.'
  );

  assert.notDeepStrictEqual(
    lowPass,
    original,
    'LOW_PASS debe modificar las muestras.'
  );
}

async function main() {
  console.log(
    `[C07] LOW_PASS cutoff por defecto: ${DEFAULT_LOW_PASS_CUTOFF_HZ} Hz`
  );

  const compressed = await fetchPreview();
  const pcm = await decodeToPcm(compressed);

  console.log(`[C07] PCM generado: ${pcm.length} bytes`);

  const normal = runTransform(pcm, AudioMode.NORMAL);
  const reversed = runTransform(pcm, AudioMode.REVERSE);
  const lowPass = runTransform(pcm, AudioMode.LOW_PASS);

  validateModes(pcm, normal, reversed, lowPass);

  const outputDirectory = path.join(__dirname, 'output');
  fs.mkdirSync(outputDirectory, {recursive: true});

  const outputs = [
    ['c07-normal.wav', normal],
    ['c07-reverse.wav', reversed],
    ['c07-low-pass.wav', lowPass],
  ];

  for (const [filename, transformedPcm] of outputs) {
    const outputPath = path.join(outputDirectory, filename);
    fs.writeFileSync(outputPath, encodeWav(transformedPcm));
    console.log(`[C07] WAV generado: ${outputPath}`);
  }

  console.log(
    '[C07] PASS: NORMAL, REVERSE y LOW_PASS comparten la misma interfaz pura.'
  );
}

main().catch((error) => {
  console.error(`[C07] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
