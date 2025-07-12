const NavigationDiscovery = require('./src/navigation-discovery');

/**
 * Test Navigation Discovery on various websites
 */
async function testNavigationDiscovery() {
  const navDiscovery = new NavigationDiscovery();
  
  try {
    console.log('🧪 Testing Navigation Discovery...\n');
    
    // Test websites
    const testSites = [
      'http://localhost:3000/test-html/multi-page-sites/corporate-site/index.html',
      'http://localhost:3000/test-html/multi-page-sites/ecommerce-site/index.html',
      'https://beeproduced.com'
    ];
    
    for (const site of testSites) {
      console.log(`\n🔍 Testing: ${site}`);
      console.log('='.repeat(60));
      
      try {
        const discovered = await navDiscovery.discoverNavigation(site, {
          maxDepth: 2,
          timeout: 15000
        });
        
        if (discovered.length === 0) {
          console.log('❌ No navigation found');
          continue;
        }
        
        // Rank by importance
        const ranked = navDiscovery.rankNavigationElements(discovered);
        
        console.log(`✅ Found ${ranked.length} navigation links:`);
        console.log();
        
        // Show top 10 most important links
        ranked.slice(0, 10).forEach((link, index) => {
          console.log(`${index + 1}. [Score: ${link.importance}] ${link.text || 'No text'}`);
          console.log(`   URL: ${link.url}`);
          console.log(`   Type: ${link.containerType}`);
          console.log(`   Position: y=${Math.round(link.position.y)}`);
          console.log();
        });
        
        // Summary statistics
        const containerTypes = {};
        ranked.forEach(link => {
          containerTypes[link.containerType] = (containerTypes[link.containerType] || 0) + 1;
        });
        
        console.log('📊 Container Type Distribution:');
        Object.entries(containerTypes).forEach(([type, count]) => {
          console.log(`   ${type}: ${count} links`);
        });
        
      } catch (error) {
        console.log(`❌ Error testing ${site}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await navDiscovery.close();
  }
}

// Run tests
if (require.main === module) {
  testNavigationDiscovery()
    .then(() => console.log('\n✅ Navigation discovery tests completed'))
    .catch(error => console.error('❌ Tests failed:', error));
}

module.exports = testNavigationDiscovery;