/**
 * @fileoverview Harness de concurrencia determinística para V4-C24.
 */

function runDeterministicCpuWork(iterations) {
  let acc = 0;
  for (let i = 1; i <= iterations; i += 1) {
    acc = (acc + (i * 31)) % 1000003;
  }
  return acc;
}

class DeterministicCpuWorker {
  constructor(threadId, tracker) {
    this.threadId = threadId;
    this.tracker = tracker;
    this.busy = false;
    this.exited = false;
  }

  isBusy() {
    return this.busy;
  }

  hasExited() {
    return this.exited;
  }

  run(job) {
    this.busy = true;
    const startMs = Date.now();
    this.tracker.onStart(this.threadId, job, startMs);

    return new Promise((resolve) => {
      const delayMs = job.source.delayMs;
      setTimeout(() => {
        const checksum = runDeterministicCpuWork(job.source.cpuIterations);
        const endMs = Date.now();
        this.busy = false;
        const result = {
          jobId: job.jobId,
          gameId: job.gameId,
          roundId: job.roundId,
          mode: job.mode,
          ok: true,
          threadId: this.threadId,
          resource: {checksum, durationMs: endMs - startMs},
        };
        this.tracker.onFinish(this.threadId, job, startMs, endMs);
        resolve(result);
      }, delayMs);
    });
  }

  async terminate() {
    this.exited = true;
    this.busy = false;
  }
}

export {DeterministicCpuWorker};
