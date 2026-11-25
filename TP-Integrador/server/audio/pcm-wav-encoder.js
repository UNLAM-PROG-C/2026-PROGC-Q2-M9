const WAV_HEADER_SIZE = 44;
const PCM_FORMAT = 1;
const PCM_FORMAT_CHUNK_SIZE = 16;
const BITS_PER_BYTE = 8;
const RIFF_SIZE_OFFSET = 4;
const RIFF_OVERHEAD_BYTES = 8;
const WAVE_ID_OFFSET = 8;
const FORMAT_ID_OFFSET = 12;
const FORMAT_SIZE_OFFSET = 16;
const AUDIO_FORMAT_OFFSET = 20;
const CHANNELS_OFFSET = 22;
const SAMPLE_RATE_OFFSET = 24;
const BYTE_RATE_OFFSET = 28;
const BLOCK_ALIGN_OFFSET = 32;
const BITS_PER_SAMPLE_OFFSET = 34;
const DATA_ID_OFFSET = 36;
const DATA_SIZE_OFFSET = 40;

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} debe ser un entero positivo.`);
  }
}

function validatePcmResource(resource) {
  if (!resource || resource.kind !== 'PCM_BUFFER') {
    throw new TypeError('Se requiere resource.kind=PCM_BUFFER.');
  }
  if (!Buffer.isBuffer(resource.pcm)) {
    throw new TypeError('resource.pcm debe ser Buffer.');
  }
  assertPositiveInteger(resource.sampleRate, 'sampleRate');
  assertPositiveInteger(resource.channels, 'channels');
  assertPositiveInteger(resource.bitsPerSample, 'bitsPerSample');
  if (resource.bitsPerSample % BITS_PER_BYTE !== 0) {
    throw new TypeError('bitsPerSample debe ser múltiplo de 8.');
  }
}

function writeContainerHeader(header, pcmLength) {
  header.write('RIFF', 0);
  header.writeUInt32LE(
      WAV_HEADER_SIZE - RIFF_OVERHEAD_BYTES + pcmLength, RIFF_SIZE_OFFSET,
  );
  header.write('WAVE', WAVE_ID_OFFSET);
  header.write('fmt ', FORMAT_ID_OFFSET);
  header.writeUInt32LE(PCM_FORMAT_CHUNK_SIZE, FORMAT_SIZE_OFFSET);
}

function writeFormatHeader(header, resource) {
  const bytesPerSample = resource.bitsPerSample / BITS_PER_BYTE;
  const blockAlign = resource.channels * bytesPerSample;
  header.writeUInt16LE(PCM_FORMAT, AUDIO_FORMAT_OFFSET);
  header.writeUInt16LE(resource.channels, CHANNELS_OFFSET);
  header.writeUInt32LE(resource.sampleRate, SAMPLE_RATE_OFFSET);
  header.writeUInt32LE(resource.sampleRate * blockAlign, BYTE_RATE_OFFSET);
  header.writeUInt16LE(blockAlign, BLOCK_ALIGN_OFFSET);
  header.writeUInt16LE(resource.bitsPerSample, BITS_PER_SAMPLE_OFFSET);
}

function writeDataHeader(header, pcmLength) {
  header.write('data', DATA_ID_OFFSET);
  header.writeUInt32LE(pcmLength, DATA_SIZE_OFFSET);
}

function encodePcmToWav(resource) {
  validatePcmResource(resource);
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  writeContainerHeader(header, resource.pcm.length);
  writeFormatHeader(header, resource);
  writeDataHeader(header, resource.pcm.length);
  return Buffer.concat([header, resource.pcm]);
}

export {encodePcmToWav};
