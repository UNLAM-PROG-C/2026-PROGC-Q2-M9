const AUDIO_ROUTE_PREFIX = '/api/audio/rounds';
const DEFAULT_CONTENT_TYPE = 'audio/wav';
const CACHE_CONTROL_VALUE = 'no-store';
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const MINIMUM_ID = 1;

/**
 * Valida que un identificador sea un entero positivo.
 * @param {*} value Valor a validar.
 * @param {string} fieldName Nombre del campo para el error.
 * @return {number} Entero validado.
 */
function parsePositiveId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MINIMUM_ID) {
    throw new TypeError(`${fieldName} debe ser un entero >= ${MINIMUM_ID}.`);
  }
  return parsed;
}

/**
 * Construye la clave unica de almacenamiento por generacion y ronda.
 * @param {number} gameId Generacion de partida.
 * @param {number} roundId Numero de ronda.
 * @return {string} Clave compuesta gameId:roundId.
 */
function buildAudioKey(gameId, roundId) {
  return `${gameId}:${roundId}`;
}

/**
 * Construye la URL HTTP reproducible para una ronda servida por el servidor.
 * @param {number} gameId Generacion de partida.
 * @param {number} roundId Numero de ronda.
 * @return {string} Ruta relativa HTTP compatible con player.src.
 */
function buildRoundAudioUrl(gameId, roundId) {
  const validGameId = parsePositiveId(gameId, 'gameId');
  const validRoundId = parsePositiveId(roundId, 'roundId');
  return `${AUDIO_ROUTE_PREFIX}/${validGameId}/${validRoundId}`;
}

/**
 * Registro en memoria de recursos de audio preparados para servir por HTTP.
 */
class RoundAudioRegistry {
  constructor() {
    this.entries = new Map();
  }

  /**
   * Registra un buffer de audio para una ronda y devuelve su URL HTTP.
   * @param {!Object} options Datos del recurso a exponer.
   * @param {number} options.gameId Generacion de partida.
   * @param {number} options.roundId Numero de ronda.
   * @param {!Buffer} options.buffer Bytes del audio (ej. WAV).
   * @param {string=} options.contentType Tipo MIME del recurso.
   * @return {string} URL HTTP donde queda expuesto el recurso.
   */
  register({gameId, roundId, buffer, contentType = DEFAULT_CONTENT_TYPE}) {
    const validGameId = parsePositiveId(gameId, 'gameId');
    const validRoundId = parsePositiveId(roundId, 'roundId');
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('buffer debe ser una instancia de Buffer.');
    }
    const key = buildAudioKey(validGameId, validRoundId);
    this.entries.set(key, {buffer, contentType});
    return buildRoundAudioUrl(validGameId, validRoundId);
  }

  /**
   * Obtiene el recurso registrado o null si no existe.
   * @param {number} gameId Generacion de partida.
   * @param {number} roundId Numero de ronda.
   * @return {?Object} Entrada con buffer y contentType, o null.
   */
  get(gameId, roundId) {
    const validGameId = parsePositiveId(gameId, 'gameId');
    const validRoundId = parsePositiveId(roundId, 'roundId');
    return this.entries.get(buildAudioKey(validGameId, validRoundId)) ?? null;
  }

  /**
   * Elimina todos los recursos registrados.
   */
  clear() {
    this.entries.clear();
  }
}

/**
 * Envía el buffer de audio con sus headers HTTP correspondientes.
 * @param {!Object} res Response de Express.
 * @param {!Object} entry Entrada con buffer y contentType.
 */
function sendAudioEntry(res, entry) {
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Cache-Control', CACHE_CONTROL_VALUE);
  res.status(HTTP_OK).send(entry.buffer);
}

/**
 * Crea el handler Express para GET /api/audio/rounds/:gameId/:roundId.
 * @param {!RoundAudioRegistry} registry Registro de recursos de audio.
 * @return {!Function} Middleware de Express.
 */
function createRoundAudioHandler(registry) {
  return (req, res) => {
    const entry = resolveRequestEntry(registry, req.params);
    if (entry === 'INVALID') {
      res.status(HTTP_BAD_REQUEST).json({error: 'INVALID_ROUND_ID'});
      return;
    }
    if (entry === null) {
      res.status(HTTP_NOT_FOUND).json({error: 'AUDIO_NOT_FOUND'});
      return;
    }
    sendAudioEntry(res, entry);
  };
}

/**
 * Resuelve los parametros de ruta contra el registro sin lanzar excepciones.
 * @param {!RoundAudioRegistry} registry Registro de recursos.
 * @param {!Object} params Parametros de Express.
 * @return {?Object|string} Entrada encontrada, null o 'INVALID'.
 */
function resolveRequestEntry(registry, params) {
  try {
    return registry.get(params.gameId, params.roundId);
  } catch {
    return 'INVALID';
  }
}

export {
  AUDIO_ROUTE_PREFIX,
  DEFAULT_CONTENT_TYPE,
  RoundAudioRegistry,
  buildRoundAudioUrl,
  createRoundAudioHandler,
};
