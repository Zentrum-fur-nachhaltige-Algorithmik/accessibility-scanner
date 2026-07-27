# Design Document: Evaluation der PDF → MathML Accessibility Pipeline

## Ziel

Evaluiere ob die Pipeline **PDF → Mistral OCR → LaTeX-Extraktion → MathML-Konvertierung → barrierefreies HTML** hinreichend zuverlässig funktioniert, um blinden Mathematikern wissenschaftliche Bücher zugänglich zu machen.

Die Evaluation beantwortet drei Fragen:
1. Wie zuverlässig extrahiert Mistral OCR LaTeX-Formeln aus mathematischen PDFs?
2. Wie zuverlässig konvertieren bestehende Tools (latex2mathml, LaTeXML) dieses LaTeX nach MathML?
3. Ist das erzeugte MathML korrekt genug für Screenreader-Ausgabe via MathCAT?

---

## Architektur der zu evaluierenden Pipeline

```
PDF-Datei
    ↓
[Schritt 1] Mistral OCR API
    ↓
Markdown mit eingebetteten LaTeX-Formeln ($...$ und $$...$$)
    ↓
[Schritt 2] LaTeX-Extraktion (Regex)
    ↓
Liste isolierter LaTeX-Formeln + umgebender Text
    ↓
[Schritt 3] LaTeX → MathML Konvertierung
    ↓
MathML-Fragmente
    ↓
[Schritt 4] HTML-Assemblierung
    ↓
Barrierefreie HTML-Seite mit eingebettetem MathML
```

---

## Testdaten

### Primäres Testset: arXiv-Papers mit LaTeX-Quelle (Ground Truth vorhanden)

Wähle 20 Papers aus folgenden Fachgebieten (je 4 Papers):
- Lineare Algebra / Reine Mathematik (math.LA, math.AG)
- Analysis / Differentialgleichungen (math.AP, math.CA)
- Theoretische Physik (hep-th, gr-qc)
- Statistik / Machine Learning (stat.ML, cs.LG)
- Theoretische Informatik (cs.CC, cs.DS)

Auswahlkriterien pro Paper:
- Mindestens 15 Seiten
- Mindestens 30 Display-Formeln ($$...$$)
- Mindestens 20 Inline-Formeln ($...$)
- Verschiedene Komplexitätsstufen (einfache Gleichungen bis Matrizen/Integrale)
- PDF und LaTeX-Quelle (.tex) beide verfügbar

Für jedes Paper:
- Lade PDF von arxiv.org
- Lade LaTeX-Quelle von arxiv.org (Quellpaket)
- Extrahiere Ground-Truth-Formeln aus dem .tex-File

### Sekundäres Testset: Lehrbuch-Seiten (keine Ground Truth)

Wähle 50 Seiten aus frei verfügbaren Lehrbüchern (z.B. OpenStax, MIT OCW):
- 10 Seiten Lineare Algebra (Matrizen, Eigenwerte, Determinanten)
- 10 Seiten Analysis (Integrale, Reihen, Grenzwerte)
- 10 Seiten Physik (Maxwell, Schrödinger, Vektorkalkül)
- 10 Seiten Statistik (Verteilungen, Hypothesentests)
- 10 Seiten mit Tabellen + Formeln gemischt

Dieses Set hat keine automatische Ground Truth. Es dient der manuellen Evaluation durch blinde Tester.

---

## Evaluation Schritt 1: Mistral OCR → LaTeX-Qualität

### Aufgabe

Sende die PDFs der 20 arXiv-Papers an die Mistral OCR API und vergleiche die extrahierten LaTeX-Formeln mit den Originalformeln aus dem .tex-Quellcode.

### Mistral API Aufruf

- Endpoint: `https://api.mistral.ai/v1/ocr`
- Modell: `mistral-ocr-latest`
- Input: Einzelne PDF-Seiten als Bilder (rendere PDF → PNG bei 300 DPI mit pdftoppm/pdf2image)
- Output: Markdown mit LaTeX

### Ground-Truth-Extraktion aus .tex

Extrahiere alle Formeln aus dem originalen .tex-File:
- Inline: Alles zwischen `$...$` (nicht `$$`)
- Display: Alles zwischen `$$...$$`, `\[...\]`, `\begin{equation}...\end{equation}`, `\begin{align}...\end{align}`, `\begin{gather}...\end{gather}`, und verwandte Environments
- Ignoriere: Formeln in Kommentaren (% ...), \label{}, \tag{} Inhalte
- Beachte: Custom Macros aus dem Preamble müssen expandiert werden (soweit möglich), da Mistral OCR diese nicht kennt und die expandierte Form zurückgibt

