# Phase 6F: EAA Procedural Requirements - Implementation Plan

## Executive Summary

**Can Phase 6F be implemented without Phase 6E?** ✅ **YES**

Phase 6F focuses on **European Accessibility Act (EAA) procedural/organizational requirements**, while Phase 6E deals with **technical WCAG input modalities and timing**. These domains are completely independent.

## Phase 6F Overview

**Timeline:** Woche 11-12 (2 weeks)  
**Focus:** EU legal compliance and organizational requirements  
**Dependencies:** ❌ None (independent of Phase 6E)

---

## 6F.1: Accessibility Statement Scanner

### Interface Definition
```typescript
interface AccessibilityStatementScanner {
  scanAccessibilityStatement(url: string, options?: StatementOptions): Promise<AccessibilityStatementReport>
  
  interface StatementOptions {
    searchDepth: number // How many levels deep to search for statement
    timeout: number
    language: string // Expected statement language
  }
  
  interface AccessibilityStatementReport {
    criteria: ["EAA-Statement", "EN-301-549-12.1.1"] 
    passed: boolean
    violations: StatementViolation[]
    summary: {
      statementExists: boolean
      statementAccessible: boolean
      statementComplete: boolean
      contactMechanismProvided: boolean
      lastUpdated: Date | null
      complianceLevel: 'A' | 'AA' | 'AAA' | 'partial' | 'non-compliant' | null
      knownIssuesListed: boolean
      feedbackMechanismAvailable: boolean
    }
  }
  
  interface StatementViolation {
    criterion: "EAA-Statement" | "EN-301-549-12.1.1"
    issue: 'missing-statement' | 'inaccessible-statement' | 'incomplete-content' | 
           'missing-contact' | 'outdated-statement' | 'missing-compliance-level' |
           'missing-known-issues' | 'missing-feedback-mechanism'
    description: string
    element?: string
    suggestion: string
    severity: 'critical' | 'major' | 'minor'
  }
}
```

### Test Cases

#### Test Case 1: Complete Good Accessibility Statement
**Input:** `https://example-good-gov.eu`
**Mock Page Content:**
```html
<footer>
  <a href="/accessibility-statement">Accessibility Statement</a>
</footer>

<!-- /accessibility-statement page -->
<main>
  <h1>Accessibility Statement</h1>
  <p>Last updated: <time datetime="2024-12-01">December 1, 2024</time></p>
  
  <h2>Compliance Level</h2>
  <p>This website is fully compliant with WCAG 2.1 AA standards.</p>
  
  <h2>Known Issues</h2>
  <ul>
    <li>PDF documents from before 2023 may not be fully accessible. We are working to update these.</li>
  </ul>
  
  <h2>Contact Us</h2>
  <p>If you experience accessibility issues, please contact us:</p>
  <ul>
    <li>Email: <a href="mailto:accessibility@example-good-gov.eu">accessibility@example-good-gov.eu</a></li>
    <li>Phone: +49 (0)30 12345678</li>
    <li>Online form: <a href="/accessibility-feedback">Submit accessibility feedback</a></li>
  </ul>
  
  <h2>Enforcement Procedure</h2>
  <p>If you are not satisfied with our response, you can contact the federal equality office.</p>
</main>
```

**Expected Output:**
```json
{
  "criteria": ["EAA-Statement", "EN-301-549-12.1.1"],
  "passed": true,
  "violations": [],
  "summary": {
    "statementExists": true,
    "statementAccessible": true,
    "statementComplete": true,
    "contactMechanismProvided": true,
    "lastUpdated": "2024-12-01T00:00:00.000Z",
    "complianceLevel": "AA",
    "knownIssuesListed": true,
    "feedbackMechanismAvailable": true
  }
}
```

#### Test Case 2: Missing Accessibility Statement
**Input:** `https://example-bad-company.com`
**Mock Page Content:**
```html
<footer>
  <a href="/privacy">Privacy Policy</a>
  <a href="/terms">Terms of Service</a>
  <!-- No accessibility statement link -->
</footer>
```

