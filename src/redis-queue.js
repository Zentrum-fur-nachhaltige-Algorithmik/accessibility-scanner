const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

class RedisQueue {
  constructor(options = {}) {
    this.client = null;
    this.subscriber = null;
    this.options = {
      host: options.host || 'localhost',
      port: options.port || 6379,
      password: options.password || null,
      db: options.db || 0,
      keyPrefix: options.keyPrefix || 'accessibility:',
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 5000,
      jobTimeout: options.jobTimeout || 300000 // 5 minutes
    };
    this.processing = false;
    this.workers = new Map();
  }

  async init() {
    try {
      // Main client for operations
      this.client = redis.createClient({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password,
        db: this.options.db
      });

      // Subscriber client for real-time updates
      this.subscriber = redis.createClient({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password,
        db: this.options.db
      });

      await this.client.connect();
      await this.subscriber.connect();

      console.log(`🔗 Connected to Redis at ${this.options.host}:${this.options.port}`);
      return true;

    } catch (error) {
      console.log(`⚠️  Redis not available: ${error.message}`);
      console.log(`📝 Falling back to in-memory queue`);
      
      // Fallback to in-memory implementation
      this.memoryQueue = [];
      this.memoryJobs = new Map();
      this.useMemory = true;
      return false;
    }
  }

  async addJob(type, data, options = {}) {
    const job = {
      id: uuidv4(),
      type,
      data,
      status: 'pending',
      createdAt: new Date(),
      attempts: 0,
      maxRetries: options.maxRetries || this.options.maxRetries,
      priority: options.priority || 0,
      delay: options.delay || 0
    };

    if (this.useMemory) {
      return this.addJobMemory(job);
    }

    try {
      const jobKey = `${this.options.keyPrefix}job:${job.id}`;
      const queueKey = `${this.options.keyPrefix}queue:${type}`;

      // Store job data
      await this.client.hSet(jobKey, {
        id: job.id,
        type: job.type,
        data: JSON.stringify(job.data),
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        attempts: job.attempts,
        maxRetries: job.maxRetries,
        priority: job.priority
      });

      // Add to queue
      if (job.delay > 0) {
        const executeAt = Date.now() + job.delay;
        await this.client.zAdd(`${queueKey}:delayed`, {
          score: executeAt,
          value: job.id
        });
      } else {
        await this.client.lPush(queueKey, job.id);
      }

      console.log(`📥 Added job ${job.id} to queue ${type}`);
      return job;

    } catch (error) {
      console.error('Error adding job to Redis:', error);
      throw error;
    }
  }

  async addJobMemory(job) {
    this.memoryJobs.set(job.id, job);
    
    if (job.delay > 0) {
      setTimeout(() => {
        if (this.memoryJobs.has(job.id)) {
          this.memoryQueue.push(job.id);
        }
      }, job.delay);
    } else {
      this.memoryQueue.push(job.id);
    }

    console.log(`📥 Added job ${job.id} to memory queue`);
    return job;
  }

  async getJob(queueType) {
    if (this.useMemory) {
      return this.getJobMemory();
    }

    try {
      const queueKey = `${this.options.keyPrefix}queue:${queueType}`;
      const delayedQueueKey = `${queueKey}:delayed`;

      // Check for delayed jobs that are ready
      const now = Date.now();
      const readyJobs = await this.client.zRangeByScore(delayedQueueKey, 0, now, {
        LIMIT: { offset: 0, count: 1 }
      });

      let jobId;

      if (readyJobs.length > 0) {
        jobId = readyJobs[0];
        await this.client.zRem(delayedQueueKey, jobId);
      } else {
        // Get from regular queue
        jobId = await this.client.rPop(queueKey);
      }

      if (!jobId) return null;

      const jobKey = `${this.options.keyPrefix}job:${jobId}`;
      const jobData = await this.client.hGetAll(jobKey);

      if (!jobData.id) return null;

      return {
        id: jobData.id,
        type: jobData.type,
        data: JSON.parse(jobData.data),
        status: jobData.status,
        createdAt: new Date(jobData.createdAt),
        attempts: parseInt(jobData.attempts),
        maxRetries: parseInt(jobData.maxRetries),
        priority: parseInt(jobData.priority)
      };

    } catch (error) {
      console.error('Error getting job from Redis:', error);
      return null;
    }
  }

  async getJobMemory() {
    if (this.memoryQueue.length === 0) return null;

    const jobId = this.memoryQueue.shift();
    const job = this.memoryJobs.get(jobId);
    
    if (!job) return null;

    return job;
  }

