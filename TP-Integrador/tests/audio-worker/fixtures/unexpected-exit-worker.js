import {parentPort} from 'node:worker_threads';

const UNEXPECTED_EXIT_CODE = 7;

parentPort.on('message', () => {
  process.exit(UNEXPECTED_EXIT_CODE);
});
