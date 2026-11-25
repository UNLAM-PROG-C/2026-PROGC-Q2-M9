/** @fileoverview Harness de concurrencia determinística para V4-C24. */

const CPU_MODULUS = 1000003;
const CPU_FACTOR = 31;

function runDeterministicCpuWork(iterations) {
  let acc = 0;
  for (let i = 1; i <= iterations; i += 1) {
    acc = (acc + (i * CPU_FACTOR)) % CPU_MODULUS;
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
      this.scheduleCompletion(job, startMs, resolve);
    });
  }

  scheduleCompletion(job, startMs, resolve) {
    setTimeout(() => {
      resolve(this.completeJob(job, startMs));
    }, job.source.delayMs);
  }

  completeJob(job, startMs) {
    const checksum = runDeterministicCpuWork(job.source.cpuIterations);
    const endMs = Date.now();
    this.busy = false;
    this.tracker.onFinish(this.threadId, job, startMs, endMs);
    return this.buildResult(job, checksum, endMs - startMs);
  }

  buildResult(job, checksum, durationMs) {
    return {
      jobId: job.jobId, gameId: job.gameId, roundId: job.roundId,
      mode: job.mode, ok: true, threadId: this.threadId,
      resource: {checksum, durationMs},
    };
  }

  async terminate() {
    this.exited = true;
    this.busy = false;
  }
}

export {DeterministicCpuWorker};
