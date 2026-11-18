/**
 * @fileoverview Matriz de escenarios de concurrencia ALT-02.
 * Ejecuta los cuatro escenarios en procesos hijos, de forma secuencial.
 * El número de rondas por escenario se configura con ALT02_MATRIX_ROUNDS
 * (20 por defecto). Un escenario aprueba si su harness termina con código 0.
 * Las recepciones confirmadas por el servidor, y no el orden de envío,
 * determinan los líderes esperados de S2, S3 y S4.
 */
import {spawnSync} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const harnessPath = path.join(__dirname, 'alt02-concurrent-answers.js');
const rounds = Math.max(
    1, Number.parseInt(process.env.ALT02_MATRIX_ROUNDS || '20', 10),
);

/**
 * Configuraciones independientes: S1 sin líder prefijado; S2 y S3 con
 * líder confirmado de dos clientes; S4 con cinco clientes y líder C5.
 * Cada escenario utiliza un puerto y una demora artificial de drenaje.
 * @type {!Array<!Object>}
 */
const scenarios = [
  {
    id: 'S1',
    description: '2 clientes, disparo nominal simultáneo',
    clients: 2,
    offsets: '0,0',
    drainDelay: 80,
    expectedWinner: null,
    port: 3199,
  },
  {
    id: 'S2',
    description: '2 clientes, C1 confirmado primero por el servidor',
    clients: 2,
    offsets: '0,0',
    drainDelay: 80,
    leadClient: 1,
    expectedWinner: 'ALT02-C1',
    port: 3200,
  },
  {
    id: 'S3',
    description: '2 clientes, C2 confirmado primero por el servidor',
    clients: 2,
    offsets: '0,0',
    drainDelay: 80,
    leadClient: 2,
    expectedWinner: 'ALT02-C2',
    port: 3201,
  },
  {
    id: 'S4',
    description: '5 clientes, C5 confirmado primero por el servidor ' +
      'y todos quedan en cola',
    clients: 5,
    offsets: '0,0,0,0,0',
    drainDelay: 100,
    leadClient: 5,
    expectedWinner: 'ALT02-C5',
    port: 3202,
  },
];

const results = [];

console.log('=== ALT-02 MATRIZ DE CONCURRENCIA ===');
console.log(`Rondas por escenario: ${rounds}`);

for (const scenario of scenarios) {
  console.log(`\n=== ${scenario.id}: ${scenario.description} ===`);
  console.log(
      `clientes=${scenario.clients}, ` +
    `offsets seguidores=${scenario.offsets} ms, ` +
    `drainDelay=${scenario.drainDelay} ms` +
    `${scenario.leadClient ? `, lead=C${scenario.leadClient}` : ''}`,
  );

  const result = spawnSync(process.execPath, [harnessPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ALT02_ROUNDS: String(rounds),
      ALT02_CLIENTS: String(scenario.clients),
      ALT02_OFFSETS: scenario.offsets,
      ALT02_QUEUE_DRAIN_DELAY_MS: String(scenario.drainDelay),
      ALT02_PORT: String(scenario.port),
      ALT02_SETTLE_MS: '200',
      ALT02_LEAD_CLIENT: scenario.leadClient ? String(scenario.leadClient) : '',
      ALT02_EXPECTED_WINNER: scenario.expectedWinner || '',
    },
    stdio: 'inherit',
    timeout: 120000,
  });

  const passed = result.status === 0;
  results.push({...scenario, passed, status: result.status});
  console.log(
      `[MATRIX] ${scenario.id}: ` +
    `${passed ? 'PASS' : `FAIL (exit=${result.status})`}`,
  );
}

console.log('\n=== ALT-02 MATRIZ RESULTADO ===');
for (const result of results) {
  console.log(
      `${result.id}: ${result.passed ? 'PASS' : 'FAIL'} - ` +
      `${result.description}`,
  );
}

const passedCount = results.filter((result) => result.passed).length;
console.log(`PASS escenarios: ${passedCount}/${results.length}`);

if (passedCount !== results.length) {
  process.exitCode = 1;
}
