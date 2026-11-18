import assert from 'node:assert/strict';

import {JobQueue} from '../server/audio/job-queue.js';

function createRequest(jobId, gameId) {
  return {
    job: {jobId, gameId},
    resolve: () => {},
    reject: () => {},
  };
}

function testEmptyQueue() {
  const queue = new JobQueue();
  assert.equal(queue.getSize(), 0);
  assert.equal(queue.isEmpty(), true);
  assert.equal(queue.dequeue(), null);
}

function testFifoOrder() {
  const queue = new JobQueue();
  queue.enqueue(createRequest('job-1', 1));
  queue.enqueue(createRequest('job-2', 1));
  queue.enqueue(createRequest('job-3', 1));
  assert.equal(queue.dequeue().job.jobId, 'job-1');
  assert.equal(queue.dequeue().job.jobId, 'job-2');
  assert.equal(queue.dequeue().job.jobId, 'job-3');
  assert.equal(queue.isEmpty(), true);
}

function testRemoveByGameId() {
  const queue = new JobQueue();
  queue.enqueue(createRequest('job-1', 1));
  queue.enqueue(createRequest('job-2', 2));
  queue.enqueue(createRequest('job-3', 1));
  queue.enqueue(createRequest('job-4', 2));
  const removed = queue.removeByGameId(1);
  assert.deepEqual(
      removed.map((entry) => entry.job.jobId),
      ['job-1', 'job-3'],
  );
  assert.equal(queue.getSize(), 2);
  assert.equal(queue.dequeue().job.jobId, 'job-2');
  assert.equal(queue.dequeue().job.jobId, 'job-4');
}

function testInvalidRequest() {
  const queue = new JobQueue();
  assert.throws(
      () => queue.enqueue({job: {jobId: 'invalid'}}),
      /requiere job, resolve y reject/,
  );
}

function main() {
  testEmptyQueue();
  testFifoOrder();
  testRemoveByGameId();
  testInvalidRequest();
  console.log(
      '[C12] PASS parcial: JobQueue preserva FIFO y filtra por gameId.',
  );
}

main();
