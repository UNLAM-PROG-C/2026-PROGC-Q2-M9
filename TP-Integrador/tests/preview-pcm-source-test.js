import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadPreviewPcmSource,
} from '../server/audio/preview-pcm-source.js';

const WAV_BASE64 =
  'UklGRjQAAABXQVZFZm10IBAAAAABAAIARKwAABCxAgAEABAA' +
  'ZGF0YRAAAABkAMgALAGQAfQBWAK8AiAD';

const WAV_URL = `data:audio/wav;base64,${WAV_BASE64}`;

test('C19A-I01: preview produce PCM_BUFFER productivo', async () => {
  const source = await loadPreviewPcmSource(WAV_URL);

  assert.equal(source.kind, 'PCM_BUFFER');
  assert.equal(Buffer.isBuffer(source.pcm), true);
  assert.equal(source.pcm.length, 16);
  assert.equal(source.sampleRate, 44100);
  assert.equal(source.channels, 2);
  assert.equal(source.bitsPerSample, 16);
});

test('C19A-I02: preview vacío es rechazado', async () => {
  await assert.rejects(
      () => loadPreviewPcmSource(''),
      TypeError,
  );
});