### Matching-Strategie

Die OCR-Formeln und Ground-Truth-Formeln müssen einander zugeordnet werden. Das ist nicht trivial, weil:
- Die Reihenfolge kann abweichen (Floats, Fußnoten)
- OCR kann Formeln splitten oder zusammenfassen
- Whitespace/Formatierung variiert

Matching-Ansatz:
1. Rendere sowohl OCR-LaTeX als auch Ground-Truth-LaTeX zu Bildern (via KaTeX oder pdflatex)
2. Ordne per sequentieller Position zu (Formel N im OCR-Output ↔ Formel N in Ground Truth)
3. Bei Alignment-Problemen: Verwende Levenshtein-Distanz auf den gerenderten Bildern als Fallback-Matching

### Metriken

Für jedes Formelpaar (OCR vs Ground Truth):

**A) Visueller Vergleich (primäre Metrik)**
- Rendere beide LaTeX-Strings zu Bildern (identische Einstellungen: gleiche Schriftgröße, gleiche Engine)
- Berechne Pixel-Differenz (normalisiert auf Bildgröße)
- Schwellwerte: <1% Differenz = korrekt, 1-5% = minor error, >5% = major error
- Verwende für das Rendering KaTeX im Headless-Browser (Puppeteer) oder pdflatex + ImageMagick

**B) Textueller Vergleich (sekundäre Metrik)**
- Normalisiere beide LaTeX-Strings: entferne Whitespace, expandiere \left/\right, normalisiere Klammern
- Berechne Character Error Rate (CER) und Token Error Rate (TER)
- Exact Match Rate nach Normalisierung

**C) Struktureller Vergleich**
- Konvertiere beide nach MathML via LaTeXML
- Vergleiche MathML-Bäume strukturell (Tree Edit Distance)
- Dies fängt Fälle ab, wo LaTeX syntaktisch verschieden aber semantisch gleich ist

### Erwartete Ergebnisse und Schwellwerte

- Formel-Erkennungsrate (wird eine Formel überhaupt als Formel erkannt): Ziel ≥ 95%
- Visueller Exact Match: Ziel ≥ 80%
- Visueller Match mit minor errors: Ziel ≥ 90%
- Major Errors (Formel fundamental falsch): Toleranz < 5%

### Fehler-Taxonomie

Kategorisiere jeden Fehler in eine der folgenden Klassen:

| Kategorie | Beispiel | Schwere |
|-----------|---------|---------|
| Zeichenverwechslung | `b` → `6`, `l` → `1` | Hoch |
| Fehlende Tokens | `x^{2+1}` → `x^{2+}` | Hoch |
| Strukturfehler | `\frac{a}{b}` → `a/b` | Mittel (semantisch ok) |
| Macro nicht aufgelöst | `\R` bleibt `\R` | Mittel |
| Whitespace/Formatierung | `x + y` → `x+y` | Niedrig |
| Delimiter-Unterschied | `\left(` → `(` | Niedrig |

---

## Evaluation Schritt 2: LaTeX → MathML Konvertierung

### Aufgabe

Teste zwei Converter auf den Ground-Truth-Formeln (nicht auf OCR-Output, um Fehler isoliert zu bewerten):

**Converter A: latex2mathml (Python)**
- Install: `pip install latex2mathml`
- Aufruf: `latex2mathml.converter.convert(latex_string)`
- Vorteile: Schnell, keine Dependencies, kein Daemon
- Nachteile: Unterstützt weniger LaTeX-Packages

**Converter B: LaTeXML (Perl)**
- Install: System-Package oder Docker
- Aufruf: `latexmlmath --pmml - "latex_string"` (für einzelne Formeln)
- Alternativ: LaTeXML Daemon-Modus für Batch-Verarbeitung
- Vorteile: Umfassendster LaTeX-Support, von arXiv verwendet
- Nachteile: Schwerere Dependency, langsamer bei Einzelformeln

### Testset

Verwende die Ground-Truth-Formeln aus den 20 arXiv-Papers (ergibt ca. 1000-2000 Formeln). Sortiere nach Komplexität:

**Einfach (Tier 1):** Einzelne Variablen, einfache Operationen
```
$x$, $a + b$, $x^2$, $\alpha$, $n \in \mathbb{N}$
```

**Mittel (Tier 2):** Brüche, Summen, Indizes
```
$\frac{a}{b}$, $\sum_{i=1}^{n} x_i$, $\int_0^\infty f(x) dx$
```

