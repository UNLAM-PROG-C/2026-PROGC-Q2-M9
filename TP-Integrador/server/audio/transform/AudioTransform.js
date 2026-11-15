const {AudioMode, isValidAudioMode} = require('../model/AudioMode');

const DEFAULT_LOW_PASS_CUTOFF_HZ = 1200;

function validatePcmConfig({
  pcm,
  mode,
  sampleRate,
  channels,
  bitsPerSample,
}) {
  if (!Buffer.isBuffer(pcm)) {
    throw new TypeError('pcm debe ser un Buffer.');
  }

  if (pcm.length === 0) {
    throw new TypeError('pcm no puede estar vacío.');
  }

  if (!isValidAudioMode(mode)) {
    throw new TypeError(`mode inválido: ${mode}`);
  }

  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new TypeError('sampleRate debe ser un entero > 0.');
  }

  if (!Number.isInteger(channels) || channels <= 0) {
    throw new TypeError('channels debe ser un entero > 0.');
  }

  if (bitsPerSample !== 16) {
    throw new TypeError(
      'El MVP V4 soporta únicamente PCM signed 16-bit little-endian.'
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = channels * bytesPerSample;

  if (pcm.length % frameSize !== 0) {
    throw new TypeError(
      `pcm debe contener frames completos de ${frameSize} bytes.`
    );
  }

  return {
    bytesPerSample,
    frameSize,
  };
}

function reversePcmFrames(pcm, frameSize) {
  const frameCount = pcm.length / frameSize;
  const output = Buffer.allocUnsafe(pcm.length);

  for (
    let destinationFrame = 0;
    destinationFrame < frameCount;
    destinationFrame++
  ) {
    const sourceFrame = frameCount - 1 - destinationFrame;

    pcm.copy(
      output,
      destinationFrame * frameSize,
      sourceFrame * frameSize,
      sourceFrame * frameSize + frameSize
    );
  }

  return output;
}

function clampInt16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function lowPassPcm({
  pcm,
  sampleRate,
  channels,
  cutoffHz,
}) {
  if (
    typeof cutoffHz !== 'number' ||
        !Number.isFinite(cutoffHz) ||
        cutoffHz <= 0
  ) {
    throw new TypeError('cutoffHz debe ser un número > 0.');
  }

  const nyquistHz = sampleRate / 2;

  if (cutoffHz >= nyquistHz) {
    throw new TypeError(
      `cutoffHz debe ser menor que Nyquist (${nyquistHz} Hz).`
    );
  }

  const bytesPerSample = 2;
  const frameSize = channels * bytesPerSample;
  const frameCount = pcm.length / frameSize;

  const output = Buffer.allocUnsafe(pcm.length);
  const previous = new Array(channels);

  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);

  for (let channel = 0; channel < channels; channel++) {
    const offset = channel * bytesPerSample;
    const firstSample = pcm.readInt16LE(offset);

    previous[channel] = firstSample;
    output.writeInt16LE(firstSample, offset);
  }

  for (let frame = 1; frame < frameCount; frame++) {
    const frameOffset = frame * frameSize;

    for (let channel = 0; channel < channels; channel++) {
      const offset = frameOffset + channel * bytesPerSample;
      const inputSample = pcm.readInt16LE(offset);

      const filtered =
        previous[channel] +
                alpha * (inputSample - previous[channel]);

      const outputSample = clampInt16(filtered);

      previous[channel] = outputSample;
      output.writeInt16LE(outputSample, offset);
    }
  }

  return output;
}

function transformPcm({
  pcm,
  mode,
  sampleRate = 44100,
  channels = 2,
  bitsPerSample = 16,
  options = {},
}) {
  const {frameSize} = validatePcmConfig({
    pcm,
    mode,
    sampleRate,
    channels,
    bitsPerSample,
  });

  switch (mode) {
    case AudioMode.NORMAL:
      return Buffer.from(pcm);

    case AudioMode.REVERSE:
      return reversePcmFrames(pcm, frameSize);

    case AudioMode.LOW_PASS:
      return lowPassPcm({
        pcm,
        sampleRate,
        channels,
        cutoffHz:
                    options.cutoffHz ?? DEFAULT_LOW_PASS_CUTOFF_HZ,
      });

    default:
      throw new TypeError(`mode inválido: ${mode}`);
  }
}

module.exports = {
  transformPcm,
  DEFAULT_LOW_PASS_CUTOFF_HZ,
};
