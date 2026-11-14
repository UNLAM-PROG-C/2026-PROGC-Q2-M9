const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const ROUNDS = Math.max(1, Number.parseInt(process.env.ALT02_ROUNDS || '20', 10));
const CLIENT_COUNT = Math.max(2, Number.parseInt(process.env.ALT02_CLIENTS || '2', 10));
const PORT = Number.parseInt(process.env.ALT02_PORT || '3199', 10);
const ANSWER = process.env.ALT02_ANSWER || 'ALT02 TEST SONG';
const START_DELAY_MS = Number.parseInt(process.env.ALT02_START_DELAY_MS || '1200', 10);
const TIMEOUT_MS = Number.parseInt(process.env.ALT02_TIMEOUT_MS || '30000', 10);
const QUEUE_DRAIN_DELAY_MS = Number.parseInt(process.env.ALT02_QUEUE_DRAIN_DELAY_MS || '10', 10);
const SETTLE_MS = Math.max(0, Number.parseInt(process.env.ALT02_SETTLE_MS || '100', 10));
const EXPECTED_WINNER = process.env.ALT02_EXPECTED_WINNER || null;
const LEAD_CLIENT_NUMBER = process.env.ALT02_LEAD_CLIENT ? Number.parseInt(process.env.ALT02_LEAD_CLIENT, 10) : null;
const offsetsText = process.env.ALT02_OFFSETS || Array(CLIENT_COUNT).fill('0').join(',');
const OFFSETS = offsetsText.split(',').map(v => Number.parseInt(v, 10));

if (OFFSETS.length !== CLIENT_COUNT || OFFSETS.some(Number.isNaN)) {
    throw new Error(`ALT02_OFFSETS debe contener ${CLIENT_COUNT} enteros, uno por cliente. Ejemplo: ${Array(CLIENT_COUNT).fill(0).join(',')}`);
}

if (LEAD_CLIENT_NUMBER !== null && (Number.isNaN(LEAD_CLIENT_NUMBER) || LEAD_CLIENT_NUMBER < 1 || LEAD_CLIENT_NUMBER > CLIENT_COUNT)) {
    throw new Error(`ALT02_LEAD_CLIENT debe estar entre 1 y ${CLIENT_COUNT}.`);
}

const projectRoot = path.resolve(__dirname, '..');
const serverPath = path.join(projectRoot, 'server.js');
const answerReceipts = [];
const queueEnqueues = [];
const adjudications = [];
const rejections = [];
let serverExited = false;
let completed = false;
let finalizeScheduled = false;

const server = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: {
        ...process.env,
        TRIVIA_TEST_MODE: '1',
        TRIVIA_TEST_ROUNDS: String(ROUNDS),
        TRIVIA_TEST_START_DELAY_MS: String(START_DELAY_MS),
        TRIVIA_TEST_SONG_TITLE: ANSWER,
        TRIVIA_TEST_QUEUE_DRAIN_DELAY_MS: String(QUEUE_DRAIN_DELAY_MS),
        PORT: String(PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
});

