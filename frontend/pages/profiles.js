import Head from 'next/head';

function Profile({ name, dates, children }) {
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z-]/g, '');
  return (
    <article className="profile-entry" aria-labelledby={`profile-${id}`}>
      <h3 id={`profile-${id}`}>
        {name} <span className="profile-dates">({dates})</span>
      </h3>
      {children}
    </article>
  );
}

export default function Profiles() {
  return (
    <>
      <Head>
        <title>Wissenschaftlerprofile — Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.</title>
        <meta name="description" content="Biografisches Archiv: Beiträge behinderter Wissenschaftlerinnen und Wissenschaftler in ihrem wissenschaftshistorischen Kontext." />
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
                <li><a href="/publications">Publikationen</a></li>
                <li><a href="/profiles" aria-current="page">Profile</a></li>
                <li><a href="/#kontakt">Kontakt</a></li>
              </ul>
            </nav>
          </div>
        </header>

        <main id="hauptinhalt" className="profile-main">
          <div className="profile-content">
            <h1>Wissenschaftlerprofile</h1>
            <h2 id="archiv-heading">Biografisches Archiv</h2>
            <p className="profile-intro">
              Das biografische Archiv der Gesellschaft dokumentiert die Beiträge behinderter
              Wissenschaftlerinnen und Wissenschaftler und ordnet sie in ihren
              wissenschaftshistorischen Kontext ein. Dabei interessiert nicht nur die Überwindung
              von Barrieren, sondern die Frage, wie Behinderung als spezifische
              Erkenntnisperspektive wissenschaftliche Methoden und Ergebnisse geprägt hat.
            </p>

            <Profile name="Abraham Nemeth" dates="1918–2013">
              <p>
                Abraham Nemeth wurde 1918 als Sohn ungarisch-jüdischer Einwanderer in New York
                geboren. Er war von Geburt an blind. Sein Wunsch, Mathematik zu studieren, wurde
                von seiner Universität zunächst abgelehnt – man empfahl ihm Psychologie als
                realistischeres Fach für einen blinden Studenten. Nemeth setzte sich durch,
                studierte Mathematik und promovierte 1969 an der Wayne State University.
              </p>
              <p>
                Sein bedeutendster Beitrag ist der Nemeth-Code, ein 1952 erstmals veröffentlichtes
                Braille-System für mathematische und naturwissenschaftliche Notation. Vor Nemeth
                existierte kein standardisiertes Verfahren, um mathematische Ausdrücke in Braille
                darzustellen – blinde Mathematikerinnen und Mathematiker waren auf individuelle, oft
                unzureichende Behelfslösungen angewiesen. Der Nemeth-Code ermöglichte erstmals die
                vollständige, eindeutige und effiziente Darstellung mathematischer Notation in
                Braille und wird bis heute weltweit verwendet.
              </p>
              <p>
                Nemeth lehrte über dreißig Jahre an der University of Detroit Mercy. Er verstand
                seine Arbeit nicht als Nischenlösung für eine kleine Gruppe, sondern als Beitrag
                zur Grundfrage, wie mathematisches Wissen unabhängig von einem bestimmten
                Sinneskanal dargestellt und vermittelt werden kann. Diese Frage steht im Zentrum
                der Arbeit der nach ihm benannten Gesellschaft.
              </p>
            </Profile>

            <Profile name="Leonhard Euler" dates="1707–1783">
              <p>
                Euler verlor in seinen Vierzigern das Augenlicht nahezu vollständig. Der
                produktivste Mathematiker der Geschichte verfasste einen wesentlichen Teil seines
                Werks nach der Erblindung. Die verbreitete Behauptung, seine produktivste
                Schaffensphase habe erst danach begonnen, wirft Fragen nach den methodischen und
                kognitiven Anpassungen auf, die dies ermöglichten.
              </p>
            </Profile>

            <Profile name="Nicholas Saunderson" dates="1682–1739">
              <p>
                Saunderson, blind seit seinem ersten Lebensjahr, wurde 1711 auf den Lucasischen
                Lehrstuhl in Cambridge berufen – denselben Lehrstuhl, den zuvor Isaac Newton
                innehatte. Er entwickelte ein taktiles Rechenbrett und leistete Beiträge zur
                Algebra und Optik.
              </p>
            </Profile>

            <Profile name="Bernard Morin" dates="1931–2018">
              <p>
                Morin, seit seinem sechsten Lebensjahr blind, bewies 1959, dass eine Sphäre im
                dreidimensionalen Raum ohne Selbstdurchdringung umgestülpt werden kann. Seine
                nicht-visuelle räumliche Intuition führte zu einem Ergebnis, an dem sehende
                Topologen gescheitert waren.
              </p>
            </Profile>

            <Profile name="Geerat Vermeij" dates="geb. 1946">
              <p>
                Vermeij, von Geburt an blind, revolutionierte die Paläobiologie durch taktile
                Analyse von Muschelschalen und Fossilien. Er entdeckte Muster, die sehenden
                Forschenden entgangen waren, und begründete darauf eine einflussreiche Theorie
                der evolutionären Eskalation. Sein Forschungsansatz wirft die Frage auf, ob
                taktile Wahrnehmung in bestimmten empirischen Kontexten systematische
                Erkenntnisvorteile bietet.
              </p>
            </Profile>

            <Profile name="Lise Meitner" dates="1878–1968">
              <p>
                Meitner, die als Frau und als Jüdin systematisch aus dem Wissenschaftsbetrieb
                gedrängt wurde, leistete grundlegende Beiträge zur Kernphysik. Ihr Profil
                erweitert den Fokus des Archivs über Behinderung im engeren Sinne auf die
                breitere Frage, wie Ausschluss die Wissenschaftsgeschichte geprägt hat.
              </p>
            </Profile>

            <p className="profile-back">
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