**Expected Output:**
```json
{
  "criteria": ["EAA-Statement", "EN-301-549-12.1.1"],
  "passed": false,
  "violations": [
    {
      "criterion": "EAA-Statement",
      "issue": "missing-statement",
      "description": "No accessibility statement found on the website",
      "suggestion": "Create an accessibility statement page and link it from the main navigation or footer",
      "severity": "critical"
    }
  ],
  "summary": {
    "statementExists": false,
    "statementAccessible": false,
    "statementComplete": false,
    "contactMechanismProvided": false,
    "lastUpdated": null,
    "complianceLevel": null,
    "knownIssuesListed": false,
    "feedbackMechanismAvailable": false
  }
}
```

#### Test Case 3: Incomplete Accessibility Statement
**Input:** `https://example-incomplete.org`
**Mock Page Content:**
```html
<footer>
  <a href="/accessibility">Accessibility</a>
</footer>

<!-- /accessibility page -->
<main>
  <h1>Accessibility</h1>
  <p>We care about accessibility.</p>
  <!-- Missing: compliance level, last updated, contact info, known issues -->
</main>
```

**Expected Output:**
```json
{
  "criteria": ["EAA-Statement", "EN-301-549-12.1.1"],
  "passed": false,
  "violations": [
    {
      "criterion": "EAA-Statement",
      "issue": "incomplete-content",
      "description": "Accessibility statement lacks required information: compliance level",
      "element": "main",
      "suggestion": "Add compliance level (A, AA, AAA, partial, or non-compliant)",
      "severity": "major"
    },
    {
      "criterion": "EAA-Statement", 
      "issue": "missing-contact",
      "description": "No contact mechanism provided for accessibility issues",
      "element": "main",
      "suggestion": "Add contact information (email, phone, or feedback form) for accessibility issues",
      "severity": "critical"
    },
    {
      "criterion": "EAA-Statement",
      "issue": "outdated-statement",
      "description": "No last updated date found or statement is older than 12 months",
      "element": "main", 
      "suggestion": "Add last updated date and ensure statement is reviewed at least annually",
      "severity": "major"
    }
  ],
  "summary": {
    "statementExists": true,
    "statementAccessible": true,
    "statementComplete": false,
    "contactMechanismProvided": false,
    "lastUpdated": null,
    "complianceLevel": null,
    "knownIssuesListed": false,
    "feedbackMechanismAvailable": false
  }
}
```

---

## 6F.2: Contact Mechanism Scanner

### Interface Definition
```typescript
interface ContactMechanismScanner {
  scanContactMechanisms(url: string): Promise<ContactMechanismReport>
  
  interface ContactMechanismReport {
    criteria: ["EAA-Contact", "EN-301-549-12.1.2"]
    passed: boolean
    violations: ContactViolation[]
    summary: {
      emailContactAvailable: boolean
      phoneContactAvailable: boolean
      onlineFormAvailable: boolean
      contactAccessible: boolean
      responseTimeStated: boolean
      multipleOptionsAvailable: boolean
    }
  }
  
  interface ContactViolation {
    criterion: "EAA-Contact" | "EN-301-549-12.1.2"
    issue: 'no-contact-methods' | 'inaccessible-contact' | 'insufficient-methods' |
           'no-response-time' | 'invalid-email' | 'invalid-phone'
    description: string
    element?: string
    suggestion: string
    severity: 'critical' | 'major' | 'minor'
  }
}
```

### Test Cases

#### Test Case 4: Complete Contact Mechanisms
**Input:** `https://example-good-contact.eu`
**Mock Page Content:**
```html
<section id="accessibility-contact">
  <h2>Accessibility Contact</h2>
  <p>We respond to accessibility issues within 2 business days.</p>
  
  <h3>Contact Methods</h3>
  <ul>
    <li>Email: <a href="mailto:access@example.eu">access@example.eu</a></li>
    <li>Phone: <a href="tel:+4930123456">+49 (0)30 123456</a></li>
    <li>Online Form: <a href="/feedback-form">Accessibility Feedback Form</a></li>
  </ul>
</section>
```

