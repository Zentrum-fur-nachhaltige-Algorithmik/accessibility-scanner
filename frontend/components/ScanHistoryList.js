import { entryKey } from '../lib/scanHistory';
import { formatDateTime } from '../lib/violations';

function EntryFacts({ entry }) {
  return (
    <span className="pb-hist-meta">
      {entry.date ? (
        <time dateTime={entry.date}>{formatDateTime(entry.date)} Uhr</time>
      ) : (
        'Datum unbekannt'
      )}
      {' · '}
      {entry.score === null || entry.score === undefined
        ? 'Bewertung unbekannt'
        : `Bewertung ${entry.score} von 100`}
      {' · '}
      {entry.violationCount === null || entry.violationCount === undefined
        ? 'Feststellungen unbekannt'
        : `${entry.violationCount} ${entry.violationCount === 1 ? 'Feststellung' : 'Feststellungen'}`}
    </span>
  );
}

/**
 * Appendix: the scans stored in this browser. Entries whose result is still
 * stored can be reopened; older entries keep their metadata only and render as
 * plain text so no dead controls end up in the tab order.
 */
export default function ScanHistoryList({
  entries,
  activeJobId,
  headingRef,
  onOpen,
  onClear,
}) {
  return (
    <section className="pb-section" aria-labelledby="history-heading">
      <h2 className="pb-h2" id="history-heading" tabIndex={-1} ref={headingRef}>
        <span className="pb-eyebrow">Anhang</span>
        Prüfhistorie
      </h2>

      {entries.length === 0 ? (
        <p className="pb-note">
          Es liegen noch keine Prüfungen vor. Abgeschlossene Prüfungen werden hier
          verzeichnet — ausschließlich lokal in diesem Browser.
        </p>
      ) : (
        <>
          <p className="pb-note">
            Die letzten {entries.length}{' '}
            {entries.length === 1 ? 'Prüfung' : 'Prüfungen'} dieses Browsers. Wählen Sie
            einen Eintrag, um das gespeicherte Ergebnis erneut anzuzeigen.
          </p>
          <ol className="pb-hist-list">
            {entries.map((entry, index) => {
              const isActive = Boolean(activeJobId) && entry.jobId === activeJobId;
              return (
                <li key={entryKey(entry, index)}>
                  {entry.result ? (
                    <button
                      type="button"
                      className="pb-hist-item"
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => onOpen(entry)}
                    >
                      <span className="sr-only">
                        Gespeichertes Ergebnis anzeigen für{' '}
                      </span>
                      <span className="pb-hist-url">{entry.url}</span>
                      <EntryFacts entry={entry} />
                      {isActive && (
                        <span className="pb-hist-tag">In Abschnitt 2 angezeigt</span>
                      )}
                    </button>
                  ) : (
                    <div className="pb-hist-item pb-hist-item-plain">
                      <span className="pb-hist-url">{entry.url}</span>
                      <EntryFacts entry={entry} />
                      <span className="pb-hist-tag">Ergebnis nicht mehr gespeichert</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="pb-actions">
            <button type="button" className="pb-btn" onClick={onClear}>
              Prüfhistorie löschen
            </button>
          </p>
        </>
      )}
    </section>
  );
}