  async updateJobStatus(jobId, status, result = null, error = null) {
    if (this.useMemory) {
      return this.updateJobStatusMemory(jobId, status, result, error);
    }

    try {
      const jobKey = `${this.options.keyPrefix}job:${jobId}`;
      const updates = {
        status,
        updatedAt: new Date().toISOString()
      };

      if (result) updates.result = JSON.stringify(result);
      if (error) updates.error = error;
      if (status === 'completed' || status === 'failed') {
        updates.completedAt = new Date().toISOString();
      }

      await this.client.hSet(jobKey, updates);
      console.log(`📊 Updated job ${jobId} status to ${status}`);

    } catch (error) {
      console.error('Error updating job status:', error);
    }
  }

  async updateJobStatusMemory(jobId, status, result = null, error = null) {
    const job = this.memoryJobs.get(jobId);
    if (job) {
      job.status = status;
      job.updatedAt = new Date();
      if (result) job.result = result;
      if (error) job.error = error;
      if (status === 'completed' || status === 'failed') {
        job.completedAt = new Date();
      }
    }
  }

  async retryJob(jobId) {
    if (this.useMemory) {
      return this.retryJobMemory(jobId);
    }

    try {
      const jobKey = `${this.options.keyPrefix}job:${jobId}`;
      const jobData = await this.client.hGetAll(jobKey);

      if (!jobData.id) return false;

      const attempts = parseInt(jobData.attempts) + 1;
      const maxRetries = parseInt(jobData.maxRetries);

      if (attempts > maxRetries) {
        await this.updateJobStatus(jobId, 'failed', null, 'Max retries exceeded');
        return false;
      }

      await this.client.hSet(jobKey, {
        status: 'pending',
        attempts,
        retryAt: new Date().toISOString()
      });

      const queueKey = `${this.options.keyPrefix}queue:${jobData.type}`;
      const retryDelay = this.options.retryDelay * attempts; // Exponential backoff
      const executeAt = Date.now() + retryDelay;

      await this.client.zAdd(`${queueKey}:delayed`, {
        score: executeAt,
        value: jobId
      });

      console.log(`🔄 Retrying job ${jobId} (attempt ${attempts}/${maxRetries})`);
      return true;

    } catch (error) {
      console.error('Error retrying job:', error);
      return false;
    }
  }

  async retryJobMemory(jobId) {
    const job = this.memoryJobs.get(jobId);
    if (!job) return false;

    job.attempts++;
    if (job.attempts > job.maxRetries) {
      job.status = 'failed';
      job.error = 'Max retries exceeded';
      return false;
    }

    job.status = 'pending';
    job.retryAt = new Date();

    const retryDelay = this.options.retryDelay * job.attempts;
    setTimeout(() => {
      this.memoryQueue.push(jobId);
    }, retryDelay);

    console.log(`🔄 Retrying job ${jobId} (attempt ${job.attempts}/${job.maxRetries})`);
    return true;
  }

  async getQueueStats(queueType) {
    if (this.useMemory) {
      return this.getQueueStatsMemory();
    }

    try {
      const queueKey = `${this.options.keyPrefix}queue:${queueType}`;
      const delayedQueueKey = `${queueKey}:delayed`;

      const [waiting, delayed] = await Promise.all([
        this.client.lLen(queueKey),
        this.client.zCard(delayedQueueKey)
      ]);

      // Count jobs by status
      const jobKeys = await this.client.keys(`${this.options.keyPrefix}job:*`);
      let completed = 0, failed = 0, processing = 0;

      for (const key of jobKeys) {
        const status = await this.client.hGet(key, 'status');
        if (status === 'completed') completed++;
        else if (status === 'failed') failed++;
        else if (status === 'processing') processing++;
      }

      return {
        waiting,
        delayed,
        processing,
        completed,
        failed,
        total: jobKeys.length
      };

    } catch (error) {
      console.error('Error getting queue stats:', error);
      return { waiting: 0, delayed: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    }
  }

  async getQueueStatsMemory() {
    const jobs = Array.from(this.memoryJobs.values());
    const stats = {
      waiting: this.memoryQueue.length,
      delayed: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: jobs.length
    };

    jobs.forEach(job => {
      switch (job.status) {
        case 'processing': stats.processing++; break;
        case 'completed': stats.completed++; break;
        case 'failed': stats.failed++; break;
      }
    });

    return stats;
  }

  async clearQueue(queueType) {
    if (this.useMemory) {
      this.memoryQueue.length = 0;
      this.memoryJobs.clear();
      return;
    }

    try {
      const queueKey = `${this.options.keyPrefix}queue:${queueType}`;
      const delayedQueueKey = `${queueKey}:delayed`;
      
      await Promise.all([
        this.client.del(queueKey),
        this.client.del(delayedQueueKey)
      ]);

      console.log(`🗑️  Cleared queue ${queueType}`);

    } catch (error) {
      console.error('Error clearing queue:', error);
    }
  }

  async close() {
    this.processing = false;
    
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }

    console.log('🔌 Redis queue connections closed');
  }
}

module.exports = RedisQueue;