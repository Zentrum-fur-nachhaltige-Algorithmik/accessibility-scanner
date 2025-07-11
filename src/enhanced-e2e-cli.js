#!/usr/bin/env node

/**
 * Enhanced E2E Testing CLI
 * Command-line interface for the comprehensive testing system
 */

const fs = require('fs-extra');
const path = require('path');
const ComprehensiveTestRunner = require('./comprehensive-test-runner');

class EnhancedE2ECLI {
    constructor() {
        this.runner = null;
        this.commands = {
            'single': this.runSingleTest.bind(this),
            'batch': this.runBatchTest.bind(this),
            'suite': this.runTestSuite.bind(this),
            'config': this.manageConfig.bind(this),
            'status': this.showStatus.bind(this),
            'help': this.showHelp.bind(this)
        };
    }

    async run() {
        try {
            const args = process.argv.slice(2);
            
            if (args.length === 0) {
                this.showHelp();
                return;
            }

            const command = args[0];
            const options = this.parseOptions(args.slice(1));

            if (!this.commands[command]) {
                console.error(`❌ Unknown command: ${command}`);
                this.showHelp();
                process.exit(1);
            }

            // Initialize runner
            this.runner = new ComprehensiveTestRunner(options);
            await this.runner.initialize();

            // Execute command
            await this.commands[command](options);

        } catch (error) {
            console.error('❌ CLI Error:', error.message);
            if (options.debug) {
                console.error(error.stack);
            }
            process.exit(1);
        } finally {
            if (this.runner) {
                await this.runner.cleanup();
            }
        }
    }

    parseOptions(args) {
        const options = {};
        
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            
            if (arg.startsWith('--')) {
                const key = arg.substring(2);
                
                if (args[i + 1] && !args[i + 1].startsWith('--')) {
                    // Value parameter
                    options[key] = this.parseValue(args[i + 1]);
                    i++; // Skip the value
                } else {
                    // Boolean parameter
                    options[key] = true;
                }
            }
        }
        
