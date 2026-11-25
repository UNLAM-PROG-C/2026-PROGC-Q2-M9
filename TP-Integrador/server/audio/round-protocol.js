import {AudioMode, isValidAudioMode} from './model/audio-mode.js';
import {buildRoundAudioUrl} from './round-audio-registry.js';

const MESSAGE_TYPE_NEW_SONG = 'NEW_SONG';
const MINIMUM_ID = 1;

/**
 * Valida que el valor sea un entero positivo.
 * @param {*} value Valor a validar.
 * @param {string} name Nombre del campo.
 */
function assertPositiveInt(value, name) {
  if (!Number.isInteger(value) || value < MINIMUM_ID) {
    throw new TypeError(`${name} debe ser un entero >= ${MINIMUM_ID}.`);
  }
}

/**
 * Resuelve la URL reproducible para player.src segun modo y recurso (D08).
 * @param {!Object} options Datos de la ronda resuelta.
 * @param {number} options.gameId Generacion de partida.
 * @param {number} options.roundId Numero de ronda.
 * @param {string=} options.resource URL original o recurso preparado.
 * @param {boolean=} options.servedByServer True si se sirve via HTTP local.
 * @return {string} URL lista para asignar a player.src.
 */
function resolveClientAudioUrl({
  gameId,
  roundId,
  resource = '',
  servedByServer = false,
}) {
  if (servedByServer) {
    return buildRoundAudioUrl(gameId, roundId);
  }
  if (typeof resource !== 'string' || resource.trim() === '') {
    throw new TypeError('resource debe ser una URL no vacia.');
  }
  return resource;
}

/**
 * Construye el payload WebSocket NEW_SONG extendido para V4 (C20 / D08).
 * Mantiene los campos V3 (type, song, round, maxRounds, hint) y agrega
 * gameId, roundId, mode, prepared y audioUrl.
 * @param {!Object} options Datos de la ronda activa.
 * @param {number} options.gameId Generacion de partida.
 * @param {number} options.roundId Numero de ronda (base 1).
 * @param {number} options.maxRounds Total de rondas de la partida.
 * @param {string=} options.mode Modo de audio (default NORMAL).
 * @param {string=} options.resource URL original (preview) o recurso.
 * @param {boolean=} options.servedByServer Si el audio se sirve por HTTP.
 * @param {string=} options.hint Texto de pista para el cliente.
a * @param {string=} options.artist Artista de la canción de la ronda.
 * @return {!Object} Mensaje serializable listo para broadcast WebSocket.
 */
/**
 * Valida identificadores y modo del payload de ronda.
 * @param {!Object} options Opciones normalizadas del payload.
 */
function validatePayloadOptions({gameId, roundId, maxRounds, mode}) {
  assertPositiveInt(gameId, 'gameId');
  assertPositiveInt(roundId, 'roundId');
  assertPositiveInt(maxRounds, 'maxRounds');
  if (!isValidAudioMode(mode)) {
    throw new TypeError(`mode invalido: ${mode}`);
  }
}

/**
 * Construye el payload WebSocket NEW_SONG extendido para V4 (C20 / D08).
 * @param {!Object} options Datos de la ronda activa.
 * @return {!Object} Mensaje serializable listo para broadcast WebSocket.
 */
function buildNewSongPayload(options) {
  const mode = options.mode ?? AudioMode.NORMAL;
  const normalized = {...options, mode};
  validatePayloadOptions(normalized);
  const {gameId, roundId, maxRounds} = normalized;
  const audioUrl = resolveClientAudioUrl(normalized);
  const hint = normalized.hint ??
      `¡Ronda ${roundId} de ${maxRounds}! Adivina la canción`;
  return {
    type: MESSAGE_TYPE_NEW_SONG, gameId, roundId,
    round: roundId, maxRounds, mode,
    prepared: Boolean(normalized.prepared),
    song: audioUrl, audioUrl, hint, artist: normalized.artist,
  };
}

export {
  MESSAGE_TYPE_NEW_SONG,
  buildNewSongPayload,
  resolveClientAudioUrl,
};
