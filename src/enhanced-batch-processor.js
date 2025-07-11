/**
 * Enhanced Batch Processor with Advanced Retry Logic and Failed Test Isolation
 * Builds upon existing batch processing with enterprise-level features
 */

const EventEmitter = require('events');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const EnhancedE2ETester = require('./enhanced-e2e-tester');

class EnhancedBatchProcessor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            maxConcurrent: options.maxConcurrent || 3,
            retryAttempts: options.retryAttempts || 3,
            retryDelay: options.retryDelay || 1000,
            retryBackoff: options.retryBackoff || 2, // Exponential backoff multiplier
            circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
            circuitBreakerTimeout: options.circuitBreakerTimeout || 30000,
            timeoutPerTest: options.timeoutPerTest || 60000,
            enablePersistence: options.enablePersistence !== false,
            ...options
        };

        this.batches = new Map();
        this.activeJobs = new Map();
        this.failedTests = new Map();
        this.circuitBreakers = new Map();
        this.statistics = {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            retriedJobs: 0,
            startTime: null,
            endTime: null
        };

        this.persistenceDir = path.join(process.cwd(), 'test-results', 'batch-state');
        this.reportsDir = path.join(process.cwd(), 'test-results', 'reports');
        this.logDir = path.join(process.cwd(), 'test-results', 'debug-logs');
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Enhanced Batch Processor...');
            
            // Ensure directories exist
            await fs.ensureDir(this.persistenceDir);
            await fs.ensureDir(this.reportsDir);
            await fs.ensureDir(this.logDir);

            // Load persisted state if enabled
            if (this.options.enablePersistence) {
                await this.loadPersistedState();
            }

            console.log('✅ Enhanced Batch Processor initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Enhanced Batch Processor:', error.message);
            throw error;
        }
    }

    async createBatch(urls, config = {}) {
        const batchId = uuidv4();
        const timestamp = new Date().toISOString();
        
        console.log(`📦 Creating batch ${batchId} with ${urls.length} URLs`);

        const batch = {
            id: batchId,
            urls: [...urls],
            config: { ...config },
            status: 'pending',
            created: timestamp,
            started: null,
            completed: null,
            jobs: new Map(),
            results: [],
            errors: [],
            retryQueue: [],
            progress: {
                total: urls.length,
                completed: 0,
                failed: 0,
                retried: 0,
                percentage: 0
            }
        };

        // Create jobs for each URL
        urls.forEach((url, index) => {
            const jobId = uuidv4();
            const job = {
                id: jobId,
                batchId,
                url,
                index,
                status: 'pending',
                attempts: 0,
                maxAttempts: this.options.retryAttempts + 1,
                created: timestamp,
                started: null,
                completed: null,
                result: null,
                error: null,
                retryDelay: this.options.retryDelay
            };
            batch.jobs.set(jobId, job);
        });

        this.batches.set(batchId, batch);
        this.emit('batchCreated', { batchId, batch });

        // Persist state
        if (this.options.enablePersistence) {
            await this.persistBatchState(batch);
        }

        return { batchId, batch };
    }

    async processBatch(batchId) {
        const batch = this.batches.get(batchId);
        if (!batch) {
            throw new Error(`Batch ${batchId} not found`);
        }

        console.log(`🚀 Starting batch processing: ${batchId}`);
        
        batch.status = 'processing';
        batch.started = new Date().toISOString();
        this.statistics.totalJobs += batch.progress.total;
        this.statistics.startTime = this.statistics.startTime || Date.now();

        this.emit('batchStarted', { batchId, batch });

        try {
            // Initialize tester
            const tester = new EnhancedE2ETester(batch.config);
            await tester.initialize();

            // Process jobs with concurrency control
            await this.processJobsConcurrently(batch, tester);

            // Process retry queue
            await this.processRetryQueue(batch, tester);

            // Cleanup
            await tester.cleanup();

            // Finalize batch
            batch.status = 'completed';
            batch.completed = new Date().toISOString();
            this.statistics.endTime = Date.now();

            // Generate comprehensive reports
            await this.generateBatchReports(batch);

            this.emit('batchCompleted', { batchId, batch });
            console.log(`✅ Batch processing completed: ${batchId}`);

            return batch;
        } catch (error) {
            batch.status = 'failed';
            batch.error = {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            };

            this.emit('batchFailed', { batchId, batch, error });
            console.error(`❌ Batch processing failed: ${batchId}`, error.message);
            throw error;
        }
    }

    async processJobsConcurrently(batch, tester) {
        const jobs = Array.from(batch.jobs.values());
        const semaphore = new Semaphore(this.options.maxConcurrent);

        const processJob = async (job) => {
            await semaphore.acquire();
            try {
                await this.processJob(job, batch, tester);
            } finally {
                semaphore.release();
            }
        };

        // Process all jobs
        const jobPromises = jobs.map(job => processJob(job));
        await Promise.allSettled(jobPromises);
    }

    async processJob(job, batch, tester) {
        const startTime = Date.now();
        
        try {
            console.log(`🔄 Processing job ${job.index + 1}/${batch.progress.total}: ${job.url}`);
            
            job.status = 'processing';
            job.started = new Date().toISOString();
            job.attempts++;

            this.activeJobs.set(job.id, job);
            this.emit('jobStarted', { job, batch });

            // Check circuit breaker
            if (this.isCircuitBreakerOpen(job.url)) {
                throw new Error(`Circuit breaker open for domain: ${this.getDomain(job.url)}`);
            }

            // Execute test with timeout
            const testPromise = tester.testWebsite(job.url, batch.config);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Test timeout')), this.options.timeoutPerTest)
            );

            const result = await Promise.race([testPromise, timeoutPromise]);

            // Process successful result
            job.status = 'completed';
            job.completed = new Date().toISOString();
            job.result = result;
            job.duration = Date.now() - startTime;

            batch.results.push(result);
            batch.progress.completed++;
            this.statistics.completedJobs++;

            // Reset circuit breaker on success
            this.resetCircuitBreaker(job.url);

            this.emit('jobCompleted', { job, batch, result });
            console.log(`✅ Job completed: ${job.url} (${job.duration}ms)`);

        } catch (error) {
            console.error(`❌ Job failed: ${job.url}`, error.message);
            
            job.error = {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                attempt: job.attempts
            };

            // Update circuit breaker
            this.updateCircuitBreaker(job.url, error);

            // Determine if retry is needed
            if (job.attempts < job.maxAttempts && this.shouldRetry(error)) {
                console.log(`🔄 Scheduling retry for job: ${job.url} (attempt ${job.attempts + 1}/${job.maxAttempts})`);
                
                job.status = 'retry_scheduled';
                job.retryDelay *= this.options.retryBackoff; // Exponential backoff
                batch.retryQueue.push(job);
                this.statistics.retriedJobs++;

                this.emit('jobRetryScheduled', { job, batch });
            } else {
                console.log(`💀 Job permanently failed: ${job.url}`);
                
                job.status = 'failed';
                batch.progress.failed++;
                this.statistics.failedJobs++;

                // Add to failed tests for isolation
                this.failedTests.set(job.id, {
                    job,
                    batch: {
                        id: batch.id,
                        config: batch.config
                    },
                    isolationPath: null
                });

                this.emit('jobFailed', { job, batch });
            }
        } finally {
            this.activeJobs.delete(job.id);
            
            // Update progress
            batch.progress.percentage = Math.round(
                ((batch.progress.completed + batch.progress.failed) / batch.progress.total) * 100
            );

            this.emit('batchProgress', { batch });
            
            // Persist state
            if (this.options.enablePersistence) {
                await this.persistBatchState(batch);
            }
        }
    }

    async processRetryQueue(batch, tester) {
        if (batch.retryQueue.length === 0) {
            return;
        }

        console.log(`🔄 Processing retry queue: ${batch.retryQueue.length} jobs`);

        // Sort by retry delay (process jobs with shorter delays first)
        batch.retryQueue.sort((a, b) => a.retryDelay - b.retryDelay);

        for (const job of batch.retryQueue) {
            // Wait for retry delay
            await this.delay(job.retryDelay);
            
            // Reset job status
            job.status = 'pending';
            
            // Process the job again
            await this.processJob(job, batch, tester);
            
            // Remove from retry queue if completed or permanently failed
            if (job.status === 'completed' || job.status === 'failed') {
                const index = batch.retryQueue.indexOf(job);
                if (index > -1) {
                    batch.retryQueue.splice(index, 1);
                }
            }
        }
    }

    async generateBatchReports(batch) {
        try {
            console.log(`📊 Generating comprehensive reports for batch: ${batch.id}`);

            // 1. JSON Report
            const jsonReport = await this.generateJSONReport(batch);
            await fs.writeJSON(
                path.join(this.reportsDir, `batch-${batch.id}.json`), 
                jsonReport, 
                { spaces: 2 }
            );

            // 2. HTML Report
            const htmlReport = await this.generateHTMLReport(batch);
            await fs.writeFile(
                path.join(this.reportsDir, `batch-${batch.id}.html`), 
                htmlReport
            );

            // 3. CSV Report
            const csvReport = await this.generateCSVReport(batch);
            await fs.writeFile(
                path.join(this.reportsDir, `batch-${batch.id}.csv`), 
                csvReport
            );

            // 4. Failed Tests Summary
            if (batch.progress.failed > 0) {
                const failedTestsReport = await this.generateFailedTestsReport(batch);
                await fs.writeJSON(
                    path.join(this.reportsDir, `batch-${batch.id}-failed-tests.json`), 
                    failedTestsReport, 
                    { spaces: 2 }
                );
            }

            console.log(`✅ Reports generated for batch: ${batch.id}`);
        } catch (error) {
            console.error('Failed to generate batch reports:', error.message);
        }
    }

    async generateJSONReport(batch) {
        const duration = batch.completed && batch.started ? 
            new Date(batch.completed) - new Date(batch.started) : null;

        return {
            batch: {
                id: batch.id,
                status: batch.status,
                created: batch.created,
                started: batch.started,
                completed: batch.completed,
                duration,
                config: batch.config
            },
            summary: {
                total: batch.progress.total,
                completed: batch.progress.completed,
                failed: batch.progress.failed,
                retried: batch.progress.retried,
                successRate: batch.progress.total > 0 ? 
                    Math.round((batch.progress.completed / batch.progress.total) * 100) : 0
            },
            results: batch.results.map(result => ({
                testId: result.testId,
                url: result.url,
                status: result.validation?.passed ? 'passed' : 'failed',
                score: result.validation?.score || 0,
                violations: result.accessibility?.violations_count || 0,
                performance: result.performance?.timing?.loadComplete || null,
                duration: result.metadata?.duration || null
            })),
            failedTests: Array.from(batch.jobs.values())
                .filter(job => job.status === 'failed')
                .map(job => ({
                    jobId: job.id,
                    url: job.url,
                    attempts: job.attempts,
                    error: job.error,
                    lastAttempt: job.completed || job.started
                })),
            statistics: this.generateStatistics(),
            timestamp: new Date().toISOString()
        };
    }

    async generateHTMLReport(batch) {
        const jsonReport = await this.generateJSONReport(batch);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Batch Test Report - ${batch.id}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { border-bottom: 2px solid #e1e5e9; padding-bottom: 20px; margin-bottom: 30px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .badge.passed { background: #d4edda; color: #155724; }
        .badge.failed { background: #f8d7da; color: #721c24; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #6c757d; margin-top: 5px; }
        .results-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .results-table th, .results-table td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
        .results-table th { background-color: #f8f9fa; font-weight: 600; }
        .score { font-weight: bold; }
        .score.high { color: #28a745; }
        .score.medium { color: #ffc107; }
        .score.low { color: #dc3545; }
        .progress-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden; margin: 10px 0; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s ease; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Batch Test Report</h1>
            <p><strong>Batch ID:</strong> ${batch.id}</p>
            <p><strong>Status:</strong> <span class="badge ${batch.status === 'completed' ? 'passed' : 'failed'}">${batch.status}</span></p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${jsonReport.summary.total}</div>
                <div class="stat-label">Total Tests</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${jsonReport.summary.completed}</div>
                <div class="stat-label">Passed</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${jsonReport.summary.failed}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${jsonReport.summary.successRate}%</div>
                <div class="stat-label">Success Rate</div>
            </div>
        </div>

        <div>
            <h3>Progress Overview</h3>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${jsonReport.summary.successRate}%"></div>
            </div>
            <p>${jsonReport.summary.completed} of ${jsonReport.summary.total} tests passed (${jsonReport.summary.successRate}%)</p>
        </div>

        <div>
            <h3>Test Results</h3>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>URL</th>
                        <th>Status</th>
                        <th>Score</th>
                        <th>Violations</th>
                        <th>Load Time</th>
                        <th>Duration</th>
                    </tr>
                </thead>
                <tbody>
                    ${jsonReport.results.map(result => `
                        <tr>
                            <td><a href="${result.url}" target="_blank">${result.url}</a></td>
                            <td><span class="badge ${result.status}">${result.status}</span></td>
                            <td><span class="score ${result.score >= 80 ? 'high' : result.score >= 60 ? 'medium' : 'low'}">${result.score}</span></td>
                            <td>${result.violations}</td>
                            <td>${result.performance ? result.performance + 'ms' : 'N/A'}</td>
                            <td>${result.duration ? result.duration + 'ms' : 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        ${jsonReport.failedTests.length > 0 ? `
        <div>
            <h3>❌ Failed Tests</h3>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>URL</th>
                        <th>Attempts</th>
                        <th>Error</th>
                        <th>Last Attempt</th>
                    </tr>
                </thead>
                <tbody>
                    ${jsonReport.failedTests.map(test => `
                        <tr>
                            <td><a href="${test.url}" target="_blank">${test.url}</a></td>
                            <td>${test.attempts}</td>
                            <td><code>${test.error?.message || 'Unknown error'}</code></td>
                            <td>${new Date(test.lastAttempt).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}

        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; text-align: center;">
            Generated by Enhanced E2E Testing System - ${new Date().toISOString()}
        </div>
    </div>
</body>
</html>`;
    }

    async generateCSVReport(batch) {
        const headers = [
            'Test ID',
            'URL', 
            'Status',
            'Score',
            'Violations',
            'Load Time (ms)',
            'Duration (ms)',
            'Timestamp'
        ];

        const rows = batch.results.map(result => [
            result.testId,
            result.url,
            result.validation?.passed ? 'PASSED' : 'FAILED',
            result.validation?.score || 0,
            result.accessibility?.violations_count || 0,
            result.performance?.timing?.loadComplete || '',
            result.metadata?.duration || '',
            result.metadata?.timestamp || ''
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        return csvContent;
    }

    async generateFailedTestsReport(batch) {
        const failedJobs = Array.from(batch.jobs.values()).filter(job => job.status === 'failed');
        
        return {
            batchId: batch.id,
            totalFailed: failedJobs.length,
            failureAnalysis: this.analyzeFailures(failedJobs),
            isolatedTests: failedJobs.map(job => {
                const failedTest = this.failedTests.get(job.id);
                return {
                    jobId: job.id,
                    url: job.url,
                    attempts: job.attempts,
                    errors: [job.error],
                    isolationPath: failedTest?.isolationPath,
                    retryInstructions: `node src/enhanced-e2e-tester.js --url="${job.url}" --test-id="${job.id}"`
                };
            }),
            timestamp: new Date().toISOString()
        };
    }

    analyzeFailures(failedJobs) {
        const analysis = {
            byErrorType: {},
            byDomain: {},
            commonPatterns: []
        };

        failedJobs.forEach(job => {
            // Group by error type
            const errorType = job.error?.message?.split(':')[0] || 'Unknown';
            analysis.byErrorType[errorType] = (analysis.byErrorType[errorType] || 0) + 1;

            // Group by domain
            const domain = this.getDomain(job.url);
            analysis.byDomain[domain] = (analysis.byDomain[domain] || 0) + 1;
        });

        // Identify common patterns
        if (Object.keys(analysis.byErrorType).length === 1) {
            analysis.commonPatterns.push('All failures have the same error type - possible systematic issue');
        }

        if (Object.keys(analysis.byDomain).length === 1) {
            analysis.commonPatterns.push('All failures are from the same domain - possible site-specific issue');
        }

        return analysis;
    }

    // Circuit Breaker Implementation
    isCircuitBreakerOpen(url) {
        const domain = this.getDomain(url);
        const breaker = this.circuitBreakers.get(domain);
        
        if (!breaker) return false;
        
        if (breaker.state === 'open') {
            if (Date.now() - breaker.lastFailure > this.options.circuitBreakerTimeout) {
                breaker.state = 'half-open';
                return false;
            }
            return true;
        }
        
        return false;
    }

    updateCircuitBreaker(url, error) {
        const domain = this.getDomain(url);
        const breaker = this.circuitBreakers.get(domain) || {
            failures: 0,
            lastFailure: null,
            state: 'closed'
        };

        breaker.failures++;
        breaker.lastFailure = Date.now();

        if (breaker.failures >= this.options.circuitBreakerThreshold) {
            breaker.state = 'open';
            console.log(`🔥 Circuit breaker opened for domain: ${domain}`);
        }

        this.circuitBreakers.set(domain, breaker);
    }

    resetCircuitBreaker(url) {
        const domain = this.getDomain(url);
        const breaker = this.circuitBreakers.get(domain);
        
        if (breaker) {
            breaker.failures = 0;
            breaker.state = 'closed';
            this.circuitBreakers.set(domain, breaker);
        }
    }

    shouldRetry(error) {
        const retryableErrors = [
            'timeout',
            'network',
            'connection',
            'ENOTFOUND',
            'ECONNRESET',
            'Test timeout'
        ];

        return retryableErrors.some(retryable => 
            error.message.toLowerCase().includes(retryable.toLowerCase())
        );
    }

    getDomain(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return 'unknown';
        }
    }

    generateStatistics() {
        const now = Date.now();
        const duration = this.statistics.endTime ? 
            this.statistics.endTime - this.statistics.startTime : 
            now - this.statistics.startTime;

        return {
            ...this.statistics,
            duration,
            averageJobTime: this.statistics.completedJobs > 0 ? 
                duration / this.statistics.completedJobs : 0,
            jobsPerMinute: duration > 0 ? 
                Math.round((this.statistics.completedJobs / duration) * 60000) : 0
        };
    }

    async persistBatchState(batch) {
        try {
            const statePath = path.join(this.persistenceDir, `batch-${batch.id}.json`);
            const state = {
                batch: {
                    ...batch,
                    jobs: Array.from(batch.jobs.entries())
                },
                statistics: this.statistics,
                timestamp: new Date().toISOString()
            };
            
            await fs.writeJSON(statePath, state, { spaces: 2 });
        } catch (error) {
            console.error('Failed to persist batch state:', error.message);
        }
    }

    async loadPersistedState() {
        try {
            const stateFiles = await fs.readdir(this.persistenceDir);
            
            for (const file of stateFiles) {
                if (file.startsWith('batch-') && file.endsWith('.json')) {
                    const statePath = path.join(this.persistenceDir, file);
                    const state = await fs.readJSON(statePath);
                    
                    // Restore batch
                    const batch = state.batch;
                    batch.jobs = new Map(batch.jobs);
                    this.batches.set(batch.id, batch);
                    
                    console.log(`📦 Restored batch: ${batch.id}`);
                }
            }
        } catch (error) {
            console.warn('Could not load persisted state:', error.message);
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Public API methods
    getBatchStatus(batchId) {
        const batch = this.batches.get(batchId);
        return batch ? {
            id: batch.id,
            status: batch.status,
            progress: batch.progress,
            duration: batch.completed && batch.started ? 
                new Date(batch.completed) - new Date(batch.started) : null
        } : null;
    }

    listBatches() {
        return Array.from(this.batches.values()).map(batch => ({
            id: batch.id,
            status: batch.status,
            created: batch.created,
            totalJobs: batch.progress.total,
            completed: batch.progress.completed,
            failed: batch.progress.failed
        }));
    }

    getFailedTests() {
        return Array.from(this.failedTests.values());
    }

    async cancelBatch(batchId) {
        const batch = this.batches.get(batchId);
        if (batch && batch.status === 'processing') {
            batch.status = 'cancelled';
            this.emit('batchCancelled', { batchId, batch });
            return true;
        }
        return false;
    }
}

// Simple Semaphore implementation for concurrency control
class Semaphore {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        return new Promise(resolve => {
            if (this.current < this.maxConcurrent) {
                this.current++;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release() {
        this.current--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.current++;
            next();
        }
    }
}

module.exports = EnhancedBatchProcessor;