function consumeServerText(text) {
    process.stdout.write(text);
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        let match = line.match(/ANSWER #(\d+) recibido de \[[^|]+\| ([^\]]+)\] en ronda (\d+)\./);
        if (match) {
            const receipt = { sequence: Number(match[1]), displayName: match[2].trim(), round: Number(match[3]) };
            answerReceipts.push(receipt);
            maybeReleaseFollowersAfterServerReceipt(receipt);
        }

        match = line.match(/\[Q\+\] ANSWER #(\d+) encolado\. queueSize=(\d+)\./);
        if (match) {
            queueEnqueues.push({ sequence: Number(match[1]), size: Number(match[2]) });
        }

        match = line.match(/\[GC✓\] Ronda (\d+) adjudicada .* ANSWER #(\d+)\./);
        if (match) {
            adjudications.push({ round: Number(match[1]), sequence: Number(match[2]) });
        }

        match = line.match(/\[GCx\] ANSWER #(\d+) descartado: ronda (\d+) ya adjudicada/);
        if (match) {
            rejections.push({ sequence: Number(match[1]), round: Number(match[2]) });
        }
    }
}

server.stdout.on('data', chunk => consumeServerText(chunk.toString()));
server.stderr.on('data', chunk => process.stderr.write(chunk.toString()));
server.on('exit', code => {
    serverExited = true;
    if (!completed && code !== null && code !== 0) {
        failAndExit(`El servidor terminó prematuramente con código ${code}.`);
    }
});

const clients = Array.from({ length: CLIENT_COUNT }, (_, index) => ({
    index,
    name: `ALT02-C${index + 1}`,
    ws: null,
    ready: false,
    currentRound: null,
    newSongRounds: new Set(),
    winnersByRound: new Map(),
    gameOver: null
}));

const roundReady = new Map();
const firedRounds = new Set();
const followerReleaseByRound = new Set();
const leadConfirmations = new Map();

function sendAnswer(client, delayMs = 0) {
    setTimeout(() => {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'ANSWER', answer: ANSWER }));
        }
    }, delayMs);
}

function maybeFire(round) {
    const readySet = roundReady.get(round);
    if (!readySet || readySet.size !== clients.length || firedRounds.has(round)) return;

    firedRounds.add(round);

    if (LEAD_CLIENT_NUMBER !== null) {
        const leader = clients[LEAD_CLIENT_NUMBER - 1];
        console.log(`[TEST] FIRE ronda ${round}: primero ${leader.name}; seguidores se liberan solo después de confirmar su recepción en el servidor.`);
        sendAnswer(leader, 0);
        return;
    }

    console.log(`[TEST] FIRE ronda ${round}: offsets=${OFFSETS.join('/')} ms.`);
    clients.forEach((client, index) => sendAnswer(client, OFFSETS[index]));
}

function maybeReleaseFollowersAfterServerReceipt(receipt) {
    if (LEAD_CLIENT_NUMBER === null || followerReleaseByRound.has(receipt.round)) return;

    const leader = clients[LEAD_CLIENT_NUMBER - 1];
    if (receipt.displayName !== leader.name) return;

    followerReleaseByRound.add(receipt.round);
    leadConfirmations.set(receipt.round, receipt);
    console.log(`[TEST] LEAD confirmado ronda ${receipt.round}: ${leader.name} obtuvo ANSWER #${String(receipt.sequence).padStart(6, '0')}. Liberando seguidores.`);

    clients.forEach((client, index) => {
        if (index === LEAD_CLIENT_NUMBER - 1) return;
        sendAnswer(client, OFFSETS[index]);
    });
}

function handleClientMessage(client, data) {
    if (data.type === 'WAITING_START') {
        client.ready = true;
        console.log(`[TEST] READY ${client.name}.`);
        return;
    }

    if (data.type === 'NEW_SONG' || data.type === 'INIT_GAME') {
        const round = data.round;
        if (!round || client.newSongRounds.has(round)) return;
        client.newSongRounds.add(round);
        client.currentRound = round;

        if (!roundReady.has(round)) roundReady.set(round, new Set());
        roundReady.get(round).add(client.index);
        maybeFire(round);
        return;
    }

    if (data.type === 'ROUND_WINNER') {
        const round = client.currentRound;
        if (!client.winnersByRound.has(round)) client.winnersByRound.set(round, []);
        client.winnersByRound.get(round).push({
            playerId: data.winner?.playerId || null,
            displayName: data.winner?.displayName || null
        });
        return;
    }

    if (data.type === 'GAME_OVER') {
        client.gameOver = data;
        if (clients.every(c => c.gameOver)) scheduleFinalize();
    }
}

function connectClients() {
    for (const client of clients) {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
        client.ws = ws;

        ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'JOIN', username: client.name }));
        });

        ws.on('message', raw => {
            const data = JSON.parse(raw.toString());
            handleClientMessage(client, data);
        });

        ws.on('error', error => {
            if (!completed) failAndExit(`${client.name}: ${error.message}`);
        });
    }
}

