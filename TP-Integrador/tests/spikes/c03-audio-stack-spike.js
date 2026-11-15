const {spawn} = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const SEARCH_URL =
  'https://itunes.apple.com/search?term=daft%20punk&entity=song&limit=5';

async function fetchPreviewUrl() {
  const response = await fetch(SEARCH_URL, {
    headers: {
      'User-Agent': 'TriviaMusical-V4/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`iTunes Search API respondió HTTP ${response.status}`);
  }

  const data = await response.json();
  const song = data.results.find((item) => item.previewUrl);

  if (!song) {
    throw new Error('La búsqueda no devolvió ninguna canción con previewUrl.');
  }

  console.log(
    `[C03] Preview seleccionado: ${song.artistName} - ${song.trackName}`
  );
  console.log(`[C03] previewUrl: ${song.previewUrl}`);

  return song.previewUrl;
}

async function downloadPreview(previewUrl) {
  const response = await fetch(previewUrl, {
    headers: {
      'User-Agent': 'TriviaMusical-V4/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Preview respondió HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length === 0) {
    throw new Error('El preview descargado está vacío.');
  }

  console.log(`[C03] Preview descargado: ${bytes.length} bytes`);

  return bytes;
}

function decodeToPcm(inputBytes) {
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
      '2',
      '-ar',
      '44100',
      'pipe:1',
    ];

    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks = [];
    const errors = [];

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => errors.push(chunk));

    ffmpeg.on('error', reject);

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `FFmpeg terminó con código ${code}: ` +
            `${Buffer.concat(errors).toString('utf8')}`
          )
        );
        return;
      }

      const pcm = Buffer.concat(chunks);

      if (pcm.length === 0) {
        reject(new Error('FFmpeg no produjo muestras PCM.'));
        return;
      }

      resolve(pcm);
    });

    ffmpeg.stdin.end(inputBytes);
  });
}

async function main() {
  console.log(`[C03] FFmpeg: ${ffmpegPath}`);

  const previewUrl = await fetchPreviewUrl();
  const compressedAudio = await downloadPreview(previewUrl);
  const pcm = await decodeToPcm(compressedAudio);

  const bytesPerSample = 2;
  const channels = 2;
  const sampleRate = 44100;
  const frames = pcm.length / (bytesPerSample * channels);
  const durationSeconds = frames / sampleRate;

  console.log(`[C03] PCM generado: ${pcm.length} bytes`);
  console.log(
    `[C03] Formato PCM: signed 16-bit little-endian, ${channels} canales, ` +
    `${sampleRate} Hz`
  );
  console.log(
    `[C03] Duración PCM aproximada: ${durationSeconds.toFixed(2)} s`
  );
  console.log(
    '[C03] PASS: preview real -> fetch Node -> FFmpeg -> PCM.'
  );
}

main().catch((error) => {
  console.error(`[C03] FAIL: ${error.message}`);
  process.exitCode = 1;
});
