const AudioMode = Object.freeze({
    NORMAL: "NORMAL",
    REVERSE: "REVERSE",
    LOW_PASS: "LOW_PASS",
});

function isValidAudioMode(mode) {
    return Object.values(AudioMode).includes(mode);
}

module.exports = {
    AudioMode,
    isValidAudioMode,
};
