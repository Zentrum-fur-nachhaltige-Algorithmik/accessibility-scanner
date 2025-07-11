const crypto = require('crypto');

class CacheManager {
  constructor(options = {}) {
    this.options = {
      ttl: options.ttl || 3600000, // 1 hour default
      maxSize: options.maxSize || 1000, // max number of cached items
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      enableCompression: options.enableCompression || true,
      redisClient: options.redisClient || null
    };
    
    // In-memory cache as fallback
    this.memoryCache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };
    
    this.useRedis = !!this.options.redisClient;
    this.cleanupTimer = null;
    
    this.startCleanup();
  }

  generateKey(url, options = {}) {
    // Create a deterministic cache key based on URL and scan options
    const keyData = {
      url: url.toLowerCase().trim(),
      scanType: options.scanType || 'enhanced',
      wcagLevel: options.wcagLevel || 'AA',
      includeWarnings: options.includeWarnings || false,
      testKeyboardNav: options.testKeyboardNav || false
    };
    
    const keyString = JSON.stringify(keyData);
    return crypto.createHash('sha256').update(keyString).digest('hex').substring(0, 16);
  }

  async get(key) {
    try {
      let cachedData = null;
      
      if (this.useRedis) {
        cachedData = await this.getFromRedis(key);
      }
      
      if (!cachedData) {
        cachedData = this.getFromMemory(key);
      }
      
      if (cachedData) {
        this.cacheStats.hits++;
        
        // Check if data is still valid
        if (this.isExpired(cachedData)) {
          await this.delete(key);
          this.cacheStats.misses++;
          return null;
        }
        
        console.log(`💾 Cache HIT for key: ${key}`);
        return this.deserializeData(cachedData.data);
      }
      
      this.cacheStats.misses++;
      console.log(`💨 Cache MISS for key: ${key}`);
      return null;
      
    } catch (error) {
      console.error('Error getting from cache:', error);
      this.cacheStats.misses++;
      return null;
    }
  }

  async set(key, data, customTtl = null) {
    try {
      const ttl = customTtl || this.options.ttl;
      const cacheItem = {
        data: this.serializeData(data),
        timestamp: Date.now(),
        ttl: ttl,
        expires: Date.now() + ttl,
        size: this.calculateSize(data)
      };
      
      if (this.useRedis) {
        await this.setToRedis(key, cacheItem);
      }
      
      this.setToMemory(key, cacheItem);
      
      this.cacheStats.sets++;
      console.log(`💾 Cached data for key: ${key} (TTL: ${Math.round(ttl/1000)}s)`);
      
    } catch (error) {
      console.error('Error setting cache:', error);
    }
  }

  async delete(key) {
    try {
      if (this.useRedis) {
        await this.deleteFromRedis(key);
      }
      
      const deleted = this.memoryCache.delete(key);
      
      if (deleted) {
        this.cacheStats.deletes++;
        console.log(`🗑️  Deleted cache key: ${key}`);
      }
      
      return deleted;
      
    } catch (error) {
      console.error('Error deleting from cache:', error);
      return false;
    }
  }

  async getFromRedis(key) {
    if (!this.options.redisClient) return null;
    
    try {
      const cacheKey = `cache:${key}`;
      const data = await this.options.redisClient.get(cacheKey);
      
      if (data) {
        return JSON.parse(data);
      }
      
      return null;
      
    } catch (error) {
      console.warn('Redis cache get failed:', error.message);
      return null;
    }
  }

  async setToRedis(key, cacheItem) {
    if (!this.options.redisClient) return;
    
    try {
      const cacheKey = `cache:${key}`;
      const ttlSeconds = Math.ceil(cacheItem.ttl / 1000);
      
      await this.options.redisClient.setEx(
        cacheKey, 
        ttlSeconds, 
        JSON.stringify(cacheItem)
      );
      
    } catch (error) {
      console.warn('Redis cache set failed:', error.message);
    }
  }

  async deleteFromRedis(key) {
    if (!this.options.redisClient) return;
    
    try {
      const cacheKey = `cache:${key}`;
      await this.options.redisClient.del(cacheKey);
      
    } catch (error) {
      console.warn('Redis cache delete failed:', error.message);
    }
  }

  getFromMemory(key) {
    return this.memoryCache.get(key) || null;
  }

  setToMemory(key, cacheItem) {
    // Check if we need to evict items due to size limit
    if (this.memoryCache.size >= this.options.maxSize) {
      this.evictOldest();
    }
    
    this.memoryCache.set(key, cacheItem);
  }

  evictOldest() {
    // Find the oldest cache entry and remove it
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, item] of this.memoryCache.entries()) {
      if (item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
      this.cacheStats.evictions++;
      console.log(`⏰ Evicted oldest cache entry: ${oldestKey}`);
    }
  }

  isExpired(cacheItem) {
    return Date.now() > cacheItem.expires;
  }

  serializeData(data) {
    if (this.options.enableCompression) {
      // Simple compression by removing whitespace from JSON
      return JSON.stringify(data);
    }
    return data;
  }

  deserializeData(data) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (error) {
        console.warn('Failed to parse cached data:', error);
        return data;
      }
    }
    return data;
  }

  calculateSize(data) {
    // Rough estimation of data size in bytes
    const jsonString = JSON.stringify(data);
    return new Blob([jsonString]).size || jsonString.length;
  }

  startCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
    
    console.log(`🧹 Cache cleanup scheduled every ${Math.round(this.options.cleanupInterval/1000)}s`);
  }

  cleanup() {
    const now = Date.now();
    let expiredCount = 0;
    
    // Clean up expired items from memory cache
    for (const [key, item] of this.memoryCache.entries()) {
      if (this.isExpired(item)) {
        this.memoryCache.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      console.log(`🧹 Cleaned up ${expiredCount} expired cache entries`);
    }
    
    // Redis cleanup is handled automatically by TTL
  }

  async clear() {
    try {
      if (this.useRedis) {
        // Clear Redis cache keys
        const keys = await this.options.redisClient.keys('cache:*');
        if (keys.length > 0) {
          await this.options.redisClient.del(keys);
        }
      }
      
      this.memoryCache.clear();
      
      // Reset stats
      this.cacheStats = {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        evictions: 0
      };
      
      console.log('🗑️  Cache cleared completely');
      
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  getStats() {
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 
      ? Math.round((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100)
      : 0;
    
    return {
      ...this.cacheStats,
      hitRate,
      memorySize: this.memoryCache.size,
      maxSize: this.options.maxSize,
      redisEnabled: this.useRedis,
      ttl: this.options.ttl
    };
  }

  // Utility methods for specific scan types
  async getScanResult(url, options = {}) {
    const key = this.generateKey(url, options);
    return await this.get(key);
  }

  async setScanResult(url, result, options = {}, customTtl = null) {
    const key = this.generateKey(url, options);
    await this.set(key, result, customTtl);
    return key;
  }

  async invalidateUrl(url) {
    // Invalidate all cached results for a specific URL
    const patterns = ['enhanced', 'basic', 'screen-reader'].map(scanType => {
      return this.generateKey(url, { scanType });
    });
    
    let invalidated = 0;
    for (const key of patterns) {
      const deleted = await this.delete(key);
      if (deleted) invalidated++;
    }
    
    console.log(`🔄 Invalidated ${invalidated} cache entries for ${url}`);
    return invalidated;
  }

  async warmup(urls, options = {}) {
    // Pre-warm cache with frequently accessed URLs
    console.log(`🔥 Starting cache warmup for ${urls.length} URLs`);
    
    const results = [];
    for (const url of urls) {
      try {
        const key = this.generateKey(url, options);
        const existing = await this.get(key);
        
        results.push({
          url,
          key,
          cached: !!existing,
          action: existing ? 'skip' : 'warm'
        });
        
      } catch (error) {
        results.push({
          url,
          error: error.message,
          action: 'error'
        });
      }
    }
    
    const cached = results.filter(r => r.cached).length;
    console.log(`🔥 Cache warmup complete: ${cached}/${urls.length} already cached`);
    
    return results;
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    console.log('🛑 Cache manager stopped');
  }
}

module.exports = CacheManager;