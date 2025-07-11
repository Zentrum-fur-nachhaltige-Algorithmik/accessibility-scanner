const EventEmitter = require('events');
const WebsiteScanner = require('./website-scanner');
const { v4: uuidv4 } = require('uuid');

class BatchProcessor extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // jobId -> job details
    this.activeJobs = new Set();
    this.maxConcurrentJobs = 3;
    this.websiteScanner = new WebsiteScanner();
  }

  async init() {
    await this.websiteScanner.init();
  }

  async submitBatch(urls, options = {}) {
    const batchId = uuidv4();
    const jobs = urls.map(url => ({
      id: uuidv4(),
      batchId,
      url,
      status: 'pending',
      result: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null
    }));

    const batch = {
      id: batchId,
      jobs: jobs.map(job => job.id),
      status: 'pending',
      totalJobs: jobs.length,
      completedJobs: 0,
      failedJobs: 0,
      options,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null
    };

    // Store jobs and batch
    jobs.forEach(job => this.jobs.set(job.id, job));
    this.jobs.set(batchId, batch);

    console.log(`📦 Created batch ${batchId} with ${jobs.length} jobs`);
    
    // Start processing
    setImmediate(() => this.processBatch(batchId));

    return {
      batchId,
      jobIds: jobs.map(job => job.id),
      status: 'submitted',
      estimatedDuration: this.estimateDuration(jobs.length, options)
    };
  }

  async processBatch(batchId) {
    const batch = this.jobs.get(batchId);
    if (!batch || batch.status !== 'pending') return;

    batch.status = 'processing';
    batch.startedAt = new Date();
    
    console.log(`🚀 Starting batch processing: ${batchId}`);
    this.emit('batchStarted', { batchId, batch });

    const jobPromises = [];

    for (const jobId of batch.jobs) {
      // Wait if we've reached max concurrent jobs
      while (this.activeJobs.size >= this.maxConcurrentJobs) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const promise = this.processJob(jobId, batch.options);
      jobPromises.push(promise);
    }

    // Wait for all jobs to complete
    await Promise.allSettled(jobPromises);

    // Update batch status
    batch.status = 'completed';
    batch.completedAt = new Date();
    
    const duration = batch.completedAt - batch.startedAt;
    console.log(`✅ Batch ${batchId} completed in ${Math.round(duration / 1000)}s`);
    
    this.emit('batchCompleted', { 
      batchId, 
      batch,
      duration: Math.round(duration / 1000)
    });

    return this.getBatchStatus(batchId);
  }

  async processJob(jobId, options) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending') return;

    this.activeJobs.add(jobId);
    job.status = 'processing';
    job.startedAt = new Date();

    console.log(`🔄 Processing job ${jobId}: ${job.url}`);
    this.emit('jobStarted', { jobId, job });

    try {
      let result;

      if (options.scanType === 'website') {
        result = await this.websiteScanner.scanWebsite(job.url, options);
      } else {
        // Single page scan
        result = await this.websiteScanner.scanSinglePage(job.url, {
          scanType: options.scanType || 'enhanced',
          wcagLevel: options.wcagLevel || 'AA',
          timeout: options.timeout || 30000
        });
      }

      job.result = result;
      job.status = 'completed';
      job.completedAt = new Date();

      // Update batch counters
      const batch = this.jobs.get(job.batchId);
      batch.completedJobs++;

      console.log(`✅ Job ${jobId} completed successfully`);
      this.emit('jobCompleted', { jobId, job, result });

    } catch (error) {
      job.error = error.message;
      job.status = 'failed';
      job.completedAt = new Date();

      // Update batch counters
      const batch = this.jobs.get(job.batchId);
      batch.failedJobs++;

      console.error(`❌ Job ${jobId} failed:`, error.message);
      this.emit('jobFailed', { jobId, job, error: error.message });
    }

    this.activeJobs.delete(jobId);
  }

  getBatchStatus(batchId) {
    const batch = this.jobs.get(batchId);
    if (!batch) {
      return { error: 'Batch not found' };
    }

    const jobs = batch.jobs.map(jobId => {
      const job = this.jobs.get(jobId);
      return {
        id: job.id,
        url: job.url,
        status: job.status,
        error: job.error,
        duration: job.completedAt && job.startedAt 
          ? Math.round((job.completedAt - job.startedAt) / 1000) 
          : null
      };
    });

    const progress = batch.totalJobs > 0 
      ? Math.round(((batch.completedJobs + batch.failedJobs) / batch.totalJobs) * 100)
      : 0;

    return {
      batchId: batch.id,
      status: batch.status,
      progress,
      totalJobs: batch.totalJobs,
      completedJobs: batch.completedJobs,
      failedJobs: batch.failedJobs,
      pendingJobs: batch.totalJobs - batch.completedJobs - batch.failedJobs,
      duration: batch.completedAt && batch.startedAt 
        ? Math.round((batch.completedAt - batch.startedAt) / 1000) 
        : null,
      jobs
    };
  }

  getJobResult(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { error: 'Job not found' };
    }

    return {
      id: job.id,
      batchId: job.batchId,
      url: job.url,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      duration: job.completedAt && job.startedAt 
        ? Math.round((job.completedAt - job.startedAt) / 1000) 
        : null
    };
  }

  estimateDuration(jobCount, options) {
    // Estimate based on scan type and job count
    let baseTimePerJob = 10; // seconds
    
    if (options.scanType === 'website') {
      baseTimePerJob = 30; // Multi-page scans take longer
    } else if (options.scanType === 'screen-reader') {
      baseTimePerJob = 15; // Screen reader analysis takes longer
    }

    const concurrentFactor = Math.min(jobCount, this.maxConcurrentJobs);
    const estimatedSeconds = Math.ceil((jobCount * baseTimePerJob) / concurrentFactor);
    
    return `${Math.round(estimatedSeconds / 60)}min ${estimatedSeconds % 60}s`;
  }

  async cancelBatch(batchId) {
    const batch = this.jobs.get(batchId);
    if (!batch) {
      return { error: 'Batch not found' };
    }

    if (batch.status === 'completed') {
      return { error: 'Batch already completed' };
    }

    batch.status = 'cancelled';
    batch.completedAt = new Date();

    // Cancel pending jobs
    for (const jobId of batch.jobs) {
      const job = this.jobs.get(jobId);
      if (job.status === 'pending') {
        job.status = 'cancelled';
        job.completedAt = new Date();
      }
    }

    console.log(`🛑 Batch ${batchId} cancelled`);
    this.emit('batchCancelled', { batchId, batch });

    return { success: true, message: 'Batch cancelled successfully' };
  }

  getActiveJobs() {
    return Array.from(this.activeJobs).map(jobId => {
      const job = this.jobs.get(jobId);
      return {
        id: job.id,
        url: job.url,
        status: job.status,
        startedAt: job.startedAt
      };
    });
  }

  getSystemStats() {
    const totalJobs = Array.from(this.jobs.values()).filter(item => item.url).length;
    const completedJobs = Array.from(this.jobs.values()).filter(item => item.status === 'completed').length;
    const failedJobs = Array.from(this.jobs.values()).filter(item => item.status === 'failed').length;
    const activeJobsCount = this.activeJobs.size;

    return {
      totalJobs,
      completedJobs,
      failedJobs,
      activeJobs: activeJobsCount,
      maxConcurrentJobs: this.maxConcurrentJobs,
      systemLoad: Math.round((activeJobsCount / this.maxConcurrentJobs) * 100)
    };
  }

  async close() {
    await this.websiteScanner.close();
  }
}

module.exports = BatchProcessor;