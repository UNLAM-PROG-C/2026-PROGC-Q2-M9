import assert from 'assert';
import {test} from 'node:test';

import {AudioMode} from '../server/audio/model/audio-mode.js';
import {transformPcm} from '../server/audio/transform/audio-transform.js';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BITS_PER_BYTE = 8;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / BITS_PER_BYTE;
const FRAME_SIZE = CHANNELS * BYTES_PER_SAMPLE;

const STEREO_FRAMES = [[100, 500], [200, 600], [300, 700]];
const REVERSED_STEREO_FRAMES = [[300, 700], [200, 600], [100, 500]];
const RIGHT_CHANNEL_LEVEL = 1000;
const STEP_LEVEL = 10000;
const STEP_FRAMES = [
  [0, RIGHT_CHANNEL_LEVEL],
  [STEP_LEVEL, RIGHT_CHANNEL_LEVEL],
  [STEP_LEVEL, RIGHT_CHANNEL_LEVEL],
  [STEP_LEVEL, RIGHT_CHANNEL_LEVEL],
];
const IMPULSE_FRAMES = [[0, 0], [STEP_LEVEL, STEP_LEVEL], [0, 0]];
const RECOVERY_FRAMES = [[42, -42]];
const CHANGED_SAMPLE = -1;
const LOW_CUTOFF_HZ = 500;
const HIGH_CUTOFF_HZ = 5000;
const UNSUPPORTED_BITS_PER_SAMPLE = 8;
const NEGATIVE_CUTOFF_HZ = -1;

function pcmFromStereoFrames(frames) {
  const pcm = Buffer.alloc(frames.length * FRAME_SIZE);

  frames.forEach(([left, right], index) => {
    pcm.writeInt16LE(left, index * FRAME_SIZE);
    pcm.writeInt16LE(right, index * FRAME_SIZE + BYTES_PER_SAMPLE);
  });
  return pcm;
}

function readStereoFrames(pcm) {
  const frames = [];
  for (let offset = 0; offset < pcm.length; offset += FRAME_SIZE) {
    frames.push([
      pcm.readInt16LE(offset),
      pcm.readInt16LE(offset + BYTES_PER_SAMPLE),
    ]);
  }
  return frames;
}

function transform(pcm, mode, overrides = {}) {
  return transformPcm({
    pcm,
    mode,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    ...overrides,
  });
}

test('NORMAL copia las muestras sin modificar la entrada', () => {
  const input = pcmFromStereoFrames(STEREO_FRAMES);
  const snapshot = Buffer.from(input);
  const output = transform(input, AudioMode.NORMAL);

  assert.ok(Buffer.isBuffer(output));
  assert.notStrictEqual(output, input);
  assert.deepStrictEqual(output, snapshot);
  output.writeInt16LE(CHANGED_SAMPLE, 0);
  assert.deepStrictEqual(input, snapshot);
});

test('REVERSE invierte frames completos y preserva los canales', () => {
  const input = pcmFromStereoFrames(STEREO_FRAMES);
  const snapshot = Buffer.from(input);
  const output = transform(input, AudioMode.REVERSE);

  assert.ok(Buffer.isBuffer(output));
  assert.notStrictEqual(output, input);
  assert.deepStrictEqual(readStereoFrames(output), REVERSED_STEREO_FRAMES);
  assert.deepStrictEqual(input, snapshot);
});

test('LOW_PASS suaviza la señal y no mezcla canales', () => {
  const input = pcmFromStereoFrames(STEP_FRAMES);
  const snapshot = Buffer.from(input);
  const output = transform(input, AudioMode.LOW_PASS);
  const frames = readStereoFrames(output);

  assert.ok(Buffer.isBuffer(output));
  assert.notStrictEqual(output, input);
  assert.strictEqual(output.length, input.length);
  assert.notDeepStrictEqual(output, input);
  assert.deepStrictEqual(input, snapshot);
  assert.deepStrictEqual(
      frames.map(([, right]) => right),
      STEP_FRAMES.map(([, right]) => right),
  );
  const [[firstLeft], [secondLeft], [thirdLeft]] = frames;
  assert.strictEqual(firstLeft, 0);
  assert.ok(secondLeft > 0 && secondLeft < STEP_LEVEL);
  assert.ok(thirdLeft > secondLeft && thirdLeft < STEP_LEVEL);
});

test('LOW_PASS admite una frecuencia de corte configurable', () => {
  const input = pcmFromStereoFrames(IMPULSE_FRAMES);
  const low = transform(input, AudioMode.LOW_PASS, {
    options: {cutoffHz: LOW_CUTOFF_HZ},
  });
  const high = transform(input, AudioMode.LOW_PASS, {
    options: {cutoffHz: HIGH_CUTOFF_HZ},
  });

  const [, [lowSample]] = readStereoFrames(low);
  const [, [highSample]] = readStereoFrames(high);
  assert.ok(highSample > lowSample);
});

test('rechaza PCM que no es Buffer', () => {
  assert.throws(
      () => transform(new Uint8Array(FRAME_SIZE), AudioMode.NORMAL), TypeError,
  );
});

test('rechaza PCM vacío', () => {
  assert.throws(() => transform(Buffer.alloc(0), AudioMode.NORMAL), TypeError);
});

test('rechaza un modo inválido', () => {
  assert.throws(() => transform(Buffer.alloc(FRAME_SIZE), 'ECHO'), TypeError);
});

test('rechaza sampleRate inválido', () => {
  assert.throws(
      () => transform(Buffer.alloc(FRAME_SIZE), AudioMode.NORMAL, {
        sampleRate: 0,
      }),
      TypeError,
  );
});

test('rechaza channels inválido', () => {
  assert.throws(() => transform(
      Buffer.alloc(FRAME_SIZE),
      AudioMode.NORMAL,
      {channels: 0},
  ),
  TypeError,
  );
});

test('rechaza una profundidad distinta de 16 bits', () => {
  assert.throws(
      () => transform(Buffer.alloc(FRAME_SIZE), AudioMode.NORMAL, {
        bitsPerSample: UNSUPPORTED_BITS_PER_SAMPLE,
      }),
      TypeError,
  );
});

test('rechaza frames incompletos', () => {
  assert.throws(
      () => transform(Buffer.alloc(FRAME_SIZE + 1), AudioMode.NORMAL),
      TypeError,
  );
});

test('LOW_PASS rechaza cortes no positivos o no finitos', () => {
  for (const cutoffHz of [0, NEGATIVE_CUTOFF_HZ, NaN, Infinity]) {
    assert.throws(
        () => transform(Buffer.alloc(FRAME_SIZE), AudioMode.LOW_PASS, {
          options: {cutoffHz},
        }),
        TypeError,
    );
  }
});

test('LOW_PASS rechaza cortes iguales o mayores a Nyquist', () => {
  const nyquistHz = SAMPLE_RATE / 2;
  for (const cutoffHz of [nyquistHz, SAMPLE_RATE]) {
    assert.throws(
        () => transform(Buffer.alloc(FRAME_SIZE), AudioMode.LOW_PASS, {
          options: {cutoffHz},
        }),
        TypeError,
    );
  }
});

test('el llamador puede continuar después de un error controlado', () => {
  assert.throws(() => transform(Buffer.alloc(0), AudioMode.NORMAL), TypeError);
  const input = pcmFromStereoFrames(RECOVERY_FRAMES);
  assert.deepStrictEqual(transform(input, AudioMode.NORMAL), input);
});

