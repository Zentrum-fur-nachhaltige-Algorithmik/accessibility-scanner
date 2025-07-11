const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

class Database {
  constructor(options = {}) {
    this.pool = null;
    this.config = {
      user: options.user || process.env.DB_USER || 'postgres',
      host: options.host || process.env.DB_HOST || 'localhost',
      database: options.database || process.env.DB_NAME || 'accessibility_checker',
      password: options.password || process.env.DB_PASSWORD || 'password',
      port: options.port || process.env.DB_PORT || 5432,
      max: options.max || 20,
      idleTimeoutMillis: options.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: options.connectionTimeoutMillis || 5000,
    };
    this.useMemory = false;
    this.memoryStorage = {
      reports: new Map(),
      scans: new Map(),
      batches: new Map()
    };
  }

  async init() {
    try {
      this.pool = new Pool(this.config);
      
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      console.log(`🗄️  Connected to PostgreSQL at ${this.config.host}:${this.config.port}`);
      
      // Initialize database schema
      await this.initializeSchema();
      return true;

    } catch (error) {
      console.log(`⚠️  PostgreSQL not available: ${error.message}`);
      console.log(`📝 Falling back to in-memory storage`);
      
      this.useMemory = true;
      return false;
    }
  }

  async initializeSchema() {
    if (this.useMemory) return;

    const schemaSQL = `
      -- Reports table
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url TEXT NOT NULL,
        scan_type VARCHAR(50) NOT NULL,
        accessibility_score INTEGER,
        violations JSONB,
        passes INTEGER,
        page_title TEXT,
        wcag_compliance JSONB,
        categories JSONB,
        keyboard_navigation JSONB,
        heading_structure JSONB,
        landmarks JSONB,
        images JSONB,
        forms JSONB,
        aria_usage JSONB,
        eu_compliance JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        scan_duration INTEGER,
        options JSONB,
        error_message TEXT
      );

      -- Scans table (for multi-page website scans)
      CREATE TABLE IF NOT EXISTS scans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        base_url TEXT NOT NULL,
        scan_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        pages_scanned INTEGER DEFAULT 0,
        total_pages INTEGER,
        overall_score INTEGER,
        common_issues JSONB,
        site_map JSONB,
        errors JSONB,
        options JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        duration INTEGER
      );

      -- Batches table
      CREATE TABLE IF NOT EXISTS batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status VARCHAR(20) DEFAULT 'pending',
        total_jobs INTEGER NOT NULL,
        completed_jobs INTEGER DEFAULT 0,
        failed_jobs INTEGER DEFAULT 0,
        options JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        duration INTEGER
      );

      -- Batch jobs table
      CREATE TABLE IF NOT EXISTS batch_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        duration INTEGER
      );

      -- Indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_reports_url ON reports(url);
      CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
      CREATE INDEX IF NOT EXISTS idx_reports_accessibility_score ON reports(accessibility_score);
      CREATE INDEX IF NOT EXISTS idx_scans_base_url ON scans(base_url);
      CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);
      CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
      CREATE INDEX IF NOT EXISTS idx_batch_jobs_batch_id ON batch_jobs(batch_id);
      CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
    `;

    try {
      await this.pool.query(schemaSQL);
      console.log('📋 Database schema initialized successfully');
    } catch (error) {
      console.error('Error initializing database schema:', error);
      throw error;
    }
  }