**Expected Output:**
```json
{
  "criteria": ["EAA-Contact", "EN-301-549-12.1.2"],
  "passed": true,
  "violations": [],
  "summary": {
    "emailContactAvailable": true,
    "phoneContactAvailable": true,
    "onlineFormAvailable": true,
    "contactAccessible": true,
    "responseTimeStated": true,
    "multipleOptionsAvailable": true
  }
}
```

#### Test Case 5: No Contact Mechanisms
**Input:** `https://example-no-contact.com`
**Mock Page Content:**
```html
<main>
  <h1>About Us</h1>
  <p>Welcome to our website.</p>
  <!-- No contact information -->
</main>
```

**Expected Output:**
```json
{
  "criteria": ["EAA-Contact", "EN-301-549-12.1.2"],
  "passed": false,
  "violations": [
    {
      "criterion": "EAA-Contact",
      "issue": "no-contact-methods",
      "description": "No accessibility contact mechanisms found",
      "suggestion": "Provide at least one contact method (email, phone, or online form) for accessibility issues",
      "severity": "critical"
    }
  ],
  "summary": {
    "emailContactAvailable": false,
    "phoneContactAvailable": false,
    "onlineFormAvailable": false,
    "contactAccessible": false,
    "responseTimeStated": false,
    "multipleOptionsAvailable": false
  }
}
```

---

## 6F.3: Compliance Monitoring Scanner

### Interface Definition  
```typescript
interface ComplianceMonitoringScanner {
  scanComplianceMonitoring(url: string): Promise<ComplianceMonitoringReport>
  
  interface ComplianceMonitoringReport {
    criteria: ["EAA-Monitoring", "EN-301-549-12.1.3"]
    passed: boolean
    violations: MonitoringViolation[]
    summary: {
      monitoringProcedureDocumented: boolean
      regularAuditsScheduled: boolean
      issueTrackingSystem: boolean
      userFeedbackIntegrated: boolean
      continuousImprovementEvidence: boolean
    }
  }
  
  interface MonitoringViolation {
    criterion: "EAA-Monitoring" | "EN-301-549-12.1.3"
    issue: 'no-monitoring-procedure' | 'no-audit-schedule' | 'no-issue-tracking' |
           'no-user-feedback' | 'no-improvement-evidence'
    description: string
    element?: string
    suggestion: string
    severity: 'critical' | 'major' | 'minor'
  }
}
```

### Test Cases

#### Test Case 6: Well-Documented Monitoring
**Input:** `https://example-good-monitoring.gov`
**Mock Page Content:**
```html
<section id="accessibility-monitoring">
  <h2>Accessibility Monitoring Procedures</h2>
  
  <h3>Regular Audits</h3>
  <p>We conduct comprehensive accessibility audits quarterly using automated tools and manual testing.</p>
  
  <h3>Issue Tracking</h3>
  <p>All accessibility issues are tracked in our <a href="/accessibility-issues">public issue tracker</a>.</p>
  
  <h3>User Feedback</h3>
  <p>User feedback is reviewed weekly and integrated into our improvement roadmap.</p>
  
  <h3>Continuous Improvement</h3>
  <p>See our <a href="/accessibility-improvements">accessibility improvements log</a> for recent updates.</p>
</section>
```

**Expected Output:**
```json
{
  "criteria": ["EAA-Monitoring", "EN-301-549-12.1.3"],
  "passed": true,
  "violations": [],
  "summary": {
    "monitoringProcedureDocumented": true,
    "regularAuditsScheduled": true,
    "issueTrackingSystem": true,
    "userFeedbackIntegrated": true,
    "continuousImprovementEvidence": true
  }
}
```

---

## Integration with Enhanced Scanner

