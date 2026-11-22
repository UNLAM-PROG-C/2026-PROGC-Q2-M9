import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STARTUP_SCRIPT = `
import https from 'node:https';
import readline from 'node:readline';
import {EventEmitter} from 'node:events';

Math.random = () => Number(process.env.PLAYLIST_TEST_RANDOM);
readline.createInterface = () => ({question() {}, close() {}});
https.get = (url, callback) => {
  const request = new EventEmitter();
  const term = new URL(url).searchParams.get('term');
  console.log('SEARCH_TERM=' + term);
  const selected = process.env.PLAYLIST_TEST_ARTIST;
  const other = selected === 'No Te Va Gustar' ? 'Soda Stereo' :
    'No Te Va Gustar';
  const song = (artistName, trackName, collectionName = 'Estudio') => ({
    artistName, trackName, collectionName, previewUrl: 'https://example.test/a',
  });
  const results = [
    song(selected, 'Tema propio'),
    song(selected, 'Tema propio'),
    song(selected, 'Tema en vivo'),
    song(other, 'Otro tema'),
    song(other, 'Otro tema distinto'),
  ];
  setImmediate(() => {
    const response = new EventEmitter();
    callback(response);
    response.emit('data', JSON.stringify({results}));
    response.emit('end');
  });
  return request;
};
const log = console.log;
console.log = (...args) => {
  log(...args);
  if (String(args[0]).includes('Playlist cargada:')) {
    setTimeout(() => process.exit(0), 20);
  }
};
await import('./server.js');
`;

for (const [random, artist] of [
  [0.125, 'No Te Va Gustar'],
  [0.375, 'Soda Stereo'],
  [0.625, 'Los Piojos'],
  [0.875, 'Divididos'],
]) {
  test(`selecciona y filtra canciones de ${artist}`, () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module', '--eval', STARTUP_SCRIPT,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        TRIVIA_TEST_MODE: '0',
        PLAYLIST_TEST_RANDOM: String(random),
        PLAYLIST_TEST_ARTIST: artist,
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`SEARCH_TERM=${artist}`), result.stdout);
    assert.ok(result.stdout.includes(`Artista seleccionado: ${artist}.`));
    assert.ok(result.stdout.includes('Playlist cargada: 1 canciones'));
  });
}