  async saveReport(reportData) {
    if (this.useMemory) {
      return this.saveReportMemory(reportData);
    }

    const query = `
      INSERT INTO reports (
        url, scan_type, accessibility_score, violations, passes, page_title,
        wcag_compliance, categories, keyboard_navigation, heading_structure,
        landmarks, images, forms, aria_usage, eu_compliance, scan_duration,
        options, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id, created_at
    `;

    const values = [
      reportData.url,
      reportData.scanType || 'enhanced',
      reportData.accessibilityScore,
      JSON.stringify(reportData.violations || []),
      reportData.passes || 0,
      reportData.pageTitle,
      JSON.stringify(reportData.wcagCompliance || {}),
      JSON.stringify(reportData.categories || {}),
      JSON.stringify(reportData.keyboardNavigation || {}),
      JSON.stringify(reportData.headingStructure || {}),
      JSON.stringify(reportData.landmarks || {}),
      JSON.stringify(reportData.images || {}),
      JSON.stringify(reportData.forms || {}),
      JSON.stringify(reportData.ariaUsage || {}),
      JSON.stringify(reportData.euCompliance || {}),
      reportData.scanDuration,
      JSON.stringify(reportData.options || {}),
      reportData.error
    ];

    try {
      const result = await this.pool.query(query, values);
      const report = result.rows[0];
      
      console.log(`💾 Saved report ${report.id} for ${reportData.url}`);
      return {
        id: report.id,
        createdAt: report.created_at,
        ...reportData
      };

    } catch (error) {
      console.error('Error saving report:', error);
      throw error;
    }
  }

  async saveReportMemory(reportData) {
    const id = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const report = {
      id,
      createdAt: new Date(),
      ...reportData
    };
    
    this.memoryStorage.reports.set(id, report);
    console.log(`💾 Saved report ${id} to memory for ${reportData.url}`);
    return report;
  }

  async getReport(reportId) {
    if (this.useMemory) {
      return this.memoryStorage.reports.get(reportId) || null;
    }

    const query = 'SELECT * FROM reports WHERE id = $1';
    
    try {
      const result = await this.pool.query(query, [reportId]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        url: row.url,
        scanType: row.scan_type,
        accessibilityScore: row.accessibility_score,
        violations: row.violations,
        passes: row.passes,
        pageTitle: row.page_title,
        wcagCompliance: row.wcag_compliance,
        categories: row.categories,
        keyboardNavigation: row.keyboard_navigation,
        headingStructure: row.heading_structure,
        landmarks: row.landmarks,
        images: row.images,
        forms: row.forms,
        ariaUsage: row.aria_usage,
        euCompliance: row.eu_compliance,
        createdAt: row.created_at,
        scanDuration: row.scan_duration,
        options: row.options,
        error: row.error_message
      };

    } catch (error) {
      console.error('Error getting report:', error);
      return null;
    }
  }

  async saveScan(scanData) {
    if (this.useMemory) {
      return this.saveScanMemory(scanData);
    }

    const query = `
      INSERT INTO scans (
        base_url, scan_type, status, pages_scanned, total_pages, overall_score,
        common_issues, site_map, errors, options, started_at, completed_at, duration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, created_at
    `;

    const values = [
      scanData.baseUrl,
      scanData.scanType || 'website',
      scanData.status || 'completed',
      scanData.summary?.pagesScanned || 0,
      scanData.summary?.pagesScanned || 0,
      scanData.summary?.overallScore,
      JSON.stringify(scanData.commonIssues || []),
      JSON.stringify(scanData.siteMap || []),
      JSON.stringify(scanData.errors || []),
      JSON.stringify(scanData.options || {}),
      scanData.startedAt ? new Date(scanData.startedAt) : null,
      scanData.completedAt ? new Date(scanData.completedAt) : null,
      scanData.duration
    ];

    try {
      const result = await this.pool.query(query, values);
      const scan = result.rows[0];
      
      console.log(`💾 Saved scan ${scan.id} for ${scanData.baseUrl}`);
      return {
        id: scan.id,
        createdAt: scan.created_at,
        ...scanData
      };

    } catch (error) {
      console.error('Error saving scan:', error);
      throw error;
    }
  }

  async saveScanMemory(scanData) {
    const id = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const scan = {
      id,
      createdAt: new Date(),
      ...scanData
    };
    
    this.memoryStorage.scans.set(id, scan);
    console.log(`💾 Saved scan ${id} to memory for ${scanData.baseUrl}`);
    return scan;
  }

