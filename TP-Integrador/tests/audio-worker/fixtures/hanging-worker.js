import {parentPort} from 'node:worker_threads';

parentPort.on('message', () => {
  // Keep the job pending until the parent terminates this fixture.
});
