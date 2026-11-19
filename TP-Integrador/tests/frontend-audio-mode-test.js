import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

test('C21-01: index.html incluye contenedor visual del modo de audio', () => {
  assert.ok(html.includes('id="audio-mode-badge"'));
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
