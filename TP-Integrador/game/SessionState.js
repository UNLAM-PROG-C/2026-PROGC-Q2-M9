const SessionState = Object.freeze({
    LOBBY: "LOBBY",
    ROUND_ACTIVE: "ROUND_ACTIVE",
    BETWEEN_ROUNDS: "BETWEEN_ROUNDS",
    GAME_OVER: "GAME_OVER"
});

function isSessionState(value) {
    return Object.values(SessionState).includes(value);
}

module.exports = {
    SessionState,
    isSessionState
};