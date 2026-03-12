import { useState, useRef } from 'react';
import Head from 'next/head';

function NemethLogo() {
  // Nemeth Braille representation of the equals sign (⠀⠶)
  // Dots: 2-3-5-6 in a standard 2x3 braille cell
  const dotSize = 4;
  const gap = 12;
  const positions = [
    // Cell: dots at positions 2,3,5,6 (0-indexed: row1-col1, row2-col0, row2-col1, row1-col0... )
    // Standard braille: col0=dots 1,2,3 col1=dots 4,5,6
    // Equals in Nemeth: dots 46 (prefix) then 13 = ⠐⠅
    // Simplified: show two braille cells side by side
    // Cell 1 (dot 4,6): positions (1,0) and (2,0) in col1
    { cx: 28, cy: 8, filled: false },   // dot 1
    { cx: 28, cy: 20, filled: false },  // dot 2
    { cx: 28, cy: 32, filled: false },  // dot 3
    { cx: 40, cy: 8, filled: true },    // dot 4
    { cx: 40, cy: 20, filled: false },  // dot 5
    { cx: 40, cy: 32, filled: true },   // dot 6
    // Cell 2 (dots 1,3): positions (0,0) and (2,0) in col0
    { cx: 56, cy: 8, filled: true },    // dot 1
    { cx: 56, cy: 20, filled: false },  // dot 2
    { cx: 56, cy: 32, filled: true },   // dot 3
    { cx: 68, cy: 8, filled: false },   // dot 4
    { cx: 68, cy: 20, filled: false },  // dot 5
    { cx: 68, cy: 32, filled: false },  // dot 6
  ];

  return (
    <svg
      role="img"
      aria-label="Logo der Abraham-Nemeth-Gesellschaft: Gleichheitszeichen in Nemeth-Braille"
      viewBox="0 0 96 40"
      width="96"
      height="40"
      className="landing-logo"
    >
      {positions.map((dot, i) => (
        <circle
          key={i}
          cx={dot.cx}
          cy={dot.cy}
          r={dotSize}
          fill={dot.filled ? '#1b2a4a' : 'none'}
          stroke="#1b2a4a"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

function NavBar() {
  return (
    <header className="landing-header" role="banner">
      <a href="#hauptinhalt" className="skip-link">Zum Hauptinhalt springen</a>
      <div className="landing-header-inner">
        <div className="landing-brand">
          <NemethLogo />
          <span className="landing-org-name">
            Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.
          </span>
        </div>
        <nav aria-label="Hauptnavigation">
          <ul className="landing-nav">
            <li><a href="#ueber-uns">Über uns</a></li>
            <li><a href="#forschung">Forschung</a></li>
            <li><a href="#publikationen">Publikationen</a></li>
            <li><a href="#wissenschaftler">Profile</a></li>
            <li><a href="#veranstaltungen">Veranstaltungen</a></li>
            <li><a href="#kontakt">Kontakt</a></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="landing-hero" aria-labelledby="hero-heading">
      <h1 id="hero-heading" className="landing-hero-title">
        Abraham-Nemeth-Gesellschaft{' '}
        <span className="landing-hero-subtitle">für barrierefreie Wissenschaft</span>
      </h1>
      <p className="landing-hero-tagline">
        <em>Barrierefreiheit ist kein Zusatz. Sie ist ein Prinzip der Wissenschaft.</em>
      </p>
      <p className="landing-hero-intro">
        Die Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft ist eine unabhängige
        wissenschaftliche Vereinigung mit Sitz in Wien. Sie erforscht die mathematischen und
        technologischen Grundlagen barrierefreier Systeme, dokumentiert die Beiträge behinderter
        Wissenschaftlerinnen und Wissenschaftler und setzt sich für strukturelle Barrierefreiheit
        im Wissenschaftssystem ein. Die Gesellschaft ist benannt nach Abraham Nemeth (1918–2013),
        dem blinden Mathematiker und Erfinder des Nemeth-Braille-Codes für mathematische Notation.
      </p>
    </section>
  );
}

function About() {
  return (
    <section id="ueber-uns" className="landing-section" aria-labelledby="ueber-uns-heading">
      <h2 id="ueber-uns-heading" className="landing-section-heading">Über die Gesellschaft</h2>

      <h3 id="selbstverstaendnis-heading">Selbstverständnis</h3>
      <p>
        Die Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft versteht Barrierefreiheit
        nicht als technische Nachrüstung und nicht als Akt der Fürsorge, sondern als epistemisches
        Grundprinzip. Wissenschaft, die nicht zugänglich ist, ist unvollständige Wissenschaft –
        sie schließt Perspektiven aus, die sie bereichern würden, und reproduziert Barrieren, die
        sie abzubauen vorgibt.
      </p>
      <p>
        Die Gesellschaft wurde in der Überzeugung gegründet, dass die mathematischen,
        algorithmischen und institutionellen Voraussetzungen barrierefreier Wissenschaft
        eigenständiger Forschung bedürfen. Ihre Arbeit bewegt sich an der Schnittstelle von
        Grundlagenforschung, Wissenschaftsgeschichte und Wissenschaftspolitik.
      </p>

      <h3 id="namensgebung-heading">Namensgebung</h3>
      <p>
        Abraham Nemeth, geboren 1918 in New York, erblindet von Geburt an, studierte Mathematik
        gegen den ausdrücklichen Rat seiner Universität, die ihn in ein als geeigneter
        betrachtetes Fach umlenken wollte. Er promovierte, lehrte jahrzehntelang und entwickelte
        den nach ihm benannten Nemeth-Code – ein Braille-System, das erstmals die vollständige
        Darstellung mathematischer Notation ermöglichte. Sein Lebenswerk steht exemplarisch für
        das Anliegen der Gesellschaft: dass wissenschaftliche Erkenntnis nicht an der
        Verfügbarkeit eines einzelnen Sinneskanals scheitern darf.
      </p>

      <h3 id="aufgaben-heading">Aufgaben und Ziele</h3>
      <p>
        Die Gesellschaft widmet sich vier Aufgabenbereichen. In der Grundlagenforschung untersucht
        sie die mathematischen Strukturen, die technologischer Barrierefreiheit zugrunde liegen –
        von maschinellem Sehen und Reinforcement Learning bis zur formalen Analyse assistiver
        Systeme. Im Bereich der wissenschaftlichen Darstellung erforscht sie modalitätsunabhängige
        Zugänge zu mathematischen, naturwissenschaftlichen und technischen Inhalten. In der
        historischen und biografischen Forschung dokumentiert sie systematisch die Beiträge
        behinderter Forschender, die in der Wissenschaftsgeschichtsschreibung bisher unzureichend
        gewürdigt werden. Und in der Wissenschaftspolitik erarbeitet sie Analysen und Empfehlungen
        zur strukturellen Barrierefreiheit an Hochschulen, in Verlagen und in Förderinstitutionen.
      </p>
    </section>
  );
}

function Research() {
  const areas = [
    {
      id: 'grundlagen',
      title: 'Mathematische Grundlagen technologischer Barrierefreiheit',
      text: `Assistive Technologien – von Navigationssystemen für blinde Nutzerinnen und Nutzer bis zu intelligenten Prothesen – beruhen auf mathematischen Modellen, deren Eigenschaften über die Qualität und Verlässlichkeit dieser Systeme entscheiden. Die Gesellschaft untersucht die formalen Grundlagen solcher Systeme mit besonderem Augenmerk auf geometrische und probabilistische Methoden der Umgebungswahrnehmung, auf lernende Systeme, die sich an individuelle Bedürfnisse anpassen, und auf die mathematischen Bedingungen, unter denen assistive Systeme verlässliche Sicherheitsgarantien bieten können.`,
      detail: `Ein zentrales Forschungsinteresse gilt der Frage, wie visuelle Information formal so reduziert und transformiert werden kann, dass sie über nicht-visuelle Kanäle – taktil, auditiv, haptisch – zugänglich wird, ohne wesentlichen Informationsverlust.`,
    },
    {
      id: 'darstellung',
      title: 'Barrierefreie Darstellung wissenschaftlicher Inhalte',
      text: `Wissenschaftliche Notation ist historisch auf visuelle Wahrnehmung ausgerichtet. Mathematische Formeln, chemische Strukturdiagramme, physikalische Schaltbilder und biologische Modelle setzen in ihrer konventionellen Darstellung das Sehen voraus. Die Gesellschaft untersucht, wie wissenschaftliche Inhalte modalitätsunabhängig dargestellt werden können, ohne ihre Präzision und Ausdruckskraft einzubüßen.`,
      detail: `Dabei stehen sowohl bestehende Systeme wie der Nemeth-Code und MathML als auch experimentelle Ansätze wie die Sonifikation mathematischer Strukturen und die algorithmische Erzeugung taktiler Darstellungen im Fokus.`,
    },
    {
      id: 'geschichte',
      title: 'Wissenschaftsgeschichte und Biografik',
      text: `Die Geschichte der Wissenschaft ist in erheblichem Maß auch eine Geschichte behinderter Forschender – eine Geschichte, die bislang fragmentarisch erzählt wird. Leonhard Euler verfasste einen wesentlichen Teil seines Werks nach seiner Erblindung. Bernard Morin, blind seit seiner Kindheit, leistete Beiträge zur Topologie, die bis heute grundlegend sind. Geerat Vermeij, ebenfalls blind, revolutionierte die Evolutionsbiologie durch einen Forschungsansatz, der auf taktiler Analyse beruhte.`,
      detail: `Die Gesellschaft baut ein systematisches biografisches Archiv auf, das die Beiträge behinderter Wissenschaftlerinnen und Wissenschaftler dokumentiert und in ihren wissenschaftshistorischen Kontext einordnet.`,
    },
    {
      id: 'politik',
      title: 'Wissenschaftspolitik und Inklusion',
      text: `Barrierefreie Wissenschaft erfordert neben technischen Lösungen strukturelle Veränderungen im Wissenschaftssystem. Die Gesellschaft analysiert die gegenwärtige Lage der Barrierefreiheit an Hochschulen, in wissenschaftlichen Verlagen und in Förderinstitutionen und erarbeitet auf dieser Grundlage Empfehlungen und Stellungnahmen.`,
      detail: `Zu den untersuchten Themen zählen die Zugänglichkeit wissenschaftlicher Publikationen und Peer-Review-Verfahren, die Bedingungen inklusiver Hochschullehre insbesondere in den MINT-Fächern, und die Frage, inwieweit bestehende Förderstrukturen den Bedürfnissen behinderter Forschender gerecht werden.`,
    },
  ];

  return (
    <section id="forschung" className="landing-section landing-section-alt" aria-labelledby="forschung-heading">
      <h2 id="forschung-heading" className="landing-section-heading">Forschungsschwerpunkte</h2>
      <div className="landing-research-grid">
        {areas.map((area) => (
          <article key={area.id} className="landing-research-card">
            <h3 id={`forschung-${area.id}`}>{area.title}</h3>
            <p>{area.text}</p>
            <p className="landing-research-detail">{area.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PublicationsPreview() {
  const entries = [
    {
      id: 'ANG-AP-2026-001',
      title: 'Zur informationstheoretischen Reduktion visueller Szenendaten für nicht-visuelle Ausgabekanäle.',
      category: 'Arbeitspapier',
      status: 'In Vorbereitung',
    },
    {
      id: 'ANG-WP-2026-001',
      title: 'Abraham Nemeth (1918–2013): Mathematiker, Pädagoge, Erfinder des Nemeth-Codes.',
      category: 'Wissenschaftlerprofil',
      status: 'Erschienen',
    },
    {
      id: 'ANG-ST-2026-001',
      title: 'Zur Barrierefreiheit mathematischer Notation in wissenschaftlichen Zeitschriften: Eine Bestandsaufnahme und Empfehlungen.',
      category: 'Stellungnahme',
      status: 'In Vorbereitung',
    },
    {
      id: 'ANG-NF-2026-001',
      title: 'Anmerkungen zur WCAG-Konformität mathematischer Darstellungen in Open-Access-Journalen.',
      category: 'Forschungsnotiz',
      status: 'In Vorbereitung',
    },
  ];

  return (
    <section id="publikationen" className="landing-section" aria-labelledby="publikationen-heading">
      <h2 id="publikationen-heading" className="landing-section-heading">Publikationen</h2>
      <p>
        Die Gesellschaft veröffentlicht Arbeitspapiere, Wissenschaftlerprofile, Stellungnahmen
        und kürzere Forschungsnotizen. Alle Veröffentlichungen stehen als frei zugängliche
        Dokumente in barrierefreien Formaten zur Verfügung.
      </p>
      <ul className="landing-pub-list">
        {entries.map((entry) => (
          <li key={entry.id} className="landing-pub-item">
            <span className="landing-pub-id">{entry.id}</span>
            <span className="landing-pub-title">{entry.title}</span>
            <span className="landing-pub-meta">
              {entry.category} – {entry.status}
            </span>
          </li>
        ))}
      </ul>
      <p>
        <a href="/publications" className="landing-more-link">
          Alle Publikationen anzeigen
        </a>
      </p>
    </section>
  );
}

function ProfilesPreview() {
  const profiles = [
    {
      name: 'Abraham Nemeth',
      dates: '1918–2013',
      summary: 'Mathematiker, Pädagoge, Erfinder des Nemeth-Codes. Von Geburt an blind, studierte er Mathematik gegen den Rat seiner Universität und entwickelte das weltweit verbreitete Braille-System für mathematische Notation.',
    },
    {
      name: 'Leonhard Euler',
      dates: '1707–1783',
      summary: 'Euler verlor in seinen Vierzigern das Augenlicht nahezu vollständig. Ein wesentlicher Teil seines mathematischen Werks entstand nach der Erblindung.',
    },
    {
      name: 'Bernard Morin',
      dates: '1931–2018',
      summary: 'Seit seinem sechsten Lebensjahr blind, bewies Morin 1959, dass eine Sphäre im dreidimensionalen Raum ohne Selbstdurchdringung umgestülpt werden kann – ein Ergebnis, an dem sehende Topologen gescheitert waren.',
    },
  ];

  return (
    <section id="wissenschaftler" className="landing-section landing-section-alt" aria-labelledby="wissenschaftler-heading">
      <h2 id="wissenschaftler-heading" className="landing-section-heading">Wissenschaftlerprofile</h2>
      <p>
        Das biografische Archiv der Gesellschaft dokumentiert die Beiträge behinderter
        Wissenschaftlerinnen und Wissenschaftler und ordnet sie in ihren
        wissenschaftshistorischen Kontext ein.
      </p>
      <div className="landing-profiles-grid">
        {profiles.map((profile) => (
          <article key={profile.name} className="landing-profile-card">
            <h3>{profile.name} <span className="landing-profile-dates">({profile.dates})</span></h3>
            <p>{profile.summary}</p>
          </article>
        ))}
      </div>
      <p>
        <a href="/profiles" className="landing-more-link">
          Alle Profile anzeigen
        </a>
      </p>
    </section>
  );
}

function Events() {
  return (
    <section id="veranstaltungen" className="landing-section" aria-labelledby="veranstaltungen-heading">
      <h2 id="veranstaltungen-heading" className="landing-section-heading">Veranstaltungen</h2>

      <h3>Kommende Veranstaltungen</h3>
      <dl className="landing-events-list">
        <dt>
          <time dateTime="2026-04">April 2026</time>
        </dt>
        <dd>
          <strong>Lesekreis: Barrierefreie Wissenschaft</strong><br />
          Monatlicher Lesekreis zu aktuellen Publikationen und Forschungsfragen im Bereich
          barrierefreie Wissenschaft. Teilnahme nach Anmeldung. Details werden rechtzeitig
          bekanntgegeben.
        </dd>
        <dt>
          <time dateTime="2026-06">Juni 2026</time>
        </dt>
        <dd>
          <strong>Workshop: Nemeth-Code für Einsteiger</strong><br />
          Einführung in die Nemeth-Braille-Notation für mathematische Ausdrücke.
          Keine Vorkenntnisse erforderlich.
        </dd>
      </dl>

      <h3>Vergangene Veranstaltungen</h3>
      <p className="landing-muted">
        Die Gesellschaft befindet sich im Aufbau. Ein Archiv vergangener Veranstaltungen
        wird nach den ersten durchgeführten Veranstaltungen hier zur Verfügung stehen.
      </p>
    </section>
  );
}

function Contact() {
  const [formErrors, setFormErrors] = useState({});
  const emailRef = useRef(null);
  const messageRef = useRef(null);

  const validateForm = () => {
    const errors = {};
    const email = emailRef.current?.value.trim();
    const message = messageRef.current?.value.trim();

    if (!email) {
      errors.email = 'Bitte geben Sie Ihre E-Mail-Adresse ein.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
    }

    if (!message) {
      errors.message = 'Bitte geben Sie eine Nachricht ein.';
    }

    return errors;
  };

  const handleSubmit = (e) => {
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      e.preventDefault();
      setFormErrors(errors);
      if (errors.email) {
        emailRef.current?.focus();
      } else if (errors.message) {
        messageRef.current?.focus();
      }
    }
  };

  const clearError = (field) => {
    if (formErrors[field]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <section id="kontakt" className="landing-section landing-section-alt" aria-labelledby="kontakt-heading">
      <h2 id="kontakt-heading" className="landing-section-heading">Kontakt und Mitgliedschaft</h2>

      <div className="landing-contact-grid">
        <div className="landing-contact-info">
          <h3>Kontakt</h3>
          <address className="landing-address">
            Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.<br />
            Vereinssitz Wien<br />
            <a href="mailto:kontakt@nemeth-gesellschaft.org">kontakt@nemeth-gesellschaft.org</a>
          </address>

          <h3>Mitgliedschaft</h3>
          <p>
            Die Mitgliedschaft steht allen natürlichen und juristischen Personen offen, die die
            Ziele der Gesellschaft unterstützen. Beitrittserklärungen können formlos per E-Mail
            oder über das Kontaktformular eingereicht werden.
          </p>
        </div>

        <div className="landing-contact-form-wrapper">
          <form
            className="landing-contact-form"
            action="mailto:kontakt@nemeth-gesellschaft.org"
            method="POST"
            encType="text/plain"
            onSubmit={handleSubmit}
            noValidate
          >
            <fieldset>
              <legend>Kontaktformular</legend>

              {Object.keys(formErrors).length > 0 && (
                <p className="error-text" role="alert">
                  <strong>Fehler:</strong> Bitte korrigieren Sie die markierten Felder.
                </p>
              )}

              <div className="landing-field">
                <label htmlFor="contact-name">Name</label>
                <input type="text" id="contact-name" name="name" autoComplete="name" />
              </div>

              <div className="landing-field">
                <label htmlFor="contact-email">
                  E-Mail <span className="required-indicator" aria-hidden="true">*</span>
                  <span className="sr-only">(Pflichtfeld)</span>
                </label>
                <input
                  ref={emailRef}
                  type="email"
                  id="contact-email"
                  name="email"
                  aria-required="true"
                  aria-invalid={formErrors.email ? 'true' : 'false'}
                  aria-describedby="contact-email-error"
                  autoComplete="email"
                  onChange={() => clearError('email')}
                />
                <p className="error-text" id="contact-email-error" aria-live="assertive">
                  {formErrors.email || ''}
                </p>
              </div>

              <div className="landing-field">
                <label htmlFor="contact-subject">Betreff</label>
                <input type="text" id="contact-subject" name="subject" />
              </div>

              <div className="landing-field">
                <label htmlFor="contact-message">
                  Nachricht <span className="required-indicator" aria-hidden="true">*</span>
                  <span className="sr-only">(Pflichtfeld)</span>
                </label>
                <textarea
                  ref={messageRef}
                  id="contact-message"
                  name="message"
                  rows="5"
                  aria-required="true"
                  aria-invalid={formErrors.message ? 'true' : 'false'}
                  aria-describedby="contact-message-error"
                  onChange={() => clearError('message')}
                />
                <p className="error-text" id="contact-message-error" aria-live="assertive">
                  {formErrors.message || ''}
                </p>
              </div>

              <button type="submit" className="landing-submit-btn">Nachricht senden</button>
            </fieldset>
          </form>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-footer" role="contentinfo">
      <div className="landing-footer-inner">
        <div className="landing-footer-org">
          <p>
            Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.
          </p>
          <p className="landing-footer-meta">
            Vereinsregisternummer: ZVR XXXXX · Vereinssitz: Wien
          </p>
        </div>
        <nav aria-label="Rechtliche Hinweise und weitere Seiten">
          <ul className="landing-footer-links">
            <li><a href="/accessibility">Barrierefreiheitserklärung</a></li>
            <li><a href="/audit">Audit-Service</a></li>
          </ul>
        </nav>
        <p className="landing-footer-wcag">
          Diese Website erfüllt WCAG 2.2 AA.
        </p>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <>
      <Head>
        <title>Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft e.V.</title>
        <meta name="description" content="Die Abraham-Nemeth-Gesellschaft für barrierefreie Wissenschaft erforscht die mathematischen und technologischen Grundlagen barrierefreier Systeme und setzt sich für strukturelle Barrierefreiheit im Wissenschaftssystem ein." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="landing-page">
        <NavBar />
        <main id="hauptinhalt">
          <Hero />
          <About />
          <Research />
          <PublicationsPreview />
          <ProfilesPreview />
          <Events />
          <Contact />
        </main>
        <Footer />
      </div>
    </>
  );
}
