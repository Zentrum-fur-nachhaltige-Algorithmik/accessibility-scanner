const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');

async function generatePDFReport() {
    console.log('🔄 Erzeuge PDF-Report für beeproduced.com...');
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        // Lade den HTML-Report
        const htmlPath = path.join(__dirname, 'beeproduced-accessibility-report.html');
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });
        
        // Erzeuge PDF
        const pdfPath = path.join(__dirname, 'beeproduced-accessibility-report.pdf');
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '15mm',
                bottom: '20mm',
                left: '15mm'
            }
        });
        
        console.log('✅ PDF-Report erfolgreich erstellt:', pdfPath);
        return pdfPath;
        
    } catch (error) {
        console.error('❌ Fehler bei PDF-Erstellung:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// CLI Ausführung
if (require.main === module) {
    generatePDFReport()
        .then(pdfPath => {
            console.log('\n🎉 PDF-Report fertig!');
            console.log('📄 Datei:', pdfPath);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 PDF-Erstellung fehlgeschlagen:', error);
            process.exit(1);
        });
}

module.exports = generatePDFReport;