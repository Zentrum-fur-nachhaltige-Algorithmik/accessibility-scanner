import { useState } from 'react';
import ConformitySeal from './ConformitySeal';
import {
  SEVERITY_LABELS,
  SEVERITY_TONE,
  countScannerErrors,
  formatDateTime,
  groupViolations,
  normalizeSeverity,
  principleCounts,
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
      <span className="pb-eyebrow">Abschnitt {number}</span>
      {children}
    </h2>
  );
}

function SeverityBadge({ severity, count }) {
  // The label is always spelled out — the colour only reinforces it.
  return (
    <span className={`pb-sev pb-tone-${SEVERITY_TONE[severity] || 'neutral'}`}>
      {count === undefined
        ? SEVERITY_LABELS[severity]
        : `${SEVERITY_LABELS[severity]} ${count}`}
    </span>
  );
}

function shorten(text, max = 60) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
            <dt>Empfehlung</dt>
            <dd>{remediation}</dd>
          </>
        )}
        {scanner && (
          <>
            <dt>Prüfmodul</dt>
            <dd>{scanner}</dd>
          </>
        )}
        {helpUrl && (
          <>
            <dt>Quelle</dt>
            <dd>
              <a href={helpUrl} target="_blank" rel="noopener noreferrer">
                Technische Dokumentation
                <span className="sr-only">
                  {` zu: ${shorten(text)} (öffnet in neuem Tab)`}
                </span>
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
            {group.count} {group.count === 1 ? 'Feststellung' : 'Feststellungen'}
          </span>
          <span className="pb-group-sev">
            {group.severities.map((entry) => (
              <SeverityBadge
                key={entry.severity}
                severity={entry.severity}
                count={entry.count}
              />
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
                    ({subgroup.count}{' '}
                    {subgroup.count === 1 ? 'Feststellung' : 'Feststellungen'})
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
 * Sections 2 to 4 of the report: assessment result, findings, test modules.
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
          Ergebnis der Konformitätsbewertung
        </SectionHeading>

        {meta?.restored && (
          <p className="pb-note pb-note-boxed">
            Gespeichertes Ergebnis aus der Prüfhistorie dieses Browsers. Für aktuelle
            Werte bitte eine neue Prüfung starten.
          </p>
        )}

        <div className="pb-verdict">
          <div className="pb-verdict-stamp">
            <ConformitySeal
              size={104}
              label={`Prüfsiegel der Prüfstelle. Automatisierte Prüfung nach WCAG 2.2 AA und EN 301 549. Ergebnis: ${band.label}.`}
            />
            <p className="pb-seal-legend">{band.seal}</p>
          </div>
          <div className="pb-verdict-body">
            <p className="pb-verdict-eyebrow">Bewertung</p>
            <p className="pb-score">
              <span className="pb-score-value">{hasScore ? score : '—'}</span>
              <span className="pb-score-max"> / 100</span>
            </p>
            <p className={`pb-verdict-label pb-tone-${band.tone}`}>{band.label}</p>
            <p className="pb-verdict-basis">
              Automatisierte Prüfung · WCAG 2.2 · EN 301 549
            </p>
          </div>
        </div>

        <p className="pb-scope-note">
          Automatisierte Prüfung nach WCAG 2.2 AA. Ersetzt keine vollständige
          Konformitätsbewertung mit manueller Prüfung.
        </p>

        <table className="pb-table pb-table-key">
          <caption className="sr-only">Angaben zur durchgeführten Prüfung</caption>
          <tbody>
            <tr>
              <th scope="row">Prüfgegenstand</th>
              <td className="pb-url">{result?.url || meta?.url || '—'}</td>
            </tr>
            <tr>
              <th scope="row">Prüfzeitpunkt</th>
              <td>
                {scannedAt ? (
                  <time dateTime={scannedAt}>{formatDateTime(scannedAt)} Uhr</time>
                ) : (
                  '—'
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">Prüfprofil</th>
              <td>{meta?.profile || '—'}</td>
            </tr>
            <tr>
              <th scope="row">Feststellungen gesamt</th>
              <td className="pb-num">
                {total}
                {result?.omittedViolations > 0 &&
                  ` (${result.omittedViolations} ältere Feststellungen wurden lokal nicht gespeichert)`}
              </td>
            </tr>
            <tr>
              <th scope="row">Prüfmodule mit Fehler</th>
              <td className="pb-num">
                {scannerErrors} von {scannerRows.length}
              </td>
            </tr>
          </tbody>
        </table>

        <h3 className="pb-h3" id="severity-heading">
          <span className="pb-subnum" aria-hidden="true">
            2.1
          </span>
          Verteilung nach Schweregrad
        </h3>
        {severities.length === 0 ? (
          <p className="pb-body">Es wurden keine Feststellungen gemeldet.</p>
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
              Verteilung nach WCAG-Prinzip
            </h3>
            <div
              className="pb-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabelle: Verteilung nach WCAG-Prinzip"
            >
              <table className="pb-table pb-table-principles">
                <caption>
                  Anzahl der Feststellungen je Prinzip der WCAG 2.2, ermittelt aus dem
                  Erfolgskriterium der jeweiligen Feststellung.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Prinzip</th>
                    <th scope="col" className="pb-col-num">
                      Feststellungen
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
            {reportPending
              ? 'Bericht wird erstellt …'
              : 'Vollständigen Prüfbericht erstellen'}
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
                Prüfbericht öffnen
                <span className="sr-only"> (öffnet in neuem Tab)</span>
              </a>
            </p>
          )}
        </div>
      </section>

      <section className="pb-section" aria-labelledby="findings-heading">
        <SectionHeading number="3" id="findings-heading">
          Feststellungen
        </SectionHeading>

        {violations.length === 0 ? (
          <p className="pb-body">Es liegen keine Feststellungen vor.</p>
        ) : (
          <>
            <fieldset className="pb-groupmode">
              <legend>Feststellungen gruppieren nach</legend>
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
                  <label htmlFor="group-mode-criterion">Erfolgskriterium</label>
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
                  <label htmlFor="group-mode-scanner">Prüfmodul</label>
                </div>
              </div>
            </fieldset>

            <p className="pb-note">
              {groups.length} {groups.length === 1 ? 'Gruppe' : 'Gruppen'}. Öffnen Sie
              eine Gruppe, um die einzelnen Feststellungen zu lesen.
            </p>

            <ul className="pb-groups" aria-labelledby="findings-heading">
              {groups.map((group, index) => (
                <Group
                  key={group.key}
                  group={group}
                  mode={mode}
                  number={`3.${index + 1}`}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="pb-section" aria-labelledby="modules-heading">
        <SectionHeading number="4" id="modules-heading">
          Prüfmodule
        </SectionHeading>
        <p className="pb-note">
          Ergebnis der einzelnen Prüfmodule. Module mit Fehler konnten die Seite nicht
          vollständig auswerten; ihre Feststellungen können unvollständig sein.
        </p>
        <div
          className="pb-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Tabelle: Ergebnis je Prüfmodul"
        >
          <table className="pb-table pb-table-modules">
            <caption className="sr-only">
              Prüfmodule mit Anzahl der Feststellungen und Ergebnis
            </caption>
            <thead>
              <tr>
                <th scope="col">Prüfmodul</th>
                <th scope="col" className="pb-col-num">
                  Feststellungen
                </th>
                <th scope="col">Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {scannerRows.map(([id, value]) => (
                <tr key={id}>
                  <th scope="row">{scannerLabel(id)}</th>
                  <td className="pb-num">{value?.violationCount ?? 0}</td>
                  <td>
                    {value?.error
                      ? `Fehler: ${value.error}`
                      : value?.passed
                        ? 'Ohne Feststellung'
                        : 'Feststellungen vorhanden'}
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
