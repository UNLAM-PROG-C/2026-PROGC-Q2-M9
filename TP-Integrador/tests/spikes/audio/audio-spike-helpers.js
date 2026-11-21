import {spawn} from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const USER_AGENT = 'TriviaMusical-V4/1.0';
const WAV_HEADER_SIZE = 44;
const RIFF_SIZE_OFFSET = 36;

function requestOptions() {
  return {headers: {'User-Agent': USER_AGENT}};
}

async function fetchFirstPreview(searchUrl, label) {
  const response = await fetch(searchUrl, requestOptions());
  assertHttpOk(response, 'iTunes Search API');
  const data = await response.json();
  const song = data.results.find((item) => item.previewUrl);
  if (!song) throw new Error('No se encontró una canción con previewUrl.');
  logSelectedPreview(label, song);
  return song;
}

function assertHttpOk(response, source) {
  if (!response.ok) {
    throw new Error(`${source} respondió HTTP ${response.status}`);
  }
}

function logSelectedPreview(label, song) {
  console.log(
      `[${label}] Preview seleccionado: ${song.artistName} - ${song.trackName}`,
  );
  console.log(`[${label}] previewUrl: ${song.previewUrl}`);
}

async function downloadPreview(previewUrl, label) {
  const response = await fetch(previewUrl, requestOptions());
  assertHttpOk(response, 'El preview');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('El preview descargado está vacío.');
  console.log(`[${label}] Preview descargado: ${bytes.length} bytes`);
  return bytes;
}

function buildFfmpegArgs(sampleRate, channels) {
  return [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-f', 's16le', '-acodec', 'pcm_s16le',
    '-ac', String(channels), '-ar', String(sampleRate), 'pipe:1',
  ];
}

function decodeToPcm(input, sampleRate, channels, frameSize = null) {
  return new Promise((resolve, reject) => {
    runFfmpegDecoder(input, sampleRate, channels, frameSize, resolve, reject);
  });
}

function runFfmpegDecoder(input, rate, channels, frameSize, resolve, reject) {
  const ffmpeg = spawn(ffmpegPath, buildFfmpegArgs(rate, channels), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  ffmpeg.stdout.on('data', (chunk) => stdout.push(chunk));
  ffmpeg.stderr.on('data', (chunk) => stderr.push(chunk));
  ffmpeg.on('error', reject);
  ffmpeg.on('close', (code) =>
    finishDecode(code, stdout, stderr, frameSize, resolve, reject));
  ffmpeg.stdin.end(input);
}

function finishDecode(code, stdout, stderr, frameSize, resolve, reject) {
  if (code !== 0) return reject(createFfmpegError(code, stderr));
  const pcm = Buffer.concat(stdout);
  if (pcm.length === 0) return reject(new Error('FFmpeg no produjo PCM.'));
  if (frameSize && pcm.length % frameSize !== 0) {
    return reject(new Error(
        `PCM inválido: ${pcm.length} bytes no son múltiplo de ${frameSize}.`,
    ));
  }
  resolve(pcm);
}

function createFfmpegError(code, stderr) {
  return new Error(
      `FFmpeg terminó con código ${code}: ` +
      Buffer.concat(stderr).toString('utf8'),
  );
}

function reversePcmFrames(pcm, frameSize) {
  if (!Buffer.isBuffer(pcm)) throw new TypeError('Se requiere un Buffer.');
  if (pcm.length % frameSize !== 0) throw new Error('Frames PCM incompletos.');
  const frameCount = pcm.length / frameSize;
  const reversed = Buffer.allocUnsafe(pcm.length);
  for (let destination = 0; destination < frameCount; destination++) {
    copyReverseFrame(pcm, reversed, destination, frameCount, frameSize);
  }
  return reversed;
}

function copyReverseFrame(pcm, output, destination, frameCount, frameSize) {
  const source = frameCount - 1 - destination;
  pcm.copy(
      output, destination * frameSize, source * frameSize,
      source * frameSize + frameSize,
  );
}

function encodeWav(pcm, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  const bytesPerSample = bitsPerSample / 8;
  writeRiffHeader(header, pcm.length);
  writeFormatHeader(
      header, sampleRate, channels, bitsPerSample, bytesPerSample,
  );
  writeDataHeader(header, pcm.length);
  return Buffer.concat([header, pcm]);
}

function writeRiffHeader(header, pcmLength) {
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(RIFF_SIZE_OFFSET + pcmLength, 4);
  header.write('WAVE', 8, 4, 'ascii');
}

function writeFormatHeader(header, rate, channels, bits, bytesPerSample) {
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bits, 34);
}

function writeDataHeader(header, pcmLength) {
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(pcmLength, 40);
}

export {
  decodeToPcm,
  downloadPreview,
  encodeWav,
  fetchFirstPreview,
  ffmpegPath,
  reversePcmFrames,
};