**Komplex (Tier 3):** Matrizen, verschachtelte Strukturen, Environments
```
$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$
$\frac{\partial^2 f}{\partial x \partial y}$
$\prod_{i=1}^{n} \left( \sum_{j=1}^{m} a_{ij} x_j \right)$
```

**Schwierig (Tier 4):** Custom Macros, seltene Packages, mehrzeilige Environments
```
\begin{align} ... \end{align}
\DeclareMathOperator
Tikz-CD (kommutative Diagramme)
```

### Metriken

Für jede Formel:

**A) Konvertierung erfolgreich (ja/nein)**
- Converter gibt gültiges MathML zurück ohne Exception
- MathML ist wohlgeformtes XML (validierbar)

**B) Visueller Vergleich**
- Rendere Original-LaTeX zu Bild (via pdflatex)
- Rendere erzeugtes MathML zu Bild (via MathJax oder Browser-Rendering)
- Pixel-Differenz wie in Schritt 1

**C) MathCAT-Kompatibilität**
- Lade MathML in MathCAT (als Bibliothek aufrufbar, Rust mit Python-Bindings)
- Prüfe: Erzeugt MathCAT einen Speech-String ohne Fehler?
- Prüfe: Enthält der Speech-String alle wesentlichen Symbole?

### Erwartete Ergebnisse

| | latex2mathml | LaTeXML |
|--|--|--|
| Tier 1 (einfach) | ~99% | ~99% |
| Tier 2 (mittel) | ~95% | ~98% |
| Tier 3 (komplex) | ~80% | ~95% |
| Tier 4 (schwierig) | ~50% | ~85% |

Falls latex2mathml bei Tier 2+ unter 90% fällt, verwende LaTeXML als primären Converter mit latex2mathml als schnellen Fallback für Tier-1-Formeln.

### Fallback-Strategie testen

Teste die Kaskade:
1. Versuche latex2mathml (schnell)
2. Bei Fehler → versuche LaTeXML (umfassender)
3. Bei Fehler → generiere aria-label aus LaTeX-String als Plain-Text-Fallback

Messe: Wie viel Prozent der Formeln werden auf Stufe 1/2/3 aufgelöst?

---

## Evaluation Schritt 3: End-to-End Pipeline

### Aufgabe

Führe die gesamte Pipeline aus (PDF → Mistral OCR → LaTeX-Extraktion → MathML → HTML) und bewerte das Endergebnis.

### Durchführung

Für jedes der 20 arXiv-Papers:
1. Rendere PDF zu Seiten-Bildern (300 DPI)
2. Sende jede Seite an Mistral OCR API
3. Parse den Markdown-Output, extrahiere Text und Formeln
4. Konvertiere jede Formel nach MathML (mit Fallback-Kaskade)
5. Assembliere HTML-Seite

### HTML-Output Format

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>[Paper-Titel]</title>
  <style>
    body { font-family: serif; max-width: 50em; margin: 2em auto; line-height: 1.6; }
    .formula-error { border: 2px solid red; padding: 0.5em; }
    .formula-fallback { font-style: italic; }
  </style>
</head>
<body>
  <nav aria-label="Dokumentnavigation">
    <h2>Inhaltsverzeichnis</h2>
    <!-- Skip-Links zu allen Überschriften -->
  </nav>
  <main>
    <!-- Konvertierter Inhalt -->
    <h1>...</h1>
    <p>Text mit <math xmlns="http://www.w3.org/1998/Math/MathML">...</math> inline.</p>
    <p>Display-Formel:</p>
    <math xmlns="http://www.w3.org/1998/Math/MathML" display="block"
          aria-label="[Fallback-Text]">
      ...
    </math>
    <!-- Bei Konvertierungsfehler: -->
    <span class="formula-error" role="math" 
          aria-label="Formel konnte nicht konvertiert werden: [LaTeX-String]">
      [LaTeX-String als Monospace]
    </span>
  </main>
