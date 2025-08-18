const fs = require('fs-extra');
const path = require('path');

/**
 * Debug the violations table rendering issue
 */
async function debugViolationsTable() {
  console.log('🔍 Debugging Violations Table Rendering Issue');
  
  try {
    // Read the violations data from one of our test reports
    const violationsPath = '/mnt/c/Users/T14/Desktop/accessability/reports/interactive-289e5a1d-961c-441e-985b-9b5b18e0a92c/data/violations.json';
    const violations = await fs.readJson(violationsPath);
    
    console.log(`📊 Loaded ${violations.length} violations`);
    console.log(`📋 Sample violation structure:`, JSON.stringify(violations[0], null, 2));
    
    // Test the table generation function
    const tableHTML = generateViolationsTableHTML(violations);
    console.log(`📄 Generated table HTML length: ${tableHTML.length} chars`);
    console.log(`📄 First 500 chars:`, tableHTML.substring(0, 500));
    
    // Check for specific issues
    const issues = [];
    
    violations.forEach((violation, index) => {
      if (!violation.id) issues.push(`Missing id at index ${index}`);
      if (!violation.impact) issues.push(`Missing impact at index ${index}`);
      if (!violation.description && !violation.help) issues.push(`Missing description/help at index ${index}`);
      
      // Check for problematic characters
      const desc = violation.description || violation.help || '';
      if (desc.includes('`')) issues.push(`Backtick in description at index ${index}`);
      if (desc.includes('${')) issues.push(`Template literal in description at index ${index}`);
    });
    
    if (issues.length > 0) {
      console.log('❌ Data Issues Found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('✅ No obvious data issues found');
    }
    
    // Write test HTML file
    const testHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Violations Table Test</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .violations-table { border-collapse: collapse; width: 100%; }
        .violations-table th, .violations-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .violations-table th { background-color: #f2f2f2; }
        .impact-badge { padding: 2px 6px; border-radius: 3px; }
        .impact-badge.critical { background: #fee2e2; color: #991b1b; }
        .impact-badge.serious { background: #fef3c7; color: #92400e; }
        .impact-badge.moderate { background: #dbeafe; color: #1e40af; }
        .impact-badge.minor { background: #d1fae5; color: #065f46; }
    </style>
</head>
<body>
    <h1>Violations Table Debug Test</h1>
    <div class="violations-table-container">
        ${tableHTML}
    </div>
</body>
</html>`;
    
    await fs.writeFile('/mnt/c/Users/T14/Desktop/accessability/debug-violations-table.html', testHTML);
    console.log('📄 Test HTML file created: debug-violations-table.html');
    
  } catch (error) {
    console.error('❌ Debug error:', error);
  }
}

function generateViolationsTableHTML(violations) {
  return `
      <table class="violations-table">
          <thead>
              <tr>
                  <th>ID</th>
                  <th>Impact</th>
                  <th>Description</th>
                  <th>WCAG</th>
                  <th>Elements</th>
              </tr>
          </thead>
          <tbody>
              ${violations.map(violation => `
                  <tr class="violation-row ${violation.impact}">
                      <td><code>${violation.id}</code></td>
                      <td><span class="impact-badge ${violation.impact}">${violation.impact}</span></td>
                      <td>${escapeHTML(violation.description || violation.help)}</td>
                      <td>${(violation.tags?.filter(tag => tag.startsWith('wcag')) || []).join(', ')}</td>
                      <td>${violation.nodes?.length || 0} elements</td>
                  </tr>
              `).join('')}
          </tbody>
      </table>
  `;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

debugViolationsTable();