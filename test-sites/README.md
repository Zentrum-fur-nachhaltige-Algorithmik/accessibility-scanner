# Phase6a Test Websites

Testkollektion für iteratives Testen und Debuggen der Phase6a Implementierung (Basis-Wahrnehmbarkeit).

## 📁 Dateien

### Bad Examples (SOLL ALS SCHLECHT ERKANNT WERDEN)

1. **`bad-color-contrast.html`** - Farbkontrast-Verletzungen
   - Hellgrauer Text auf weißem Hintergrund (1.6:1)
   - Gelber Text auf weißem Hintergrund (1.1:1)
   - Hellblauer Text auf weißem Hintergrund (2.4:1)
   - Dunkle Links auf schwarzem Hintergrund
   - Orange Text auf rotem Hintergrund
   - Buttons und Formulare mit unzureichendem Kontrast
   - **Erwartung**: Phase6a erkennt 5+ Kontrast-Verletzungen mit hoher Konfidenz

2. **`bad-use-of-color.html`** - Falsche Verwendung von Farbe
   - Links nur durch Farbe unterschieden (ohne Unterstreichung)
   - Formular-Fehler nur durch rote Farbe
   - Pflichtfelder nur durch rote Sterne
   - Status-Nachrichten nur durch Hintergrundfarbe
   - Diagramme nur durch Farben unterschieden
   - Navigation aktiver Zustand nur durch Farbe
   - Verfügbarkeit nur durch Farbe angezeigt
   - **Erwartung**: Phase6a erkennt 7+ Use-of-Color-Verletzungen mit hoher Konfidenz

3. **`bad-images-of-text.html`** - Text in Bildern
   - Buttons mit Text als Bilder
   - Header/Überschriften als Bilder
   - Navigation mit Text-Bildern
   - Preise und wichtige Zahlen als Bilder
   - Call-to-Action Banner als Text-Bilder
   - Formular-Labels als Bilder
   - **Erwartung**: Phase6a erkennt 6+ Images-of-Text-Verletzungen mit mittlerer Konfidenz

### Good Examples (SOLL ALS GUT ERKANNT WERDEN)

4. **`good-accessibility.html`** - Beste Praktiken
   - Ausgezeichnete Farbkontraste (8.8:1+)
   - Links mit Unterstreichung UND Farbe
   - Formular-Fehler mit Icon + Text + Farbe + Rahmen
   - Pflichtfelder mit Text "(erforderlich)"
   - Status-Nachrichten mit Icon + Text + Hintergrund
   - Navigation mit mehreren visuellen Hinweisen
   - Diagramme mit zugänglicher Legende
   - Verfügbarkeit mit Symbol + Text + Farbe
   - **Erwartung**: Phase6a findet 0 Verletzungen, PASS-Ergebnis

## 🧪 Test Runner

**`test-runner.js`** - Automatisierter Test für Phase6a Genauigkeit
- Lädt alle HTML-Testdateien
- Führt Phase6a Scanner aus
- Validiert Ergebnisse gegen erwartete Werte
- Generiert detaillierten Bericht
- Performance-Tests (Scanner sollte <10 Sekunden brauchen)

### Verwendung:

```bash
# Test Runner ausführen
node test-runner.js

# Mit npm (falls package.json existiert)
npm test
```

### Erwartete Ergebnisse:

| Datei | Erwartetes Ergebnis | Konfidenz | Violations |
|-------|-------------------|-----------|------------|
| bad-color-contrast.html | FAIL | High | 5+ Color Contrast |
| bad-use-of-color.html | FAIL | High | 7+ Use of Color |
| bad-images-of-text.html | FAIL | Medium | 6+ Images of Text |
| good-accessibility.html | PASS | High | 0 Violations |

## 🎯 Phase6a Scanner Integration

Um diese Tests mit der echten Phase6a Implementierung zu verwenden:

1. **Import der Phase6a Scanner Funktion**:
   ```javascript
   // In test-runner.js, Zeile 13 anpassen:
   const { runPhase6aScan } = require('../phase6a/scanner');
   ```

2. **Mock-Funktion ersetzen**:
   ```javascript
   // runMockPhase6aScan() durch echten Scanner ersetzen:
   async function runRealPhase6aScan(htmlContent, filename) {
     return await runPhase6aScan(htmlContent, {
       enableColorContrast: true,
       enableUseOfColor: true, 
       enableImagesOfText: true
     });
   }
   ```

3. **Scanner-Output anpassen**:
   - Falls Phase6a andere Datenstruktur zurückgibt
   - Expected Results entsprechend anpassen

## 🔧 Debugging & Iterative Entwicklung

### 1. Einzelne Tests ausführen:
```javascript
// Nur Color Contrast testen
const htmlContent = fs.readFileSync('bad-color-contrast.html', 'utf8');
const results = await runPhase6aScan(htmlContent);
console.log(results);
```

### 2. Scanner-Parameter anpassen:
- Kontrast-Thresholds adjustieren
- Konfidenz-Schwellenwerte optimieren
- Heuristiken für Images-of-Text verbessern

### 3. False Positives/Negatives analysieren:
- Test-Cases erweitern wenn nötig
- Edge Cases identifizieren
- Scanner-Logik verfeinern

## 📊 EN 301 549 Mapping

Diese Tests validieren folgende EN 301 549 Kriterien:

- **9.1.4.1** Use of Color → `bad-use-of-color.html`
- **9.1.4.3** Contrast (Minimum) → `bad-color-contrast.html`  
- **9.1.4.5** Images of Text → `bad-images-of-text.html`

## 🚀 CI/CD Integration

Der Test Runner kann in CI/CD-Pipelines integriert werden:

```yaml
# GitHub Actions Beispiel
- name: Run Phase6a Tests
  run: |
    cd test-sites
    node test-runner.js
  # Exit code 0 = alle Tests bestanden
  # Exit code 1 = mindestens ein Test fehlgeschlagen
```

## 📝 Erweiterte Test-Cases

Für umfassendere Tests können weitere HTML-Dateien erstellt werden:

- `edge-cases-color-contrast.html` - Grenzfälle bei Kontrasten
- `complex-use-of-color.html` - Komplexe Farb-Szenarien
- `svg-images-of-text.html` - SVG-spezifische Text-Bilder
- `dynamic-content.html` - JavaScript-generierte Inhalte

## 🎛 Scanner-Konfiguration

Test-spezifische Scanner-Einstellungen:

```javascript
const scannerConfig = {
  colorContrast: {
    wcagLevel: 'AA',        // AA oder AAA
    largeTextThreshold: 18, // px
    boldTextThreshold: 14   // px für fetten Text
  },
  useOfColor: {
    checkLinks: true,
    checkForms: true,
    checkStatus: true,
    checkCharts: true
  },
  imagesOfText: {
    confidenceThreshold: 0.6,
    checkButtonImages: true,
    checkHeaderImages: true,
    checkNavigationImages: true
  }
};
```