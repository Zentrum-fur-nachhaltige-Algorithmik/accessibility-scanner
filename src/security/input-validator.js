const path = require('path');

class InputValidator {
  static validateUrl(url) {
    const allowedProtocols = ['http:', 'https:'];
    const blockedHosts = [
      '127.0.0.1', 'localhost', '::1',
      '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.', 
      '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
      '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
      '169.254.', // Link-local
      '224.', '225.', '226.', '227.', '228.', '229.', '230.', '231.', // Multicast
    ];
    
    try {
      const parsedUrl = new URL(url);
      
      // Protocol validation
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        throw new Error(`Invalid protocol: ${parsedUrl.protocol}. Allowed: ${allowedProtocols.join(', ')}`);
      }
      
      // Host validation
      for (const blocked of blockedHosts) {
        if (parsedUrl.hostname.startsWith(blocked)) {
          throw new Error(`Blocked internal host: ${parsedUrl.hostname}`);
        }
      }
      
      // Block internal domains
      const internalDomains = ['metadata.google.internal', 'instance-data.amazon.com'];
      if (internalDomains.includes(parsedUrl.hostname)) {
        throw new Error(`Blocked internal host: ${parsedUrl.hostname}`);
      }
      
      // Port validation (optional)
      const dangerousPorts = [22, 23, 25, 53, 135, 139, 445, 1433, 1521, 3306, 3389, 5432, 6379, 27017];
      if (parsedUrl.port && dangerousPorts.includes(parseInt(parsedUrl.port))) {
        throw new Error(`Blocked dangerous port: ${parsedUrl.port}`);
      }
      
      return { valid: true, url: parsedUrl.href };
    } catch (error) {
      throw new Error(`URL validation failed: ${error.message}`);
    }
  }
  
  static sanitizePath(filePath) {
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..') || normalizedPath.startsWith('/')) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    return normalizedPath;
  }
  
  static validateScanOptions(options) {
    const allowedOptions = [
      'timeout', 'viewport', 'includeHidden', 'wcagLevel', 
      'phases', 'screenshots', 'cspBypass', 'securityMode'
    ];
    
    for (const key of Object.keys(options)) {
      if (!allowedOptions.includes(key)) {
        throw new Error(`Invalid scan option: ${key}`);
      }
    }
    
    if (options.timeout && (options.timeout < 1000 || options.timeout > 300000)) {
      throw new Error('Timeout must be between 1000ms and 300000ms');
    }
    
    return options;
  }
}

module.exports = { InputValidator };