import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

function extractGameResetBlock() {
  const start = html.indexOf('function handleGameReset(data)');
  const end = html.indexOf('function resetAudioPlayer()', start);
  return html.slice(start, end);
}

function createMockDocument(elements) {
  return {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          style: {}, addEventListener() {}, play: () => Promise.resolve(),
        });
      }
      return elements.get(id);
    },
  };
}

function createFrontendContext(document) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({document, console});
  vm.runInContext(script, context);
  return context;
}

function assertArtistDisplay(context, elements) {
  context.handleRoundStart({
    artist: 'Soda Stereo', roundId: 1, maxRounds: 4, mode: 'NORMAL',
    audioUrl: 'https://example.test/preview',
  });
  assert.equal(elements.get('song-artist').textContent,
      'Hoy jugamos con: Soda Stereo');
  context.handleRoundStart({
    roundId: 2, maxRounds: 4, mode: 'NORMAL',
  });
  assert.equal(elements.get('song-artist').textContent, '');
}


test('C21-01: index.html incluye contenedor visual del modo de audio', () => {
  assert.ok(html.includes('id="audio-mode-badge"'));
  assert.equal((html.match(/id="audio-player"/g) ?? []).length, 1);
  assert.ok(html.includes('.mode-normal'));
  assert.ok(html.includes('.mode-reverse'));
  assert.ok(html.includes('.mode-low-pass'));
});

test('C21-02: cliente resuelve audioUrl V4 con fallback a song V3', () => {
  assert.ok(html.includes('function resolveRoundAudioSrc(data)'));
  assert.ok(html.includes('data.audioUrl || data.song'));
  assert.ok(html.includes('player.src = resolveRoundAudioSrc(data);'));
});

test('C21-03: cliente soporta modos NORMAL, REVERSE y LOW_PASS', () => {
  assert.ok(html.includes('NORMAL:'));
  assert.ok(html.includes('REVERSE:'));
  assert.ok(html.includes('LOW_PASS:'));
  assert.ok(html.includes('updateAudioModeBadge(data.mode);'));
  assert.ok(html.includes('resetAudioModeBadge();'));
});

test('C21-04: GAME_RESET limpia el indicador de modo de audio', () => {
  const gameResetBlock = extractGameResetBlock();
  assert.ok(html.includes('GAME_RESET: handleGameReset'));
  assert.ok(gameResetBlock.includes('resetAudioModeBadge();'));
});

test('la ronda muestra el artista recibido y limpia el dato ausente', () => {
  const elements = new Map();
  const document = createMockDocument(elements);
  const context = createFrontendContext(document);
  assertArtistDisplay(context, elements);
});