function roundReceipts(round) {
    return answerReceipts.filter(item => item.round === round);
}

function maxQueueSizeForRound(round) {
    const sequences = new Set(roundReceipts(round).map(item => item.sequence));
    const sizes = queueEnqueues
        .filter(item => sequences.has(item.sequence))
        .map(item => item.size);
    return sizes.length ? Math.max(...sizes) : 0;
}

function validate() {
    const errors = [];
    const winnerDistribution = new Map();

    for (let round = 1; round <= ROUNDS; round++) {
        const perClientWinners = clients.map(client => client.winnersByRound.get(round) || []);

        for (let i = 0; i < perClientWinners.length; i++) {
            if (perClientWinners[i].length !== 1) {
                errors.push(`Ronda ${round}: ${clients[i].name} recibió ${perClientWinners[i].length} ROUND_WINNER (esperado 1).`);
            }
        }

        const visibleWinners = perClientWinners.flat();
        const winnerIds = visibleWinners.map(winner => winner.playerId).filter(Boolean);
        if (winnerIds.length > 0 && new Set(winnerIds).size !== 1) {
            errors.push(`Ronda ${round}: los clientes no observaron el mismo ganador (${winnerIds.join(', ')}).`);
        }

        const representativeWinner = visibleWinners[0];
        if (representativeWinner?.displayName) {
            winnerDistribution.set(
                representativeWinner.displayName,
                (winnerDistribution.get(representativeWinner.displayName) || 0) + 1
            );
        }

        if (EXPECTED_WINNER && representativeWinner?.displayName !== EXPECTED_WINNER) {
            errors.push(`Ronda ${round}: ganador=${representativeWinner?.displayName || 'ninguno'}; esperado=${EXPECTED_WINNER}.`);
        }

        const gcItems = adjudications.filter(item => item.round === round);
        if (gcItems.length !== 1) {
            errors.push(`Ronda ${round}: GameCoordinator adjudicó ${gcItems.length} ganadores (esperado 1).`);
        }

        const receipts = roundReceipts(round);
        if (receipts.length !== CLIENT_COUNT) {
            errors.push(`Ronda ${round}: llegaron ${receipts.length} ANSWER al servidor; esperados=${CLIENT_COUNT}.`);
        }

        if (LEAD_CLIENT_NUMBER !== null) {
            const leader = clients[LEAD_CLIENT_NUMBER - 1];
            const confirmation = leadConfirmations.get(round);
            if (!confirmation) {
                errors.push(`Ronda ${round}: no se confirmó la recepción autoritativa del líder ${leader.name}.`);
            } else if (receipts.length) {
                const firstReceipt = receipts.reduce((best, item) => item.sequence < best.sequence ? item : best);
                if (firstReceipt.displayName !== leader.name) {
                    errors.push(`Ronda ${round}: la menor sequence fue de ${firstReceipt.displayName}; líder esperado=${leader.name}.`);
                }
            }
        }

        if (receipts.length && gcItems.length === 1) {
            const firstSequence = Math.min(...receipts.map(item => item.sequence));
            if (gcItems[0].sequence !== firstSequence) {
                errors.push(`Ronda ${round}: se adjudicó ANSWER #${gcItems[0].sequence}, pero la primera sequence recibida fue #${firstSequence}.`);
            }
        }

        const maxQueueSize = maxQueueSizeForRound(round);
        if (maxQueueSize < CLIENT_COUNT) {
            errors.push(`Ronda ${round}: maxQueueSize=${maxQueueSize}; esperado al menos ${CLIENT_COUNT} para ejercitar la colisión completa.`);
        }

        const rejectionCount = rejections.filter(item => item.round === round).length;
        if (rejectionCount !== CLIENT_COUNT - 1) {
            errors.push(`Ronda ${round}: descartes por ganador previo=${rejectionCount}; esperados=${CLIENT_COUNT - 1}.`);
        }
    }

    const sequences = answerReceipts.map(item => item.sequence);
    const uniqueSequences = new Set(sequences);
    if (uniqueSequences.size !== sequences.length) {
        errors.push('Hay sequence duplicadas en los ANSWER recibidos.');
    }
    for (let i = 1; i < sequences.length; i++) {
        if (sequences[i] <= sequences[i - 1]) {
            errors.push(`Sequence no monotónica: ${sequences[i - 1]} -> ${sequences[i]}.`);
            break;
        }
    }

    const finalLeaderboard = clients[0].gameOver?.leaderboard || [];
    const totalScore = finalLeaderboard.reduce((sum, player) => sum + Number(player.score || 0), 0);
    const expectedScore = ROUNDS * 100;
    if (totalScore !== expectedScore) {
        errors.push(`Score total=${totalScore}; esperado=${expectedScore} (un único incremento de 100 por ronda).`);
    }

    const globalMaxQueueSize = queueEnqueues.length
        ? Math.max(...queueEnqueues.map(item => item.size))
        : 0;

    return { errors, totalScore, sequences, winnerDistribution, globalMaxQueueSize };
}

