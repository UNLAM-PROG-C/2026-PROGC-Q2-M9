/**
 * Modos de transformación admitidos por el MVP V4 (D02).
 * El objeto está congelado. Elegir un modo no ejecuta la transformación.
 * @enum {string}
 */
const AudioMode = Object.freeze({
  /**
   * Audio sin transformación de muestras.
   */
  NORMAL: 'NORMAL',
  /**
   * Inversión temporal del orden de los frames.
   */
  REVERSE: 'REVERSE',
  /**
   * Atenuación de frecuencias altas mediante un filtro pasa bajos.
   */
  LOW_PASS: 'LOW_PASS',
});

/**
 * Comprueba pertenencia exacta al conjunto de modos, sin convertir valores.
 * @param {*} mode Valor a verificar.
 * @return {boolean} True si coincide con uno de los modos admitidos.
 */
function isValidAudioMode(mode) {
  return Object.values(AudioMode).includes(mode);
}

module.exports = {
  AudioMode,
  isValidAudioMode,
};
