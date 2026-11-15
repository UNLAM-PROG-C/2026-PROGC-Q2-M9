/**
 * @fileoverview Spike C06: preview real, FFmpeg, REVERSE y salida WAV.
 * Usa una inversión local de frames anterior a la interfaz común C07.
 * Mide una ejecución de la inversión, no un benchmark ni paralelismo.
 * La validación estructural solo compara longitud y frames extremos.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {performance} from 'perf_hooks';
import {fileURLToPath} from 'url';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEARCH_URL =
  'https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=5';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const FRAME_SIZE = CHANNELS * BYTES_PER_SAMPLE;

/**
 * Busca la primera canción con previewUrl y descarga sus bytes.
 * Rechaza respuestas HTTP fallidas o un preview vacío.
 * @return {!Promise<!Object>} Canción seleccionada y Buffer comprimido.
 */
async function fetchPreview() {
  const searchResponse = await fetch(SEARCH_URL, {
    headers: {
      'User-Agent': 'TriviaMusical-V4/1.0',
    },
  });

  if (!searchResponse.ok) {
    throw new Error(
        `iTunes Search API respondió HTTP ${searchResponse.status}`,
    );
  }

  const data = await searchResponse.json();
  const song = data.results.find((item) => item.previewUrl);

  if (!song) {
    throw new Error('No se encontró una canción con previewUrl.');
  }

  console.log(
      `[C06] Preview seleccionado: ${song.artistName} - ${song.trackName}`,
  );
  console.log(`[C06] previewUrl: ${song.previewUrl}`);

  const previewResponse = await fetch(song.previewUrl, {
    headers: {
      'User-Agent': 'TriviaMusical-V4/1.0',
    },
  });

  if (!previewResponse.ok) {
    throw new Error(
        `El preview respondió HTTP ${previewResponse.status}`,
    );
  }

  const compressed = Buffer.from(await previewResponse.arrayBuffer());

  if (compressed.length === 0) {
    throw new Error('El preview descargado está vacío.');
  }

  console.log(`[C06] Preview descargado: ${compressed.length} bytes`);

  return {song, compressed};
}

/**
 * Invoca FFmpeg en un proceso hijo a través de stdin/stdout y acumula PCM.
 * Rechaza errores, salida vacía o frames incompletos.
 * @param {!Buffer} compressed Bytes del preview.
 * @return {!Promise<!Buffer>} PCM s16le estéreo a 44100 Hz.
 */
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
            `${Buffer.concat(stderr).toString('utf8')}`,
            ),
        );
        return;
      }

      const pcm = Buffer.concat(stdout);

      if (pcm.length === 0) {
        reject(new Error('FFmpeg no produjo PCM.'));
        return;
      }

      if (pcm.length % FRAME_SIZE !== 0) {
        reject(
            new Error(
                `PCM inválido: ${pcm.length} bytes no son múltiplo ` +
            `del frame size ${FRAME_SIZE}.`,
            ),
        );
        return;
      }

      resolve(pcm);
    });

    ffmpeg.stdin.end(compressed);
  });
}

/**
 * Invierte el orden temporal de frames de cuatro bytes, sin alterar L/R.
 * @param {!Buffer} pcm PCM con frames completos.
 * @return {!Buffer} Nuevo buffer invertido.
 * @throws {TypeError} Si pcm no es Buffer.
 * @throws {Error} Si la longitud no es múltiplo del tamaño del frame.
 */
function reversePcmFrames(pcm) {
  if (!Buffer.isBuffer(pcm)) {
    throw new TypeError('reversePcmFrames requiere un Buffer.');
  }

  if (pcm.length % FRAME_SIZE !== 0) {
    throw new Error(
        `El PCM debe contener frames completos de ${FRAME_SIZE} bytes.`,
    );
  }

  const frameCount = pcm.length / FRAME_SIZE;
  const reversed = Buffer.allocUnsafe(pcm.length);

  for (let destinationFrame = 0; destinationFrame < frameCount;
    destinationFrame++) {
    const sourceFrame = frameCount - 1 - destinationFrame;

    pcm.copy(
        reversed,
        destinationFrame * FRAME_SIZE,
        sourceFrame * FRAME_SIZE,
        sourceFrame * FRAME_SIZE + FRAME_SIZE,
    );
  }

  return reversed;
}

/**
 * Compara longitud y primer/último frame; no examina todos los frames.
 * @param {!Buffer} original PCM de entrada.
 * @param {!Buffer} reversed PCM invertido.
 */
function verifyReverse(original, reversed) {
  assert.strictEqual(reversed.length, original.length);

  const firstOriginal = original.subarray(0, FRAME_SIZE);
  const lastOriginal = original.subarray(original.length - FRAME_SIZE);

  const firstReversed = reversed.subarray(0, FRAME_SIZE);
  const lastReversed = reversed.subarray(reversed.length - FRAME_SIZE);

  assert.deepStrictEqual(
      firstReversed,
      lastOriginal,
      'El primer frame invertido debe coincidir con el último frame original.',
  );

  assert.deepStrictEqual(
      lastReversed,
      firstOriginal,
      'El último frame invertido debe coincidir con el primer frame original.',
  );
}

/**
 * Antepone una cabecera RIFF/WAVE PCM de 44 bytes con formato fijo.
 * @param {!Buffer} pcm Muestras a codificar.
 * @return {!Buffer} Contenido del WAV.
 */
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

/**
 * Ejecuta la prueba de extremo a extremo y escribe c06-reverse.wav.
 * @return {!Promise<void>} Finaliza o rechaza si una etapa falla.
 */
async function main() {
  console.log(`[C06] FFmpeg: ${ffmpegPath}`);

  const {compressed} = await fetchPreview();
  const pcm = await decodeToPcm(compressed);

  const frameCount = pcm.length / FRAME_SIZE;
  const durationSeconds = frameCount / SAMPLE_RATE;

  console.log(`[C06] PCM generado: ${pcm.length} bytes`);
  console.log(
      `[C06] PCM: ${BITS_PER_SAMPLE}-bit LE, ${CHANNELS} canales, ` +
    `${SAMPLE_RATE} Hz`,
  );
  console.log(
      `[C06] Duración aproximada: ${durationSeconds.toFixed(2)} s`,
  );

  const start = performance.now();
  const reversedPcm = reversePcmFrames(pcm);
  const end = performance.now();

  verifyReverse(pcm, reversedPcm);

  console.log(
      `[C06] REVERSE JavaScript completado en ${(end - start).toFixed(2)} ms`,
  );
  console.log(
      '[C06] Verificación estructural PASS: se invirtieron frames completos, ' +
    'preservando pares L/R.',
  );

  const wav = encodeWav(reversedPcm);

  const outputDirectory = path.join(__dirname, 'output');
  fs.mkdirSync(outputDirectory, {recursive: true});

  const outputPath = path.join(outputDirectory, 'c06-reverse.wav');
  fs.writeFileSync(outputPath, wav);

  console.log(`[C06] WAV generado: ${wav.length} bytes`);
  console.log(`[C06] Archivo reproducible: ${outputPath}`);
  console.log(
      '[C06] PASS: preview real -> decode PCM -> REVERSE JavaScript -> WAV.',
  );
}

main().catch((error) => {
  console.error(`[C06] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