  async getScan(scanId) {
    if (this.useMemory) {
      return this.memoryStorage.scans.get(scanId) || null;
    }

    const query = 'SELECT * FROM scans WHERE id = $1';
    
    try {
      const result = await this.pool.query(query, [scanId]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        baseUrl: row.base_url,
        scanType: row.scan_type,
        status: row.status,
        summary: {
          pagesScanned: row.pages_scanned,
          overallScore: row.overall_score
        },
        commonIssues: row.common_issues,
        siteMap: row.site_map,
        errors: row.errors,
        options: row.options,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        duration: row.duration
      };

    } catch (error) {
      console.error('Error getting scan:', error);
      return null;
    }
  }

  async getReports(options = {}) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const sortBy = options.sortBy || 'created_at';
    const sortOrder = options.sortOrder || 'DESC';

    if (this.useMemory) {
      const reports = Array.from(this.memoryStorage.reports.values())
        .sort((a, b) => {
          if (sortBy === 'created_at') {
            return sortOrder === 'DESC' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
          }
          return 0;
        })
        .slice(offset, offset + limit);
      
      return {
        reports,
        total: this.memoryStorage.reports.size,
        limit,
        offset
      };
    }

    const countQuery = 'SELECT COUNT(*) FROM reports';
    const dataQuery = `
      SELECT id, url, scan_type, accessibility_score, page_title, created_at, scan_duration
      FROM reports 
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $1 OFFSET $2
    `;

    try {
      const [countResult, dataResult] = await Promise.all([
        this.pool.query(countQuery),
        this.pool.query(dataQuery, [limit, offset])
      ]);

      return {
        reports: dataResult.rows.map(row => ({
          id: row.id,
          url: row.url,
          scanType: row.scan_type,
          accessibilityScore: row.accessibility_score,
          pageTitle: row.page_title,
          createdAt: row.created_at,
          scanDuration: row.scan_duration
        })),
        total: parseInt(countResult.rows[0].count),
        limit,
        offset
      };

    } catch (error) {
      console.error('Error getting reports:', error);
      return { reports: [], total: 0, limit, offset };
    }
  }

  async getStats() {
    if (this.useMemory) {
      const reports = Array.from(this.memoryStorage.reports.values());
      const scans = Array.from(this.memoryStorage.scans.values());
      
      return {
        totalReports: reports.length,
        totalScans: scans.length,
        totalBatches: this.memoryStorage.batches.size,
        averageScore: reports.length > 0 
          ? Math.round(reports.reduce((sum, r) => sum + (r.accessibilityScore || 0), 0) / reports.length)
          : 0,
        reportsToday: reports.filter(r => {
          const today = new Date();
          const reportDate = new Date(r.createdAt);
          return reportDate.toDateString() === today.toDateString();
        }).length
      };
    }

    const query = `
      SELECT 
        COUNT(*) as total_reports,
        AVG(accessibility_score) as average_score,
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as reports_today,
        (SELECT COUNT(*) FROM scans) as total_scans,
        (SELECT COUNT(*) FROM batches) as total_batches
      FROM reports
    `;

    try {
      const result = await this.pool.query(query);
      const row = result.rows[0];

      return {
        totalReports: parseInt(row.total_reports),
        totalScans: parseInt(row.total_scans),
        totalBatches: parseInt(row.total_batches),
        averageScore: Math.round(parseFloat(row.average_score) || 0),
        reportsToday: parseInt(row.reports_today)
      };

    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        totalReports: 0,
        totalScans: 0,
        totalBatches: 0,
        averageScore: 0,
        reportsToday: 0
      };
    }
  }

  async cleanup(olderThanDays = 30) {
    if (this.useMemory) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      for (const [id, report] of this.memoryStorage.reports.entries()) {
        if (report.createdAt < cutoffDate) {
          this.memoryStorage.reports.delete(id);
        }
      }
      return;
    }

    const query = `
      DELETE FROM reports 
      WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
    `;

    try {
      const result = await this.pool.query(query);
      console.log(`🗑️  Cleaned up ${result.rowCount} old reports`);
      return result.rowCount;

    } catch (error) {
      console.error('Error during cleanup:', error);
      return 0;
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('🔌 Database connections closed');
    }
  }
}

module.exports = Database;