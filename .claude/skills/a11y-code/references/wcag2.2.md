# WCAG 2.2 – Alle Erfolgskriterien mit Codebeispielen

> Vollständige Referenz aller 86 Erfolgskriterien der Web Content Accessibility Guidelines 2.2.
> 🆕 = Neu in WCAG 2.2 | 🗑️ = Entfernt in WCAG 2.2

---

## Prinzip 1: Wahrnehmbar

Informationen und Bestandteile der Benutzerschnittstelle müssen den Benutzern so präsentiert werden, dass diese sie wahrnehmen können.

---

### Richtlinie 1.1 – Textalternativen

#### 1.1.1 Nicht-Text-Inhalt (A)

Alle Nicht-Text-Inhalte müssen eine Textalternative haben.

**❌ Schlecht:**
```html
<img src="firmenlogo.png">
```

**✅ Gut:**
```html
<img src="firmenlogo.png" alt="Logo der Firma Beispiel GmbH">
```

Dekorative Bilder:
```html
<img src="zierleiste.png" alt="" role="presentation">
```

**SVG-Icons in Buttons** – häufig stumm für Screenreader:
```html
<!-- ❌ Schlecht: SVG ohne zugänglichen Namen -->
<button>
  <svg viewBox="0 0 24 24"><path d="..."/></svg>
</button>

<!-- ✅ Gut: aria-label auf Button, SVG versteckt -->
<button aria-label="Menü öffnen">
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="..."/></svg>
</button>
```

**Komplexe Bilder (Infografiken, Diagramme):**
```html
<!-- ❌ Schlecht: Nutzloser Alt-Text -->
<img src="umsatz-chart.png" alt="Diagramm">

<!-- ✅ Gut: Kurzer Alt + ausführliche Beschreibung -->
<figure>
  <img src="umsatz-chart.png"
       alt="Balkendiagramm: Umsatzentwicklung 2020–2024"
       aria-describedby="chart-desc">
  <figcaption id="chart-desc">
    Der Umsatz stieg von 1,2 Mio. € (2020) auf 3,8 Mio. € (2024).
    Den größten Sprung gab es 2022 mit +40 %.
  </figcaption>
</figure>
```

---

### Richtlinie 1.2 – Zeitbasierte Medien

#### 1.2.1 Reines Audio und reines Video (aufgezeichnet) (A)

Für aufgezeichnete Audio- oder Videoinhalte muss eine Alternative bereitgestellt werden (Transkript oder Audiobeschreibung).

**❌ Schlecht:**
```html
<audio src="interview.mp3" controls></audio>
```

**✅ Gut:**
```html
<audio src="interview.mp3" controls></audio>
<a href="interview-transkript.html">Transkript des Interviews lesen</a>
```

---

#### 1.2.2 Untertitel (aufgezeichnet) (A)

Aufgezeichnete Videos mit Audio müssen Untertitel enthalten.

**❌ Schlecht:**
```html
<video src="vortrag.mp4" controls></video>
```

**✅ Gut:**
```html
<video src="vortrag.mp4" controls>
  <track kind="captions" src="vortrag-ut.vtt" srclang="de" label="Deutsch" default>
</video>
```

---

#### 1.2.3 Audiodeskription oder Medienalternative (aufgezeichnet) (A)

Videos müssen eine Audiodeskription oder eine vollständige Textalternative haben.

**❌ Schlecht:**
```html
<video src="tutorial.mp4" controls></video>
<!-- Kein Transkript, keine Audiodeskription -->
```

**✅ Gut:**
```html
<video src="tutorial.mp4" controls>
  <track kind="descriptions" src="tutorial-ad.vtt" srclang="de" label="Audiodeskription">
</video>
<a href="tutorial-transkript.html">Vollständiges Transkript mit Beschreibungen</a>
```

---

#### 1.2.4 Untertitel (Live) (AA)

Live-Audio in synchronisierten Medien muss Untertitel haben.

**❌ Schlecht:**
```html
<video src="livestream" controls>
  <!-- Keine Live-Untertitel -->
</video>
```

**✅ Gut:**
```html
<video src="livestream" controls>
  <track kind="captions" src="live-captions-endpoint" srclang="de" label="Live-Untertitel" default>
</video>
<!-- Echtzeit-Untertitelung z. B. über CART/Stenografie -->
```

---

#### 1.2.5 Audiodeskription (aufgezeichnet) (AA)

Aufgezeichnete Videos müssen eine Audiodeskription der visuellen Inhalte enthalten.

**❌ Schlecht:**
```html
<!-- Video zeigt Grafiken und Diagramme, die nur visuell erklärt werden -->
<video src="praesentation.mp4" controls></video>
```

**✅ Gut:**
```html
<video src="praesentation.mp4" controls>
  <track kind="descriptions" src="praesentation-ad.vtt" srclang="de">
</video>
<a href="praesentation-mit-ad.mp4">Version mit Audiodeskription</a>
```

---

#### 1.2.6 Gebärdensprache (aufgezeichnet) (AAA)

Aufgezeichnete Audioinhalte in synchronisierten Medien müssen eine Gebärdensprachdolmetschung haben.

**✅ Gut:**
```html
<video src="vortrag.mp4" controls></video>
<a href="vortrag-gebaerdensprache.mp4">Version mit Gebärdensprachdolmetschung</a>
```

---

#### 1.2.7 Erweiterte Audiodeskription (aufgezeichnet) (AAA)

Falls Pausen im Vordergrund-Audio nicht ausreichen, wird eine erweiterte Audiodeskription bereitgestellt (Video wird pausiert).

**✅ Gut:**
```html
<a href="film-erweiterte-ad.mp4">Version mit erweiterter Audiodeskription</a>
```

---

#### 1.2.8 Medienalternative (aufgezeichnet) (AAA)

Für alle aufgezeichneten synchronisierten Medien muss eine vollständige Textalternative bereitgestellt werden.

**✅ Gut:**
```html
<video src="dokumentation.mp4" controls>
  <track kind="captions" src="doku-ut.vtt" srclang="de" default>
</video>
<a href="dokumentation-volltext.html">Vollständige Textfassung der Dokumentation</a>
```

---

#### 1.2.9 Reines Audio (Live) (AAA)

Für Live-Audio muss eine Textalternative bereitgestellt werden.

**✅ Gut:**
```html
<audio src="live-radio" controls></audio>
<div id="live-transkript" aria-live="polite">
  <!-- Echtzeit-Transkript wird hier eingefügt -->
</div>
```

---

### Richtlinie 1.3 – Anpassbar

#### 1.3.1 Info und Beziehungen (A)

Informationen, Struktur und Beziehungen, die durch die Darstellung vermittelt werden, müssen programmatisch bestimmbar sein.

**❌ Schlecht:**
```html
<div class="ueberschrift-gross">Kontaktformular</div>
<div class="fett">Name:</div>
<div><input type="text"></div>
```

**✅ Gut:**
```html
<h2>Kontaktformular</h2>
<form>
  <label for="name">Name:</label>
  <input type="text" id="name" name="name">
</form>
```

**Tabellen:**
```html
<!-- ❌ Schlecht -->
<div class="tabelle">
  <div class="zeile"><div>Name</div><div>Alter</div></div>
</div>

<!-- ✅ Gut -->
<table>
  <thead>
    <tr><th>Name</th><th>Alter</th></tr>
  </thead>
  <tbody>
    <tr><td>Anna</td><td>30</td></tr>
  </tbody>
</table>
```

**Radio-Buttons und Checkbox-Gruppen** – einer der häufigsten Fehler überhaupt:
```html
<!-- ❌ Schlecht: Gruppierte Felder ohne semantische Verbindung -->
<p>Zahlungsart wählen:</p>
<input type="radio" id="paypal" name="pay"><label for="paypal">PayPal</label>
<input type="radio" id="card" name="pay"><label for="card">Kreditkarte</label>

<!-- ✅ Gut: fieldset + legend -->
<fieldset>
  <legend>Zahlungsart wählen:</legend>
  <input type="radio" id="paypal" name="pay"><label for="paypal">PayPal</label>
  <input type="radio" id="card" name="pay"><label for="card">Kreditkarte</label>
</fieldset>

<!-- ✅ Gut: ARIA-Alternative, wenn fieldset nicht möglich ist (z. B. in React/Vue) -->
<div role="group" aria-labelledby="pay-group-label">
  <p id="pay-group-label">Zahlungsart wählen:</p>
  <input type="radio" id="paypal" name="pay"><label for="paypal">PayPal</label>
  <input type="radio" id="card" name="pay"><label for="card">Kreditkarte</label>
</div>
```

