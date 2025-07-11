const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

const BatchProcessor = require('./batch-processor');
const RedisQueue = require('./redis-queue');
const Database = require('./database');
const CacheManager = require('./cache-manager');
const PerformanceMonitor = require('./performance-monitor');
const WebsiteScanner = require('./website-scanner');
const EnhancedScanner = require('./enhanced-scanner');
const ScreenReaderScanner = require('./screen-reader-scanner');

class ScalableAccessibilityServer {
  constructor(options = {}) {
    this.app = express();
    this.port = options.port || process.env.PORT || 3001;
    this.environment = options.environment || process.env.NODE_ENV || 'development';
    
    // Initialize components
    this.batchProcessor = new BatchProcessor();
    this.redisQueue = new RedisQueue();
    this.database = new Database();
    this.cacheManager = new CacheManager();
    this.performanceMonitor = new PerformanceMonitor();
    
    // Scanners
    this.websiteScanner = new WebsiteScanner();
    this.enhancedScanner = new EnhancedScanner();
    this.screenReaderScanner = new ScreenReaderScanner();
    
    this.server = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;

    console.log('🚀 Initializing Scalable Accessibility Server...');

    // Initialize infrastructure components
    await Promise.all([
      this.redisQueue.init(),
      this.database.init(),
      this.batchProcessor.init(),
      this.websiteScanner.init(),
      this.enhancedScanner.init(),
      this.screenReaderScanner.init()
    ]);

    // Setup cache with Redis if available
    if (this.redisQueue.client && !this.redisQueue.useMemory) {
      this.cacheManager = new CacheManager({
        redisClient: this.redisQueue.client,
        ttl: 1800000, // 30 minutes
        maxSize: 2000
      });
    }

    // Start performance monitoring
    this.performanceMonitor.start();

    // Setup Express middleware
    this.setupMiddleware();
    
    // Setup routes
    this.setupRoutes();
    
    // Setup error handling
    this.setupErrorHandling();

    this.isInitialized = true;
    console.log('✅ Server initialization complete');
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    
    // Compression
    this.app.use(compression());
    
    // CORS
    this.app.use(cors({
      origin: this.environment === 'production' 
        ? ['https://yourdomain.com'] 
        : true,
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: this.environment === 'production' ? 100 : 1000, // requests per window
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging and monitoring
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.performanceMonitor.recordPerformanceEvent('http_request', {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent')
        });
      });
      
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', async (req, res) => {
      const health = await this.getHealthStatus();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      const metrics = {
        performance: this.performanceMonitor.getMetrics(),
        cache: this.cacheManager.getStats(),
        queue: this.redisQueue.useMemory ? null : 'Redis queue active',
        database: this.database.useMemory ? 'Memory storage' : 'PostgreSQL active'
      };
      res.json(metrics);
    });