</body>
</html>
```

### Automatische Metriken (End-to-End)

**A) Formel-Vollständigkeit**
- Anzahl Formeln in Ground Truth vs. Anzahl Formeln im Output
- Formel-Recall: Wie viele GT-Formeln tauchen (in irgendeiner Form) im Output auf?

**B) Formel-Korrektheit**
- Von den erkannten Formeln: Wie viele sind visuell korrekt? (Pixel-Vergleich)
- Von den erkannten Formeln: Wie viele erzeugen gültiges MathML?
- Von den erkannten Formeln: Wie viele erzeugen korrekten MathCAT-Speech?

**C) Text-Vollständigkeit**
- Sind alle Textabschnitte vorhanden? (Stichproben-Check, nicht automatisch vollständig prüfbar)
- Sind Überschriften als `<h1>`-`<h6>` markiert?
- Ist die Lesereihenfolge korrekt? (besonders bei zweispaltigen Papers)

**D) Fehlerrate nach Kategorie**
- Anteil der Seiten mit mindestens einem Formel-Fehler
- Anteil der Seiten die komplett fehlerfrei sind
- Verteilung der Fehler über Fachgebiete

### Pipeline-Kosten und Performance

Messe und dokumentiere pro Paper:
- Mistral API Kosten (Summe der Token-Kosten)
- Mistral API Latenz (Gesamtzeit für alle Seiten)
- LaTeX→MathML Konvertierungszeit
- HTML-Generierungszeit
- Gesamtzeit End-to-End

---

## Evaluation Schritt 4: Manuelle Bewertung (durch blinde Tester)

### Aufgabe

Lasse das HTML-Output von blinden Mathematikern mit Screenreader testen. Dieser Schritt ist nicht durch den Coding Agent automatisierbar, aber der Agent soll das Testset vorbereiten und das Bewertungsformular bereitstellen.

### Testset-Vorbereitung

Wähle aus dem End-to-End-Output:
- 5 Papers mit bester automatischer Score
- 5 Papers mit schlechtester automatischer Score
- Die 50 Lehrbuch-Seiten (sekundäres Testset)

### Bewertungsformular (als barrierefreie HTML-Seite generieren)

Für jede Seite bewerten die Tester:

**A) Gesamteindruck (1-5)**
- 5: Alles korrekt vorgelesen, gut navigierbar
- 4: Kleine Fehler, Gesamtverständnis nicht beeinträchtigt
- 3: Einige Fehler, aber Kerninhalt verständlich
- 2: Viele Fehler, Verständnis stark beeinträchtigt
- 1: Unbrauchbar

**B) Pro Formel (Stichprobe von 10 Formeln pro Seite):**
- Wird die Formel vorgelesen? (ja/nein)
- Ist die Vorlesung korrekt? (ja/teilweise/nein)
- Ist die Navigation in die Formel möglich? (ja/nein)
- Freitext: Was wurde falsch vorgelesen?

**C) Dokumentstruktur:**
- Sind Überschriften als solche erkennbar?
- Funktioniert die Skip-Navigation?
- Ist die Lesereihenfolge logisch?
- Werden Tabellen korrekt vorgelesen?

---

## Implementierungshinweise

### Dependencies

```
# Python
pip install latex2mathml
pip install requests          # Mistral API
pip install pdf2image         # PDF → Bilder
pip install Pillow            # Bildvergleich
pip install lxml              # XML/MathML Validierung

# System
apt install poppler-utils     # pdftoppm für PDF-Rendering
apt install latexml           # LaTeXML Converter (optional, wenn LaTeXML getestet wird)
apt install texlive-full      # pdflatex für Ground-Truth-Rendering (oder texlive-base + Extras)
```

### Projektstruktur

```
eval/
├── config.yaml                  # API Keys, Schwellwerte, Pfade
├── data/
│   ├── arxiv_papers/            # Heruntergeladene Papers
│   │   ├── 2301.12345/
│   │   │   ├── paper.pdf
│   │   │   ├── source.tex       # LaTeX-Quelle
│   │   │   └── formulas_gt.json # Extrahierte Ground-Truth-Formeln
│   │   └── .../
│   └── textbook_pages/          # Lehrbuch-PDFs
├── pipeline/
│   ├── ocr.py                   # Mistral API Wrapper
│   ├── extract_formulas.py      # LaTeX aus Markdown extrahieren
│   ├── convert_mathml.py        # LaTeX → MathML (mit Fallback)
│   ├── assemble_html.py         # HTML-Generierung
│   └── run_pipeline.py          # End-to-End Orchestrierung
├── eval/
│   ├── extract_ground_truth.py  # Formeln aus .tex extrahieren
│   ├── render_formula.py        # LaTeX/MathML → Bild
│   ├── compare_visual.py        # Pixel-Vergleich
│   ├── compare_structural.py    # MathML Tree Diff
│   ├── eval_step1_ocr.py        # Schritt 1 Evaluation
│   ├── eval_step2_converter.py  # Schritt 2 Evaluation
│   ├── eval_step3_e2e.py        # Schritt 3 End-to-End
│   └── generate_report.py       # Ergebnis-Report
├── output/
│   ├── html/                    # Generierte HTML-Dateien
│   ├── reports/                 # Evaluation-Reports
│   └── manual_test/             # Vorbereitete Testsets für blinde Tester
└── README.md
```

### config.yaml Struktur

```yaml
mistral:
  api_key: "${MISTRAL_API_KEY}"
  model: "mistral-ocr-latest"
  
