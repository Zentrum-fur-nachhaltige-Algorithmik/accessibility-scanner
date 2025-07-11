const os = require('os');
const EventEmitter = require('events');

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      interval: options.interval || 5000, // 5 seconds
      historyLimit: options.historyLimit || 100,
      thresholds: {
        cpuUsage: options.thresholds?.cpuUsage || 80,
        memoryUsage: options.thresholds?.memoryUsage || 85,
        responseTime: options.thresholds?.responseTime || 5000, // ms
        errorRate: options.thresholds?.errorRate || 5 // %
      }
    };
    
    this.metrics = {
      system: [],
      scans: [],
      errors: [],
      performance: []
    };
    
    this.currentMetrics = {
      totalScans: 0,
      successfulScans: 0,
      failedScans: 0,
      averageResponseTime: 0,
      activeScans: 0,
      queuedScans: 0
    };
    
    this.monitoring = false;
    this.startTime = new Date();
  }

  start() {
    if (this.monitoring) return;
    
    this.monitoring = true;
    console.log('📊 Performance monitoring started');
    
    // Start system monitoring
    this.systemMonitorInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.interval);
    
    // Start performance analysis
    this.analysisInterval = setInterval(() => {
      this.analyzePerformance();
    }, this.options.interval * 2);
    
    this.emit('monitoringStarted');
  }

  stop() {
    if (!this.monitoring) return;
    
    this.monitoring = false;
    
    if (this.systemMonitorInterval) {
      clearInterval(this.systemMonitorInterval);
    }
    
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }
    
    console.log('📊 Performance monitoring stopped');
    this.emit('monitoringStopped');
  }

  collectSystemMetrics() {
    const now = new Date();
    
    // CPU metrics
    const cpus = os.cpus();
    const cpuUsage = this.calculateCpuUsage();
    
    // Memory metrics
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;
    
    // Load average (Unix systems)
    const loadAverage = os.loadavg();
    
    const systemMetric = {
      timestamp: now,
      cpu: {
        usage: cpuUsage,
        cores: cpus.length,
        loadAverage: loadAverage[0] // 1-minute average
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usage: memoryUsage
      },
      uptime: os.uptime(),
      platform: os.platform(),
      arch: os.arch()
    };
    
    this.addMetric('system', systemMetric);
    
    // Check thresholds
    this.checkThresholds(systemMetric);
  }

  calculateCpuUsage() {
    // Simplified CPU usage calculation
    // In production, you'd want a more sophisticated approach
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - Math.round((idle / total) * 100);
    
    return Math.max(0, Math.min(100, usage));
  }

  recordScanStart(scanId, url, options = {}) {
    const scanMetric = {
      id: scanId,
      url,
      type: options.scanType || 'unknown',
      startTime: new Date(),
      endTime: null,
      duration: null,
      success: null,
      error: null,
      memoryUsage: process.memoryUsage(),
      activeScansBefore: this.currentMetrics.activeScans
    };
    
    this.currentMetrics.activeScans++;
    this.addMetric('scans', scanMetric);
    
    console.log(`📈 Started tracking scan ${scanId} for ${url}`);
    return scanMetric;
  }

  recordScanEnd(scanId, success = true, error = null) {
    const scanMetrics = this.metrics.scans;
    const scanMetric = scanMetrics.find(m => m.id === scanId);
    
    if (!scanMetric) {
      console.warn(`⚠️  Scan metric not found for ${scanId}`);
      return;
    }
    
    const endTime = new Date();
    scanMetric.endTime = endTime;
    scanMetric.duration = endTime - scanMetric.startTime;
    scanMetric.success = success;
    scanMetric.error = error;
    scanMetric.memoryUsageEnd = process.memoryUsage();
    
    // Update counters
    this.currentMetrics.totalScans++;
    this.currentMetrics.activeScans = Math.max(0, this.currentMetrics.activeScans - 1);
    
    if (success) {
      this.currentMetrics.successfulScans++;
    } else {
      this.currentMetrics.failedScans++;
      this.recordError(error, 'scan', { scanId, url: scanMetric.url });
    }
    
    // Update average response time
    const recentScans = scanMetrics
      .filter(m => m.duration !== null && m.startTime > Date.now() - 300000) // Last 5 minutes
      .map(m => m.duration);
    
    if (recentScans.length > 0) {
      this.currentMetrics.averageResponseTime = Math.round(
        recentScans.reduce((sum, duration) => sum + duration, 0) / recentScans.length
      );
    }
    
    console.log(`📉 Completed tracking scan ${scanId} (${scanMetric.duration}ms, success: ${success})`);
    
    this.emit('scanCompleted', {
      scanId,
      duration: scanMetric.duration,
      success,
      currentMetrics: { ...this.currentMetrics }
    });
  }

  recordError(error, category = 'general', context = {}) {
    const errorMetric = {
      timestamp: new Date(),
      error: error instanceof Error ? error.message : String(error),
      category,
      context,
      stack: error instanceof Error ? error.stack : null
    };
    
    this.addMetric('errors', errorMetric);
    
    console.error(`🚨 Recorded error in ${category}:`, error);
    this.emit('errorRecorded', errorMetric);
  }

  recordPerformanceEvent(eventType, data = {}) {
    const performanceMetric = {
      timestamp: new Date(),
      eventType,
      data,
      memoryUsage: process.memoryUsage(),
      cpuUsage: this.calculateCpuUsage()
    };
    
    this.addMetric('performance', performanceMetric);
    
    this.emit('performanceEvent', performanceMetric);
  }

  addMetric(type, metric) {
    if (!this.metrics[type]) {
      this.metrics[type] = [];
    }
    
    this.metrics[type].push(metric);
    
    // Maintain history limit
    if (this.metrics[type].length > this.options.historyLimit) {
      this.metrics[type] = this.metrics[type].slice(-this.options.historyLimit);
    }
  }

  checkThresholds(systemMetric) {
    const alerts = [];
    
    // CPU usage threshold
    if (systemMetric.cpu.usage > this.options.thresholds.cpuUsage) {
      alerts.push({
        type: 'cpu',
        severity: 'warning',
        message: `High CPU usage: ${systemMetric.cpu.usage}%`,
        threshold: this.options.thresholds.cpuUsage,
        actual: systemMetric.cpu.usage
      });
    }
    
    // Memory usage threshold
    if (systemMetric.memory.usage > this.options.thresholds.memoryUsage) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: `High memory usage: ${Math.round(systemMetric.memory.usage)}%`,
        threshold: this.options.thresholds.memoryUsage,
        actual: Math.round(systemMetric.memory.usage)
      });
    }
    
    // Response time threshold
    if (this.currentMetrics.averageResponseTime > this.options.thresholds.responseTime) {
      alerts.push({
        type: 'responseTime',
        severity: 'warning',
        message: `High response time: ${this.currentMetrics.averageResponseTime}ms`,
        threshold: this.options.thresholds.responseTime,
        actual: this.currentMetrics.averageResponseTime
      });
    }
    
    // Error rate threshold
    const errorRate = this.calculateErrorRate();
    if (errorRate > this.options.thresholds.errorRate) {
      alerts.push({
        type: 'errorRate',
        severity: 'critical',
        message: `High error rate: ${errorRate}%`,
        threshold: this.options.thresholds.errorRate,
        actual: errorRate
      });
    }
    
    // Emit alerts
    alerts.forEach(alert => {
      console.warn(`⚠️  ${alert.message}`);
      this.emit('alert', alert);
    });
  }

  calculateErrorRate() {
    if (this.currentMetrics.totalScans === 0) return 0;
    
    return Math.round(
      (this.currentMetrics.failedScans / this.currentMetrics.totalScans) * 100
    );
  }

  analyzePerformance() {
    const analysis = {
      timestamp: new Date(),
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      systemHealth: this.getSystemHealth(),
      scanPerformance: this.getScanPerformance(),
      errorAnalysis: this.getErrorAnalysis(),
      recommendations: this.generateRecommendations()
    };
    
    this.emit('performanceAnalysis', analysis);
    
    // Log summary every 10 intervals (approximately every minute with 5s intervals)
    if (this.metrics.system.length % 10 === 0) {
      this.logPerformanceSummary(analysis);
    }
  }

  getSystemHealth() {
    const recentSystemMetrics = this.metrics.system.slice(-10); // Last 10 readings
    if (recentSystemMetrics.length === 0) return { status: 'unknown' };
    
    const avgCpu = recentSystemMetrics.reduce((sum, m) => sum + m.cpu.usage, 0) / recentSystemMetrics.length;
    const avgMemory = recentSystemMetrics.reduce((sum, m) => sum + m.memory.usage, 0) / recentSystemMetrics.length;
    
    let status = 'healthy';
    if (avgCpu > this.options.thresholds.cpuUsage || avgMemory > this.options.thresholds.memoryUsage) {
      status = 'stressed';
    }
    
    return {
      status,
      averageCpuUsage: Math.round(avgCpu),
      averageMemoryUsage: Math.round(avgMemory),
      currentActiveScans: this.currentMetrics.activeScans
    };
  }

  getScanPerformance() {
    const recentScans = this.metrics.scans.filter(s => 
      s.startTime > Date.now() - 300000 && s.duration !== null // Last 5 minutes
    );
    
    if (recentScans.length === 0) {
      return {
        totalScans: this.currentMetrics.totalScans,
        successRate: 0,
        averageResponseTime: 0,
        throughput: 0
      };
    }
    
    const successfulScans = recentScans.filter(s => s.success).length;
    const avgDuration = recentScans.reduce((sum, s) => sum + s.duration, 0) / recentScans.length;
    const throughput = recentScans.length / 5; // scans per minute
    
    return {
      totalScans: this.currentMetrics.totalScans,
      successRate: Math.round((successfulScans / recentScans.length) * 100),
      averageResponseTime: Math.round(avgDuration),
      throughput: Math.round(throughput * 10) / 10 // Round to 1 decimal
    };
  }

  getErrorAnalysis() {
    const recentErrors = this.metrics.errors.filter(e => 
      e.timestamp > Date.now() - 300000 // Last 5 minutes
    );
    
    const errorsByCategory = {};
    recentErrors.forEach(error => {
      errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
    });
    
    return {
      totalErrors: recentErrors.length,
      errorRate: this.calculateErrorRate(),
      errorsByCategory,
      mostCommonError: recentErrors.length > 0 ? 
        Object.keys(errorsByCategory).reduce((a, b) => 
          errorsByCategory[a] > errorsByCategory[b] ? a : b
        ) : null
    };
  }

  generateRecommendations() {
    const recommendations = [];
    const systemHealth = this.getSystemHealth();
    const scanPerf = this.getScanPerformance();
    const errorAnalysis = this.getErrorAnalysis();
    
    // System recommendations
    if (systemHealth.averageCpuUsage > 70) {
      recommendations.push({
        type: 'system',
        priority: 'high',
        message: 'High CPU usage detected. Consider reducing concurrent scans or scaling infrastructure.'
      });
    }
    
    if (systemHealth.averageMemoryUsage > 80) {
      recommendations.push({
        type: 'system',
        priority: 'high',
        message: 'High memory usage detected. Monitor for memory leaks or increase available memory.'
      });
    }
    
    // Performance recommendations
    if (scanPerf.averageResponseTime > 3000) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        message: 'Slow response times detected. Consider optimizing scan algorithms or caching.'
      });
    }
    
    if (scanPerf.successRate < 95) {
      recommendations.push({
        type: 'reliability',
        priority: 'high',
        message: 'Low success rate detected. Investigate error patterns and improve error handling.'
      });
    }
    
    // Error recommendations
    if (errorAnalysis.errorRate > 5) {
      recommendations.push({
        type: 'errors',
        priority: 'critical',
        message: 'High error rate detected. Immediate investigation required.'
      });
    }
    
    return recommendations;
  }

  logPerformanceSummary(analysis) {
    console.log('\n📊 Performance Summary:');
    console.log(`   System Health: ${analysis.systemHealth.status.toUpperCase()}`);
    console.log(`   CPU: ${analysis.systemHealth.averageCpuUsage}% | Memory: ${analysis.systemHealth.averageMemoryUsage}%`);
    console.log(`   Active Scans: ${analysis.systemHealth.currentActiveScans}`);
    console.log(`   Success Rate: ${analysis.scanPerformance.successRate}% | Avg Response: ${analysis.scanPerformance.averageResponseTime}ms`);
    console.log(`   Throughput: ${analysis.scanPerformance.throughput} scans/min`);
    console.log(`   Error Rate: ${analysis.errorAnalysis.errorRate}% | Total Errors: ${analysis.errorAnalysis.totalErrors}`);
    
    if (analysis.recommendations.length > 0) {
      console.log(`   Recommendations: ${analysis.recommendations.length} items`);
      analysis.recommendations.forEach(rec => {
        console.log(`   - [${rec.priority.toUpperCase()}] ${rec.message}`);
      });
    }
    console.log('');
  }

  getMetrics() {
    return {
      current: { ...this.currentMetrics },
      system: this.metrics.system.slice(-10),
      scans: this.metrics.scans.slice(-50),
      errors: this.metrics.errors.slice(-20),
      performance: this.metrics.performance.slice(-20),
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      monitoring: this.monitoring
    };
  }

  reset() {
    this.metrics = {
      system: [],
      scans: [],
      errors: [],
      performance: []
    };
    
    this.currentMetrics = {
      totalScans: 0,
      successfulScans: 0,
      failedScans: 0,
      averageResponseTime: 0,
      activeScans: 0,
      queuedScans: 0
    };
    
    console.log('📊 Performance metrics reset');
    this.emit('metricsReset');
  }
}

module.exports = PerformanceMonitor;