    // Single page scan
    this.app.post('/api/scan', async (req, res) => {
      try {
        const { url, options = {} } = req.body;
        
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        const scanId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.performanceMonitor.recordScanStart(scanId, url, options);

        // Check cache first
        const cacheKey = this.cacheManager.generateKey(url, options);
        let result = await this.cacheManager.get(cacheKey);

        if (result) {
          this.performanceMonitor.recordScanEnd(scanId, true);
          return res.json({
            ...result,
            cached: true,
            scanId
          });
        }

        // Perform scan
        let scanner;
        switch (options.scanType) {
          case 'screen-reader':
            scanner = this.screenReaderScanner;
            result = await scanner.screenReaderAnalysis(url);
            break;
          case 'basic':
            scanner = this.enhancedScanner; // Use enhanced for basic too
            result = await scanner.enhancedScan(url, { ...options, includeWarnings: false });
            break;
          case 'enhanced':
          default:
            scanner = this.enhancedScanner;
            result = await scanner.enhancedScan(url, options);
            break;
        }

        // Cache the result
        await this.cacheManager.set(cacheKey, result);

        // Save to database
        const savedReport = await this.database.saveReport({
          ...result,
          scanType: options.scanType || 'enhanced',
          options
        });

        this.performanceMonitor.recordScanEnd(scanId, true);

        res.json({
          ...result,
          reportId: savedReport.id,
          scanId,
          cached: false
        });

      } catch (error) {
        this.performanceMonitor.recordScanEnd(req.body.scanId || 'unknown', false, error.message);
        this.performanceMonitor.recordError(error, 'scan_api', { url: req.body.url });
        
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Website scan (multi-page)
    this.app.post('/api/scan/website', async (req, res) => {
      try {
        const { url, options = {} } = req.body;
        
        if (!url) {
          return res.status(400).json({ error: 'URL is required' });
        }

        const scanId = `website_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.performanceMonitor.recordScanStart(scanId, url, { ...options, scanType: 'website' });

        const result = await this.websiteScanner.scanWebsite(url, options);

        // Save website scan to database
        const savedScan = await this.database.saveScan(result);

        this.performanceMonitor.recordScanEnd(scanId, true);

        res.json({
          ...result,
          scanId: savedScan.id,
          websiteScanId: scanId
        });

      } catch (error) {
        this.performanceMonitor.recordScanEnd(req.body.scanId || 'unknown', false, error.message);
        this.performanceMonitor.recordError(error, 'website_scan_api', { url: req.body.url });
        
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Batch processing
    this.app.post('/api/batch', async (req, res) => {
      try {
        const { urls, options = {} } = req.body;
        
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return res.status(400).json({ error: 'URLs array is required' });
        }

        if (urls.length > 100) {
          return res.status(400).json({ error: 'Maximum 100 URLs per batch' });
        }

        const batch = await this.batchProcessor.submitBatch(urls, options);

        res.json(batch);

      } catch (error) {
        this.performanceMonitor.recordError(error, 'batch_api');
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Batch status
    this.app.get('/api/batch/:batchId', (req, res) => {
      try {
        const { batchId } = req.params;
        const status = this.batchProcessor.getBatchStatus(batchId);
        
        if (status.error) {
          return res.status(404).json(status);
        }

        res.json(status);

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Get saved report
    this.app.get('/api/report/:reportId', async (req, res) => {
      try {
        const { reportId } = req.params;
        const report = await this.database.getReport(reportId);
        
        if (!report) {
          return res.status(404).json({ error: 'Report not found' });
        }

        res.json(report);

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // List reports
    this.app.get('/api/reports', async (req, res) => {
      try {
        const options = {
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0,
          sortBy: req.query.sortBy || 'created_at',
          sortOrder: req.query.sortOrder || 'DESC'
        };

        const result = await this.database.getReports(options);
        res.json(result);

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Statistics
    this.app.get('/api/stats', async (req, res) => {
      try {
        const stats = await this.database.getStats();
        const systemStats = this.batchProcessor.getSystemStats();
        const cacheStats = this.cacheManager.getStats();

        res.json({
          database: stats,
          system: systemStats,
          cache: cacheStats,
          timestamp: new Date()
        });

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Cache management
    this.app.delete('/api/cache', async (req, res) => {
      try {
        await this.cacheManager.clear();
        res.json({ message: 'Cache cleared successfully' });

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    this.app.delete('/api/cache/:url', async (req, res) => {
      try {
        const { url } = req.params;
        const invalidated = await this.cacheManager.invalidateUrl(decodeURIComponent(url));
        
        res.json({ 
          message: `Invalidated ${invalidated} cache entries for URL`,
          url: decodeURIComponent(url)
        });

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // Admin endpoints
    this.app.post('/api/admin/warmup', async (req, res) => {
      try {
        const { urls, options = {} } = req.body;
        
        if (!urls || !Array.isArray(urls)) {
          return res.status(400).json({ error: 'URLs array is required' });
        }

        const result = await this.cacheManager.warmup(urls, options);
        res.json(result);

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });

    // System maintenance
    this.app.post('/api/admin/cleanup', async (req, res) => {
      try {
        const { olderThanDays = 30 } = req.body;
        const cleaned = await this.database.cleanup(olderThanDays);
        
        res.json({ 
          message: `Cleaned up ${cleaned} old records`,
          olderThanDays
        });

      } catch (error) {
        res.status(500).json({
          error: error.message,
          timestamp: new Date()
        });
      }
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date()
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      this.performanceMonitor.recordError(error, 'express_error', {
        method: req.method,
        path: req.path,
        body: req.body
      });

      console.error('Express error:', error);

      res.status(500).json({
        error: 'Internal Server Error',
        message: this.environment === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date()
      });
    });
  }

  async getHealthStatus() {
    const checks = {
      database: this.database.useMemory ? 'memory' : 'postgresql',
      redis: this.redisQueue.useMemory ? 'memory' : 'connected',
      cache: 'active',
      monitoring: this.performanceMonitor.monitoring ? 'active' : 'stopped'
    };

    const performanceMetrics = this.performanceMonitor.getMetrics();
    const systemHealth = performanceMetrics.current;

    return {
      status: 'healthy',
      timestamp: new Date(),
      version: '3.0.0',
      environment: this.environment,
      uptime: Math.round(process.uptime()),
      components: checks,
      performance: {
        activeScans: systemHealth.activeScans,
        totalScans: systemHealth.totalScans,
        successRate: systemHealth.totalScans > 0 
          ? Math.round((systemHealth.successfulScans / systemHealth.totalScans) * 100)
          : 100,
        averageResponseTime: systemHealth.averageResponseTime
      }
    };
  }

  async start() {
    await this.init();

    this.server = this.app.listen(this.port, () => {
      console.log(`🌐 Scalable Accessibility Server running on port ${this.port}`);
      console.log(`📊 Environment: ${this.environment}`);
      console.log(`🔗 Health check: http://localhost:${this.port}/health`);
      console.log(`📈 Metrics: http://localhost:${this.port}/metrics`);
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());

    return this.server;
  }

  async gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated...');

    if (this.server) {
      this.server.close();
    }

    // Stop monitoring
    this.performanceMonitor.stop();
    this.cacheManager.stop();

    // Close connections
    await Promise.all([
      this.database.close(),
      this.redisQueue.close(),
      this.batchProcessor.close(),
      this.websiteScanner.close(),
      this.enhancedScanner.close(),
      this.screenReaderScanner.close()
    ]);

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  }
}

// Export both class and instance for different usage patterns
module.exports = ScalableAccessibilityServer;

// CLI usage
if (require.main === module) {
  const server = new ScalableAccessibilityServer();
  server.start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}