function scheduleFinalize() {
    if (completed || finalizeScheduled) return;
    finalizeScheduled = true;
    setTimeout(finalize, SETTLE_MS);
}

function finalize() {
    if (completed) return;
    completed = true;

    const { errors, totalScore, sequences, winnerDistribution, globalMaxQueueSize } = validate();
    const distributionText = [...winnerDistribution.entries()]
        .map(([name, count]) => `${name}=${count}`)
        .join(', ') || 'sin datos';

    console.log('\n=== ALT-02 RESULTADO ===');
    console.log(`Rondas: ${ROUNDS}`);
    console.log(`Clientes: ${clients.length}`);
    console.log(`Offsets seguidores: ${OFFSETS.join('/')} ms`);
    if (LEAD_CLIENT_NUMBER !== null) console.log(`Lead confirmado por recepción del servidor: ALT02-C${LEAD_CLIENT_NUMBER}`);
    console.log(`Queue drain delay (test only): ${QUEUE_DRAIN_DELAY_MS} ms`);
    console.log(`Max queueSize observado: ${globalMaxQueueSize}`);
    console.log(`ANSWER recibidos: ${answerReceipts.length}`);
    console.log(`Sequences: ${sequences.length ? `${sequences[0]}..${sequences[sequences.length - 1]}` : 'ninguna'}`);
    console.log(`Adjudicaciones GC: ${adjudications.length}`);
    console.log(`Descartes por ganador previo: ${rejections.length}`);
    console.log(`Score total: ${totalScore}`);
    console.log(`Ganadores: ${distributionText}`);
    if (EXPECTED_WINNER) console.log(`Ganador esperado por recepción confirmada: ${EXPECTED_WINNER}`);
    console.log(`doubleWinner: ${errors.filter(e => e.includes('adjudicó')).length}`);
    console.log(`clientMismatch: ${errors.filter(e => e.includes('mismo ganador')).length}`);
    console.log(`PASS: ${errors.length === 0 ? `${ROUNDS}/${ROUNDS}` : 'NO'}`);

    if (errors.length) {
        console.log('\nErrores:');
        for (const error of errors) console.log(`- ${error}`);
    }

    cleanup();
    process.exitCode = errors.length ? 1 : 0;
}

function cleanup() {
    for (const client of clients) {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) client.ws.close();
    }
    if (!serverExited) server.kill();
}

function failAndExit(message) {
    if (completed) return;
    completed = true;
    console.error(`\n[TEST][FAIL] ${message}`);
    cleanup();
    process.exitCode = 1;
}

const timeout = setTimeout(() => failAndExit(`Timeout global de ${TIMEOUT_MS} ms.`), TIMEOUT_MS);
timeout.unref();

let serverBuffer = '';
server.stdout.on('data', chunk => {
    serverBuffer += chunk.toString();
    if (serverBuffer.includes(`Servidor web corriendo en http://localhost:${PORT}`) && clients.every(c => !c.ws)) {
        connectClients();
    }
});

process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
});