### Enhanced Scanner Updates
```typescript
interface Phase6FOptions {
  includePhase6F: boolean
  searchDepth?: number // For finding accessibility statements
  statementLanguage?: string
}

// In EnhancedAccessibilityScanner.enhancedScan()
if (scanOptions.includePhase6F) {
  scanPromises.push(
    this.accessibilityStatementScanner.scanAccessibilityStatement(url, {
      searchDepth: scanOptions.searchDepth || 3,
      timeout: scanOptions.timeout,
      language: scanOptions.statementLanguage || 'auto'
    }),
    this.contactMechanismScanner.scanContactMechanisms(url),
    this.complianceMonitoringScanner.scanComplianceMonitoring(url)
  );
}

// Phase 6F results integration
interface Phase6FCompliance {
  accessibilityStatement: AccessibilityStatementReport
  contactMechanism: ContactMechanismReport  
  complianceMonitoring: ComplianceMonitoringReport
}

// Add to detailed report
if (phase6FCompliance) {
  report.phase6FCompliance = phase6FCompliance;
  
  // Calculate overall Phase 6F score
  const phase6FTests = [
    phase6FCompliance.accessibilityStatement,
    phase6FCompliance.contactMechanism,
    phase6FCompliance.complianceMonitoring
  ];
  
  const phase6FPassed = phase6FTests.filter(test => test.passed).length;
  const phase6FScore = Math.round((phase6FPassed / phase6FTests.length) * 100);
  
  report.phase6FScore = phase6FScore;
  report.eaaCompliance = {
    proceduralRequirements: {
      accessibilityStatement: phase6FCompliance.accessibilityStatement.passed,
      contactMechanism: phase6FCompliance.contactMechanism.passed,
      monitoringProcedures: phase6FCompliance.complianceMonitoring.passed
    },
    overallScore: phase6FScore
  };
}
```

---

## Test Pages for Phase 6F

### Create Test Pages
```bash
# Good EAA compliance example
test-pages/phase6f-good-eaa-compliance.html

# Bad EAA compliance example (missing statement)
test-pages/phase6f-bad-missing-statement.html

# Incomplete EAA compliance example  
test-pages/phase6f-incomplete-statement.html
```

---

## Implementation Strategy

### Week 1: Core Scanner Development
1. **Day 1-2:** Implement AccessibilityStatementScanner
2. **Day 3-4:** Implement ContactMechanismScanner  
3. **Day 5:** Create test pages and basic testing

### Week 2: Integration & Testing
1. **Day 1-2:** Implement ComplianceMonitoringScanner
2. **Day 3:** Integrate with EnhancedScanner
3. **Day 4:** Comprehensive testing and debugging
4. **Day 5:** Documentation and validation

---

## Success Criteria

### Functional Requirements
- [ ] ✅ Correctly identifies accessibility statements (100% accuracy on test cases)
- [ ] ✅ Validates statement completeness (all required EAA elements)
- [ ] ✅ Detects contact mechanisms (email, phone, forms)
- [ ] ✅ Assesses monitoring procedure documentation
- [ ] ✅ Integrates seamlessly with enhanced scanner
- [ ] ✅ Generates EAA compliance reports

### Performance Requirements  
- [ ] ✅ Scans complete in <10 seconds for typical government sites
- [ ] ✅ Handles multi-language accessibility statements
- [ ] ✅ Works across different site architectures

### Legal Compliance
- [ ] ✅ Covers all EAA procedural requirements
- [ ] ✅ Provides actionable improvement suggestions
- [ ] ✅ Generates legally-relevant compliance reports

---

## Dependencies & Risks

### ✅ No Dependencies on Phase 6E
Phase 6F is completely independent and can be implemented immediately.

### Low Implementation Risk
- Uses existing DOM parsing patterns
- No complex visual analysis required
- Clear pass/fail criteria based on content presence

### Mitigation Strategies
- **Multi-language support:** Auto-detect statement language or allow configuration
- **Site architecture variations:** Search multiple common statement locations
- **Content variations:** Use flexible pattern matching for compliance level detection

---

## Conclusion

Phase 6F provides **critical legal compliance functionality** for the European Accessibility Act. It can be implemented **independently of Phase 6E** and offers **clear business value** for organizations needing to demonstrate EAA compliance.

The implementation focuses on **reliable detection** of procedural requirements with **actionable reporting** for legal compliance teams.