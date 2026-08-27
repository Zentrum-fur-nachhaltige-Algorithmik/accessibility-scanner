import { entryKey } from '../lib/scanHistory';
import { formatDateTime } from '../lib/violations';

function EntryFacts({ entry }) {
  return (
    <span className="pb-hist-meta">
      {entry.date ? (
        <time dateTime={entry.date}>{formatDateTime(entry.date)}</time>
      ) : (
        'Date unknown'
      )}
      {' · '}
      {entry.score === null || entry.score === undefined
        ? 'Score unknown'
        : `Score ${entry.score} of 100`}
      {' · '}
      {entry.violationCount === null || entry.violationCount === undefined
        ? 'Findings unknown'
        : `${entry.violationCount} ${entry.violationCount === 1 ? 'finding' : 'findings'}`}
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
        <span className="pb-eyebrow">Appendix</span>
        Scan history
      </h2>

      {entries.length === 0 ? (
        <p className="pb-note">
          No scans yet. Completed scans are listed here, stored only in this
          browser.
        </p>
      ) : (
        <>
          <p className="pb-note">
            The last {entries.length} {entries.length === 1 ? 'scan' : 'scans'} in
            this browser. Select an entry to show its stored result again.
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
                      <span className="sr-only">Show stored result for </span>
                      <span className="pb-hist-url">{entry.url}</span>
                      <EntryFacts entry={entry} />
                      {isActive && (
                        <span className="pb-hist-tag">Shown in section 2</span>
                      )}
                    </button>
                  ) : (
                    <div className="pb-hist-item pb-hist-item-plain">
                      <span className="pb-hist-url">{entry.url}</span>
                      <EntryFacts entry={entry} />
                      <span className="pb-hist-tag">Result no longer stored</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="pb-actions">
            <button type="button" className="pb-btn" onClick={onClear}>
              Clear scan history
            </button>
          </p>
        </>
      )}
    </section>
  );
}