**Heading-Hierarchie** – Stufen überspringen:
```html
<!-- ❌ Schlecht: h1 direkt zu h4 -->
<h1>Startseite</h1>
<h4>Unsere Angebote</h4>

<!-- ✅ Gut: Keine Stufen überspringen -->
<h1>Startseite</h1>
<h2>Unsere Angebote</h2>
```

**`<br>` statt echte Listen** – häufig in CMS-Inhalten:
```html
<!-- ❌ Schlecht: Visuelle Liste ohne Semantik -->
<p>Vorteile:<br>Schnell<br>Günstig<br>Zuverlässig</p>

<!-- ✅ Gut: Echte Liste -->
<p>Vorteile:</p>
<ul>
  <li>Schnell</li>
  <li>Günstig</li>
  <li>Zuverlässig</li>
</ul>
```

**Wichtige Infos nur per CSS `content`** – nicht alle Screenreader lesen das:
```css
/* ❌ Schlecht: Information nur in CSS */
.price::before {
  content: "Angebot: ";
  color: red;
}
```
```html
<!-- ✅ Gut: Info im HTML, visuelle Gestaltung per CSS -->
<span class="sr-only">Angebot: </span><span class="price">19,99 €</span>
```

---

#### 1.3.2 Bedeutungstragende Reihenfolge (A)

Die richtige Lesereihenfolge muss programmatisch bestimmbar sein.

**❌ Schlecht:**
```html
<div style="display: flex; flex-direction: row-reverse;">
  <div>Schritt 3</div>
  <div>Schritt 2</div>
  <div>Schritt 1</div>
</div>
<!-- DOM-Reihenfolge: 3, 2, 1 – weicht von visueller Reihenfolge ab -->
```

**✅ Gut:**
```html
<div style="display: flex;">
  <div>Schritt 1</div>
  <div>Schritt 2</div>
  <div>Schritt 3</div>
</div>
```

---

#### 1.3.3 Sensorische Eigenschaften (A)

Anweisungen dürfen sich nicht ausschließlich auf sensorische Merkmale stützen (Form, Größe, Position, Farbe, Klang).

**❌ Schlecht:**
```html
<p>Klicken Sie auf den runden grünen Button rechts.</p>
```

**✅ Gut:**
```html
<p>Klicken Sie auf den Button „Absenden".</p>
<button>Absenden</button>
```

---

#### 1.3.4 Ausrichtung (AA)

Inhalte dürfen nicht auf eine einzige Anzeigeausrichtung beschränkt sein (Hoch- oder Querformat).

**❌ Schlecht:**
```css
@media (orientation: portrait) {
  body { display: none; }
  body::after { content: "Bitte drehen Sie Ihr Gerät."; }
}
```

**✅ Gut:**
```css
@media (orientation: portrait) {
  .layout { flex-direction: column; }
}
@media (orientation: landscape) {
  .layout { flex-direction: row; }
}
```

---

#### 1.3.5 Eingabezweck bestimmen (AA)

Der Zweck von Eingabefeldern für persönliche Daten muss programmatisch bestimmbar sein.

**❌ Schlecht:**
```html
<input type="text" name="field1">
<input type="text" name="field2">
```

**✅ Gut:**
```html
<label for="fname">Vorname</label>
<input type="text" id="fname" name="fname" autocomplete="given-name">

<label for="email">E-Mail</label>
<input type="email" id="email" name="email" autocomplete="email">

<label for="tel">Telefon</label>
<input type="tel" id="tel" name="tel" autocomplete="tel">
```

---

#### 1.3.6 Zweck identifizieren (AAA)

Der Zweck von Benutzeroberflächenkomponenten, Icons und Regionen kann programmatisch bestimmt werden.

**❌ Schlecht:**
```html
<!-- Keine semantischen HTML5-Landmarks, nur bedeutungslose Divs -->
<div class="header">...</div>
<div class="sidebar">...</div>
<div class="footer">...</div>
```

**✅ Gut:**
```html
<nav aria-label="Hauptnavigation">
  <a href="/home"><span aria-hidden="true">🏠</span> Startseite</a>
</nav>
<main>...</main>
<aside aria-label="Sidebar mit verwandten Artikeln">...</aside>
<footer>...</footer>
```

---

### Richtlinie 1.4 – Unterscheidbar

#### 1.4.1 Benutzung von Farbe (A)

Farbe darf nicht als einziges visuelles Mittel verwendet werden, um Informationen zu vermitteln.

**❌ Schlecht:**
```html
<p>Pflichtfelder sind <span style="color: red;">rot</span> markiert.</p>
<input type="text" style="border-color: red;">
```

**✅ Gut:**
```html
<label for="name">Name <span aria-label="Pflichtfeld">*</span></label>
<input type="text" id="name" required aria-required="true">
```

**Links im Fließtext** – nur durch Farbe erkennbar:
```css
/* ❌ Schlecht: Link nur durch Farbe unterscheidbar */
p a { color: #0056b3; text-decoration: none; }

/* ✅ Gut: Link hat zusätzlich einen Unterstrich */
p a { color: #0056b3; text-decoration: underline; text-underline-offset: 2px; }
```

**Diagramme/Charts:**
```css
/* ❌ Schlecht: Linien nur durch Farbe unterscheidbar */
.line-revenue { stroke: green; }
.line-costs { stroke: red; }

/* ✅ Gut: Unterscheidung durch Farbe UND Muster */
.line-revenue { stroke: green; stroke-dasharray: none; }   /* Durchgezogen */
.line-costs { stroke: red; stroke-dasharray: 4 4; }        /* Gestrichelt */
```

---

#### 1.4.2 Audio-Steuerung (A)

Automatisch abgespielte Audioinhalte (>3 Sek.) müssen pausierbar/stoppbar sein oder die Lautstärke muss regelbar sein.

**❌ Schlecht:**
```html
<audio src="hintergrundmusik.mp3" autoplay loop></audio>
```

**✅ Gut:**
```html
<audio src="hintergrundmusik.mp3" controls></audio>
```

---

#### 1.4.3 Kontrast (Minimum) (AA)

Text muss ein Kontrastverhältnis von mindestens 4,5:1 haben (3:1 für großen Text ≥ 18pt / 14pt fett).

**❌ Schlecht:**
```css
/* Kontrast ca. 2,5:1 */
p { color: #999; background-color: #fff; }
```

**✅ Gut:**
```css
/* Kontrast ca. 7:1 */
p { color: #333; background-color: #fff; }
```

**Placeholder-Texte** – fallen fast immer durch den WCAG-Test:
```css
/* ❌ Schlecht: Standard-Grau hat oft nur ~2:1 Kontrast */
input::placeholder { color: #cccccc; }

/* ✅ Gut: Dunkleres Grau für mindestens 4,5:1 Kontrast auf Weiß */
input::placeholder { color: #767676; opacity: 1; }
```

---

#### 1.4.4 Textgröße ändern (AA)

Text muss ohne Hilfstechnologie auf 200 % vergrößerbar sein, ohne Inhaltsverlust.

**❌ Schlecht:**
```css
body { font-size: 12px; }
.container { width: 960px; overflow: hidden; }
```

**✅ Gut:**
```css
body { font-size: 1rem; }
.container { max-width: 60rem; overflow: visible; }
```

**Zoom auf Mobilgeräten blockiert** – extrem häufiger Fehler:
```html
<!-- ❌ Schlecht: Blockiert Zoom -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">

<!-- ✅ Gut: Zoom erlauben -->
<meta name="viewport" content="width=device-width, initial-scale=1">
```

---

#### 1.4.5 Bilder eines Textes (AA)

Text soll als echter Text und nicht als Bild dargestellt werden (Ausnahmen: Logos, anpassbare Bilder).

**❌ Schlecht:**
```html
<img src="willkommen-auf-unserer-seite.png" alt="Willkommen auf unserer Seite">
```

**✅ Gut:**
```html
<h1>Willkommen auf unserer Seite</h1>
```

---

#### 1.4.6 Kontrast (Erweitert) (AAA)

Text muss ein Kontrastverhältnis von mindestens 7:1 haben (4,5:1 für großen Text).

**❌ Schlecht:**
```css
/* Erfüllt zwar AA (4,5:1), scheitert aber an AAA (7:1) */
p { color: #767676; background-color: #fff; }
```

**✅ Gut:**
```css
/* Kontrast ca. 12,6:1 */
p { color: #1a1a1a; background-color: #fff; }
```

---

#### 1.4.7 Leiser oder kein Hintergrund-Audio (AAA)

Aufgezeichnete Audioinhalte mit Sprache müssen Hintergrundgeräusche vermeiden oder mindestens 20 dB leiser haben.

