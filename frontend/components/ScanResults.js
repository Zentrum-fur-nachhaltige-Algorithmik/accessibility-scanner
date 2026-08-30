import { useState } from 'react';
import ConformitySeal from './ConformitySeal';
import { APP_NAME } from '../lib/branding';
import {
  NOT_AVAILABLE,
  SEVERITY_LABELS,
  SEVERITY_TONE,
  countScannerErrors,
  formatDateTime,
  groupViolations,
  needsReviewItems,
  normalizeSeverity,
  principleCounts,
  reviewMeasurements,
  reviewQuestion,
  scannerLabel,
  scoreBand,
  severityCounts,
  violationDetails,
  violationElement,
  violationHelpUrl,
  violationRemediation,
  violationText,
} from '../lib/violations';

function SectionHeading({ number, id, children, headingRef }) {
  return (
    <h2 className="pb-h2" id={id} tabIndex={headingRef ? -1 : undefined} ref={headingRef}>
      <span className="pb-secnum" aria-hidden="true">
        {number}
      </span>
      <span className="pb-eyebrow">Section {number}</span>
      {children}
    </h2>
  );
}

function SeverityBadge({ severity, count }) {
  // The label is always spelled out; the colour only reinforces it.
  return (
    <span className={`pb-sev pb-tone-${SEVERITY_TONE[severity] || 'neutral'}`}>
      {count === undefined ? SEVERITY_LABELS[severity] : `${SEVERITY_LABELS[severity]} ${count}`}
    </span>
  );
}

function shorten(text, max = 60) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function findingsWord(count) {
  return count === 1 ? 'finding' : 'findings';
}

