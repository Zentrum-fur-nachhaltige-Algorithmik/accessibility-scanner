/**
 * Enhanced Logger for E2E Testing System
 * Comprehensive logging with file rotation and structured output
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class EnhancedLogger {
    constructor(options = {}) {
        this.options = {
            level: options.level || 'info', // debug, info, warn, error
            enableFileLogging: options.enableFileLogging !== false,
            enableConsoleLogging: options.enableConsoleLogging !== false,
            logToSeparateFiles: options.logToSeparateFiles !== false,
            maxLogFileSize: options.maxLogFileSize || 10 * 1024 * 1024, // 10MB
            maxLogFiles: options.maxLogFiles || 5,
            logDir: options.logDir || path.join(process.cwd(), 'test-results', 'debug-logs'),
            dateFormat: options.dateFormat || 'YYYY-MM-DD HH:mm:ss.SSS',
            ...options
        };

        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };

        this.currentLevel = this.levels[this.options.level] || 1;
        this.logStreams = new Map();
        this.sessionId = uuidv4();
        
        this.init();
    }

    async init() {
        try {
            // Ensure log directory exists
            await fs.ensureDir(this.options.logDir);
            
            // Initialize log files
            if (this.options.enableFileLogging) {
                await this.initializeLogFiles();
            }

            this.info('Enhanced Logger initialized', {
                sessionId: this.sessionId,
                level: this.options.level,
                logDir: this.options.logDir
            });
        } catch (error) {
            console.error('Failed to initialize Enhanced Logger:', error.message);
        }
    }

    async initializeLogFiles() {
        const logFiles = this.options.logToSeparateFiles ? 
            ['debug', 'info', 'warn', 'error', 'system', 'performance', 'accessibility'] :
            ['combined'];

        for (const logType of logFiles) {
            const logPath = path.join(this.options.logDir, `${logType}.log`);
            
            // Check if rotation is needed
            await this.rotateLogIfNeeded(logPath);
            
            // Create write stream
            const stream = fs.createWriteStream(logPath, { flags: 'a' });
            this.logStreams.set(logType, stream);
        }
    }

    async rotateLogIfNeeded(logPath) {
        try {
            if (await fs.pathExists(logPath)) {
                const stats = await fs.stat(logPath);
                
                if (stats.size > this.options.maxLogFileSize) {
                    await this.rotateLogFile(logPath);
                }
            }
        } catch (error) {
            console.warn('Failed to check log rotation:', error.message);
        }
    }

    async rotateLogFile(logPath) {
        const dir = path.dirname(logPath);
        const basename = path.basename(logPath, '.log');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Move current log to backup
        const backupPath = path.join(dir, `${basename}-${timestamp}.log`);
        await fs.move(logPath, backupPath);
        
        // Clean up old backup files
        await this.cleanupOldLogs(dir, basename);
    }

    async cleanupOldLogs(dir, basename) {
        try {
            const files = await fs.readdir(dir);
            const logFiles = files
                .filter(file => file.startsWith(`${basename}-`) && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(dir, file),
                    time: fs.statSync(path.join(dir, file)).mtime
                }))
                .sort((a, b) => b.time - a.time);

            // Remove old log files beyond max limit
            if (logFiles.length > this.options.maxLogFiles) {
                const filesToDelete = logFiles.slice(this.options.maxLogFiles);
                for (const file of filesToDelete) {
                    await fs.remove(file.path);
                }
            }
        } catch (error) {
            console.warn('Failed to cleanup old logs:', error.message);
        }
    }

    formatMessage(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            sessionId: this.sessionId,
            message,
            ...metadata
        };

        return JSON.stringify(logEntry);
    }

    shouldLog(level) {
        return this.levels[level] >= this.currentLevel;
    }

    async writeToFile(level, formattedMessage) {
        if (!this.options.enableFileLogging) return;

        try {
            if (this.options.logToSeparateFiles) {
                // Write to specific level file
                const stream = this.logStreams.get(level);
                if (stream) {
                    stream.write(formattedMessage + '\n');
                }

                // Also write to combined if it's warn or error
                if (['warn', 'error'].includes(level)) {
                    const combinedStream = this.logStreams.get('combined');
                    if (combinedStream) {
                        combinedStream.write(formattedMessage + '\n');
                    }
                }
            } else {
                // Write to combined log
                const stream = this.logStreams.get('combined');
                if (stream) {
                    stream.write(formattedMessage + '\n');
                }
            }
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    writeToConsole(level, message, metadata = {}) {
        if (!this.options.enableConsoleLogging) return;

        const timestamp = new Date().toLocaleTimeString();
        const emoji = this.getLevelEmoji(level);
        const colorCode = this.getLevelColor(level);
        
        let output = `${colorCode}[${timestamp}] ${emoji} ${level.toUpperCase()}: ${message}`;
        
        if (Object.keys(metadata).length > 0) {
            output += `\n  ${JSON.stringify(metadata, null, 2)}`;
        }
        
        output += '\x1b[0m'; // Reset color
        
        console.log(output);
    }

    getLevelEmoji(level) {
        const emojis = {
            debug: '🔍',
            info: 'ℹ️',
            warn: '⚠️',
            error: '❌'
        };
        return emojis[level] || 'ℹ️';
    }

    getLevelColor(level) {
        const colors = {
            debug: '\x1b[90m', // Gray
            info: '\x1b[36m',  // Cyan
            warn: '\x1b[33m',  // Yellow
            error: '\x1b[31m'  // Red
        };
        return colors[level] || '\x1b[0m';
    }

    // Core logging methods
    debug(message, metadata = {}) {
        if (!this.shouldLog('debug')) return;
        
        const formattedMessage = this.formatMessage('debug', message, metadata);
        this.writeToConsole('debug', message, metadata);
        this.writeToFile('debug', formattedMessage);
    }

    info(message, metadata = {}) {
        if (!this.shouldLog('info')) return;
        
        const formattedMessage = this.formatMessage('info', message, metadata);
        this.writeToConsole('info', message, metadata);
        this.writeToFile('info', formattedMessage);
    }

    warn(message, metadata = {}) {
        if (!this.shouldLog('warn')) return;
        
        const formattedMessage = this.formatMessage('warn', message, metadata);
        this.writeToConsole('warn', message, metadata);
        this.writeToFile('warn', formattedMessage);
    }

    error(message, metadata = {}) {
        if (!this.shouldLog('error')) return;
        
        const formattedMessage = this.formatMessage('error', message, metadata);
        this.writeToConsole('error', message, metadata);
        this.writeToFile('error', formattedMessage);
    }

    // Specialized logging methods
    system(message, metadata = {}) {
        const formattedMessage = this.formatMessage('info', `[SYSTEM] ${message}`, {
            category: 'system',
            ...metadata
        });
        
        this.writeToConsole('info', `[SYSTEM] ${message}`, metadata);
        this.writeToFile('system', formattedMessage);
    }

    performance(message, metrics = {}) {
        const formattedMessage = this.formatMessage('info', `[PERFORMANCE] ${message}`, {
            category: 'performance',
            metrics,
            timestamp: Date.now()
        });
        
        this.writeToConsole('info', `[PERFORMANCE] ${message}`, { metrics });
        this.writeToFile('performance', formattedMessage);
    }

    accessibility(message, testData = {}) {
        const formattedMessage = this.formatMessage('info', `[ACCESSIBILITY] ${message}`, {
            category: 'accessibility',
            testData
        });
        
        this.writeToConsole('info', `[ACCESSIBILITY] ${message}`, { testData });
        this.writeToFile('accessibility', formattedMessage);
    }

    testStart(testId, url, config = {}) {
        this.info('Test started', {
            testId,
            url,
            config,
            category: 'test-lifecycle'
        });
    }

    testEnd(testId, result, duration) {
        const level = result.validation?.passed ? 'info' : 'warn';
        this[level]('Test completed', {
            testId,
            status: result.validation?.passed ? 'PASSED' : 'FAILED',
            score: result.validation?.score,
            violations: result.accessibility?.violations_count,
            duration,
            category: 'test-lifecycle'
        });
    }

    batchStart(batchId, totalJobs) {
        this.info('Batch started', {
            batchId,
            totalJobs,
            category: 'batch-lifecycle'
        });
    }

    batchProgress(batchId, completed, total, failed = 0) {
        this.info('Batch progress', {
            batchId,
            completed,
            total,
            failed,
            percentage: Math.round((completed / total) * 100),
            category: 'batch-lifecycle'
        });
    }

    batchEnd(batchId, summary) {
        this.info('Batch completed', {
            batchId,
            ...summary,
            category: 'batch-lifecycle'
        });
    }

    failedTestIsolated(testId, isolationPath, error) {
        this.warn('Failed test isolated', {
            testId,
            isolationPath,
            error: error?.message,
            category: 'failed-test-isolation'
        });
    }

    circuitBreakerTriggered(domain, failures) {
        this.warn('Circuit breaker triggered', {
            domain,
            failures,
            category: 'circuit-breaker'
        });
    }

    retryAttempt(testId, attempt, maxAttempts, error) {
        this.warn('Test retry attempt', {
            testId,
            attempt,
            maxAttempts,
            error: error?.message,
            category: 'retry-logic'
        });
    }

    // Structured logging for different components
    logTestExecution(testId, phase, data = {}) {
        this.debug(`Test execution: ${phase}`, {
            testId,
            phase,
            ...data,
            category: 'test-execution'
        });
    }

    logScreenshotCapture(testId, device, screenshotPath) {
        this.debug('Screenshot captured', {
            testId,
            device,
            screenshotPath,
            category: 'screenshot-capture'
        });
    }

    logAccessibilityViolation(testId, violation) {
        this.warn('Accessibility violation detected', {
            testId,
            violationId: violation.id,
            impact: violation.impact,
            nodes: violation.nodes,
            category: 'accessibility-violation'
        });
    }

    logPerformanceMetrics(testId, metrics) {
        this.performance('Performance metrics captured', {
            testId,
            loadTime: metrics.timing?.loadComplete,
            firstPaint: metrics.timing?.firstPaint,
            memoryUsage: metrics.JSHeapUsedSize,
            category: 'performance-metrics'
        });
    }

    // Query and analysis methods
    async getLogs(options = {}) {
        const {
            level = null,
            category = null,
            startDate = null,
            endDate = null,
            limit = 100
        } = options;

        try {
            const logFiles = this.options.logToSeparateFiles ? 
                [level || 'info'] : ['combined'];

            const logs = [];
            
            for (const logType of logFiles) {
                const logPath = path.join(this.options.logDir, `${logType}.log`);
                
                if (await fs.pathExists(logPath)) {
                    const content = await fs.readFile(logPath, 'utf8');
                    const lines = content.trim().split('\n').filter(line => line);
                    
                    for (const line of lines) {
                        try {
                            const logEntry = JSON.parse(line);
                            
                            // Apply filters
                            if (category && logEntry.category !== category) continue;
                            if (startDate && new Date(logEntry.timestamp) < new Date(startDate)) continue;
                            if (endDate && new Date(logEntry.timestamp) > new Date(endDate)) continue;
                            
                            logs.push(logEntry);
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                }
            }

            // Sort by timestamp and limit
            return logs
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, limit);

        } catch (error) {
            this.error('Failed to retrieve logs', { error: error.message });
            return [];
        }
    }

    async getLogStats() {
        try {
            const logs = await this.getLogs({ limit: 1000 });
            
            const stats = {
                total: logs.length,
                byLevel: {},
                byCategory: {},
                timeRange: {
                    oldest: null,
                    newest: null
                }
            };

            logs.forEach(log => {
                // Count by level
                stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
                
                // Count by category
                if (log.category) {
                    stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
                }
                
                // Track time range
                const timestamp = new Date(log.timestamp);
                if (!stats.timeRange.oldest || timestamp < new Date(stats.timeRange.oldest)) {
                    stats.timeRange.oldest = log.timestamp;
                }
                if (!stats.timeRange.newest || timestamp > new Date(stats.timeRange.newest)) {
                    stats.timeRange.newest = log.timestamp;
                }
            });

            return stats;
        } catch (error) {
            this.error('Failed to get log stats', { error: error.message });
            return null;
        }
    }

    // Cleanup and shutdown
    async close() {
        try {
            // Close all file streams
            for (const [type, stream] of this.logStreams) {
                stream.end();
            }
            
            this.info('Enhanced Logger closed');
        } catch (error) {
            console.error('Failed to close logger:', error.message);
        }
    }
}

module.exports = EnhancedLogger;