**❌ Schlecht:**
```html
<!-- Laute Hintergrundmusik überdeckt die Sprecherstimme -->
<audio src="werbespot-laute-musik.mp3" controls></audio>
```

**✅ Gut:**
```html
<!-- Podcast ohne Hintergrundmusik während des Sprechens -->
<audio src="podcast-ohne-hintergrund.mp3" controls></audio>
```

---

#### 1.4.8 Visuelle Präsentation (AAA)

Textblöcke müssen vom Benutzer anpassbar sein (Vordergrund/Hintergrundfarbe, Zeilenabstand ≥1,5, max. 80 Zeichen Breite, kein Blocksatz).

**❌ Schlecht:**
```css
p {
  text-align: justify;
  width: 1200px;
  line-height: 1.0;
}
```

**✅ Gut:**
```css
p {
  text-align: left;
  max-width: 80ch;
  line-height: 1.5;
}
```

---

#### 1.4.9 Bilder eines Textes (keine Ausnahme) (AAA)

Bilder von Text werden nur für reine Dekoration oder wenn eine bestimmte Darstellung wesentlich ist verwendet.

**❌ Schlecht:**
```html
<!-- Text als Bild, nur um eine spezielle Schriftart zu erzwingen -->
<img src="zitat-in-kalligrafie.png" alt="Sein oder Nichtsein, das ist hier die Frage">
```

**✅ Gut:**
```html
<h1 style="font-family: 'Playfair Display', serif; font-size: 3rem;">
  Unsere Vision
</h1>
```

---

#### 1.4.10 Umbruch (Reflow) (AA)

Inhalte müssen ohne horizontales Scrollen dargestellt werden können bei 320 CSS-Pixeln Breite (vertikal) bzw. 256 CSS-Pixeln Höhe (horizontal).

**❌ Schlecht:**
```css
.content {
  width: 1200px;
  overflow-x: scroll;
}
```

**✅ Gut:**
```css
.content {
  max-width: 100%;
  overflow-wrap: break-word;
}
img { max-width: 100%; height: auto; }

/* Flex-Container müssen auf kleinen Screens umbrechen dürfen */
.row {
  display: flex;
  flex-wrap: wrap;
}
```

---

#### 1.4.11 Nicht-Text-Kontrast (AA)

Grafische Objekte und UI-Komponenten müssen ein Kontrastverhältnis von mindestens 3:1 haben.

**❌ Schlecht:**
```css
button {
  border: 2px solid #ccc; /* ~1,6:1 Kontrast */
  background: #fff;
}
```

**✅ Gut:**
```css
button {
  border: 2px solid #767676; /* ~4,5:1 Kontrast */
  background: #fff;
  color: #333;
}
```

**Custom Checkboxen/Radio-Buttons:**
```css
/* ❌ Schlecht: Hellgrauer Ring auf Weiß (~1,5:1) */
.custom-radio { border: 2px solid #ccc; border-radius: 50%; }

/* ✅ Gut: Deutlicher Rand (~4,5:1) */
.custom-radio { border: 2px solid #595959; border-radius: 50%; }
```

> **Hinweis:** Deaktivierte Elemente (`disabled`) sind von der 3:1-Kontrastregel ausgenommen. Das führt in der Praxis oft zu Diskussionen mit Designern – der Kontrast darf hier bewusst niedriger sein.

---

#### 1.4.12 Textabstand (AA)

Inhalte müssen lesbar bleiben, wenn Benutzer folgende Abstände setzen: Zeilenabstand 1,5×, Absatzabstand 2×, Buchstabenabstand 0,12×, Wortabstand 0,16×.

**❌ Schlecht:**
```css
.card {
  height: 200px;
  overflow: hidden; /* Schneidet Text ab bei vergrößertem Abstand */
}
```

**✅ Gut:**
```css
.card {
  min-height: 200px; /* Wächst mit dem Inhalt */
  overflow: visible;
}
```

---

#### 1.4.13 Eingeblendete Inhalte (AA)

Zusätzliche Inhalte, die bei Hover/Focus erscheinen (Tooltips, Dropdowns), müssen verwerfbar, hover-fähig und persistent sein.

**❌ Schlecht:**
```css
.tooltip { display: none; }
.trigger:hover .tooltip { display: block; }
/* Tooltip verschwindet sofort wenn Maus ihn verlässt */
/* Kein Weg, den Tooltip per Tastatur zu schließen */
```

**✅ Gut:**
```html
<button aria-describedby="tip1">Info</button>
<div id="tip1" role="tooltip" class="tooltip">
  Hier steht eine Erklärung.
</div>
```
```css
.tooltip { display: none; }
.trigger:hover .tooltip,
.trigger:focus .tooltip,
.tooltip:hover { /* Tooltip bleibt beim Hovern sichtbar */
  display: block;
}
```
```js
// Escape-Taste schließt den Tooltip
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTooltip();
});
```

---

## Prinzip 2: Bedienbar

Bestandteile der Benutzerschnittstelle und Navigation müssen bedienbar sein.

---

### Richtlinie 2.1 – Tastaturbedienbar

#### 2.1.1 Tastatur (A)

Alle Funktionen müssen per Tastatur bedienbar sein.

**❌ Schlecht:**
```html
<div onclick="doSomething()" style="cursor: pointer;">
  Klick mich
</div>
```

**✅ Gut:**
```html
<button onclick="doSomething()">Klick mich</button>

<!-- Oder wenn div nötig: -->
<div role="button" tabindex="0"
     onclick="doSomething()"
     onkeydown="if(event.key==='Enter'||event.key===' ')doSomething()">
  Klick mich
</div>
```

**Button vs. Link** – falsche Semantik in SPAs (React/Vue/Angular):
```html
<!-- ❌ Schlecht: Link als Aktion missbraucht -->
<a href="#" class="btn" onclick="submitForm()">Speichern</a>

<!-- ✅ Gut: Button für Aktionen, Links für Navigation -->
<button type="submit" class="btn">Speichern</button>
```

---

#### 2.1.2 Keine Tastaturfalle (A)

Der Tastaturfokus darf nicht in einem Element gefangen werden, ohne dass der Benutzer es verlassen kann.

**❌ Schlecht:**
```js
element.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') e.preventDefault();
});
```

**✅ Gut:**
```js
// Modal mit Fokusfalle, die per Escape verlassen werden kann
dialog.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDialog();
  if (e.key === 'Tab') trapFocusWithinDialog(e);
});
```

---

#### 2.1.3 Tastatur (keine Ausnahme) (AAA)

Alle Funktionen müssen ohne Ausnahme per Tastatur bedienbar sein (auch Freihandzeichnen, Drag & Drop etc.).

**❌ Schlecht:**
```html
<!-- Zeichen-App zwingt den Nutzer, die Maus zu benutzen -->
<canvas id="drawing-board" onmousedown="startDraw()" onmousemove="draw()"></canvas>
```

**✅ Gut:**
```html
<!-- Bietet zusätzlich Tastaturbefehle, um Formen zu platzieren -->
<canvas id="drawing-board"></canvas>
<div class="keyboard-controls">
  <label>X: <input type="number"></label>
  <label>Y: <input type="number"></label>
  <button onclick="drawCircleAt()">Kreis zeichnen</button>
</div>
```

---

#### 2.1.4 Zeichentastenkürzel (A)

Tastaturkürzel aus einzelnen Zeichen müssen abschaltbar oder umkonfigurierbar sein oder nur bei Fokus aktiv.

**❌ Schlecht:**
```js
// Einzeltasten-Shortcut ohne Möglichkeit zur Deaktivierung
document.addEventListener('keydown', (e) => {
  if (e.key === 's') openSearch();
});
```

**✅ Gut:**
```js
// Modifizier-Taste erforderlich
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') openSearch();
});

// Oder: Shortcuts deaktivierbar
if (userSettings.keyboardShortcuts) {
  document.addEventListener('keydown', handleShortcuts);
}
```

---

### Richtlinie 2.2 – Ausreichend Zeit

#### 2.2.1 Zeitbegrenzung anpassbar (A)

Zeitbegrenzungen müssen abschaltbar, anpassbar oder verlängerbar sein.

**❌ Schlecht:**
```js
// Session-Timeout ohne Warnung
setTimeout(() => {
  window.location = '/logout';
}, 300000);
```

**✅ Gut:**
```js
// Warnung 60 Sekunden vor Ablauf mit Verlängerungsoption
setTimeout(() => {
  showDialog('Ihre Sitzung läuft in 60 Sekunden ab. Verlängern?', {
    onConfirm: () => extendSession(),
    onTimeout: () => logout()
  });
}, 240000);
```

---

#### 2.2.2 Pausieren, Beenden, Ausblenden (A)

