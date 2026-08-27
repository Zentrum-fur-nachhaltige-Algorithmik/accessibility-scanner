/**
 * scan-jobs
 * In-memory async job store for scans: POST /api/scan enqueues a job and the
 * client polls GET /api/scan/job/:jobId. Jobs run through the server's p-queue,
 * so scan concurrency is unchanged. State does not survive a restart.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

/** @typedef {'queued'|'running'|'done'|'error'} JobStatus */

/**
 * @typedef {object} ScanJob
 * @property {string} id
 * @property {string} url
 * @property {object} options
 * @property {JobStatus} status
 * @property {number} createdAt   epoch ms
 * @property {number|null} startedAt
 * @property {number|null} finishedAt
 * @property {*} result           pipeline result once status === 'done'
 * @property {string|null} error  message once status === 'error'
 * @property {*} progress         optional, scanner-reported progress
 */

const DEFAULT_MAX_JOBS = 100;
const TERMINAL = new Set(['done', 'error']);

class ScanJobStore {
  /**
   * @param {object} options
   * @param {() => Promise<import('p-queue').default>} options.getQueue
   *        resolves the shared scan queue (p-queue is ESM, hence async)
   * @param {(url: string, options: object, job: ScanJob) => Promise<*>} options.runScan
   *        performs the actual scan
   * @param {number} [options.maxJobs] retention cap (default 100)
   */
  constructor({ getQueue, runScan, maxJobs = DEFAULT_MAX_JOBS } = {}) {
    if (typeof getQueue !== 'function') throw new TypeError('getQueue is required');
    if (typeof runScan !== 'function') throw new TypeError('runScan is required');
    this.getQueue = getQueue;
    this.runScan = runScan;
    this.maxJobs = maxJobs;
    /** @type {Map<string, ScanJob>} insertion-ordered, oldest first */
    this.jobs = new Map();
  }

  /**
   * Create a job and enqueue it. Returns immediately; the scan runs in the
   * background through the shared queue.
   *
   * @param {string} url already validated by url-guard
   * @param {object} [options] pipeline options (scannerIds, timeout, …)
   * @returns {ScanJob}
   */
  createJob(url, options = {}) {
    /** @type {ScanJob} */
    const job = {
      id: uuidv4(),
      url,
      options,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      progress: null,
    };

    this.jobs.set(job.id, job);
    this.evict();
    this.enqueue(job);
    return job;
  }

  /** @param {ScanJob} job */
  enqueue(job) {
    // Errors are captured onto the job itself; the promise must never reject
    // unhandled, so every path is caught.
    Promise.resolve()
      .then(() => this.getQueue())
      .then((queue) =>
        queue.add(async () => {
          job.status = 'running';
          job.startedAt = Date.now();
          try {
            job.result = await this.runScan(job.url, job.options, job);
            job.status = 'done';
          } catch (error) {
            job.error = error && error.message ? error.message : String(error);
            job.status = 'error';
          } finally {
            job.finishedAt = Date.now();
            // A job only becomes evictable once it finishes, so re-run the cap
            // here as well; evicting at creation time alone lets a burst of
            // still-pending jobs grow the store without bound.
            this.evict();
          }
        })
      )
      .catch((error) => {
        // Queue itself failed (import error, abort): surface it on the job.
        if (!TERMINAL.has(job.status)) {
          job.error = error && error.message ? error.message : String(error);
          job.status = 'error';
          job.finishedAt = Date.now();
        }
      });
  }

  /** @returns {ScanJob|undefined} */
  get(id) {
    return this.jobs.get(id);
  }

  /**
   * 1-based position among still-queued jobs, or null once running/finished.
   * @returns {number|null}
   */
  queuePosition(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'queued') return null;
    let position = 0;
    for (const candidate of this.jobs.values()) {
      if (candidate.status === 'queued') {
        position += 1;
        if (candidate.id === id) return position;
      }
    }
    return null;
  }

  /**
   * Serialise a job for the API. Optional fields are omitted when empty so the
   * polling response stays small while a scan is still running.
   */
  toPublic(id) {
    const job = this.jobs.get(id);
    if (!job) return null;

    const payload = {
      jobId: job.id,
      url: job.url,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };

    if (job.progress !== null && job.progress !== undefined) payload.progress = job.progress;
    if (job.status === 'queued') {
      const position = this.queuePosition(id);
      if (position !== null) payload.queuePosition = position;
    }
    if (job.status === 'done') payload.result = job.result;
    if (job.status === 'error') payload.error = job.error;

    return payload;
  }

  /** Update reported progress for a running job (no-op for unknown ids). */
  setProgress(id, progress) {
    const job = this.jobs.get(id);
    if (job) job.progress = progress;
  }

  /**
   * Enforce the retention cap by dropping the oldest *finished* jobs.
   * Queued/running jobs are never evicted (losing them would strand a caller
   * that is still polling), so the store may briefly exceed maxJobs under a
   * flood of concurrent scans.
   */
  evict() {
    if (this.jobs.size <= this.maxJobs) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= this.maxJobs) break;
      if (TERMINAL.has(job.status)) this.jobs.delete(id);
    }
  }

  /** Test/introspection helper. */
  size() {
    return this.jobs.size;
  }
}

module.exports = { ScanJobStore, DEFAULT_MAX_JOBS };