rendering:
  dpi: 300
  formula_render_engine: "katex"   # oder "pdflatex"
  
converter:
  primary: "latex2mathml"
  fallback: "latexml"
  
evaluation:
  pixel_diff_threshold_correct: 0.01
  pixel_diff_threshold_minor: 0.05
  
arxiv_papers:
  - id: "2301.12345"
    field: "math.LA"
  # ... 19 weitere
```

### Reihenfolge der Implementierung

1. **Zuerst:** Ground-Truth-Extraktion aus .tex-Files (`extract_ground_truth.py`)
2. **Dann:** Formel-Rendering zu Bildern (`render_formula.py`) und visueller Vergleich (`compare_visual.py`)
3. **Dann:** Schritt 2 Evaluation (Converter isoliert testen, da kein API-Call nötig)
4. **Dann:** Schritt 1 Evaluation (Mistral API, kostet Geld – erst starten wenn Eval-Infrastruktur steht)
5. **Dann:** Schritt 3 End-to-End
6. **Zuletzt:** Testset für manuelle Evaluation vorbereiten

### Kosten-Budget

- Mistral OCR API: ~$0.001/Seite → 20 Papers × ~20 Seiten = 400 Seiten → ~$0.40
- Lehrbuch-Seiten: 50 Seiten → ~$0.05
- Gesamtes Eval-Budget für API-Calls: unter $1

### Wichtige Design-Entscheidungen

**Formel-Extraktion aus Markdown:** Mistral OCR gibt Markdown zurück. Formeln stehen zwischen `$...$` (inline) und `$$...$$` (display). Die Extraktion per Regex ist simpel, muss aber Edge Cases behandeln:
- Dollar-Zeichen im Text (z.B. Preise) → Kontext-Heuristik nötig
- Verschachtelte Dollar-Zeichen → Greedy vs. Lazy Matching
- Escaped Dollar: `\$` → Kein Formel-Delimiter

**MathML-Validierung:** Erzeugtes MathML muss wohlgeformtes XML sein. Validiere mit lxml gegen das MathML-Schema. Ungültiges MathML → Fallback auf aria-label.

**aria-label Generierung:** Für den Fallback-Text (wenn MathML-Konvertierung fehlschlägt oder Screenreader kein MathML unterstützt):
- Einfachster Ansatz: LaTeX-String bereinigt als aria-label (`\frac{a}{b}` → "a geteilt durch b" ist NICHT trivial)
- Besserer Ansatz: MathCAT als Bibliothek serverseitig nutzen, um aus dem MathML den Speech-String zu generieren und als aria-label einzusetzen
- Damit bekommen auch Screenreader ohne MathML-Support zumindest linearisierten Text

**Sprache:** aria-labels und MathCAT-Speech zunächst nur auf Englisch. Deutsche Mathe-Sprachausgabe ist bei MathCAT in Entwicklung, aber noch nicht stabil. Die meisten mathematischen Fachbücher sind ohnehin englisch.

---

## Erfolgskriterien

Die Pipeline gilt als **evaluiert und vielversprechend** wenn:

- ≥ 90% der Formeln werden von Mistral OCR erkannt (Recall)
- ≥ 80% der erkannten Formeln produzieren visuell korrektes MathML
- ≥ 95% der Formeln produzieren zumindest einen brauchbaren Fallback (aria-label)
- ≤ 2% der Formeln sind komplett verloren (weder MathML noch Fallback)
- Blinde Tester bewerten ≥ 60% der Seiten mit 4 oder 5 (von 5)
- End-to-End-Kosten bleiben unter $0.50 pro 300-Seiten-Buch

Die Pipeline gilt als **nicht tragfähig in aktueller Form** wenn:

- < 70% Formel-Recall bei Mistral OCR
- < 60% visuell korrekte MathML-Konvertierung
- Blinde Tester bewerten < 40% der Seiten mit 4 oder 5
- Systematische Fehlerklassen existieren, die nicht durch Preprocessing lösbar sind (z.B. bestimmte Formeltypen werden nie korrekt erkannt)