        return options;
    }

    parseValue(value) {
        // Try to parse as JSON first
        try {
            return JSON.parse(value);
        } catch {
            // Return as string if not valid JSON
            return value;
        }
    }

    async runSingleTest(options) {
        if (!options.url) {
            console.error('❌ --url parameter is required for single test');
            process.exit(1);
        }

        console.log(`🧪 Running single test: ${options.url}`);
        
        const customConfig = {};
        if (options.config) {
            const configPath = path.resolve(options.config);
            customConfig = await fs.readJSON(configPath);
        }

        // Apply CLI overrides
        if (options.maxViolations !== undefined) {
            customConfig.maxViolations = options.maxViolations;
        }
        if (options.performanceThreshold !== undefined) {
            customConfig.performanceThreshold = options.performanceThreshold;
        }
        if (options.headless !== undefined) {
            customConfig.headless = options.headless;
        }

        const result = await this.runner.runSingleTest(options.url, customConfig);
        
        console.log(`\n📊 Test Results:`);
        console.log(`Status: ${result.status.toUpperCase()}`);
        console.log(`Score: ${result.result.validation.score}/100`);
        console.log(`Duration: ${result.duration}ms`);
        
        if (result.result.accessibility?.violations_count > 0) {
            console.log(`Violations: ${result.result.accessibility.violations_count}`);
        }

        if (options.json) {
            console.log(`\n📄 JSON Output:`);
            console.log(JSON.stringify(result, null, 2));
        }
    }

    async runBatchTest(options) {
        let urls = [];
        
        if (options.urls) {
            // Comma-separated URLs
            urls = options.urls.split(',').map(url => url.trim());
        } else if (options.file) {
            // URLs from file
            const filePath = path.resolve(options.file);
            const content = await fs.readFile(filePath, 'utf8');
            urls = content.split('\n').map(line => line.trim()).filter(line => line);
        } else {
            console.error('❌ Either --urls or --file parameter is required for batch test');
            process.exit(1);
        }

        console.log(`🚀 Running batch test with ${urls.length} URLs`);
        
        const customConfig = {};
        if (options.config) {
            const configPath = path.resolve(options.config);
            customConfig = await fs.readJSON(configPath);
        }

        // Apply CLI overrides
        if (options.concurrent !== undefined) {
            customConfig.maxConcurrent = options.concurrent;
        }

        const result = await this.runner.runBatchTest(urls, customConfig);
        
        console.log(`\n📊 Batch Results:`);
        console.log(`Total: ${result.progress.total}`);
        console.log(`Passed: ${result.progress.completed}`);
        console.log(`Failed: ${result.progress.failed}`);
        console.log(`Success Rate: ${result.progress.percentage}%`);

        if (options.json) {
            console.log(`\n📄 JSON Output:`);
            console.log(JSON.stringify(result, null, 2));
        }
    }

    async runTestSuite(options) {
        if (!options.suite) {
            console.error('❌ --suite parameter is required for test suite');
            process.exit(1);
        }

        const suitePath = path.resolve(options.suite);
        const testSuite = await fs.readJSON(suitePath);
        
        console.log(`🎯 Running test suite: ${testSuite.name || 'Unnamed'}`);
        
        const result = await this.runner.runTestSuite(testSuite);
        
        console.log(`\n📊 Suite Results:`);
        console.log(`Tests: ${result.summary.total}`);
        console.log(`Passed: ${result.summary.passed}`);
        console.log(`Failed: ${result.summary.failed}`);
        console.log(`Duration: ${result.summary.duration}ms`);

        if (options.json) {
            console.log(`\n📄 JSON Output:`);
            console.log(JSON.stringify(result, null, 2));
        }
    }

    async manageConfig(options) {
        if (options.show) {
            const config = this.runner.getConfiguration();
            console.log('📋 Current Configuration:');
            console.log(JSON.stringify(config, null, 2));
        } else if (options.set) {
            const [key, value] = options.set.split('=');
            const config = this.runner.getConfiguration();
            
            // Set nested property
            const keys = key.split('.');
            let current = config;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = this.parseValue(value);
            
            await this.runner.updateConfiguration(config);
            console.log(`✅ Configuration updated: ${key} = ${value}`);
        } else if (options.reset) {
            // Reset to default configuration
            const defaultConfig = new ComprehensiveTestRunner().getDefaultConfiguration();
            await this.runner.updateConfiguration(defaultConfig);
            console.log('✅ Configuration reset to defaults');
        } else {
            console.log('Usage: config [--show] [--set key=value] [--reset]');
        }
    }

    async showStatus(options) {
        const metrics = this.runner.getSystemMetrics();
        const activeSessions = this.runner.getActiveSessions();
        
        console.log('📈 System Status:');
        console.log(`Total Tests: ${metrics.totalTests}`);
        console.log(`Passed: ${metrics.passedTests}`);
        console.log(`Failed: ${metrics.failedTests}`);
        console.log(`Success Rate: ${metrics.successRate}%`);
        console.log(`Isolated Failures: ${metrics.isolatedFailures}`);
        console.log(`Active Sessions: ${activeSessions.length}`);
        
        if (metrics.startTime) {
            console.log(`Runtime: ${Math.round(metrics.duration / 1000)}s`);
        }

        if (options.detailed && activeSessions.length > 0) {
            console.log('\n🔄 Active Sessions:');
            activeSessions.forEach(session => {
                console.log(`- ${session.id}: ${session.status}`);
            });
        }
    }

    showHelp() {
        console.log(`
🧪 Enhanced E2E Testing CLI

USAGE:
  enhanced-e2e-cli <command> [options]

COMMANDS:
  single                Run a single website test
  batch                 Run batch testing for multiple websites
  suite                 Run a predefined test suite
  config                Manage configuration
  status                Show system status
  help                  Show this help

SINGLE TEST OPTIONS:
  --url <url>           Website URL to test (required)
  --config <file>       Custom configuration file
  --maxViolations <n>   Maximum allowed violations
  --performanceThreshold <ms>  Performance threshold in milliseconds
  --headless <bool>     Run in headless mode (true/false)
  --json                Output results in JSON format

BATCH TEST OPTIONS:
  --urls <urls>         Comma-separated URLs
  --file <file>         File containing URLs (one per line)
  --config <file>       Custom configuration file
  --concurrent <n>      Number of concurrent tests
  --json                Output results in JSON format

TEST SUITE OPTIONS:
  --suite <file>        Test suite JSON file (required)
  --json                Output results in JSON format

CONFIG OPTIONS:
  --show                Show current configuration
  --set <key=value>     Set configuration value (e.g., batch.maxConcurrent=5)
  --reset               Reset to default configuration

STATUS OPTIONS:
  --detailed            Show detailed status information

GLOBAL OPTIONS:
  --debug               Enable debug mode
  --help                Show this help

EXAMPLES:
  # Single test
  enhanced-e2e-cli single --url="https://example.com"
  
  # Batch test from URLs
  enhanced-e2e-cli batch --urls="https://site1.com,https://site2.com"
  
  # Batch test from file
  enhanced-e2e-cli batch --file="urls.txt" --concurrent=5
  
  # Run test suite
  enhanced-e2e-cli suite --suite="test-suite.json"
  
  # Show configuration
  enhanced-e2e-cli config --show
  
  # Update configuration
  enhanced-e2e-cli config --set="batch.maxConcurrent=10"
  
  # Show system status
  enhanced-e2e-cli status --detailed

CONFIGURATION:
  Configuration files should be in JSON format. Use 'config --show' to see
  the current configuration structure.

FAILED TEST ISOLATION:
  Failed tests are automatically isolated in test-results/failed-tests/
  Each isolated test contains:
  - failure-report.json (detailed failure analysis)
  - screenshots/ (captured screenshots)
  - html-snapshot.html (HTML at time of failure)
  - debug-info.json (technical debugging information)
  - retry-instructions.md (how to retry the test)

OUTPUT:
  Reports are generated in test-results/reports/ in multiple formats:
  - JSON (programmatic analysis)
  - HTML (human-readable)
  - CSV (spreadsheet analysis)

For more information, see the documentation or visit:
https://github.com/your-repo/enhanced-e2e-testing
        `);
    }
}

// Run CLI if this file is executed directly
if (require.main === module) {
    const cli = new EnhancedE2ECLI();
    cli.run().catch(error => {
        console.error('Unhandled CLI error:', error);
        process.exit(1);
    });
}

module.exports = EnhancedE2ECLI;