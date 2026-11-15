import {AudioMode, isValidAudioMode} from '../model/audio-mode.js';

/**
 * Frecuencia de corte predeterminada para LOW_PASS, en Hz.
 * @const {number}
 */
const DEFAULT_LOW_PASS_CUTOFF_HZ = 1200;

/**
 * Valida el contenedor de muestras y los parámetros PCM del MVP V4.
 * Exige frames completos, con dos bytes por muestra y un sample por canal.
 * No analiza cabeceras, metadatos ni detecta el formato real del Buffer.
 * @param {!Object} config Configuración de entrada.
 * @param {!Buffer} config.pcm Buffer no vacío de PCM signed 16-bit LE.
 * @param {string} config.mode Modo de transformación admitido.
 * @param {number} config.sampleRate Frecuencia de muestreo, entero > 0.
 * @param {number} config.channels Cantidad de canales, entero > 0.
 * @param {number} config.bitsPerSample Debe ser 16.
 * @return {{bytesPerSample: number, frameSize: number}} Tamaños en bytes.
 * @throws {TypeError} Si falla alguna validación.
 */
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
        'El MVP V4 soporta únicamente PCM signed 16-bit little-endian.',
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = channels * bytesPerSample;

  if (pcm.length % frameSize !== 0) {
    throw new TypeError(
        `pcm debe contener frames completos de ${frameSize} bytes.`,
    );
  }

  return {
    bytesPerSample,
    frameSize,
  };
}

/**
 * Invierte el orden temporal de los frames completos, no sus bytes.
 * Conserva el orden de canales dentro de cada frame (p. ej., L/R en estéreo).
 * Presupone un Buffer y un tamaño de frame validados por transformPcm.
 * @param {!Buffer} pcm Muestras PCM entrelazadas por canal.
 * @param {number} frameSize Cantidad de bytes por frame.
 * @return {!Buffer} Nuevo Buffer de la misma longitud, sin mutar la entrada.
 */
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
        sourceFrame * frameSize + frameSize,
    );
  }

  return output;
}

/**
 * Redondea y limita una muestra al rango entero con signo de 16 bits.
 * @param {number} value Valor calculado por el filtro (finito).
 * @return {number} Muestra entera entre -32768 y 32767.
 */
function clampInt16(value) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

/**
 * Aplica un filtro pasa bajos recursivo de primer orden por canal.
 * Usa alpha = dt / (RC + dt), con dt = 1 / sampleRate y
 * RC = 1 / (2 * PI * cutoffHz). Inicializa cada canal con su primera muestra.
 * Cada salida redondeada y limitada se utiliza como estado del siguiente
 * frame. No mezcla canales, no cambia la duración ni modifica la entrada.
 * Presupone una configuración PCM validada por transformPcm.
 * @param {!Object} config Configuración del filtro.
 * @param {!Buffer} config.pcm Muestras signed 16-bit LE.
 * @param {number} config.sampleRate Frecuencia de muestreo en Hz.
 * @param {number} config.channels Cantidad de canales entrelazados.
 * @param {number} config.cutoffHz Corte en Hz, finito, > 0 y < Nyquist.
 * @return {!Buffer} PCM filtrado, de la misma longitud que la entrada.
 * @throws {TypeError} Si cutoffHz no está en el intervalo permitido.
 */
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
        `cutoffHz debe ser menor que Nyquist (${nyquistHz} Hz).`,
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

/**
 * Transforma un Buffer de PCM signed 16-bit little-endian (C07).
 * NORMAL copia las muestras; REVERSE invierte frames completos; LOW_PASS
 * aplica un filtro por canal. Devuelve un Buffer nuevo en los tres modos.
 * Es una operación síncrona de CPU, sin I/O ni creación de hilos. Si se
 * invoca en el event loop del servidor, ocupa ese hilo hasta retornar.
 * No decodifica archivos comprimidos ni genera contenedores WAV; tampoco
 * modifica el Buffer de entrada o sus parámetros de formato.
 * @param {!Object} config Configuración de transformación.
 * @param {!Buffer} config.pcm Muestras PCM sin cabecera, con frames completos.
 * @param {string} config.mode Modo de transformación admitido.
 * @param {number=} config.sampleRate Frecuencia en Hz; por defecto, 44100.
 * @param {number=} config.channels Canales; por defecto, 2 (estéreo).
 * @param {number=} config.bitsPerSample Profundidad; por defecto, 16.
 * @param {!Object=} config.options Opciones DSP; por defecto, objeto vacío.
 * @param {?number=} config.options.cutoffHz Corte LOW_PASS en Hz; si es nulo
 *     o no está definido se usa DEFAULT_LOW_PASS_CUTOFF_HZ. No se utiliza
 *     en NORMAL ni REVERSE. Debe ser finito, positivo y menor que Nyquist.
 * @return {!Buffer} Nuevo Buffer PCM de la misma longitud que la entrada.
 * @throws {TypeError} Si la configuración PCM o el corte son inválidos.
 */
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

export {
  transformPcm,
  DEFAULT_LOW_PASS_CUTOFF_HZ,
};