Sich bewegende, blinkende oder scrollende Inhalte müssen pausierbar, stoppbar oder ausblenbar sein.

**❌ Schlecht:**
```html
<marquee>Aktuelle Nachrichten...</marquee>
<div class="auto-carousel"><!-- Kein Stopp-Button --></div>
```

**✅ Gut:**
```html
<div class="carousel" role="region" aria-label="Neuigkeiten-Karussell">
  <div class="slides">...</div>
  <button onclick="pauseCarousel()" aria-label="Karussell pausieren">⏸ Pause</button>
</div>
```

**Autoplay-Hintergrundvideos (Hero-Videos)** – häufigster moderner Verstoß:
```html
<!-- ❌ Schlecht: Autoplay-Video ohne Pause-Möglichkeit -->
<video src="hero-bg.mp4" autoplay muted loop class="hero-video"></video>

<!-- ✅ Gut: Pause-Button + prefers-reduced-motion beachten -->
<div class="hero">
  <video src="hero-bg.mp4" autoplay muted loop id="hero-vid" class="hero-video"></video>
  <button onclick="document.getElementById('hero-vid').pause()"
          aria-label="Hintergrundvideo pausieren">⏸ Pause</button>
</div>
```
```css
@media (prefers-reduced-motion: reduce) {
  .hero-video { display: none; }
}
```

---

#### 2.2.3 Keine Zeitbegrenzung (AAA)

Zeitbegrenzungen werden komplett vermieden (Ausnahme: Echtzeitevents).

**❌ Schlecht:**
```html
<!-- Harter 10-Minuten-Countdown, der nicht deaktiviert werden kann -->
<div id="countdown">10:00</div>
<script>
  setTimeout(() => window.location = '/timeout', 600000);
</script>
```

**✅ Gut:**
```html
<form>
  <p>Sie können dieses Formular jederzeit ausfüllen. Ihr Fortschritt wird gespeichert.</p>
</form>
```

---

#### 2.2.4 Unterbrechungen (AAA)

Unterbrechungen (z. B. Benachrichtigungen) müssen vom Benutzer unterdrückt oder verschoben werden können.

**❌ Schlecht:**
```html
<!-- Newsletter-Modal ploppt nach 15 Sekunden ungefragt auf -->
<script>
  setTimeout(() => {
    document.getElementById('newsletter-modal').showModal();
  }, 15000);
</script>
```

**✅ Gut:**
```html
<div role="status" aria-live="polite">
  <!-- Nicht-dringende Updates erscheinen hier -->
</div>
<label>
  <input type="checkbox" id="notif-toggle"> Benachrichtigungen pausieren
</label>
```

---

#### 2.2.5 Erneute Authentisierung (AAA)

Nach einer erneuten Authentifizierung müssen alle Daten der aktuellen Sitzung erhalten bleiben.

**❌ Schlecht:**
```html
<!-- Sitzung läuft ab, nach Re-Login sind alle Formulareingaben gelöscht -->
<form action="/submit">
  <!-- Formular ist nach dem erneuten Login wieder komplett leer -->
</form>
```

**✅ Gut:**
```js
// Formulardaten vor Session-Timeout speichern
window.addEventListener('beforeunload', () => {
  sessionStorage.setItem('formData', JSON.stringify(getFormData()));
});

// Nach Re-Login Daten wiederherstellen
window.addEventListener('load', () => {
  const saved = sessionStorage.getItem('formData');
  if (saved) restoreFormData(JSON.parse(saved));
});
```

---

#### 2.2.6 Timeouts (AAA)

Benutzer müssen über Timeouts informiert werden, die zu Datenverlust führen können.

**❌ Schlecht:**
```html
<!-- Sitzung läuft lautlos ab, Nutzer klickt "Speichern" und verliert alle Daten -->
<button type="submit">Änderungen speichern</button>
<!-- Führt zu einer generischen "Bitte loggen Sie sich ein"-Seite -->
```

**✅ Gut:**
```html
<p role="alert">
  ⚠️ Ihre Sitzung wird nach 20 Minuten Inaktivität beendet.
  Nicht gespeicherte Daten gehen dabei verloren.
</p>
```

---

### Richtlinie 2.3 – Anfälle und physische Reaktionen

#### 2.3.1 Drei Blitze oder unterhalb Schwellenwert (A)

Inhalte dürfen nicht mehr als dreimal pro Sekunde blitzen.

**❌ Schlecht:**
```css
@keyframes blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.alert { animation: blink 0.2s infinite; }
```

**✅ Gut:**
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
.alert { animation: pulse 2s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .alert { animation: none; }
}
```

---

#### 2.3.2 Drei Blitze (AAA)

Inhalte dürfen nie mehr als dreimal pro Sekunde blitzen (ohne Ausnahme).

*(Strengere Version von 2.3.1, komplett keine Blitze über dem Schwellenwert.)*

---

#### 2.3.3 Animation durch Interaktion (AAA)

Durch Interaktion ausgelöste Bewegungsanimationen können deaktiviert werden.

**❌ Schlecht:**
```css
/* Parallax-Effekt, der Übelkeit auslösen kann und nicht abschaltbar ist */
.parallax-bg {
  transform: translateZ(-1px) scale(2);
}
/* Es fehlt @media (prefers-reduced-motion: reduce) */
```

**✅ Gut:**
```css
.card { transition: transform 0.3s ease; }
.card:hover { transform: scale(1.05); }

@media (prefers-reduced-motion: reduce) {
  .card { transition: none; }
  .card:hover { transform: none; }
}
```

---

### Richtlinie 2.4 – Navigierbar

#### 2.4.1 Blöcke umgehen (A)

Es muss eine Möglichkeit geben, sich wiederholende Inhaltsblöcke zu überspringen.

**❌ Schlecht:**
```html
<body>
  <div class="nav"><!-- 50 Navigationslinks --></div>
  <div class="content">...</div>
</body>
```

**✅ Gut:**
```html
<body>
  <a href="#main" class="skip-link">Zum Hauptinhalt springen</a>
  <nav aria-label="Hauptnavigation">...</nav>
  <main id="main">...</main>
</body>
```
```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
}
.skip-link:focus {
  top: 0;
}
```

**Skip-Links in SPAs** – funktionieren oft nicht, weil der Fokus nicht wirklich springt:
```js
// ❌ Schlecht: Nur Hash-Navigation, Fokus bleibt oben
// <a href="#main">Zum Inhalt</a>

// ✅ Gut: Fokus programmatisch setzen
document.querySelector('.skip-link').addEventListener('click', (e) => {
  e.preventDefault();
  const main = document.getElementById('main');
  main.setAttribute('tabindex', '-1');
  main.focus();
});
```

---

#### 2.4.2 Seite betitelt (A)

Webseiten müssen einen aussagekräftigen Titel haben.

**❌ Schlecht:**
```html
<title>Seite 1</title>
```

**✅ Gut:**
```html
<title>Kontaktformular – Beispiel GmbH</title>
```

---

#### 2.4.3 Fokusreihenfolge (A)

Die Fokusreihenfolge muss logisch und sinnvoll sein.

**❌ Schlecht:**
```html
<input tabindex="3" placeholder="Name">
<input tabindex="1" placeholder="E-Mail">
<input tabindex="2" placeholder="Telefon">
```

**✅ Gut:**
```html
<!-- Natürliche DOM-Reihenfolge = richtige Tab-Reihenfolge -->
<input placeholder="Name">
<input placeholder="E-Mail">
<input placeholder="Telefon">
```

**CSS `order` / `flex-direction: row-reverse`** – Tab-Fokus springt wild:
```css
/* ❌ Schlecht: DOM: Abbrechen (Tab 1), Speichern (Tab 2)
   Optik: Speichern (rechts), Abbrechen (links) – Tab springt rückwärts! */
.modal-actions { display: flex; flex-direction: row-reverse; }
```
```html
<!-- ✅ Gut: DOM-Reihenfolge entspricht der visuellen Reihenfolge -->
<div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 10px;">
  <button>Abbrechen</button>
  <button>Speichern</button>
</div>
```

---

#### 2.4.4 Linkzweck (im Kontext) (A)

Der Zweck jedes Links muss aus dem Linktext (oder Kontext) erkennbar sein.

**❌ Schlecht:**
```html
<a href="/angebote">Hier klicken</a>
<a href="/agb">Mehr</a>
```

**✅ Gut:**
```html
<a href="/angebote">Aktuelle Angebote ansehen</a>
<a href="/agb">Allgemeine Geschäftsbedingungen lesen</a>

