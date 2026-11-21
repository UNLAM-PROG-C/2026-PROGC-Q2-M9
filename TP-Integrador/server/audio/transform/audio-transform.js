import {AudioMode, isValidAudioMode} from '../model/audio-mode.js';

const DEFAULT_LOW_PASS_CUTOFF_HZ = 100;
const BITS_PER_BYTE = 8;
const PCM_BITS = 16;
const INT16_MIN = -32768;
const INT16_MAX = 32767;

function assertBuffer(pcm) {
  if (!Buffer.isBuffer(pcm)) throw new TypeError('pcm debe ser un Buffer.');
  if (pcm.length === 0) throw new TypeError('pcm no puede estar vacío.');
}

function assertMode(mode) {
  if (!isValidAudioMode(mode)) throw new TypeError(`mode inválido: ${mode}`);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} debe ser un entero > 0.`);
  }
}

function validatePcmConfig(config) {
  assertBuffer(config.pcm);
  assertMode(config.mode);
  assertPositiveInteger(config.sampleRate, 'sampleRate');
  assertPositiveInteger(config.channels, 'channels');
  assertPcmBits(config.bitsPerSample);
  return buildPcmSizes(config);
}

function assertPcmBits(bitsPerSample) {
  if (bitsPerSample !== PCM_BITS) {
    throw new TypeError(
        'El MVP V4 soporta únicamente PCM signed 16-bit little-endian.',
    );
  }
}

function buildPcmSizes({pcm, channels, bitsPerSample}) {
  const bytesPerSample = bitsPerSample / BITS_PER_BYTE;
  const frameSize = channels * bytesPerSample;
  if (pcm.length % frameSize !== 0) {
    throw new TypeError(
        `pcm debe contener frames completos de ${frameSize} bytes.`,
    );
  }
  return {bytesPerSample, frameSize};
}

function reversePcmFrames(pcm, frameSize) {
  const frameCount = pcm.length / frameSize;
  const output = Buffer.allocUnsafe(pcm.length);
  for (let destination = 0; destination < frameCount; destination++) {
    copyReverseFrame(pcm, output, destination, frameCount, frameSize);
  }
  return output;
}

function copyReverseFrame(pcm, output, destination, frameCount, frameSize) {
  const source = frameCount - 1 - destination;
  pcm.copy(
      output,
      destination * frameSize,
      source * frameSize,
      source * frameSize + frameSize,
  );
}

function clampInt16(value) {
  return Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(value)));
}

function assertCutoff(cutoffHz, sampleRate) {
  if (typeof cutoffHz !== 'number' || !Number.isFinite(cutoffHz) ||
      cutoffHz <= 0) {
    throw new TypeError('cutoffHz debe ser un número > 0.');
  }
  const nyquistHz = sampleRate / 2;
  if (cutoffHz >= nyquistHz) {
    throw new TypeError(
        `cutoffHz debe ser menor que Nyquist (${nyquistHz} Hz).`,
    );
  }
}

function buildLowPassState(config) {
  const bytesPerSample = PCM_BITS / BITS_PER_BYTE;
  const frameSize = config.channels * bytesPerSample;
  const frameCount = config.pcm.length / frameSize;
  const output = Buffer.allocUnsafe(config.pcm.length);
  const previous = new Array(config.channels);
  const dt = 1 / config.sampleRate;
  const rc = 1 / (2 * Math.PI * config.cutoffHz);
  return {bytesPerSample, frameSize, frameCount, output, previous,
    alpha: dt / (rc + dt)};
}

function initializeLowPassChannels(config, state) {
  for (let channel = 0; channel < config.channels; channel++) {
    const offset = channel * state.bytesPerSample;
    const firstSample = config.pcm.readInt16LE(offset);
    state.previous[channel] = firstSample;
    state.output.writeInt16LE(firstSample, offset);
  }
}

function filterFrame(config, state, frame) {
  const frameOffset = frame * state.frameSize;
  for (let channel = 0; channel < config.channels; channel++) {
    filterSample(config, state, frameOffset, channel);
  }
}

function filterSample(config, state, frameOffset, channel) {
  const offset = frameOffset + channel * state.bytesPerSample;
  const input = config.pcm.readInt16LE(offset);
  const previous = state.previous[channel];
  const filtered = previous + state.alpha * (input - previous);
  const output = clampInt16(filtered);
  state.previous[channel] = output;
  state.output.writeInt16LE(output, offset);
}

function lowPassPcm(config) {
  assertCutoff(config.cutoffHz, config.sampleRate);
  const state = buildLowPassState(config);
  initializeLowPassChannels(config, state);
  for (let frame = 1; frame < state.frameCount; frame++) {
    filterFrame(config, state, frame);
  }
  return state.output;
}

function transformLowPass(config) {
  const cutoffHz = config.options.cutoffHz ?? DEFAULT_LOW_PASS_CUTOFF_HZ;
  return lowPassPcm({
    pcm: config.pcm,
    sampleRate: config.sampleRate,
    channels: config.channels,
    cutoffHz,
  });
}

function transformByMode(config, frameSize) {
  if (config.mode === AudioMode.NORMAL) return Buffer.from(config.pcm);
  if (config.mode === AudioMode.REVERSE) {
    return reversePcmFrames(config.pcm, frameSize);
  }
  if (config.mode === AudioMode.LOW_PASS) return transformLowPass(config);
  throw new TypeError(`mode inválido: ${config.mode}`);
}

function transformPcm(options) {
  const config = {
    sampleRate: 44100, channels: 2, bitsPerSample: PCM_BITS,
    options: {}, ...options,
  };
  const {frameSize} = validatePcmConfig(config);
  return transformByMode(config, frameSize);
}

export {transformPcm, DEFAULT_LOW_PASS_CUTOFF_HZ};
