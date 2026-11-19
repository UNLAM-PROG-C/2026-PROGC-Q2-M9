function createDefaultResult(job, workerId) {
  return {jobId: job.jobId, workerId};
}

class ControlledWorker {
  constructor(id, {
    dispatchLog = [],
    completionLog = [],
    createResult = createDefaultResult,
  } = {}) {
    this.id = id;
    this.dispatchLog = dispatchLog;
    this.completionLog = completionLog;
    this.createResult = createResult;
    this.busy = false;
    this.exited = false;
    this.pending = null;
    this.runCount = 0;
  }

  isBusy() {
    return this.busy;
  }

  hasExited() {
    return this.exited;
  }

  run(job) {
    this.busy = true;
    this.runCount += 1;
    this.dispatchLog.push({workerId: this.id, jobId: job.jobId});
    return new Promise((resolve) => {
      this.pending = {job, resolve};
    });
  }

  complete() {
    const {job, resolve} = this.pending;
    this.pending = null;
    this.busy = false;
    this.completionLog.push({workerId: this.id, jobId: job.jobId});
    resolve(this.createResult(job, this.id));
  }

  async terminate() {
    this.exited = true;
    this.busy = false;
  }
}

export {ControlledWorker};