<!-- Oder mit SR-Text: -->
<p>Unser Produkt X ist jetzt verfügbar.
  <a href="/produkt-x">
    Mehr erfahren<span class="sr-only"> über Produkt X</span>
  </a>
</p>
```

**Card-Komponenten (Teaser)** – ganzer Block klickbar, ohne den SR zu überfluten:
```html
<!-- ❌ Schlecht: div onclick + redundanter Link -->
<div class="card" onclick="location.href='/news'">
  <h3>Neues Produkt</h3>
  <p>Wir haben ein neues Produkt gelauncht.</p>
  <a href="/news">Mehr lesen</a>
</div>

<!-- ✅ Gut: Link per CSS-Pseudo-Element über die ganze Card -->
<div class="card" style="position: relative;">
  <h3><a href="/news" class="card-link">Neues Produkt: Launch 2024</a></h3>
  <p>Wir haben ein neues Produkt gelauncht.</p>
</div>
```
```css
.card-link::after {
  content: "";
  position: absolute;
  inset: 0; /* Macht die ganze Card klickbar */
}
```

---

#### 2.4.5 Verschiedene Methoden (AA)

Es gibt mehr als eine Möglichkeit, eine Seite innerhalb einer Website zu finden.

**❌ Schlecht:**
```html
<!-- Nur ein einziges Dropdown-Menü, keine Suche, keine Sitemap -->
<nav>
  <a href="/produkte">Produkte</a>
  <a href="/kontakt">Kontakt</a>
</nav>
<!-- Kein <form role="search">, kein Sitemap-Link -->
```

**✅ Gut:**
```html
<nav aria-label="Hauptnavigation">
  <a href="/produkte">Produkte</a>
  <a href="/kontakt">Kontakt</a>
</nav>

<form role="search" action="/suche">
  <label for="search">Suche</label>
  <input type="search" id="search" name="q">
  <button type="submit">Suchen</button>
</form>

