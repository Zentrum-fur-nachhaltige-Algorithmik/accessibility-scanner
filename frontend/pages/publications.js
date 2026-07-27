import Head from 'next/head';

function PubEntry({ id, title, status, children }) {
  return (
    <article className="pub-entry">
      <h4 className="pub-entry-id">{id}</h4>
      <p className="pub-entry-title"><em>{title}</em></p>
      <p className="pub-entry-status">{status}</p>
      {children && <div className="pub-entry-abstract">{children}</div>}
    </article>
  );
}

export default function Publications() {
  return (
    <>
      <Head>
        <title>Publikationen — Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.</title>
        <meta name="description" content="Arbeitspapiere, Wissenschaftlerprofile, Stellungnahmen und Forschungsnotizen der Abraham-Nemeth-Gesellschaft." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="landing-page">
        <header className="landing-header" role="banner">
          <a href="#hauptinhalt" className="skip-link">Zum Hauptinhalt springen</a>
          <div className="landing-header-inner">
            <div className="landing-brand">
              <a href="/" className="landing-brand-link">
                <span className="landing-org-name">
                  Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.
                </span>
              </a>
            </div>
            <nav aria-label="Hauptnavigation">
              <ul className="landing-nav">
                <li><a href="/#ueber-uns">Über uns</a></li>
                <li><a href="/#forschung">Forschung</a></li>
                <li><a href="/publications" aria-current="page">Publikationen</a></li>
                <li><a href="/profiles">Profile</a></li>
                <li><a href="/#kontakt">Kontakt</a></li>
              </ul>
            </nav>
          </div>
        </header>

        <main id="hauptinhalt" className="pub-main">
          <div className="pub-content">
            <h1>Publikationen</h1>
            <p className="pub-intro">
              Die Gesellschaft veröffentlicht Arbeitspapiere, Wissenschaftlerprofile, Stellungnahmen
              und kürzere Forschungsnotizen. Alle Veröffentlichungen stehen im Einklang mit dem
              Grundsatz der Gesellschaft als frei zugängliche Dokumente zur Verfügung. Die
              Gesellschaft veröffentlicht grundsätzlich in barrierefreien Formaten.
            </p>
            <p className="pub-intro">
              Hinweise zur Zitierweise finden sich in den jeweiligen Dokumenten.
            </p>

            {/* Arbeitspapiere */}
            <section aria-labelledby="ap-heading">
              <h2 id="ap-heading">Arbeitspapiere</h2>
              <p>
                Die Arbeitspapiere der Gesellschaft behandeln Grundlagenfragen an der Schnittstelle
                von Mathematik, Informatik und Barrierefreiheit. Sie durchlaufen eine interne
                Begutachtung und werden als Diskussionsbeiträge veröffentlicht.
              </p>

              <PubEntry
                id="ANG-AP-2026-001"
                title="Zur informationstheoretischen Reduktion visueller Szenendaten für nicht-visuelle Ausgabekanäle."
                status="In Vorbereitung."
              >
                <p>
                  Das Papier untersucht, welche formalen Bedingungen erfüllt sein müssen, damit
                  eine Reduktion dreidimensionaler Szenendaten auf taktile oder auditive
                  Darstellungen informationstheoretisch verlustarm gelingt. Es werden Verbindungen
                  zur Rate-Distortion-Theorie und zur sensorischen Substitutionsforschung hergestellt.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-AP-2026-002"
                title="Reward-Modellierung für adaptive Assistenzsysteme: Autonomie als Optimierungsziel im Reinforcement Learning."
                status="In Vorbereitung."
              >
                <p>
                  Konventionelle Reinforcement-Learning-Systeme optimieren auf Effizienz oder
                  Genauigkeit. Das Papier schlägt einen formalen Rahmen vor, in dem die Autonomie
                  der nutzenden Person als primäres Optimierungsziel modelliert wird, und diskutiert
                  die mathematischen Eigenschaften der resultierenden Reward-Strukturen.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-AP-2026-003"
                title="Modalitätsunabhängige Darstellung mathematischer Notation: Ein Vergleich formaler Eigenschaften von Nemeth-Code, LaTeX und MathML."
                status="In Vorbereitung."
              >
                <p>
                  Die drei verbreitetsten Systeme zur Darstellung mathematischer Notation werden
                  hinsichtlich ihrer Ausdrucksmächtigkeit, Eindeutigkeit und Übersetzbarkeit
                  ineinander analysiert. Das Papier fragt, ob eine modalitätsunabhängige
                  Zwischenrepräsentation möglich ist, die als gemeinsame Grundlage visueller,
                  taktiler und auditiver Darstellungen dienen kann.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-AP-2026-004"
                title="Sicherheitsgarantien für lernende Assistenzsysteme: Ein Beitrag zur Theorie des Safe Reinforcement Learning."
                status="In Vorbereitung."
              >
                <p>
                  Assistive Systeme, auf die sich Menschen mit Behinderungen im Alltag verlassen,
                  erfordern formal überprüfbare Sicherheitsgarantien. Das Papier untersucht
                  bestehende Ansätze des Safe Reinforcement Learning auf ihre Anwendbarkeit im
                  assistiven Kontext und identifiziert offene Probleme, die spezifisch für dieses
                  Anwendungsfeld sind.
                </p>
              </PubEntry>
            </section>

            {/* Wissenschaftlerprofile */}
            <section aria-labelledby="wp-heading">
              <h2 id="wp-heading">Wissenschaftlerprofile</h2>
              <p>
                Das biografische Archiv der Gesellschaft dokumentiert die Beiträge behinderter
                Wissenschaftlerinnen und Wissenschaftler und ordnet sie in ihren
                wissenschaftshistorischen Kontext ein. Die Profile erscheinen fortlaufend.
              </p>

              <PubEntry
                id="ANG-WP-2026-001"
                title="Abraham Nemeth (1918–2013): Mathematiker, Pädagoge, Erfinder des Nemeth-Codes."
                status="Erschienen."
              />

              <PubEntry
                id="ANG-WP-2026-002"
                title="Leonhard Euler (1707–1783): Produktivität jenseits des Sehens."
                status="In Vorbereitung."
              >
                <p>
                  Euler verlor in seinen Vierzigern das Augenlicht nahezu vollständig. Der Beitrag
                  untersucht die verbreitete Behauptung, seine produktivste Schaffensphase habe erst
                  nach der Erblindung begonnen, und fragt nach den methodischen und kognitiven
                  Anpassungen, die dies ermöglichten.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-WP-2026-003"
                title="Nicholas Saunderson (1682–1739): Der blinde Lucasische Professor und die Erfindung taktiler Rechenmethoden."
                status="In Vorbereitung."
              >
                <p>
                  Saunderson, blind seit seinem ersten Lebensjahr, wurde 1711 auf den Lucasischen
                  Lehrstuhl in Cambridge berufen – denselben Lehrstuhl, den zuvor Isaac Newton
                  innehatte. Der Beitrag dokumentiert seine Entwicklung eines taktilen Rechenbretts
                  und seine Beiträge zur Algebra und Optik.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-WP-2026-004"
                title="Bernard Morin (1931–2018) und die Topologie des Unsichtbaren."
                status="In Vorbereitung."
              >
                <p>
                  Morin, seit seinem sechsten Lebensjahr blind, bewies 1959, dass eine Sphäre im
                  dreidimensionalen Raum ohne Selbstdurchdringung umgestülpt werden kann. Der
                  Beitrag untersucht, wie seine nicht-visuelle räumliche Intuition zu einem Ergebnis
                  führte, an dem sehende Topologen gescheitert waren.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-WP-2026-005"
                title="Geerat Vermeij (geb. 1946): Tastende Erkenntnis in der Evolutionsbiologie."
                status="In Vorbereitung."
              >
                <p>
                  Vermeij, von Geburt an blind, revolutionierte die Paläobiologie durch taktile
                  Analyse von Muschelschalen und Fossilien. Er entdeckte Muster, die sehenden
                  Forschenden entgangen waren, und begründete darauf eine einflussreiche Theorie
                  der evolutionären Eskalation. Der Beitrag fragt, ob taktile Wahrnehmung in
                  bestimmten empirischen Kontexten systematische Erkenntnisvorteile bietet.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-WP-2026-006"
                title="Lise Meitner (1878–1968): Wissenschaft unter doppelter Ausgrenzung."
                status="In Vorbereitung."
              >
                <p>
                  Meitner, die als Frau und als Jüdin systematisch aus dem Wissenschaftsbetrieb
                  gedrängt wurde, leistete grundlegende Beiträge zur Kernphysik. Der Beitrag
                  erweitert den Fokus des Archivs über Behinderung im engeren Sinne auf die
                  breitere Frage, wie Ausschluss die Wissenschaftsgeschichte geprägt hat.
                </p>
              </PubEntry>
            </section>

            {/* Stellungnahmen */}
            <section aria-labelledby="st-heading">
              <h2 id="st-heading">Stellungnahmen</h2>
              <p>
                Die Gesellschaft veröffentlicht Stellungnahmen zu wissenschaftspolitischen Fragen
                im Bereich Barrierefreiheit und Inklusion. Stellungnahmen richten sich an
                Hochschulen, Förderinstitutionen, Verlage und die wissenschaftliche Öffentlichkeit.
              </p>

              <PubEntry
                id="ANG-ST-2026-001"
                title="Zur Barrierefreiheit mathematischer Notation in wissenschaftlichen Zeitschriften: Eine Bestandsaufnahme und Empfehlungen."
                status="In Vorbereitung."
              >
                <p>
                  Die überwiegende Mehrheit wissenschaftlicher Zeitschriften veröffentlicht
                  mathematische Inhalte in Formaten, die für blinde und sehbehinderte Leserinnen
                  und Leser nicht zugänglich sind. Die Stellungnahme dokumentiert den gegenwärtigen
                  Stand, vergleicht die Praxis großer Verlage und formuliert konkrete Empfehlungen
                  für eine barrierefreie Darstellung mathematischer Notation in digitalen
                  Publikationen.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-ST-2026-002"
                title="MINT-Studium mit Behinderung in Österreich: Strukturelle Barrieren und institutionelle Verantwortung."
                status="In Vorbereitung."
              >
                <p>
                  Auf Grundlage einer Analyse bestehender Studien und institutioneller
                  Rahmenbedingungen untersucht die Stellungnahme, welche spezifischen Barrieren
                  das MINT-Studium für Studierende mit Behinderungen in Österreich aufweist und
                  welche Maßnahmen auf Ebene der Hochschulen und des Gesetzgebers erforderlich wären.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-ST-2026-003"
                title="Barrierefreiheit als Förderkriterium: Empfehlungen an den Wissenschaftsfonds FWF."
                status="In Vorbereitung."
              >
                <p>
                  Die Stellungnahme argumentiert, dass Barrierefreiheit als Querschnittskriterium
                  in die Projektförderung wissenschaftlicher Forschung aufgenommen werden sollte,
                  und schlägt konkrete Mechanismen für die Integration in bestehende
                  Begutachtungsverfahren vor.
                </p>
              </PubEntry>
            </section>

            {/* Notizen aus der Forschung */}
            <section aria-labelledby="nf-heading">
              <h2 id="nf-heading">Notizen aus der Forschung</h2>
              <p>
                Kürzere Beiträge zu laufenden Arbeiten, Beobachtungen und methodischen Fragen. Die
                Notizen sind informeller als Arbeitspapiere und dienen der Dokumentation des
                Forschungsprozesses.
              </p>

              <PubEntry
                id="ANG-NF-2026-001"
                title="Anmerkungen zur WCAG-Konformität mathematischer Darstellungen in Open-Access-Journalen."
                status="In Vorbereitung."
              >
                <p>
                  Eine stichprobenartige Untersuchung der Zugänglichkeit mathematischer Inhalte in
                  zehn großen Open-Access-Zeitschriften. Erste Ergebnisse deuten darauf hin, dass
                  selbst Journale, die grundlegende WCAG-Richtlinien einhalten, bei mathematischer
                  Notation systematisch scheitern.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-NF-2026-002"
                title="Überlegungen zur Sonifikation von Sortieralgorithmen: Ein Werkstattbericht."
                status="In Vorbereitung."
              >
                <p>
                  Sortieralgorithmen werden häufig visuell dargestellt. Die Notiz beschreibt erste
                  Experimente mit auditiven Darstellungen und diskutiert, welche algorithmischen
                  Eigenschaften sich auditiv besser vermitteln lassen als visuell.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-NF-2026-003"
                title="Welche geometrischen Merkmale einer 3D-Szene sind für blinde Navigation tatsächlich relevant? Vorüberlegungen zu einem Reduktionsmodell."
                status="In Vorbereitung."
              >
                <p>
                  Nicht alle Informationen einer dreidimensionalen Szene sind für die Navigation
                  relevant. Die Notiz skizziert einen formalen Ansatz zur Bestimmung der minimalen
                  geometrischen Merkmale, die ein assistives Navigationssystem übermitteln muss.
                </p>
              </PubEntry>

              <PubEntry
                id="ANG-NF-2026-004"
                title="Euler nach der Erblindung: Eine quantitative Analyse seiner Publikationstätigkeit 1738–1783."
                status="In Vorbereitung."
              >
                <p>
                  Ist die verbreitete Behauptung, Euler sei nach seiner Erblindung produktiver
                  gewesen, empirisch haltbar? Die Notiz stellt vorläufige bibliometrische Daten
                  zusammen und diskutiert methodische Schwierigkeiten einer solchen Analyse.
                </p>
              </PubEntry>
            </section>

            {/* Hinweise */}
            <section aria-labelledby="hinweise-heading">
              <h2 id="hinweise-heading">Hinweise</h2>
              <p>
                Alle Veröffentlichungen der Gesellschaft verwenden das Nummerierungssystem
                ANG-[Kategorie]-[Jahr]-[Nummer]. Arbeitspapiere (AP), Wissenschaftlerprofile (WP),
                Stellungnahmen (ST) und Notizen aus der Forschung (NF) werden fortlaufend nummeriert.
              </p>
              <p>
                Die Gesellschaft bemüht sich, alle Veröffentlichungen in barrierefreiem PDF/UA-Format
                sowie als HTML-Version bereitzustellen. Sollten Sie bei der Nutzung einer
                Veröffentlichung auf Barrieren stoßen, bitten wir um Mitteilung an{' '}
                <a href="mailto:kontakt@nemeth-gesellschaft.org">kontakt@nemeth-gesellschaft.org</a>.
              </p>
            </section>

            <p className="pub-back">
              <a href="/">Zurück zur Startseite</a>
            </p>
          </div>
        </main>

        <footer className="landing-footer" role="contentinfo">
          <div className="landing-footer-inner">
            <p>Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.</p>
            <nav aria-label="Rechtliche Hinweise und weitere Seiten">
              <ul className="landing-footer-links">
                <li><a href="/accessibility">Barrierefreiheitserklärung</a></li>
                <li><a href="/audit">Audit-Service</a></li>
              </ul>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}
