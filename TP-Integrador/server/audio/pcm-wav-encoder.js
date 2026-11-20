const WAV_HEADER_SIZE = 44;
const PCM_FORMAT = 1;
const PCM_FORMAT_CHUNK_SIZE = 16;

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
  if (resource.bitsPerSample % 8 !== 0) {
    throw new TypeError('bitsPerSample debe ser múltiplo de 8.');
  }
}

function writeContainerHeader(header, pcmLength) {
  header.write('RIFF', 0);
  header.writeUInt32LE(WAV_HEADER_SIZE - 8 + pcmLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(PCM_FORMAT_CHUNK_SIZE, 16);
}

function writeFormatHeader(header, resource) {
  const bytesPerSample = resource.bitsPerSample / 8;
  const blockAlign = resource.channels * bytesPerSample;
  header.writeUInt16LE(PCM_FORMAT, 20);
  header.writeUInt16LE(resource.channels, 22);
  header.writeUInt32LE(resource.sampleRate, 24);
  header.writeUInt32LE(resource.sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(resource.bitsPerSample, 34);
}

function writeDataHeader(header, pcmLength) {
  header.write('data', 36);
  header.writeUInt32LE(pcmLength, 40);
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