function Finding({ violation, number }) {
  const severity = normalizeSeverity(violation);
  const element = violationElement(violation);
  const remediation = violationRemediation(violation);
  const helpUrl = violationHelpUrl(violation);
  const details = violationDetails(violation);
  const scanner = violation?.scannerId ? scannerLabel(violation.scannerId) : '';
  const text = violationText(violation);

  return (
    <li className="pb-finding">
      <p className="pb-finding-head">
        <span className="pb-finding-no" aria-hidden="true">
          {number}
        </span>
        <SeverityBadge severity={severity} />
        <span className="pb-finding-text">{text}</span>
      </p>
      {details.length > 0 && (
        <ul className="pb-finding-details">
          {details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      )}
      <dl className="pb-finding-meta">
        {element && (
          <>
            <dt>Element</dt>
            <dd>
              <code>{element}</code>
            </dd>
          </>
        )}
        {remediation && (
          <>
            <dt>Recommendation</dt>
            <dd>{remediation}</dd>
          </>
        )}
        {scanner && (
          <>
            <dt>Scan module</dt>
            <dd>{scanner}</dd>
          </>
        )}
        {helpUrl && (
          <>
            <dt>Source</dt>
            <dd>
              <a href={helpUrl} target="_blank" rel="noopener noreferrer">
                Technical documentation
                <span className="sr-only">{` for: ${shorten(text)} (opens in a new tab)`}</span>
              </a>
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}

function FindingList({ violations }) {
  return (
    <ol className="pb-finding-list">
      {violations.map((violation, index) => (
        <Finding key={index} violation={violation} number={index + 1} />
      ))}
    </ol>
  );
}

function Group({ group, mode, number }) {
  return (
    <li className="pb-group">
      <details className="pb-group-details">
        <summary className="pb-group-summary">
          <span className="pb-group-no" aria-hidden="true">
            {number}
          </span>
          <span className="pb-group-name">{group.label}</span>
          <span className="pb-group-count">
            {group.count} {findingsWord(group.count)}
          </span>
          <span className="pb-group-sev">
            {group.severities.map((entry) => (
              <SeverityBadge key={entry.severity} severity={entry.severity} count={entry.count} />
            ))}
          </span>
        </summary>
        <div className="pb-group-body">
          {group.note && <p className="pb-note">{group.note}</p>}
          {mode === 'scanner' ? (
            group.subgroups.map((subgroup) => (
              <div className="pb-subgroup" key={subgroup.key}>
                <h4 className="pb-h4">
                  {subgroup.label}{' '}
                  <span className="pb-subgroup-count">
                    ({subgroup.count} {findingsWord(subgroup.count)})
                  </span>
                </h4>
                <FindingList violations={subgroup.items} />
              </div>
            ))
          ) : (
            <FindingList violations={group.items} />
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * One finding the scanners could not decide: the question a reviewer has to
 * answer, plus the values the scanner did measure. Neutral, never a severity:
 * it is an open question, not a failure.
 */
function ReviewItem({ item, number }) {
  const element = item?.dossier?.element?.selector || violationElement(item);
  const measurements = reviewMeasurements(item);
  const scanner = item?.scannerId ? scannerLabel(item.scannerId) : '';

  return (
    <li className="pb-finding">
      <p className="pb-finding-head">
        <span className="pb-finding-no" aria-hidden="true">
          {number}
        </span>
        <span className="pb-sev pb-tone-neutral">Needs review</span>
        <span className="pb-finding-text">{reviewQuestion(item)}</span>
      </p>
      <dl className="pb-finding-meta">
        {element && (
          <>
            <dt>Element</dt>
            <dd>
              <code>{element}</code>
            </dd>
          </>
        )}
        {measurements.length > 0 && (
          <>
            <dt>Measured</dt>
            <dd>
              <ul className="pb-finding-details">
                {measurements.map(([key, value]) => (
                  <li key={key}>{`${key}: ${value}`}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {scanner && (
          <>
            <dt>Scan module</dt>
            <dd>{scanner}</dd>
          </>
        )}
      </dl>
    </li>
  );
}

function NeedsReviewSection({ items }) {
  if (items.length === 0) return null;

  return (
    <details className="pb-group-details">
      <summary className="pb-group-summary">
        <span className="pb-group-name">Needs review ({items.length})</span>
        <span className="pb-group-count">not counted as findings</span>
      </summary>
      <div className="pb-group-body">
        <p className="pb-note">
          These checks could not be decided automatically. They do not count as findings and do not
          affect the score; each states the question a reviewer has to answer.
        </p>
        <ol className="pb-finding-list">
          {items.map((item, index) => (
            <ReviewItem key={index} item={item} number={index + 1} />
          ))}
        </ol>
      </div>
    </details>
  );
}

/**
 * Sections 2 to 4 of the report: assessment result, findings, scan modules.
 */
export default function ScanResults({
  result,
  meta,
  headingRef,
  onGenerateReport,
  reportPending,
  reportLink,
  reportLinkRef,
}) {
  const [mode, setMode] = useState('criterion');

  const violations = Array.isArray(result?.violations) ? result.violations : [];
  const review = needsReviewItems(result);
  const groups = groupViolations(violations, mode);
  const severities = severityCounts(violations);
  const principles = principleCounts(violations);
  const score = result?.accessibilityScore;
  const hasScore = Number.isFinite(Number(score));
  const band = scoreBand(score);
  const scannerRows = Object.entries(result?.scanners || {});
  const scannerErrors = countScannerErrors(result);
  const scannedAt = result?.timestamp || meta?.scannedAt || '';
  const total = result?.totalViolations ?? violations.length;

  return (
    <>
      <section className="pb-section" aria-labelledby="results-heading">
        <SectionHeading number="2" id="results-heading" headingRef={headingRef}>
          Assessment result
        </SectionHeading>

        {meta?.restored && (
          <p className="pb-note pb-note-boxed">
            Stored result from this browser&apos;s scan history. Start a new scan for current
            values.
          </p>
        )}

        <div className="pb-verdict">
          <div className="pb-verdict-stamp">
            <ConformitySeal
              size={104}
              label={`${APP_NAME} seal. Automated check against WCAG 2.2 AA and EN 301 549. Result: ${band.label}.`}
            />
            <p className="pb-seal-legend">{band.seal}</p>
          </div>
          <div className="pb-verdict-body">
            <p className="pb-verdict-eyebrow">Score</p>
            <p className="pb-score">
              <span className="pb-score-value">{hasScore ? score : NOT_AVAILABLE}</span>
              <span className="pb-score-max"> / 100</span>
            </p>
            <p className={`pb-verdict-label pb-tone-${band.tone}`}>{band.label}</p>
            <p className="pb-verdict-basis">Automated check · WCAG 2.2 · EN 301 549</p>
          </div>
        </div>

        <p className="pb-scope-note">
          Automated check against WCAG 2.2 AA. It does not replace a full conformity assessment with
          manual testing.
        </p>

        <table className="pb-table pb-table-key">
          <caption className="sr-only">Details of the scan</caption>
          <tbody>
            <tr>
              <th scope="row">Scanned page</th>
              <td className="pb-url">{result?.url || meta?.url || NOT_AVAILABLE}</td>
            </tr>
            <tr>
              <th scope="row">Scanned at</th>
              <td>
                {scannedAt ? (
                  <time dateTime={scannedAt}>{formatDateTime(scannedAt)}</time>
                ) : (
                  NOT_AVAILABLE
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">Scan profile</th>
              <td>{meta?.profile || NOT_AVAILABLE}</td>
            </tr>
            <tr>
              <th scope="row">Total findings</th>
              <td className="pb-num">
                {total}
                {result?.omittedViolations > 0 &&
                  ` (${result.omittedViolations} older findings were not stored locally)`}
              </td>
            </tr>
            <tr>
              <th scope="row">Scan modules with errors</th>
              <td className="pb-num">
                {scannerErrors} of {scannerRows.length}
              </td>
            </tr>
          </tbody>
        </table>

        <h3 className="pb-h3" id="severity-heading">
          <span className="pb-subnum" aria-hidden="true">
            2.1
          </span>
          Distribution by severity
        </h3>
        {severities.length === 0 ? (
          <p className="pb-body">No findings were reported.</p>
        ) : (
          <ul className="pb-sev-list" aria-labelledby="severity-heading">
            {severities.map((entry) => (
              <li key={entry.severity}>
                <SeverityBadge severity={entry.severity} count={entry.count} />
              </li>
            ))}
          </ul>
        )}

        {violations.length > 0 && (
          <>
            <h3 className="pb-h3" id="principles-heading">
              <span className="pb-subnum" aria-hidden="true">
                2.2
              </span>
              Distribution by WCAG principle
            </h3>
            <div
              className="pb-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Table: distribution by WCAG principle"
            >
              <table className="pb-table pb-table-principles">
                <caption>
                  Number of findings per WCAG 2.2 principle, derived from the success criterion of
                  each finding.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Principle</th>
                    <th scope="col" className="pb-col-num">
                      Findings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {principles.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td className="pb-num">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="pb-actions">
          <button
            type="button"
            className="pb-btn"
            onClick={onGenerateReport}
            disabled={reportPending}
          >
            {reportPending ? 'Generating report...' : 'Generate full report'}
          </button>
          {reportLink && (
            <p className="pb-report-ready">
              <a
                ref={reportLinkRef}
                className="pb-report-link"
                href={reportLink.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open report
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          )}
        </div>
      </section>

      <section className="pb-section" aria-labelledby="findings-heading">
        <SectionHeading number="3" id="findings-heading">
          Findings
        </SectionHeading>

        {violations.length === 0 ? (
          <p className="pb-body">There are no findings.</p>
        ) : (
          <>
            <fieldset className="pb-groupmode">
              <legend>Group findings by</legend>
              <div className="pb-groupmode-options">
                <div className="pb-groupmode-option">
                  <input
                    type="radio"
                    id="group-mode-criterion"
                    name="group-mode"
                    value="criterion"
                    checked={mode === 'criterion'}
                    onChange={() => setMode('criterion')}
                  />
                  <label htmlFor="group-mode-criterion">Success criterion</label>
                </div>
                <div className="pb-groupmode-option">
                  <input
                    type="radio"
                    id="group-mode-scanner"
                    name="group-mode"
                    value="scanner"
                    checked={mode === 'scanner'}
                    onChange={() => setMode('scanner')}
                  />
                  <label htmlFor="group-mode-scanner">Scan module</label>
                </div>
              </div>
            </fieldset>

            <p className="pb-note">
              {groups.length} {groups.length === 1 ? 'group' : 'groups'}. Open a group to read its
              findings.
            </p>

            <ul className="pb-groups" aria-labelledby="findings-heading">
              {groups.map((group, index) => (
                <Group key={group.key} group={group} mode={mode} number={`3.${index + 1}`} />
              ))}
            </ul>
          </>
        )}

        <NeedsReviewSection items={review} />
      </section>

      <section className="pb-section" aria-labelledby="modules-heading">
        <SectionHeading number="4" id="modules-heading">
          Scan modules
        </SectionHeading>
        <p className="pb-note">
          Result of each scan module. Modules with errors could not fully evaluate the page; their
          findings may be incomplete.
        </p>
        <div
          className="pb-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Table: result per scan module"
        >
          <table className="pb-table pb-table-modules">
            <caption className="sr-only">Scan modules with number of findings and result</caption>
            <thead>
              <tr>
                <th scope="col">Scan module</th>
                <th scope="col" className="pb-col-num">
                  Findings
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {scannerRows.map(([id, value]) => (
                <tr key={id}>
                  <th scope="row">{scannerLabel(id)}</th>
                  <td className="pb-num">{value?.violationCount ?? 0}</td>
                  <td>
                    {value?.error
                      ? `Error: ${value.error}`
                      : value?.passed
                        ? 'No findings'
                        : 'Findings present'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
