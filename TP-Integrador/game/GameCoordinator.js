class GameCoordinator {
    constructor({
        playersById,
        normalizeText,
        getRoundContext,
        buildWinnerView,
        sendToPlayer,
        broadcast,
        broadcastLeaderboard,
        finishGame,
        scheduleNextRound,
        log = console.log
    }) {
        this.playersById = playersById;
        this.normalizeText = normalizeText;
        this.getRoundContext = getRoundContext;
        this.buildWinnerView = buildWinnerView;
        this.sendToPlayer = sendToPlayer;
        this.broadcast = broadcast;
        this.broadcastLeaderboard = broadcastLeaderboard;
        this.finishGame = finishGame;
        this.scheduleNextRound = scheduleNextRound;
        this.log = log;

        // ALT-01 / C7: invariante explícita de un único ganador por ronda.
        this.activeRoundId = null;
        this.roundWinnerPlayerId = null;
    }

    beginRound(roundId) {
        this.activeRoundId = roundId;
        this.roundWinnerPlayerId = null;
        this.log(`[GC] Ronda ${roundId} abierta para adjudicación. winner=null.`);
    }

    resetGameState() {
        this.activeRoundId = null;
        this.roundWinnerPlayerId = null;
        this.log('[GC] Estado de juego reiniciado. activeRoundId=null, winner=null.');
    }

    processAnswerEvent(answerEvent) {
        const context = this.getRoundContext();
        const sequenceLabel = String(answerEvent.sequence).padStart(6, '0');

        // Esta guarda es deliberadamente anterior a gameStarted: si una respuesta
        // quedó en cola después del primer acierto, el rechazo se explica por la
        // invariante de ganador único y no solo por el cierre genérico de la ronda.
        if (answerEvent.roundId === this.activeRoundId && this.roundWinnerPlayerId !== null) {
            this.log(`[GCx] ANSWER #${sequenceLabel} descartado: ronda ${answerEvent.roundId} ya adjudicada a ${this.roundWinnerPlayerId}.`);
            return;
        }

        if (!context.gameStarted || context.gameFinished) {
            this.log(`[GCx] ANSWER #${sequenceLabel} descartado: partida/ronda no activa.`);
            return;
        }

        if (answerEvent.roundId !== context.currentRound + 1) {
            this.log(`[GCx] ANSWER #${sequenceLabel} descartado: ronda ${answerEvent.roundId} ya no es la ronda activa ${context.currentRound + 1}.`);
            return;
        }

        const player = this.playersById.get(answerEvent.playerId);
        if (!player) {
            this.log(`[GCx] ANSWER #${sequenceLabel} descartado: playerId ${answerEvent.playerId} inexistente.`);
            return;
        }

        const correctSong = context.playlist[context.currentSongIndex];
        const userAnswer = this.normalizeText(answerEvent.answer);
        const correctNormalized = correctSong ? this.normalizeText(correctSong.title) : '';

        this.log(`[GC] ANSWER #${sequenceLabel} adjudicando para [${player.playerId} | ${player.displayName}] en ronda ${answerEvent.roundId}.`);

        if (correctSong && userAnswer === correctNormalized) {
            this.handleCorrectAnswer(answerEvent, player, correctSong, context);
        } else {
            this.handleWrongAnswer(answerEvent, player);
        }
    }

    handleCorrectAnswer(answerEvent, player, correctSong, context) {
        const sequenceLabel = String(answerEvent.sequence).padStart(6, '0');

        // Segunda defensa de la misma invariante dentro del punto de adjudicación.
        if (this.roundWinnerPlayerId !== null) {
            this.log(`[GCx] ANSWER #${sequenceLabel} descartado: ya existe ganador ${this.roundWinnerPlayerId} para la ronda ${answerEvent.roundId}.`);
            return;
        }

        // El coordinador fija el ganador antes de modificar score o emitir eventos.
        // Como existe un único consumidor, esta asignación define el punto de
        // adjudicación autoritativo de la ronda.
        this.roundWinnerPlayerId = player.playerId;
        this.log(`[GC✓] Ronda ${answerEvent.roundId} adjudicada a [${player.playerId} | ${player.displayName}] por ANSWER #${sequenceLabel}.`);

        const pointsWon = Math.max(10, 100 - (player.attempts * 5));
        player.score += pointsWon;

        this.log(`[✓] [${player.playerId} | ${player.displayName}] acertó la canción "${correctSong.title}" y sumó ${pointsWon} pts. Total: ${player.score}.`);

        this.broadcastLeaderboard();

        this.sendToPlayer(player.playerId, {
            type: 'CORRECT_ANSWER',
            guess: answerEvent.answer,
            points: pointsWon,
            songTitle: correctSong.title
        });

        this.broadcast({
            type: 'ROUND_WINNER',
            winner: this.buildWinnerView(player),
            songTitle: correctSong.title,
            points: pointsWon,
            delay: context.delayNextRound
        });

        const isLastRound = context.currentRound + 1 >= context.maxRounds ||
            context.currentRound + 1 >= context.playlist.length;

        if (isLastRound) {
            this.finishGame();
        } else {
            this.scheduleNextRound(context.delayNextRound);
        }
    }

    handleWrongAnswer(answerEvent, player) {
        player.attempts += 1;
        const potentialPoints = Math.max(10, 100 - ((player.attempts - 1) * 5));

        this.log(`[✗] [${player.playerId} | ${player.displayName}] hizo un intento erróneo: "${answerEvent.answer}". Intentos: ${player.attempts}.`);

        this.sendToPlayer(player.playerId, {
            type: 'WRONG_ANSWER',
            guess: answerEvent.answer,
            potentialPoints
        });
    }
}

module.exports = GameCoordinator;