<a href="/sitemap">Sitemap</a>
```

---

#### 2.4.6 Überschriften und Beschriftungen (AA)

Überschriften und Labels müssen den Inhalt oder Zweck beschreiben.

**❌ Schlecht:**
```html
<h2>Abschnitt 1</h2>
<label for="f1">Feld 1</label>
<input id="f1">
```

**✅ Gut:**
```html
<h2>Lieferadresse</h2>
<label for="strasse">Straße und Hausnummer</label>
<input id="strasse" name="strasse">
```

---

#### 2.4.7 Fokus sichtbar (AA)

Der Tastaturfokus muss visuell erkennbar sein.

**❌ Schlecht:**
```css
*:focus { outline: none; }
```

**✅ Gut:**
```css
*:focus-visible {
  outline: 3px solid #1a5a9a;
  outline-offset: 2px;
}
```

**`box-shadow` als Fokusindikator** – versagt im Windows High Contrast Mode:
```css
/* ❌ Schlecht: Unsichtbar im High Contrast Mode */
button:focus { outline: none; box-shadow: 0 0 0 3px #1a5a9a; }

/* ✅ Gut: Outline bleibt im High Contrast Mode sichtbar */
button:focus-visible {
  outline: 3px solid #1a5a9a;
  outline-offset: 2px;
}
```

---

#### 2.4.8 Position (AAA)

Dem Benutzer wird angezeigt, wo er sich innerhalb der Website befindet.

**❌ Schlecht:**
```html
<!-- Keine Indikation, wo man sich befindet -->
<nav>
  <a href="/">Home</a>
  <a href="/produkte">Produkte</a> <!-- Nicht als "aktiv" markiert -->
</nav>
<!-- Keine Breadcrumbs vorhanden -->
```

**✅ Gut:**
```html
<nav aria-label="Breadcrumb">
  <ol>
    <li><a href="/">Startseite</a></li>
    <li><a href="/produkte">Produkte</a></li>
    <li aria-current="page">Laptop X200</li>
  </ol>
</nav>
```

---

#### 2.4.9 Linkzweck (nur Link) (AAA)

Der Zweck jedes Links ist allein aus dem Linktext erkennbar (ohne Kontext).

**❌ Schlecht:**
```html
<a href="/bericht.pdf">Herunterladen</a>
```

**✅ Gut:**
```html
<a href="/bericht.pdf">Jahresbericht 2024 herunterladen (PDF, 2 MB)</a>
```

---

#### 2.4.10 Abschnittsüberschriften (AAA)

Inhalte sind mit Überschriften gegliedert.

**❌ Schlecht:**
```html
<!-- "Wall of Text" ohne Zwischenüberschriften -->
<h1>Datenschutzerklärung</h1>
<p>Hier steht ein 3000-Wörter-Text, der nur durch Absätze,
   aber nicht durch h2 oder h3 gegliedert ist...</p>
<p>Nächster Absatz...</p>
```

**✅ Gut:**
```html
<h1>Jahresbericht 2024</h1>
  <h2>Zusammenfassung</h2>
  <h2>Finanzen</h2>
    <h3>Einnahmen</h3>
    <h3>Ausgaben</h3>
  <h2>Ausblick</h2>
```

---

#### 2.4.11 Fokus nicht verdeckt (Minimum) (AA) 🆕

Das fokussierte Element darf nicht vollständig von anderen Inhalten verdeckt werden.

**❌ Schlecht:**
```css
.sticky-footer {
  position: fixed;
  bottom: 0;
  width: 100%;
  height: 80px;
  z-index: 999;
}
/* Links am Seitenende werden vom Sticky Footer vollständig verdeckt */
```

**✅ Gut (CSS-Lösung mit `scroll-padding`):**
```css
html {
  scroll-padding-top: 60px;    /* Höhe des fixierten Headers */
  scroll-padding-bottom: 80px; /* Höhe des fixierten Footers */
}

.sticky-footer {
  position: fixed;
  bottom: 0;
  height: 80px;
}

main {
  padding-bottom: 100px; /* Zusätzlicher Platz als Fallback */
}
```

---

#### 2.4.12 Fokus nicht verdeckt (Erweitert) (AAA) 🆕

Das fokussierte Element darf überhaupt nicht (auch nicht teilweise) von anderen Inhalten verdeckt werden.

**❌ Schlecht:**
```css
/* Halbtransparenter Cookie-Banner: Fokus dahinter ist sichtbar,
   aber teilweise verdeckt – scheitert an AAA */
.cookie-banner {
  position: fixed;
  bottom: 0;
  width: 100%;
  background: rgba(255, 255, 255, 0.85);
  z-index: 999;
}
```

*(Strengere Version von 2.4.11 – auch teilweises Verdecken ist nicht erlaubt.)*

---

#### 2.4.13 Fokusdarstellung (AAA) 🆕

Der Fokusindikator muss eine Mindestgröße und ein Mindestkontrastverhältnis von 3:1 haben.

**❌ Schlecht:**
```css
a:focus {
  outline: 1px dotted #ccc; /* Zu dünn, zu wenig Kontrast */
}
```

**✅ Gut:**
```css
a:focus-visible {
  outline: 3px solid #0050b3; /* Kontrast ≥ 3:1 */
  outline-offset: 2px;
  /* Mindestfläche: Umfang des Elements × 2 CSS-Pixel */
}
```

---

### Richtlinie 2.5 – Eingabemodalitäten

#### 2.5.1 Zeigergesten (A)

Funktionen, die Mehrpunkt- oder pfadbasierte Gesten erfordern, müssen auch mit einfachen Zeigergesten bedienbar sein.

**❌ Schlecht:**
```js
// Nur Pinch-to-Zoom möglich
map.addEventListener('gesturechange', (e) => {
  map.zoom(e.scale);
});
```

**✅ Gut:**
```html
<button onclick="map.zoomIn()" aria-label="Karte vergrößern">+</button>
<button onclick="map.zoomOut()" aria-label="Karte verkleinern">−</button>
```

---

#### 2.5.2 Zeigereingabe abbrechen (A)

Funktionen, die über einen einfachen Zeiger ausgelöst werden, müssen abbrechbar sein (nicht auf Down-Event, oder rückgängig machbar).

**❌ Schlecht:**
```js
// Aktion auf mousedown – kein Abbrechen möglich
button.addEventListener('mousedown', () => {
  deleteItem();
});
```

**✅ Gut:**
```js
// Aktion auf click (mouseup) – Benutzer kann Maus wegbewegen
button.addEventListener('click', () => {
  deleteItem();
});
```

---

#### 2.5.3 Beschriftung im zugänglichen Namen (A)

Der sichtbare Text eines UI-Elements muss im zugänglichen Namen enthalten sein.

**❌ Schlecht:**
```html
<!-- Sichtbarer Text: "Suchen", aber aria-label weicht ab -->
<button aria-label="Finden Sie Inhalte">Suchen</button>
```

**✅ Gut:**
```html
<button>Suchen</button>
```

**Sprachsteuerung (Voice Control)** – `aria-label` muss den sichtbaren Text enthalten:
```html
<!-- ❌ Schlecht: Sichtbar "Weiter", SR "Nächster Schritt" -->
<button aria-label="Nächster Schritt">Weiter</button>

<!-- ✅ Gut: aria-label beginnt mit dem sichtbaren Text -->
<button aria-label="Weiter zum Bezahlvorgang">Weiter</button>
```

---

#### 2.5.4 Betätigung durch Bewegung (A)

Funktionen durch Gerätebewegung (Schütteln, Kippen) müssen auch über UI-Elemente bedienbar sein und deaktivierbar sein.

**❌ Schlecht:**
```js
// Nur Schütteln zum Rückgängigmachen
window.addEventListener('devicemotion', (e) => {
  if (isShake(e)) undo();
});
```

**✅ Gut:**
```html
<button onclick="undo()">Rückgängig</button>
```
```js
if (userSettings.motionControls) {
  window.addEventListener('devicemotion', handleMotion);
}
```

---

#### 2.5.5 Zielgröße (Erweitert) (AAA)

Klick-/Tippziele müssen mindestens 44×44 CSS-Pixel groß sein (strengere Version von 2.5.8).

**❌ Schlecht:**
```css
.icon-btn {
  width: 20px;
  height: 20px;
  padding: 0;
}
```

**✅ Gut:**
```css
.icon-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 12px;
}
```

---

#### 2.5.6 Gleichzeitige Eingabemechanismen (AAA)

Webinhalte dürfen die Nutzung verschiedener Eingabegeräte (z. B. Touchscreen und Maus gleichzeitig) nicht einschränken.

**❌ Schlecht:**
```js
// Geht davon aus, dass ein Touch-Gerät keine Maus hat (z. B. iPad mit Trackpad)
if ('ontouchstart' in window) {
  disableMouseHoverEffects();
}
```

**✅ Gut:**
```css
/* Abfrage über CSS-Features statt starre Geräteklassen */
@media (hover: hover) and (pointer: fine) {
  .menu-item:hover { background: #eee; }
}
```

---

#### 2.5.7 Ziehbewegungen (AA) 🆕

Funktionen, die Ziehen erfordern (Drag & Drop), müssen auch ohne Ziehbewegung bedienbar sein.

**❌ Schlecht:**
```html
<ul id="sortable">
  <li draggable="true">Element A</li>
  <li draggable="true">Element B</li>
  <li draggable="true">Element C</li>
</ul>
```

**✅ Gut:**
```html
<ul>
  <li>
    Element A
    <button aria-label="Element A nach oben verschieben">↑</button>
    <button aria-label="Element A nach unten verschieben">↓</button>
  </li>
  <li>
    Element B
    <button aria-label="Element B nach oben verschieben">↑</button>
    <button aria-label="Element B nach unten verschieben">↓</button>
  </li>
</ul>
```

---

#### 2.5.8 Zielgröße (Minimum) (AA) 🆕

Klick-/Tippziele müssen mindestens 24×24 CSS-Pixel groß sein (oder genügend Abstand haben).

**❌ Schlecht:**
```css
.icon-btn {
  width: 16px;
  height: 16px;
  padding: 0;
}
```

**✅ Gut (erfüllt AA – 24×24px Minimum):**
```css
.icon-btn {
  min-width: 24px;
  min-height: 24px;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

**✅ Besser (erfüllt auch 2.5.5 AAA – 44×44px):**
```css
.icon-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

---

## Prinzip 3: Verständlich

Informationen und Bedienung der Benutzerschnittstelle müssen verständlich sein.

---

### Richtlinie 3.1 – Lesbar

#### 3.1.1 Sprache der Seite (A)

Die Standardsprache der Seite muss programmatisch bestimmbar sein.

**❌ Schlecht:**
```html
<html>
  <head><title>Willkommen</title></head>
</html>
```

**✅ Gut:**
```html
<html lang="de">
  <head><title>Willkommen</title></head>
</html>
```

---

#### 3.1.2 Sprache von Teilen (AA)

Fremdsprachige Textpassagen müssen mit dem `lang`-Attribut gekennzeichnet sein.

**❌ Schlecht:**
```html
<p>Das nennt man auch User Experience.</p>
```

**✅ Gut:**
```html
<p>Das nennt man auch <span lang="en">User Experience</span>.</p>
```

---

#### 3.1.3 Ungebräuchliche Wörter (AAA)

Es gibt eine Möglichkeit, ungewöhnliche Wörter oder Fachjargon zu erklären.

**❌ Schlecht:**
```html
<!-- Fachjargon ohne Erklärung -->
<p>Die Authentifizierung erfolgt über einen JWT-Bearer-Token im Authorization-Header.</p>
<!-- Weder <abbr>, <dfn> noch ein Glossar-Link vorhanden -->
```

**✅ Gut:**
```html
<p>Das System verwendet eine <dfn>API</dfn>
  (<abbr title="Application Programming Interface">API</abbr>),
  also eine Programmierschnittstelle.</p>

<a href="/glossar#api">API</a>
```

---

#### 3.1.4 Abkürzungen (AAA)

Abkürzungen müssen erklärt oder erklärbar sein.

**❌ Schlecht:**
```html
<p>Die DSGVO tritt in Kraft.</p>
```

**✅ Gut:**
```html
<p>Die <abbr title="Datenschutz-Grundverordnung">DSGVO</abbr> tritt in Kraft.</p>
```

---

#### 3.1.5 Leseniveau (AAA)

Texte, die über ein Sekundarstufe-I-Niveau hinausgehen, müssen eine vereinfachte Version bieten.

**❌ Schlecht:**
```html
<!-- Hochkomplexes Beamtendeutsch ohne einfache Zusammenfassung -->
<p>Die Inanspruchnahme der Subsidiaritätsklausel bedingt eine vorgelagerte
   Verifizierung der allokierten Ressourcen.</p>
<!-- Keine "Leichte Sprache"-Alternative angeboten -->
```

**✅ Gut:**
```html
<details>
  <summary>Einfache Erklärung anzeigen</summary>
  <p>Wir schützen Ihre Daten. Niemand darf Ihre Daten ohne Ihre Erlaubnis sehen.</p>
</details>
<p>Gemäß Art. 6 Abs. 1 lit. a DSGVO erfolgt die Verarbeitung
   personenbezogener Daten...</p>
```

---

#### 3.1.6 Aussprache (AAA)

Für Wörter, deren Bedeutung von der Aussprache abhängt, muss die Aussprache angegeben werden.

**❌ Schlecht:**
```html
<!-- Heteronym ohne Klärung: Sänger (Te-NOR) oder Sinngehalt (TE-nor)? -->
<p>Der Tenor des Urteils war überraschend.</p>
```

**✅ Gut:**
```html
<p>Er <ruby>lebt<rp>(</rp><rt>leebt</rt><rp>)</rp></ruby> in Berlin.</p>
```

---

### Richtlinie 3.2 – Vorhersehbar

#### 3.2.1 Bei Fokus (A)

Wenn ein Element den Fokus erhält, darf keine unerwartete Kontextänderung stattfinden.

**❌ Schlecht:**
```js
input.addEventListener('focus', () => {
  window.location = '/andere-seite';
});
```

**✅ Gut:**
```js
input.addEventListener('focus', () => {
  showHelpText(); // Nur Hilfetext anzeigen
});
```

---

#### 3.2.2 Bei Eingabe (A)

Änderungen an Formularelementen dürfen keine unerwartete Kontextänderung verursachen.

**❌ Schlecht:**
```html
<!-- Formular wird automatisch bei Auswahl abgeschickt -->
<select onchange="this.form.submit()">
  <option>Deutsch</option>
  <option>Englisch</option>
</select>
```

**✅ Gut:**
```html
<label for="lang">Sprache wählen:</label>
<select id="lang" name="lang">
  <option>Deutsch</option>
  <option>Englisch</option>
</select>
<button type="submit">Sprache ändern</button>
```

**Checkbox öffnet unerwartet Modal:**
```html
<!-- ❌ Schlecht: Klick auf Checkbox reißt Nutzer aus dem Kontext -->
<input type="checkbox" onchange="openNewsletterModal()"> Newsletter abonnieren

<!-- ✅ Gut: Separate Aktion für Details -->
<label><input type="checkbox" name="newsletter"> Newsletter abonnieren</label>
<p>Hinweis: <button onclick="showPrivacyInfo()">Details zum Datenschutz</button></p>
```

---

#### 3.2.3 Konsistente Navigation (AA)

Navigationsmenüs müssen auf allen Seiten in der gleichen Reihenfolge erscheinen.

**❌ Schlecht:**
```html
<!-- Seite 1 -->
<nav><a href="/">Start</a> <a href="/produkte">Produkte</a> <a href="/kontakt">Kontakt</a></nav>

<!-- Seite 2 – andere Reihenfolge! -->
<nav><a href="/kontakt">Kontakt</a> <a href="/">Start</a> <a href="/produkte">Produkte</a></nav>
```

**✅ Gut:**
```html
<!-- Gleiche Reihenfolge auf allen Seiten -->
<nav>
  <a href="/">Start</a>
  <a href="/produkte">Produkte</a>
  <a href="/kontakt">Kontakt</a>
</nav>
```

---

#### 3.2.4 Konsistente Erkennung (AA)

Komponenten mit gleicher Funktion müssen konsistent beschriftet/identifiziert sein.

**❌ Schlecht:**
```html
<!-- Seite 1 --><button>Suchen</button>
<!-- Seite 2 --><button>Finden</button>
<!-- Seite 3 --><button aria-label="Los">🔍</button>
```

**✅ Gut:**
```html
<!-- Einheitlich auf allen Seiten -->
<button><span aria-hidden="true">🔍</span> Suchen</button>
```

---

#### 3.2.5 Änderung auf Anfrage (AAA)

Kontextänderungen werden nur auf Benutzeranfrage ausgelöst oder es gibt einen Mechanismus, sie abzuschalten.

**❌ Schlecht:**
```html
<!-- Automatischer Reload ohne Vorwarnung – desorientiert Screenreader-Nutzer -->
<meta http-equiv="refresh" content="60">
```

**✅ Gut:**
```html
<p>Sie werden in 10 Sekunden weitergeleitet.
  <a href="/neue-seite">Jetzt weiterleiten</a>
  <button onclick="cancelRedirect()">Weiterleitung abbrechen</button>
</p>
```

---

#### 3.2.6 Konsistente Hilfe (A) 🆕

Hilfemechanismen, die auf mehreren Seiten vorhanden sind, müssen an derselben relativen Stelle stehen.

**❌ Schlecht:**
```html
<!-- Seite 1: Hilfe im Header -->
<header><a href="/hilfe">Hilfe</a></header>

<!-- Seite 2: Hilfe im Footer -->
<footer><a href="/hilfe">Hilfe</a></footer>
```

**✅ Gut:**
```html
<!-- Auf allen Seiten: Hilfe immer an derselben Stelle -->
<header>
  <nav>
    <a href="/">Start</a>
    <a href="/produkte">Produkte</a>
    <a href="/hilfe">Hilfe</a> <!-- Immer letzte Position -->
  </nav>
</header>
```

---

### Richtlinie 3.3 – Eingabeunterstützung

#### 3.3.1 Fehlererkennung (A)

Eingabefehler müssen automatisch erkannt und dem Benutzer in Textform beschrieben werden.

**❌ Schlecht:**
```html
<!-- Nur rote Markierung, kein Text -->
<input type="email" style="border-color: red;">
```

**✅ Gut:**
```html
<label for="email">E-Mail-Adresse</label>
<input type="email" id="email" aria-describedby="email-error" aria-invalid="true">
<p id="email-error" role="alert" style="color: #d32f2f;">
  ⚠️ Bitte geben Sie eine gültige E-Mail-Adresse ein (z. B. name@beispiel.de).
</p>
```

**Fokus-Management nach dem Absenden** – besonders wichtig in SPAs:
```html
<!-- ✅ Gut: Fehlerzusammenfassung erhält den Fokus -->
<div id="error-summary" tabindex="-1" role="alert">
  <h2>Es gab 2 Fehler in Ihrem Formular:</h2>
  <ul>
    <li><a href="#email">E-Mail-Adresse ist ungültig</a></li>
    <li><a href="#plz">PLZ muss 5 Stellen haben</a></li>
  </ul>
</div>
```
```js
// Fokus programmatisch auf die Fehlerzusammenfassung setzen
showErrors();
document.getElementById('error-summary').focus();
```

---

#### 3.3.2 Beschriftungen oder Anweisungen (A)

Wenn Eingaben erforderlich sind, müssen Beschriftungen oder Anweisungen bereitgestellt werden.

**❌ Schlecht:**
```html
<input type="text" placeholder="...">
```

**✅ Gut:**
```html
<label for="geb">Geburtsdatum</label>
<input type="date" id="geb" name="geb" aria-describedby="geb-hint">
<p id="geb-hint">Format: TT.MM.JJJJ</p>
```

**Floating Labels** – als einziges Label verschwindet der Hinweis beim Tippen:
```html
<!-- ❌ Schlecht: Placeholder als einziges Label -->
<div class="float-label">
  <input type="text" placeholder="E-Mail" id="email">
</div>

<!-- ✅ Gut: Echtes Label, das sichtbar bleibt -->
<div class="float-label">
  <!-- Das Leerzeichen im Placeholder ist ein CSS-Trick:
       Es ermöglicht die Nutzung von :placeholder-shown,
       um das Label per CSS hochschweben zu lassen -->
  <input type="email" id="email" placeholder=" ">
  <label for="email">E-Mail</label>
</div>
```

**Passwort-Regeln ohne semantische Verknüpfung** – Audit-Klassiker:
```html
<!-- ❌ Schlecht: Regeln stehen unter dem Input, sind aber nicht verknüpft -->
<label for="pwd">Passwort</label>
<input type="password" id="pwd">
<p>Mindestens 8 Zeichen, inkl. Sonderzeichen.</p>

<!-- ✅ Gut: Regeln per aria-describedby verknüpft -->
<label for="pwd">Passwort</label>
<input type="password" id="pwd" aria-describedby="pwd-rules">
<p id="pwd-rules">Mindestens 8 Zeichen, inkl. Sonderzeichen.</p>
```

---

#### 3.3.3 Fehlerempfehlung (AA)

Wenn ein Eingabefehler erkannt wird und Korrekturvorschläge bekannt sind, müssen diese dem Benutzer bereitgestellt werden.

**❌ Schlecht:**
```html
<p class="error">Fehler im Feld "Land".</p>
```

**✅ Gut:**
```html
<p class="error" role="alert">
  ⚠️ Das Land „Deuschland" wurde nicht erkannt.
  Meinten Sie „Deutschland"?
</p>
```

---

#### 3.3.4 Fehlervermeidung (rechtlich, finanziell, Daten) (AA)

Bei rechtlich bindenden oder finanziellen Transaktionen müssen Eingaben überprüfbar, bestätigbar oder umkehrbar sein.

**❌ Schlecht:**
```html
<button onclick="submitOrder()">Jetzt kaufen</button>
<!-- Kein Überprüfungsschritt -->
```

**✅ Gut:**
```html
<h2>Bestellung überprüfen</h2>
<p>Produkt: Laptop X200 – 999,00 €</p>
<p>Lieferadresse: Musterstr. 1, 12345 Berlin</p>
<button onclick="goBack()">Ändern</button>
<button onclick="confirmOrder()">Kostenpflichtig bestellen</button>
```

---

#### 3.3.5 Hilfe (AAA)

Kontextbezogene Hilfe ist verfügbar.

**❌ Schlecht:**
```html
<!-- Komplexes Feld ohne Erklärung -->
<label for="steuer-id">Steueridentifikationsnummer</label>
<input type="text" id="steuer-id">
<!-- Keine Hilfe, wie viele Stellen erwartet werden oder wo man sie findet -->
```

**✅ Gut:**
```html
<label for="iban">IBAN</label>
<input type="text" id="iban" aria-describedby="iban-help">
<details id="iban-help">
  <summary>Wo finde ich meine IBAN?</summary>
  <p>Die IBAN finden Sie auf Ihrer Bankkarte oder im Online-Banking.
     Sie beginnt mit DE und hat 22 Stellen.</p>
</details>
```

---

#### 3.3.6 Fehlervermeidung (alle) (AAA)

Für alle Formulare (nicht nur rechtliche/finanzielle) müssen Eingaben überprüfbar, bestätigbar oder umkehrbar sein.

**❌ Schlecht:**
```html
<!-- Profil wird sofort unwiderruflich gelöscht -->
<form action="/delete-account" method="POST">
  <button type="submit">Profil löschen</button>
</form>
<!-- Keine Bestätigung, kein "Sind Sie sicher?"-Dialog -->
```

*(Wie 3.3.4, aber für alle Formulare.)*

---

#### 3.3.7 Redundante Eingabe (A) 🆕

Informationen, die der Benutzer bereits eingegeben hat, dürfen nicht erneut abgefragt werden (oder müssen vorausgefüllt sein).

**❌ Schlecht:**
```html
<!-- Schritt 1 -->
<h2>Rechnungsadresse</h2>
<input name="billing-street" value="Musterstr. 1">

<!-- Schritt 2 – gleiche Daten nochmal abfragen -->
<h2>Lieferadresse</h2>
<input name="shipping-street" value="">
```

**✅ Gut:**
```html
<h2>Lieferadresse</h2>
<label>
  <input type="checkbox" id="same-address" checked onchange="copyAddress()">
  Lieferadresse ist gleich der Rechnungsadresse
</label>
<input name="shipping-street" value="Musterstr. 1">
```

---

#### 3.3.8 Barrierefreie Authentifizierung (Minimum) (AA) 🆕

Anmeldeprozesse dürfen keinen kognitiven Funktionstest erfordern (z. B. Passwort merken), es sei denn, es gibt eine Alternative (Passwort-Manager, Copy-Paste, biometrisch).

**❌ Schlecht:**
```html
<!-- Passwort-Feld, das Copy-Paste blockiert -->
<input type="password" oncopy="return false" onpaste="return false">

<!-- CAPTCHA ohne Alternative -->
<img src="captcha.png" alt="Captcha">
<input type="text" placeholder="Geben Sie den Code ein">
```

**✅ Gut:**
```html
<!-- Passwort-Feld erlaubt Paste (Passwort-Manager) -->
<label for="pw">Passwort</label>
<input type="password" id="pw" autocomplete="current-password">

<!-- Oder: Alternatives Login -->
<button onclick="loginWithPasskey()">Mit Passkey anmelden</button>
<button onclick="loginWithEmail()">Anmeldelink per E-Mail senden</button>
```

**2-Faktor-Authentifizierung (2FA)** – OTP abtippen ist ein kognitiver Test:
```html
<!-- ❌ Schlecht: OTP-Feld ohne Autofill-Unterstützung -->
<input type="text" id="otp" maxlength="6" autocomplete="off">

<!-- ✅ Gut: Unterstützt Auto-Fill vom Gerät und Copy & Paste -->
<label for="otp">Bestätigungscode (aus der SMS)</label>
<input type="text" id="otp" autocomplete="one-time-code" inputmode="numeric">
```

---

#### 3.3.9 Barrierefreie Authentifizierung (Erweitert) (AAA) 🆕

Noch strenger: Keinerlei kognitive Tests bei der Authentifizierung (auch keine Objekterkennung o. Ä.).

**❌ Schlecht:**
```html
<!-- Nutzer müssen Objekte erkennen (kognitiver Test) ohne Alternative -->
<p>Klicken Sie auf alle Bilder, die Ampeln enthalten.</p>
<img src="captcha-grid.jpg" usemap="#captcha">
```

**✅ Gut:**
```html
<button onclick="loginWithPasskey()">Mit Passkey anmelden</button>
<button onclick="loginWithBiometric()">Mit Fingerabdruck anmelden</button>
```

---

## Prinzip 4: Robust

Inhalte müssen robust genug sein, um von verschiedenen Benutzeragenten (einschließlich Hilfstechnologien) zuverlässig interpretiert werden zu können.

---

### Richtlinie 4.1 – Kompatibel

#### ~~4.1.1 Parsen~~ 🗑️

**In WCAG 2.2 entfernt.** Moderne Browser und Hilfstechnologien sind robust genug, um mit Parsing-Fehlern umzugehen. Valides HTML ist trotzdem eine gute Praxis:

```html
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Beispiel</title></head>
<body>...</body>
</html>
```

---

#### 4.1.2 Name, Rolle, Wert (A)

Für alle UI-Komponenten müssen Name, Rolle und Zustand programmatisch bestimmbar sein.

**❌ Schlecht:**
```html
<div class="custom-checkbox active" onclick="toggle()">
  Ich akzeptiere die AGB
</div>
```

**✅ Gut:**
```html
<label>
  <input type="checkbox" name="agb"> Ich akzeptiere die AGB
</label>

<!-- Oder als Custom-Element: -->
<div role="checkbox" aria-checked="true" tabindex="0"
     aria-label="Ich akzeptiere die AGB"
     onclick="toggle()" onkeydown="handleKey(event)">
  ✓ Ich akzeptiere die AGB
</div>
```

**Toggle-Switches mit `aria-pressed`:**
```html
<!-- ❌ Schlecht: Zustand nicht kommuniziert -->
<div class="toggle-switch on" onclick="toggleTheme()">Darkmode an</div>

<!-- ✅ Gut: Button mit Status -->
<button aria-pressed="true" onclick="toggleTheme()">Darkmode</button>
```

**Akkordeons mit `aria-expanded`:**
```html
<!-- ❌ Schlecht: Stummes Akkordeon -->
<div class="accordion-header" onclick="toggle()">FAQ Frage 1</div>
<div class="accordion-body" style="display: none;">Antwort...</div>

<!-- ✅ Gut: Zugängliches Akkordeon -->
<h3>
  <button aria-expanded="false" aria-controls="faq1" id="btn-faq1" onclick="toggle()">
    FAQ Frage 1
  </button>
</h3>
<div id="faq1" aria-labelledby="btn-faq1" hidden>
  <p>Antwort...</p>
</div>

<!-- ✅ Am besten: Natives HTML5 – braucht kein JS und kein ARIA -->
<details>
  <summary>FAQ Frage 1</summary>
  <p>Antwort...</p>
</details>
```

**`aria-hidden` auf interaktiven Elementen** – einer der gefährlichsten ARIA-Fehler:
```html
<!-- ❌ Schlecht: Button ist für SR versteckt, aber per Tab noch erreichbar -->
<button aria-hidden="true" onclick="close()">X</button>

<!-- ✅ Gut: Entweder sichtbar + zugänglich oder komplett entfernt -->
<button aria-label="Dialog schließen" onclick="close()">X</button>
```

---

#### 4.1.3 Statusmeldungen (AA)

Statusmeldungen müssen programmatisch so bestimmbar sein, dass Hilfstechnologien sie ohne Fokusverschiebung ankündigen können.

**❌ Schlecht:**
```html
<!-- Statusmeldung wird eingefügt, aber SR bemerkt sie nicht -->
<div class="success-msg">Artikel wurde zum Warenkorb hinzugefügt.</div>
```

**✅ Gut:**
```html
<!-- Mit Live-Region: SR kündigt die Nachricht automatisch an -->
<div role="status" aria-live="polite">
  Artikel wurde zum Warenkorb hinzugefügt.
</div>

<!-- Für Fehlermeldungen: -->
<div role="alert" aria-live="assertive">
  Fehler: Ihre Sitzung ist abgelaufen.
</div>
```

**SPA-Seitenwechsel** – React/Angular/Vue melden Routenwechsel nicht an Screenreader:
```js
// ❌ Schlecht: React Router wechselt Seite, SR bemerkt nichts
navigate('/dashboard');

// ✅ Gut: Seitenwechsel ankündigen
navigate('/dashboard');
document.title = 'Dashboard – MeineApp';
announcer.textContent = 'Seite Dashboard wurde geladen';
// <div role="status" aria-live="polite" id="announcer" class="sr-only"></div>
```

---

## Zusammenfassung der Stufen

| Stufe | Anzahl Kriterien | Bedeutung |
|-------|----------------:|-----------|
| **A** | 31 | Grundlegende Barrierefreiheit |
| **AA** | 24 | Standard für die meisten gesetzlichen Anforderungen |
| **AAA** | 31 | Höchster Grad an Barrierefreiheit |

### Neuerungen in WCAG 2.2 auf einen Blick

| Nr. | Kriterium | Stufe |
|-----|-----------|-------|
| 2.4.11 | Fokus nicht verdeckt (Minimum) | AA |
| 2.4.12 | Fokus nicht verdeckt (Erweitert) | AAA |
| 2.4.13 | Fokusdarstellung | AAA |
| 2.5.7 | Ziehbewegungen | AA |
| 2.5.8 | Zielgröße (Minimum) | AA |
| 3.2.6 | Konsistente Hilfe | A |
| 3.3.7 | Redundante Eingabe | A |
| 3.3.8 | Barrierefreie Authentifizierung (Minimum) | AA |
| 3.3.9 | Barrierefreie Authentifizierung (Erweitert) | AAA |

### Entfernt in WCAG 2.2

| Nr. | Kriterium | Grund |
|-----|-----------|-------|
| 4.1.1 | Parsen | Moderne Browser kompensieren Parsing-Fehler |

---

*Stand: WCAG 2.2 (W3C Recommendation, Oktober 2023)*