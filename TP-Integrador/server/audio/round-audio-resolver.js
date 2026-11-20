import {AudioMode} from './model/audio-mode.js';

const SOURCE_PREPARED = 'PREPARED_ROUND';
const SOURCE_FALLBACK = 'FALLBACK_ORIGINAL';

/**
 * Resuelve el recurso de audio disponible al comenzar una ronda.
 */
class RoundAudioResolver {
  /**
   * @param {!Object} options Dependencias del resolver.
   * @param {!Object} options.preparedRoundBuffer Buffer de rondas READY.
   * @param {function(string): void=} options.log Logger opcional.
   */
  constructor({preparedRoundBuffer, log = console.log} = {}) {
    if (!preparedRoundBuffer ||
        typeof preparedRoundBuffer.consume !== 'function') {
      throw new TypeError('preparedRoundBuffer debe exponer consume().');
    }

    if (typeof log !== 'function') {
      throw new TypeError('log debe ser una función.');
    }

    this.preparedRoundBuffer = preparedRoundBuffer;
    this.log = log;
  }

  /**
   * @param {!Object} options Contexto de la ronda.
   * @return {!Object} Audio resuelto para la ronda.
   */
  resolve({gameId, roundId, playlistSong}) {
    const prepared = this.preparedRoundBuffer.consume(gameId, roundId);
    if (prepared) {
      return this.resolvePrepared(prepared);
    }
    return this.resolveFallback({gameId, roundId, playlistSong});
  }

  /**
   * @param {!Object} prepared PreparedRound consumido.
   * @return {!Object} Resultado preparado.
   * @private
   */
  resolvePrepared(prepared) {
    this.log(
        `[AUDIO_USE] gameId=${prepared.gameId} ` +
        `roundId=${prepared.roundId} mode=${prepared.mode} source=PREPARED`,
    );

    return {
      gameId: prepared.gameId,
      roundId: prepared.roundId,
      mode: prepared.mode,
      song: prepared.song,
      resource: prepared.resource,
      prepared: true,
      source: SOURCE_PREPARED,
    };
  }

  /**
   * @param {!Object} options Contexto sin PreparedRound READY.
   * @return {!Object} Resultado fallback.
   * @private
   */
  resolveFallback({gameId, roundId, playlistSong}) {
    this.validateFallbackSong(playlistSong);
    this.log(
        `[AUDIO_FALLBACK] gameId=${gameId} roundId=${roundId} ` +
        `mode=${AudioMode.NORMAL} reason=PREPARED_NOT_READY`,
    );

    return {
      gameId,
      roundId,
      mode: AudioMode.NORMAL,
      song: playlistSong,
      resource: playlistSong.preview,
      prepared: false,
      source: SOURCE_FALLBACK,
    };
  }

  /**
   * @param {*} playlistSong Canción original de V3.
   * @private
   */
  validateFallbackSong(playlistSong) {
    if (!playlistSong || typeof playlistSong.preview !== 'string' ||
        playlistSong.preview.trim() === '') {
      throw new TypeError('playlistSong.preview debe ser un string no vacío.');
    }
  }
}

export {RoundAudioResolver};
