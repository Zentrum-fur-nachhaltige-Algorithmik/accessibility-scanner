const { BrowserPoolManager } = require('../../src/base/browser-pool-manager');

const BROWSER_POOL_PERFORMANCE_TESTS = [
  {
    name: 'Memory Usage Optimization',
    testFunction: async () => {
      const poolManager = new BrowserPoolManager({ maxBrowsers: 3 });
      const startMemory = process.memoryUsage().heapUsed;
      
      // Create multiple pages with same browser type
      const pages = [];
      for (let i = 0; i < 10; i++) {
        const page = await poolManager.getPage('csp-bypass');
        pages.push(page);
      }
      
      const midMemory = process.memoryUsage().heapUsed;
      
      // Close pages
      await Promise.all(pages.map(page => page.close()));
      await poolManager.closeAllBrowsers();
      
      const endMemory = process.memoryUsage().heapUsed;
      
      return {
        startMemory: Math.round(startMemory / 1024 / 1024),
        midMemory: Math.round(midMemory / 1024 / 1024),
        endMemory: Math.round(endMemory / 1024 / 1024),
        memoryIncrease: Math.round((midMemory - startMemory) / 1024 / 1024),
        expectedMaxIncrease: 150 // MB
      };
    },
    validation: (result) => result.memoryIncrease < result.expectedMaxIncrease,
    description: 'Browser pool should limit memory usage to <150MB increase'
  },
  {
    name: 'Browser Instance Reuse',
    testFunction: async () => {
      const poolManager = new BrowserPoolManager({ maxBrowsers: 2 });
      
      const browser1a = await poolManager.getBrowser('csp-bypass');
      const browser1b = await poolManager.getBrowser('csp-bypass');
      const browser2a = await poolManager.getBrowser('strict');
      
      await poolManager.closeAllBrowsers();
      
      return {
        sameTypeReused: browser1a === browser1b,
        differentTypesUnique: browser1a !== browser2a,
        totalBrowsersCreated: poolManager.browsers.size
      };
    },
    validation: (result) => result.sameTypeReused && result.differentTypesUnique,
    description: 'Browser pool should reuse instances of same type'
  },
  {
    name: 'Browser Creation Speed',
    testFunction: async () => {
      const poolManager = new BrowserPoolManager();
      
      // Test cold start
      const coldStart = Date.now();
      await poolManager.getBrowser('csp-bypass');
      const coldTime = Date.now() - coldStart;
      
      // Test warm retrieval
      const warmStart = Date.now();
      await poolManager.getBrowser('csp-bypass');
      const warmTime = Date.now() - warmStart;
      
      await poolManager.closeAllBrowsers();
      
      return {
        coldStartTime: coldTime,
        warmRetrievalTime: warmTime,
        speedImprovement: coldTime / warmTime
      };
    },
    validation: (result) => result.warmRetrievalTime < 100 && result.speedImprovement > 10,
    description: 'Browser retrieval should be <100ms after cold start'
  }
];

async function runBrowserPoolPerformanceTests() {
  console.log('⚡ Testing Browser Pool Performance...');
  let passed = 0, failed = 0;
  
  for (const test of BROWSER_POOL_PERFORMANCE_TESTS) {
    try {
      const result = await test.testFunction();
      
      if (test.validation(result)) {
        console.log(`✅ ${test.name}: PASS`);
        console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
        passed++;
      } else {
        console.log(`❌ ${test.name}: FAIL`);
        console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR - ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Browser Pool Performance Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed, total: BROWSER_POOL_PERFORMANCE_TESTS.length };
}

module.exports = { runBrowserPoolPerformanceTests };