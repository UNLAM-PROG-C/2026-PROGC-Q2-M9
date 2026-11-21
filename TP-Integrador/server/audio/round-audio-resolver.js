import {AudioMode} from './model/audio-mode.js';

const SOURCE_PREPARED = 'PREPARED_ROUND';
const SOURCE_FALLBACK = 'FALLBACK_ORIGINAL';

/** Resuelve el recurso de audio disponible al comenzar una ronda. */
class RoundAudioResolver {
  constructor({preparedRoundBuffer, log = console.log} = {}) {
    if (!preparedRoundBuffer ||
        typeof preparedRoundBuffer.consume !== 'function') {
      throw new TypeError('preparedRoundBuffer debe exponer consume().');
    }
    if (typeof log !== 'function') throw new TypeError('log debe ser función.');
    this.preparedRoundBuffer = preparedRoundBuffer;
    this.log = log;
  }

  resolve({gameId, roundId, playlistSong}) {
    const prepared = this.preparedRoundBuffer.consume(gameId, roundId);
    if (prepared) return this.resolvePrepared(prepared);
    return this.resolveFallback({gameId, roundId, playlistSong});
  }

  resolvePrepared(prepared) {
    this.logPrepared(prepared);
    return {
      gameId: prepared.gameId, roundId: prepared.roundId,
      mode: prepared.mode, song: prepared.song,
      resource: prepared.resource, prepared: true,
      source: SOURCE_PREPARED,
    };
  }

  logPrepared(prepared) {
    this.log(
        `[AUDIO_USE] gameId=${prepared.gameId} ` +
        `roundId=${prepared.roundId} mode=${prepared.mode} source=PREPARED`,
    );
  }

  resolveFallback({gameId, roundId, playlistSong}) {
    this.validateFallbackSong(playlistSong);
    this.logFallback(gameId, roundId);
    return {
      gameId, roundId, mode: AudioMode.NORMAL, song: playlistSong,
      resource: playlistSong.preview, prepared: false,
      source: SOURCE_FALLBACK,
    };
  }

  logFallback(gameId, roundId) {
    this.log(
        `[AUDIO_FALLBACK] gameId=${gameId} roundId=${roundId} ` +
        `mode=${AudioMode.NORMAL} reason=PREPARED_NOT_READY`,
    );
  }

  validateFallbackSong(playlistSong) {
    if (!playlistSong || typeof playlistSong.preview !== 'string' ||
        playlistSong.preview.trim() === '') {
      throw new TypeError('playlistSong.preview debe ser un string no vacío.');
    }
  }
}

export {RoundAudioResolver};
