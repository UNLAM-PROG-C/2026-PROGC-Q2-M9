import {parentPort} from 'node:worker_threads';

const FATAL_ERROR_MESSAGE = 'FATAL_TEST_WORKER';

parentPort.on('message', () => {
  throw new Error(FATAL_ERROR_MESSAGE);
});
