const assert = require("assert");

const AudioJob = require("../server/audio/model/AudioJob");
const AudioResult = require("../server/audio/model/AudioResult");
const PreparedRound = require("../server/audio/model/PreparedRound");
const { AudioMode } = require("../server/audio/model/AudioMode");

function expectTypeError(fn, message) {
    assert.throws(fn, TypeError, message);
}

function testAudioJob() {
    const source = { previewUrl: "https://example.test/song.m4a" };

    const job = new AudioJob({
        jobId: "job-1",
        gameId: 1,
        roundId: 2,
        mode: AudioMode.REVERSE,
        source,
    });

    assert.strictEqual(job.jobId, "job-1");
    assert.strictEqual(job.gameId, 1);
    assert.strictEqual(job.roundId, 2);
    assert.strictEqual(job.mode, AudioMode.REVERSE);
    assert.strictEqual(job.source, source);

    expectTypeError(
        () =>
            new AudioJob({
                jobId: "",
                gameId: 1,
                roundId: 1,
                mode: AudioMode.NORMAL,
                source,
            }),
        "jobId vacío debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioJob({
                jobId: "job-2",
                gameId: 0,
                roundId: 1,
                mode: AudioMode.NORMAL,
                source,
            }),
        "gameId inválido debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioJob({
                jobId: "job-3",
                gameId: 1,
                roundId: 0,
                mode: AudioMode.NORMAL,
                source,
            }),
        "roundId inválido debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioJob({
                jobId: "job-4",
                gameId: 1,
                roundId: 1,
                mode: "UNKNOWN",
                source,
            }),
        "mode desconocido debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioJob({
                jobId: "job-5",
                gameId: 1,
                roundId: 1,
                mode: AudioMode.NORMAL,
                source: null,
            }),
        "source ausente debe rechazarse"
    );
}

function testAudioResult() {
    const success = new AudioResult({
        jobId: "job-10",
        gameId: 2,
        roundId: 3,
        mode: AudioMode.LOW_PASS,
        ok: true,
        resource: { path: "/audio/generated/g2-r3.wav" },
    });

    assert.strictEqual(success.ok, true);
    assert.deepStrictEqual(success.resource, {
        path: "/audio/generated/g2-r3.wav",
    });
    assert.strictEqual(success.error, null);

    const failure = new AudioResult({
        jobId: "job-11",
        gameId: 2,
        roundId: 4,
        mode: AudioMode.REVERSE,
        ok: false,
        error: "No se pudo decodificar el audio.",
    });

    assert.strictEqual(failure.ok, false);
    assert.strictEqual(failure.resource, null);
    assert.strictEqual(failure.error, "No se pudo decodificar el audio.");

    expectTypeError(
        () =>
            new AudioResult({
                jobId: "job-12",
                gameId: 2,
                roundId: 5,
                mode: AudioMode.REVERSE,
                ok: true,
            }),
        "resultado exitoso sin resource debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioResult({
                jobId: "job-13",
                gameId: 2,
                roundId: 6,
                mode: AudioMode.REVERSE,
                ok: true,
                resource: "audio.wav",
                error: "error contradictorio",
            }),
        "éxito con error debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioResult({
                jobId: "job-14",
                gameId: 2,
                roundId: 7,
                mode: AudioMode.REVERSE,
                ok: false,
                resource: "audio.wav",
                error: "falló",
            }),
        "fallo con resource debe rechazarse"
    );

    expectTypeError(
        () =>
            new AudioResult({
                jobId: "job-15",
                gameId: 2,
                roundId: 8,
                mode: AudioMode.REVERSE,
                ok: false,
            }),
        "fallo sin error debe rechazarse"
    );
}

function testPreparedRound() {
    const song = {
        title: "Canción de prueba",
        artist: "Artista",
    };

    const round = new PreparedRound({
        gameId: 3,
        roundId: 1,
        mode: AudioMode.NORMAL,
        song,
        resource: "https://example.test/original.m4a",
    });

    assert.strictEqual(round.gameId, 3);
    assert.strictEqual(round.roundId, 1);
    assert.strictEqual(round.mode, AudioMode.NORMAL);
    assert.strictEqual(round.song, song);
    assert.strictEqual(
        round.resource,
        "https://example.test/original.m4a"
    );

    expectTypeError(
        () =>
            new PreparedRound({
                gameId: 3,
                roundId: 1,
                mode: "UNKNOWN",
                song,
                resource: "audio.wav",
            }),
        "mode desconocido debe rechazarse"
    );

    expectTypeError(
        () =>
            new PreparedRound({
                gameId: 3,
                roundId: 1,
                mode: AudioMode.NORMAL,
                song: null,
                resource: "audio.wav",
            }),
        "song ausente debe rechazarse"
    );

    expectTypeError(
        () =>
            new PreparedRound({
                gameId: 3,
                roundId: 1,
                mode: AudioMode.NORMAL,
                song,
                resource: null,
            }),
        "resource ausente debe rechazarse"
    );
}

function run() {
    testAudioJob();
    testAudioResult();
    testPreparedRound();

    console.log(
        "[C05] PASS: contratos AudioJob, AudioResult y PreparedRound validados."
    );
}

run();
